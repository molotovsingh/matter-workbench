import process from "node:process";

import {
  PRIVATE_BETA_SIGNAL_STATUSES,
} from "../shared/private-beta-signal-lifecycle.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { httpError } from "./http.mjs";
import { generateIngestionToken, hashIngestionToken } from "./tokens.mjs";

const FEEDBACK_STATUSES = Object.freeze(["new", "reviewed", "needs_evidence", "fixed", "parked", "not_reproducible"]);
export const SIGNAL_STATUSES = PRIVATE_BETA_SIGNAL_STATUSES;

export function createMothershipStore({
  database,
  tokenFactory = generateIngestionToken,
  now = () => new Date(),
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

  async function updateFeedbackStatus({ installationId, feedbackId, status, actor = "operator", note = "" }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const normalizedFeedbackId = requireIdentifier(feedbackId, "feedbackId");
    const normalizedStatus = requireFeedbackStatus(status);
    const updatedAt = isoNow(now);
    const normalizedActor = sanitizeAuditText(actor || "operator", 120) || "operator";
    const normalizedNote = sanitizeAuditText(note, 500);
    const result = await database.query(
      `update mothership_feedback_events
       set status = $3,
           payload = jsonb_set(
             jsonb_set(
               jsonb_set(payload, '{status}', to_jsonb($3::text), true),
               '{operatorTriage}',
               jsonb_build_object(
                 'status', $3::text,
                 'updatedAt', $4::text,
                 'actor', $5::text,
                 'note', $6::text
               ),
               true
             ),
             '{operatorTriageHistory}',
             coalesce(payload->'operatorTriageHistory', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'status', $3::text,
               'updatedAt', $4::text,
               'actor', $5::text,
               'note', $6::text
             )),
             true
           )
       where installation_id = $1 and feedback_id = $2
       returning id`,
      [normalizedId, normalizedFeedbackId, normalizedStatus, updatedAt, normalizedActor, normalizedNote],
    );
    return {
      updated: (result.rowCount || 0) > 0,
      status: normalizedStatus,
      updatedAt,
      actor: normalizedActor,
      note: normalizedNote,
    };
  }

  async function ingestSignal({ installationId, signal }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const item = requireObject(signal, "signal");
    const signalId = requireIdentifier(item.id, "signal.id");
    const fingerprint = requireText(item.fingerprint, "signal.fingerprint", 200);
    const status = requireSignalStatus(item.status || "active");
    const statusUpdatedAt = status === "active"
      ? null
      : requireIso(item.statusUpdatedAt || item.updatedAt || item.lastSeenAt || item.createdAt, "signal.statusUpdatedAt");
    const payloadJson = JSON.stringify(item);

    if (status !== "active") {
      const lifecycle = await database.query(
        `update mothership_signal_events
         set status = $3,
             status_updated_at = $4::timestamptz,
             payload = jsonb_set($5::jsonb, '{status}', to_jsonb($3::text), true)
         where installation_id = $1
           and (signal_id = $2 or fingerprint = $6)
           and status = 'active'
         returning id, status`,
        [normalizedId, signalId, status, statusUpdatedAt, payloadJson, fingerprint],
      );
      const row = lifecycle.rows?.[0] || null;
      if (row) return { inserted: false, status: row.status || status, lifecycleUpdated: true };

      const existing = await database.query(
        `select signal_id, status
         from mothership_signal_events
         where installation_id = $1
           and (signal_id = $2 or fingerprint = $3)
         limit 1`,
        [normalizedId, signalId, fingerprint],
      );
      const existingRow = existing.rows?.[0] || null;
      if (existingRow) return { inserted: false, status: existingRow.status || "unchanged", lifecycleUpdated: false };
    }

    const result = await database.query(
      `insert into mothership_signal_events
         (installation_id, signal_id, source, severity, fingerprint, matter_name,
          occurrence_count, first_seen_at, last_seen_at, status, status_updated_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11::timestamptz, $12::jsonb)
       on conflict (installation_id, signal_id) do update
       set source = excluded.source,
           severity = excluded.severity,
           fingerprint = excluded.fingerprint,
           matter_name = excluded.matter_name,
           occurrence_count = greatest(mothership_signal_events.occurrence_count, excluded.occurrence_count),
           first_seen_at = least(mothership_signal_events.first_seen_at, excluded.first_seen_at),
           last_seen_at = greatest(mothership_signal_events.last_seen_at, excluded.last_seen_at),
           received_at = now(),
           status = case
             when mothership_signal_events.status in ('resolved', 'superseded')
               and excluded.status = 'active'
               and excluded.source <> 'job_status'
             then 'active'
             else mothership_signal_events.status
           end,
           status_updated_at = case
             when mothership_signal_events.status in ('resolved', 'superseded')
               and excluded.status = 'active'
               and excluded.source <> 'job_status'
             then excluded.last_seen_at
             else mothership_signal_events.status_updated_at
           end,
           payload = case
             when excluded.last_seen_at >= mothership_signal_events.last_seen_at then
               excluded.payload
               || jsonb_build_object('status', case
                 when mothership_signal_events.status in ('resolved', 'superseded')
                   and excluded.status = 'active'
                   and excluded.source <> 'job_status'
                 then 'active'
                 else mothership_signal_events.status
               end)
               || case when mothership_signal_events.payload ? 'operatorStatus'
                 then jsonb_build_object('operatorStatus', mothership_signal_events.payload->'operatorStatus')
                 else '{}'::jsonb end
               || case when mothership_signal_events.payload ? 'operatorStatusHistory'
                 then jsonb_build_object('operatorStatusHistory', mothership_signal_events.payload->'operatorStatusHistory')
                 else '{}'::jsonb end
             else mothership_signal_events.payload
           end
       where excluded.status = 'active'
       returning id, status, (xmax = 0) as inserted`,
      [
        normalizedId,
        signalId,
        requireText(item.source, "signal.source", 80),
        requireText(item.severity, "signal.severity", 40),
        fingerprint,
        optionalText(item.matterName, 300),
        positiveInteger(item.occurrenceCount, 1),
        requireIso(item.firstSeenAt || item.createdAt, "signal.firstSeenAt"),
        requireIso(item.lastSeenAt || item.updatedAt || item.createdAt, "signal.lastSeenAt"),
        status,
        statusUpdatedAt,
        payloadJson,
      ],
    );
    const row = result.rows?.[0] || null;
    return { inserted: row?.inserted === true, status: row?.status || "unchanged" };
  }

  async function updateSignalStatus({ installationId, signalId = "", fingerprint = "", status, actor = "operator", note = "" }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const normalizedSignalId = String(signalId || "").trim();
    const normalizedFingerprint = String(fingerprint || "").trim();
    if (!normalizedSignalId && !normalizedFingerprint) throw httpError("signalId or fingerprint is required", 400);
    const lookupColumn = normalizedSignalId ? "signal_id" : "fingerprint";
    const lookupValue = normalizedSignalId
      ? requireIdentifier(normalizedSignalId, "signalId")
      : requireText(normalizedFingerprint, "fingerprint", 200);
    const normalizedStatus = requireSignalStatus(status);
    const updatedAt = isoNow(now);
    const normalizedActor = sanitizeAuditText(actor || "operator", 120) || "operator";
    const normalizedNote = sanitizeAuditText(note, 500);
    const result = await database.query(
      `update mothership_signal_events
       set status = $3,
           status_updated_at = $4::timestamptz,
           payload = jsonb_set(
             jsonb_set(
               jsonb_set(payload, '{status}', to_jsonb($3::text), true),
               '{operatorStatus}',
               jsonb_build_object(
                 'status', $3::text,
                 'updatedAt', $4::text,
                 'actor', $5::text,
                 'note', $6::text
               ),
               true
             ),
             '{operatorStatusHistory}',
             coalesce(payload->'operatorStatusHistory', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'status', $3::text,
               'updatedAt', $4::text,
               'actor', $5::text,
               'note', $6::text
             )),
             true
           )
       where installation_id = $1 and ${lookupColumn} = $2
       returning signal_id, fingerprint, status`,
      [normalizedId, lookupValue, normalizedStatus, updatedAt, normalizedActor, normalizedNote],
    );
    const row = result.rows?.[0] || null;
    return {
      updated: (result.rowCount || 0) > 0,
      signalId: row?.signal_id || (lookupColumn === "signal_id" ? lookupValue : ""),
      fingerprint: row?.fingerprint || (lookupColumn === "fingerprint" ? lookupValue : ""),
      status: normalizedStatus,
      updatedAt,
      actor: normalizedActor,
      note: normalizedNote,
    };
  }

  async function ingestMetricSnapshot({ installationId, metric }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const item = requireObject(metric, "metric");
    const result = await database.query(
      `insert into mothership_metric_snapshots
         (installation_id, snapshot_id, captured_at, payload)
       values ($1, $2, $3::timestamptz, $4::jsonb)
       on conflict (installation_id, snapshot_id) do update
       set captured_at = excluded.captured_at,
           received_at = now(),
           payload = excluded.payload
       returning id, (xmax = 0) as inserted`,
      [
        normalizedId,
        requireIdentifier(item.id, "metric.id"),
        requireIso(item.createdAt, "metric.createdAt"),
        JSON.stringify(item),
      ],
    );
    return { inserted: result.rows?.[0]?.inserted === true };
  }

  async function ingestHeartbeat({ installationId, heartbeat }) {
    const normalizedId = requireIdentifier(installationId, "installationId");
    const item = requireObject(heartbeat, "heartbeat");
    const result = await database.query(
      `insert into mothership_heartbeat_events
         (installation_id, heartbeat_id, captured_at, payload)
       values ($1, $2, $3::timestamptz, $4::jsonb)
       on conflict (installation_id, heartbeat_id) do update
       set captured_at = excluded.captured_at,
           received_at = now(),
           payload = excluded.payload
       returning id, (xmax = 0) as inserted`,
      [
        normalizedId,
        requireIdentifier(item.id, "heartbeat.id"),
        requireIso(item.createdAt || item.sentAt, "heartbeat.createdAt"),
        JSON.stringify(item),
      ],
    );
    return { inserted: result.rows?.[0]?.inserted === true };
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
    const metrics = await database.query(
      `delete from mothership_metric_snapshots
       where received_at < now() - ($1::integer * interval '1 day')`,
      [days],
    );
    const heartbeats = await database.query(
      `delete from mothership_heartbeat_events
       where received_at < now() - ($1::integer * interval '1 day')`,
      [days],
    );
    return {
      feedbackDeleted: feedback.rowCount || 0,
      signalsDeleted: signals.rowCount || 0,
      metricsDeleted: metrics.rowCount || 0,
      heartbeatsDeleted: heartbeats.rowCount || 0,
      retentionDays: days,
    };
  }

  async function health() {
    const result = await database.query("select 1 as ok");
    return { database: result.rows?.[0]?.ok === 1 ? "ready" : "unavailable" };
  }

  async function queryReport({ sinceDays = 30, installationId } = {}) {
    const days = positiveInteger(sinceDays, 30);
    const filter = installationId
      ? { clause: "and installation_id = $2", values: [days, requireIdentifier(installationId, "installationId")] }
      : { clause: "", values: [days] };
    const [feedback, signals, metrics, heartbeats] = await Promise.all([
      database.query(
        `select installation_id, feedback_id, classification, status, matter_name,
                occurred_at, received_at, payload
         from mothership_feedback_events
         where received_at >= now() - ($1::integer * interval '1 day') ${filter.clause}
         order by received_at desc`,
        filter.values,
      ),
      database.query(
        `select installation_id, signal_id, source, severity, fingerprint, matter_name,
                occurrence_count, first_seen_at, last_seen_at, received_at, status, status_updated_at, payload
         from mothership_signal_events
         where received_at >= now() - ($1::integer * interval '1 day') ${filter.clause}
         order by received_at desc`,
        filter.values,
      ),
      database.query(
        `select installation_id, snapshot_id, captured_at, received_at, payload
         from mothership_metric_snapshots
         where received_at >= now() - ($1::integer * interval '1 day') ${filter.clause}
         order by received_at desc`,
        filter.values,
      ),
      database.query(
        `select installation_id, heartbeat_id, captured_at, received_at, payload
         from mothership_heartbeat_events
         where received_at >= now() - ($1::integer * interval '1 day') ${filter.clause}
         order by received_at desc`,
        filter.values,
      ),
    ]);
    return {
      sinceDays: days,
      ...(installationId ? { installationId: filter.values[1] } : {}),
      feedback: feedback.rows || [],
      signals: signals.rows || [],
      metrics: metrics.rows || [],
      heartbeats: heartbeats.rows || [],
    };
  }

  async function listInstallations({ sinceDays = 30 } = {}) {
    const days = positiveInteger(sinceDays, 30);
    const result = await database.query(
      `select i.installation_id,
              i.label,
              i.status,
              i.created_at,
              i.updated_at,
              i.revoked_at,
              hb.latest_heartbeat_received_at,
              coalesce(sig.recent_signal_count, 0) as recent_signal_count,
              coalesce(fb.recent_feedback_count, 0) as recent_feedback_count
         from mothership_installations i
         left join (
           select installation_id, max(received_at) as latest_heartbeat_received_at
           from mothership_heartbeat_events
           group by installation_id
         ) hb on hb.installation_id = i.installation_id
         left join (
           select installation_id, count(*)::integer as recent_signal_count
           from mothership_signal_events
           where status = 'active'
             and received_at >= now() - ($1::integer * interval '1 day')
           group by installation_id
         ) sig on sig.installation_id = i.installation_id
         left join (
           select installation_id, count(*)::integer as recent_feedback_count
           from mothership_feedback_events
           where received_at >= now() - ($1::integer * interval '1 day')
           group by installation_id
         ) fb on fb.installation_id = i.installation_id
         order by i.created_at desc`,
      [days],
    );
    const rows = result.rows || [];
    return {
      sinceDays: days,
      installations: rows.map((row) => ({
        installationId: String(row.installation_id || ""),
        label: String(row.label || ""),
        status: String(row.status || ""),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        revokedAt: toIso(row.revoked_at),
        latestHeartbeatReceivedAt: toIso(row.latest_heartbeat_received_at),
        recentSignalCount: positiveInteger(row.recent_signal_count, 0),
        recentFeedbackCount: positiveInteger(row.recent_feedback_count, 0),
      })),
    };
  }

  return {
    registerInstallation,
    authorizeIngestion,
    revokeInstallation,
    ingestFeedback,
    updateFeedbackStatus,
    ingestSignal,
    updateSignalStatus,
    ingestMetricSnapshot,
    ingestHeartbeat,
    pruneExpired,
    health,
    queryReport,
    listInstallations,
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

function requireFeedbackStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!FEEDBACK_STATUSES.includes(status)) {
    throw httpError(`feedback status must be one of: ${FEEDBACK_STATUSES.join(", ")}`, 400);
  }
  return status;
}

function requireSignalStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!SIGNAL_STATUSES.includes(status)) {
    throw httpError(`signal status must be one of: ${SIGNAL_STATUSES.join(", ")}`, 400);
  }
  return status;
}

function sanitizeAuditText(value, maxLength) {
  return redactSensitiveText(String(value || "")).slice(0, maxLength).trim();
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

function isoNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
