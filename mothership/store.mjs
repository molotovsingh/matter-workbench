import process from "node:process";

import { generateIngestionToken, hashIngestionToken } from "./tokens.mjs";

export function createMothershipStore({
  database,
  tokenFactory = generateIngestionToken,
} = {}) {
  if (!database?.query || !database?.transaction) {
    throw new Error("Mothership store requires a database query and transaction adapter.");
  }

  async function registerInstallation({ installationId, label }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const normalizedLabel = requireText(label, "label", 200);
    const token = tokenFactory();
    await database.transaction(async (client) => {
      await client.query(
        `insert into mothership_installations (installation_id, label, status, updated_at, revoked_at)
         values ($1, $2, 'active', now(), null)
         on conflict (installation_id) do update
         set label = excluded.label, status = 'active', updated_at = now(), revoked_at = null`,
        [normalizedId, normalizedLabel],
      );
      await client.query(
        `update mothership_ingestion_tokens
         set status = 'revoked', revoked_at = now()
         where installation_id = $1 and status = 'active'`,
        [normalizedId],
      );
      await client.query(
        `insert into mothership_ingestion_tokens
           (installation_id, token_sha256, token_prefix, status)
         values ($1, $2, $3, 'active')`,
        [normalizedId, token.tokenSha256, token.tokenPrefix],
      );
    });
    return { installationId: normalizedId, label: normalizedLabel, rawToken: token.rawToken, tokenPrefix: token.tokenPrefix };
  }

  async function authorizeIngestion({ rawToken, installationId }) {
    const token = String(rawToken || "").trim();
    if (!token) throw httpError("Missing ingestion token", 401);
    const normalizedId = requireIdentifier(installationId, "installId");
    const result = await database.query(
      `select t.installation_id, t.status as token_status, i.status as installation_status
       from mothership_ingestion_tokens t
       join mothership_installations i on i.installation_id = t.installation_id
       where t.token_sha256 = $1
       limit 1`,
      [hashIngestionToken(token)],
    );
    const row = result.rows?.[0];
    if (!row) throw httpError("Invalid ingestion token", 401);
    if (row.installation_id !== normalizedId) throw httpError("Token installation does not match payload installId", 403);
    if (row.token_status !== "active" || row.installation_status !== "active") {
      throw httpError("Installation or token has been revoked", 403);
    }
    return { installationId: row.installation_id };
  }

  async function revokeInstallation({ installationId }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    let installationUpdated = 0;
    await database.transaction(async (client) => {
      const installation = await client.query(
        `update mothership_installations
         set status = 'revoked', revoked_at = now(), updated_at = now()
         where installation_id = $1 and status <> 'revoked'`,
        [normalizedId],
      );
      installationUpdated = installation.rowCount || 0;
      await client.query(
        `update mothership_ingestion_tokens
         set status = 'revoked', revoked_at = now()
         where installation_id = $1 and status <> 'revoked'`,
        [normalizedId],
      );
    });
    return installationUpdated > 0;
  }

  async function ingestFeedback({ installationId, feedback }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const item = requireObject(feedback, "feedback");
    const result = await database.query(
      `insert into mothership_feedback_events
         (installation_id, feedback_id, classification, status, matter_name, occurred_at, payload)
       values ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)
       on conflict (installation_id, feedback_id) do nothing
       returning id`,
      [
        normalizedId,
        requireIdentifier(item.id, "feedback.id"),
        requireText(item.classification, "feedback.classification", 80),
        requireText(item.status || "new", "feedback.status", 80),
        optionalText(item.context?.activeMatterName, 300),
        requireIso(item.createdAt, "feedback.createdAt"),
        JSON.stringify(item),
      ],
    );
    return { inserted: (result.rowCount || 0) > 0 };
  }

  async function ingestSignal({ installationId, signal }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const item = requireObject(signal, "signal");
    const result = await database.query(
      `insert into mothership_signal_events
         (installation_id, signal_id, source, severity, fingerprint, matter_name,
          occurrence_count, first_seen_at, last_seen_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::jsonb)
       on conflict (installation_id, signal_id) do nothing
       returning id`,
      [
        normalizedId,
        requireIdentifier(item.id, "signal.id"),
        requireText(item.source, "signal.source", 80),
        requireText(item.severity, "signal.severity", 40),
        requireText(item.fingerprint, "signal.fingerprint", 200),
        optionalText(item.matterName, 300),
        positiveInteger(item.occurrenceCount, 1),
        requireIso(item.firstSeenAt || item.createdAt, "signal.firstSeenAt"),
        requireIso(item.lastSeenAt || item.updatedAt || item.createdAt, "signal.lastSeenAt"),
        JSON.stringify(item),
      ],
    );
    return { inserted: (result.rowCount || 0) > 0 };
  }

  async function pruneExpired({ retentionDays = 180 } = {}) {
    const days = positiveInteger(retentionDays, 180);
    const feedback = await database.query(
      `delete from mothership_feedback_events
       where received_at < now() - ($1::integer * interval '1 day')`,
      [days],
    );
    const signals = await database.query(
      `delete from mothership_signal_events
       where received_at < now() - ($1::integer * interval '1 day')`,
      [days],
    );
    return { feedbackDeleted: feedback.rowCount || 0, signalsDeleted: signals.rowCount || 0, retentionDays: days };
  }

  async function health() {
    const result = await database.query("select 1 as ok");
    return { database: result.rows?.[0]?.ok === 1 ? "ready" : "unavailable" };
  }

  async function queryReport({ sinceDays = 30 } = {}) {
    const days = positiveInteger(sinceDays, 30);
    const [feedback, signals] = await Promise.all([
      database.query(
        `select installation_id, feedback_id, classification, status, matter_name,
                occurred_at, received_at, payload
         from mothership_feedback_events
         where received_at >= now() - ($1::integer * interval '1 day')
         order by received_at desc`,
        [days],
      ),
      database.query(
        `select installation_id, signal_id, source, severity, fingerprint, matter_name,
                occurrence_count, first_seen_at, last_seen_at, received_at, payload
         from mothership_signal_events
         where received_at >= now() - ($1::integer * interval '1 day')
         order by received_at desc`,
        [days],
      ),
    ]);
    return { sinceDays: days, feedback: feedback.rows || [], signals: signals.rows || [] };
  }

  return {
    registerInstallation,
    authorizeIngestion,
    revokeInstallation,
    ingestFeedback,
    ingestSignal,
    pruneExpired,
    health,
    queryReport,
  };
}

export async function createPostgresMothershipDatabase({ connectionString = process.env.MOTHERSHIP_DATABASE_URL } = {}) {
  if (!String(connectionString || "").trim()) throw new Error("MOTHERSHIP_DATABASE_URL is required");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });
  return {
    query: (text, values = []) => pool.query(text, values),
    transaction: async (operation) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await operation(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function requireIdentifier(value, field) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(text)) throw httpError(`${field} is invalid`, 400);
  return text;
}

function requireText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw httpError(`${field} is required`, 400);
  return text.slice(0, maxLength);
}

function optionalText(value, maxLength) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function requireIso(value, field) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) throw httpError(`${field} must be an ISO timestamp`, 400);
  return date.toISOString();
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(`${field} is required`, 400);
  return value;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
