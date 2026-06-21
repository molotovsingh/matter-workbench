#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMothershipStore } from "../mothership/store.mjs";
import { createMothershipServer } from "../mothership/server.mjs";
import { createConsoleAuthService, hashConsolePassword } from "../mothership/console-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consoleDist = path.resolve(__dirname, "..", "mothership", "console", "dist");

const OPERATOR_PASSWORD_HASH = hashConsolePassword("demo", { iterations: 5000 });

function createDemoDatabase() {
  const tables = { installations: [], feedback: [], signals: [], metrics: [], heartbeats: [] };
  seedDemoData(tables);

  function query(text, values = []) {
    const sql = text.toLowerCase();
    if (sql.includes("select 1 as ok")) return Promise.resolve({ rows: [{ ok: 1 }], rowCount: 1 });
    if (sql.includes("from mothership_installations i")) return Promise.resolve(queryInstallations(values, tables));
    if (sql.includes("from mothership_feedback_events")) return Promise.resolve(queryFeedback(values, tables));
    if (sql.includes("from mothership_signal_events")) return Promise.resolve(querySignals(values, tables));
    if (sql.includes("from mothership_metric_snapshots")) return Promise.resolve(queryMetrics(values, tables));
    if (sql.includes("from mothership_heartbeat_events")) return Promise.resolve(queryHeartbeats(values, tables));
    if (sql.includes("update mothership_installations")) return Promise.resolve({ rows: [], rowCount: 1 });
    if (sql.includes("update mothership_feedback_events")) return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  async function transaction(operation) {
    return operation({ query: (text, values = []) => query(text, values) });
  }

  return { query, transaction, close: () => {} };
}

function queryInstallations(values, tables) {
  const days = values[0] || 30;
  const now = Date.now();
  return {
    rows: tables.installations.map((inst) => {
      const hb = tables.heartbeats.filter((h) => h.installation_id === inst.installation_id);
      const latestHb = hb.sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))[0];
      const recentSignals = tables.signals.filter((s) => s.installation_id === inst.installation_id && Date.parse(s.received_at) >= now - days * 86400000).length;
      const recentFeedback = tables.feedback.filter((f) => f.installation_id === inst.installation_id && Date.parse(f.received_at) >= now - days * 86400000).length;
      return {
        installation_id: inst.installation_id, label: inst.label, status: inst.status,
        created_at: inst.created_at, updated_at: inst.updated_at, revoked_at: inst.revoked_at,
        latest_heartbeat_received_at: latestHb?.received_at || null,
        recent_signal_count: recentSignals, recent_feedback_count: recentFeedback,
      };
    }),
    rowCount: tables.installations.length,
  };
}

function queryFeedback(values, tables) {
  const days = values[0] || 30;
  const installationId = values[1];
  const now = Date.now();
  let rows = tables.feedback.filter((f) => Date.parse(f.received_at) >= now - days * 86400000);
  if (installationId) rows = rows.filter((f) => f.installation_id === installationId);
  return { rows: rows.sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)), rowCount: rows.length };
}

function querySignals(values, tables) {
  const days = values[0] || 30;
  const installationId = values[1];
  const now = Date.now();
  let rows = tables.signals.filter((s) => Date.parse(s.received_at) >= now - days * 86400000);
  if (installationId) rows = rows.filter((s) => s.installation_id === installationId);
  return { rows: rows.sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)), rowCount: rows.length };
}

function queryMetrics(values, tables) {
  const days = values[0] || 30;
  const installationId = values[1];
  const now = Date.now();
  let rows = tables.metrics.filter((m) => Date.parse(m.received_at) >= now - days * 86400000);
  if (installationId) rows = rows.filter((m) => m.installation_id === installationId);
  return { rows: rows.sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)), rowCount: rows.length };
}

function queryHeartbeats(values, tables) {
  const days = values[0] || 30;
  const installationId = values[1];
  const now = Date.now();
  let rows = tables.heartbeats.filter((h) => Date.parse(h.received_at) >= now - days * 86400000);
  if (installationId) rows = rows.filter((h) => h.installation_id === installationId);
  return { rows: rows.sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)), rowCount: rows.length };
}

function seedDemoData(tables) {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

  tables.installations = [
    { installation_id: "firm-alpha-01", label: "Singh & Partners — Alpha", status: "active", created_at: daysAgo(45), updated_at: hoursAgo(2), revoked_at: null },
    { installation_id: "firm-beta-02", label: "Patel Legal — Beta", status: "active", created_at: daysAgo(20), updated_at: hoursAgo(6), revoked_at: null },
    { installation_id: "firm-gamma-03", label: "Mehta Associates — Gamma", status: "revoked", created_at: daysAgo(60), updated_at: daysAgo(3), revoked_at: daysAgo(3) },
  ];

  tables.feedback = [
    {
      installation_id: "firm-alpha-01", feedback_id: "fb_001", classification: "bug", status: "new", matter_name: "Gionee v. Creditor",
      occurred_at: hoursAgo(3), received_at: hoursAgo(3),
      payload: { id: "fb_001", classification: "bug", status: "new", createdAt: hoursAgo(3), tryingToDo: "Ask Copilot about the source index", happenedInstead: "The answer cited a file that doesn't exist in the record.", context: { activeMatterName: "Gionee v. Creditor", username: "aks@firm-alpha.com", displayName: "Aks" } },
    },
    {
      installation_id: "firm-alpha-01", feedback_id: "fb_002", classification: "confusing_ux", status: "reviewed", matter_name: "Gionee v. Creditor",
      occurred_at: hoursAgo(8), received_at: hoursAgo(8),
      payload: { id: "fb_002", classification: "confusing_ux", status: "reviewed", createdAt: hoursAgo(8), tryingToDo: "Understand why List of Dates didn't run automatically", happenedInstead: "I waited 10 minutes and nothing happened.", context: { activeMatterName: "Gionee v. Creditor", username: "shivangi@firm-alpha.com", displayName: "Shivangi" } },
    },
    {
      installation_id: "firm-beta-02", feedback_id: "fb_003", classification: "feature_request", status: "needs_evidence", matter_name: "Estate of Kapoor",
      occurred_at: hoursAgo(20), received_at: hoursAgo(20),
      payload: { id: "fb_003", classification: "feature_request", status: "needs_evidence", createdAt: hoursAgo(20), tryingToDo: "Add a deadline calendar", happenedInstead: "I want to see all filing deadlines in one view.", context: { activeMatterName: "Estate of Kapoor", username: "raj@firm-beta.com", displayName: "Raj" } },
    },
  ];

  tables.signals = [
    {
      installation_id: "firm-alpha-01", signal_id: "sig_001", source: "job_status", severity: "error", fingerprint: "extract-failed-1",
      matter_name: "Gionee v. Creditor", occurrence_count: 3, first_seen_at: hoursAgo(12), last_seen_at: hoursAgo(1), received_at: hoursAgo(1),
      payload: { id: "sig_001", source: "job_status", severity: "error", fingerprint: "extract-failed-1", matterName: "Gionee v. Creditor", occurrenceCount: 3, firstSeenAt: hoursAgo(12), lastSeenAt: hoursAgo(1), title: "Label Sources failed", details: { errorMessage: "No extraction records found. Run /extract before creating a source index." } },
    },
    {
      installation_id: "firm-alpha-01", signal_id: "sig_002", source: "job_status", severity: "warning", fingerprint: "slow-ocr-1",
      matter_name: "Gionee v. Creditor", occurrence_count: 2, first_seen_at: hoursAgo(18), last_seen_at: hoursAgo(5), received_at: hoursAgo(5),
      payload: { id: "sig_002", source: "job_status", severity: "warning", fingerprint: "slow-ocr-1", matterName: "Gionee v. Creditor", occurrenceCount: 2, firstSeenAt: hoursAgo(18), lastSeenAt: hoursAgo(5), title: "Slow OCR step", details: { message: "One OCR step took 4 minutes." } },
    },
    {
      installation_id: "firm-beta-02", signal_id: "sig_003", source: "provider", severity: "warning", fingerprint: "rate-limit-1",
      matter_name: "Estate of Kapoor", occurrence_count: 1, first_seen_at: hoursAgo(6), last_seen_at: hoursAgo(6), received_at: hoursAgo(6),
      payload: { id: "sig_003", source: "provider", severity: "warning", fingerprint: "rate-limit-1", matterName: "Estate of Kapoor", occurrenceCount: 1, firstSeenAt: hoursAgo(6), lastSeenAt: hoursAgo(6), title: "OpenRouter rate limit", details: { message: "Provider returned 429. Retried after backoff." } },
    },
  ];

  tables.metrics = [
    {
      installation_id: "firm-alpha-01", snapshot_id: "met_001", captured_at: hoursAgo(1), received_at: hoursAgo(1),
      payload: { id: "met_001", createdAt: hoursAgo(1), scores: { backendSuitability: 78, portability: 85, restoreConfidence: 65, capacityHeadroom: 72, userPatienceRisk: "medium" }, latency: { p95Ms: 420, silentWaitMaxMs: 1800 }, runtime: { diskFreePercent: 68 } },
    },
    {
      installation_id: "firm-alpha-01", snapshot_id: "met_002", captured_at: hoursAgo(6), received_at: hoursAgo(6),
      payload: { id: "met_002", createdAt: hoursAgo(6), scores: { backendSuitability: 74, portability: 82, restoreConfidence: 60, capacityHeadroom: 70, userPatienceRisk: "high" }, latency: { p95Ms: 580, silentWaitMaxMs: 3200 }, runtime: { diskFreePercent: 65 } },
    },
    {
      installation_id: "firm-alpha-01", snapshot_id: "met_003", captured_at: hoursAgo(12), received_at: hoursAgo(12),
      payload: { id: "met_003", createdAt: hoursAgo(12), scores: { backendSuitability: 71, portability: 80, restoreConfidence: 58, capacityHeadroom: 68, userPatienceRisk: "high" }, latency: { p95Ms: 650, silentWaitMaxMs: 4100 }, runtime: { diskFreePercent: 62 } },
    },
    {
      installation_id: "firm-beta-02", snapshot_id: "met_004", captured_at: hoursAgo(4), received_at: hoursAgo(4),
      payload: { id: "met_004", createdAt: hoursAgo(4), scores: { backendSuitability: 82, portability: 88, restoreConfidence: 75, capacityHeadroom: 80, userPatienceRisk: "low" }, latency: { p95Ms: 280, silentWaitMaxMs: 800 }, runtime: { diskFreePercent: 85 } },
    },
  ];

  tables.heartbeats = [
    {
      installation_id: "firm-alpha-01", heartbeat_id: "hb_001", captured_at: hoursAgo(0.5), received_at: hoursAgo(0.5),
      payload: {
        id: "hb_001", createdAt: hoursAgo(0.5), activeSessions: 2, highestPatienceRisk: "high",
        journeys: [
          { user: "aks@firm-alpha.com", matter: "Gionee v. Creditor", screen: "Matter Overview", route: "/matter/overview", lastAction: "Asked Copilot", currentStage: "source_labels", currentStageStatus: "failed", traceId: "trace_001", jobId: "job_001", lastError: "No extraction records found", patienceRisk: "high" },
          { user: "shivangi@firm-alpha.com", matter: "Gionee v. Creditor", screen: "List of Dates", route: "/matter/listofdates", lastAction: "Waiting for preparation", currentStage: "extract_documents", currentStageStatus: "running", traceId: "trace_002", jobId: "job_002", lastError: "", patienceRisk: "medium" },
        ],
        matterHealth: [
          { matter: "Gionee v. Creditor", prepareState: "stale", nextStepLabel: "Extract Documents", attentionState: "warning", blockers: 1, warnings: 1, checkedAt: hoursAgo(0.5) },
          { matter: "Sharma Estate", prepareState: "complete", nextStepLabel: "Core preparation is current", attentionState: "clear", blockers: 0, warnings: 0, checkedAt: hoursAgo(0.5) },
        ],
        counters: { failedJobs: 1, runningJobs: 1 },
      },
    },
    {
      installation_id: "firm-beta-02", heartbeat_id: "hb_002", captured_at: hoursAgo(4), received_at: hoursAgo(4),
      payload: {
        id: "hb_002", createdAt: hoursAgo(4), activeSessions: 1, highestPatienceRisk: "low",
        journeys: [
          { user: "raj@firm-beta.com", matter: "Estate of Kapoor", screen: "Skills", route: "/skills", lastAction: "Ran /describe_sources", currentStage: "source_labels", currentStageStatus: "succeeded", traceId: "trace_003", jobId: "job_003", lastError: "", patienceRisk: "low" },
        ],
        matterHealth: [
          { matter: "Estate of Kapoor", prepareState: "complete", nextStepLabel: "Core preparation is current", attentionState: "clear", blockers: 0, warnings: 0, checkedAt: hoursAgo(4) },
        ],
        counters: { failedJobs: 0, runningJobs: 0 },
      },
    },
  ];
}

async function main() {
  const database = createDemoDatabase();
  const store = createMothershipStore({ database });
  const auth = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_USERNAME: "aks_hemanth",
      MOTHERSHIP_CONSOLE_PASSWORD_HASH: OPERATOR_PASSWORD_HASH,
      MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS: "28800",
    },
  });

  const app = createMothershipServer({ store, consoleAuth: auth, consoleAssetRoot: consoleDist });
  const port = Number(process.env.MOTHERSHIP_PORT || 4192);
  const host = "127.0.0.1";

  await new Promise((resolve) => app.server.listen(port, host, resolve));
  console.log("");
  console.log("  Mothership Console — DEMO MODE");
  console.log(`  URL:      http://${host}:${port}/`);
  console.log("  Username: aks_hemanth");
  console.log("  Password: demo");
  console.log("  Press Ctrl+C to stop");
  console.log("");

  const close = () => { app.server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref(); };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
