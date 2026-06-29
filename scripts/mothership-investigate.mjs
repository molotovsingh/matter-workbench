#!/usr/bin/env node
import process from "node:process";

import { createMothershipStore, createPostgresMothershipDatabase } from "../mothership/store.mjs";
import { loadMothershipScriptEnv } from "./mothership-env.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const SCHEMA_VERSION = "mothership-investigation/v1";
const DEFAULT_SINCE_HOURS = 72;
const DEFAULT_WINDOW_MINUTES = 20;
const DEFAULT_LIMIT = 12;
const LARGE_FILE_TERMS = Object.freeze([
  "large",
  "larger",
  "heavy",
  "slow",
  "time",
  "taking",
  "read",
  "reading",
  "process",
  "processed",
  "extract",
  "extraction",
  "rerun",
  "502",
  "bad gateway",
  "failed to fetch",
]);

export function parseMothershipInvestigateArgs(argv = []) {
  const parsed = {
    preset: "large-files",
    user: "",
    matter: "",
    text: "",
    sinceHours: DEFAULT_SINCE_HOURS,
    windowMinutes: DEFAULT_WINDOW_MINUTES,
    limit: DEFAULT_LIMIT,
    format: "markdown",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (/password|token|secret/i.test(key)) throw new Error("Mothership investigation does not accept secrets through command arguments.");
    if (key === "json") {
      parsed.format = "json";
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    index += 1;
    if (key === "preset") parsed.preset = normalizePreset(value);
    else if (key === "user") parsed.user = cleanText(value, 160);
    else if (key === "matter") parsed.matter = cleanText(value, 300);
    else if (key === "text" || key === "keyword" || key === "keywords") parsed.text = cleanText(value, 400);
    else if (key === "since-hours") parsed.sinceHours = positiveInteger(value, DEFAULT_SINCE_HOURS);
    else if (key === "window-minutes") parsed.windowMinutes = positiveInteger(value, DEFAULT_WINDOW_MINUTES);
    else if (key === "limit") parsed.limit = positiveInteger(value, DEFAULT_LIMIT);
    else if (key === "format") parsed.format = normalizeFormat(value);
    else throw new Error(`Unknown option: --${key}`);
  }

  return parsed;
}

export async function runMothershipInvestigate({
  argv = process.argv.slice(2),
  store,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
  env = process.env,
  now = () => new Date(),
} = {}) {
  let database;
  try {
    const options = parseMothershipInvestigateArgs(argv);
    if (!store) {
      await loadMothershipScriptEnv({ targetEnv: env, override: false });
      database = await createPostgresMothershipDatabase({ connectionString: env.MOTHERSHIP_DATABASE_URL });
      store = createMothershipStore({ database });
    }
    const sinceDays = Math.max(1, Math.ceil(options.sinceHours / 24));
    const dataset = await store.queryReport({ sinceDays });
    const report = buildMothershipInvestigation(dataset, { ...options, now: now() });
    stdout(options.format === "json" ? JSON.stringify(report, null, 2) : renderMothershipInvestigationMarkdown(report).trimEnd());
    return 0;
  } catch (error) {
    stderr(redactSensitiveText(String(error?.message || error || "Mothership investigation failed")).slice(0, 500));
    return 1;
  } finally {
    await database?.close?.();
  }
}

export function buildMothershipInvestigation(dataset = {}, options = {}) {
  const now = toDate(options.now) || new Date();
  const sinceHours = positiveInteger(options.sinceHours, DEFAULT_SINCE_HOURS);
  const cutoff = new Date(now.getTime() - sinceHours * 60 * 60 * 1000);
  const windowMinutes = positiveInteger(options.windowMinutes, DEFAULT_WINDOW_MINUTES);
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT);
  const query = {
    preset: normalizePreset(options.preset || "large-files"),
    user: cleanText(options.user || "", 160),
    matter: cleanText(options.matter || "", 300),
    text: cleanText(options.text || "", 400),
    sinceHours,
    windowMinutes,
    limit,
  };
  const terms = investigationTerms(query);
  const feedback = rowsSince(dataset.feedback, cutoff)
    .map(normalizeFeedbackRow)
    .filter((item) => matchesInvestigation(item.searchText, { query, terms }))
    .slice(0, limit);
  const matterHints = Array.from(new Set([
    query.matter,
    ...feedback.map((item) => item.matter),
  ].map(normalizeLookup).filter(Boolean)));

  const heartbeats = rowsSince(dataset.heartbeats, cutoff).map(normalizeHeartbeatRow);
  const signals = rowsSince(dataset.signals, cutoff)
    .map(normalizeSignalRow)
    .filter((item) => matchesSignal(item, { query, terms, matterHints }))
    .slice(0, Math.max(limit * 2, limit));
  const latestHeartbeat = heartbeats[0] || null;
  const latestMatterHealth = latestHeartbeat
    ? summarizeMatterHealth(latestHeartbeat.payload?.matterHealth, matterHints)
    : [];

  const feedbackWithEvidence = feedback.map((item) => ({
    ...item,
    relatedSignals: nearbySignals(signals, item, windowMinutes),
    relatedHeartbeats: nearbyHeartbeats(heartbeats, item, windowMinutes, matterHints.length ? matterHints : [normalizeLookup(item.matter)]),
  }));

  const openFeedbackCounts = countOpenFeedback(rowsSince(dataset.feedback, cutoff).map(normalizeFeedbackRow), { query, terms });

  return {
    schema_version: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    query,
    counts: {
      feedbackMatched: feedbackWithEvidence.length,
      signalsMatched: signals.length,
      heartbeatsScanned: heartbeats.length,
      openFeedbackMatched: openFeedbackCounts.reduce((sum, row) => sum + row.count, 0),
    },
    latestHeartbeat: latestHeartbeat ? {
      capturedAt: latestHeartbeat.capturedAt,
      receivedAt: latestHeartbeat.receivedAt,
      counters: latestHeartbeat.payload?.counters || {},
      activeSessions: latestHeartbeat.payload?.activeSessions ?? null,
    } : null,
    latestMatterHealth,
    openFeedbackCounts,
    feedback: feedbackWithEvidence,
    signals,
  };
}

export function renderMothershipInvestigationMarkdown(report = {}) {
  const lines = [
    "# Mothership Investigation",
    "",
    `Generated: ${report.generatedAt || ""}`,
    `Preset: ${report.query?.preset || ""}`,
    `User: ${report.query?.user || "(any)"}`,
    `Matter: ${report.query?.matter || "(any)"}`,
    `Text: ${report.query?.text || "(preset terms)"}`,
    `Window: last ${report.query?.sinceHours || DEFAULT_SINCE_HOURS}h; nearby ±${report.query?.windowMinutes || DEFAULT_WINDOW_MINUTES}m`,
    "",
    "## Summary",
    "",
    `- feedback matched: ${report.counts?.feedbackMatched ?? 0}`,
    `- open feedback matched: ${report.counts?.openFeedbackMatched ?? 0}`,
    `- signals matched: ${report.counts?.signalsMatched ?? 0}`,
    `- heartbeats scanned: ${report.counts?.heartbeatsScanned ?? 0}`,
  ];

  if (report.latestHeartbeat) {
    lines.push(`- latest heartbeat: ${report.latestHeartbeat.capturedAt || ""}`);
    const counters = report.latestHeartbeat.counters || {};
    lines.push(`- latest counters: failedJobs=${counters.failedJobs ?? 0}, slowStages=${counters.slowStages ?? 0}, openSignals=${counters.openSignals ?? 0}`);
  }

  lines.push("", "## Latest Matter Health", "");
  if (report.latestMatterHealth?.length) {
    for (const item of report.latestMatterHealth) {
      lines.push(`- ${item.matter}: ${item.prepareState || "unknown"}; next=${item.nextStepLabel || ""}; attention=${item.attentionState || ""}; blockers=${item.blockers ?? 0}; warnings=${item.warnings ?? 0}`);
    }
  } else {
    lines.push("- No matching matter-health row in the latest heartbeat.");
  }

  lines.push("", "## Open Feedback Counts", "");
  if (report.openFeedbackCounts?.length) {
    for (const row of report.openFeedbackCounts) lines.push(`- ${row.classification || "unknown"}: ${row.count}`);
  } else {
    lines.push("- No matching open feedback.");
  }

  lines.push("", "## Matched Feedback", "");
  if (report.feedback?.length) {
    for (const item of report.feedback) {
      lines.push(`### ${item.feedbackId}`);
      lines.push(`- received: ${item.receivedAt}`);
      lines.push(`- status/classification: ${item.status} / ${item.classification}`);
      lines.push(`- user: ${item.user || ""}`);
      lines.push(`- matter: ${item.matter || ""}`);
      lines.push(`- tryingToDo: ${item.tryingToDo || ""}`);
      lines.push(`- happenedInstead: ${item.happenedInstead || ""}`);
      lines.push(`- visibleError: ${item.visibleError || ""}`);
      if (item.recentActivity?.length) {
        lines.push("- recent activity:");
        for (const activity of item.recentActivity.slice(-4)) lines.push(`  - ${activity}`);
      }
      lines.push(`- nearby signals: ${item.relatedSignals.length}`);
      lines.push(`- nearby heartbeats: ${item.relatedHeartbeats.length}`);
      for (const heartbeat of item.relatedHeartbeats.slice(0, 4)) {
        lines.push(`  - heartbeat ${heartbeat.capturedAt}: journeys=${heartbeat.journeys.length}; failedJobs=${heartbeat.counters.failedJobs ?? 0}; slowStages=${heartbeat.counters.slowStages ?? 0}`);
        for (const journey of heartbeat.journeys.slice(0, 3)) lines.push(`    - ${journey.currentStage || journey.title || "journey"}: ${journey.currentStageStatus || journey.status || ""} (${journey.jobId || journey.id || ""})`);
        for (const health of heartbeat.matterHealth.slice(0, 2)) lines.push(`    - health ${health.matter}: ${health.prepareState}; next=${health.nextStepLabel}`);
      }
      lines.push("");
    }
  } else {
    lines.push("No matching feedback found.");
  }

  if (report.signals?.length) {
    lines.push("## Matching Signals", "");
    for (const signal of report.signals.slice(0, 12)) {
      lines.push(`- ${signal.receivedAt} ${signal.severity}/${signal.source} ${signal.matter || ""}: ${signal.title || signal.detail || signal.signalId}`);
    }
  }

  return lines.join("\n");
}

function rowsSince(rows = [], cutoff) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const date = toDate(row.received_at || row.receivedAt || row.captured_at || row.capturedAt || row.occurred_at || row.occurredAt);
    return date && date >= cutoff;
  });
}

function normalizeFeedbackRow(row = {}) {
  const payload = row.payload || {};
  const context = payload.context || {};
  const user = cleanText(payload.user || payload.userEmail || payload.actor || context.user || context.userEmail || context.username || context.betaUser || "", 200);
  const matter = cleanText(row.matter_name || row.matterName || context.activeMatterName || payload.matterName || "", 300);
  const tryingToDo = cleanText(payload.tryingToDo || payload.title || payload.summary || payload.message || "", 500);
  const happenedInstead = cleanText(payload.happenedInstead || payload.detail || payload.description || payload.message || "", 500);
  const visibleError = cleanText(context.visibleError || payload.visibleError || "", 500);
  const recentActivity = Array.isArray(context.recentActivity)
    ? context.recentActivity.map((line) => cleanText(line, 300)).filter(Boolean)
    : [];
  const item = {
    feedbackId: cleanText(row.feedback_id || row.feedbackId || payload.id || "", 200),
    status: cleanText(row.status || payload.status || "", 80),
    classification: cleanText(row.classification || payload.classification || "", 80),
    matter,
    user,
    occurredAt: toIso(row.occurred_at || row.occurredAt || payload.createdAt),
    receivedAt: toIso(row.received_at || row.receivedAt || payload.receivedAt),
    tryingToDo,
    happenedInstead,
    visibleError,
    route: cleanText(context.route || "", 160),
    traceId: cleanText(context.traceId || "", 200),
    recentActivity,
  };
  item.searchText = [item.user, item.matter, item.tryingToDo, item.happenedInstead, item.visibleError, item.recentActivity.join(" ")].join(" ").toLowerCase();
  return item;
}

function normalizeSignalRow(row = {}) {
  const payload = row.payload || {};
  const item = {
    signalId: cleanText(row.signal_id || row.signalId || payload.id || "", 200),
    severity: cleanText(row.severity || payload.severity || "", 80),
    source: cleanText(row.source || payload.source || "", 80),
    matter: cleanText(row.matter_name || row.matterName || payload.matterName || "", 300),
    occurrenceCount: positiveInteger(row.occurrence_count || row.occurrenceCount || payload.occurrenceCount, 1),
    firstSeenAt: toIso(row.first_seen_at || row.firstSeenAt || payload.firstSeenAt),
    lastSeenAt: toIso(row.last_seen_at || row.lastSeenAt || payload.lastSeenAt),
    receivedAt: toIso(row.received_at || row.receivedAt || payload.receivedAt),
    title: cleanText(payload.title || "", 300),
    detail: cleanText(payload.detail || payload.message || "", 500),
  };
  item.searchText = [item.severity, item.source, item.matter, item.title, item.detail].join(" ").toLowerCase();
  return item;
}

function normalizeHeartbeatRow(row = {}) {
  return {
    heartbeatId: cleanText(row.heartbeat_id || row.heartbeatId || row.payload?.id || "", 200),
    capturedAt: toIso(row.captured_at || row.capturedAt || row.payload?.capturedAt || row.payload?.createdAt || row.payload?.sentAt),
    receivedAt: toIso(row.received_at || row.receivedAt),
    payload: row.payload || {},
  };
}

function matchesInvestigation(searchText, { query, terms }) {
  const haystack = normalizeLookup(searchText);
  if (query.user && !haystack.includes(normalizeLookup(query.user))) return false;
  if (query.matter && !haystack.includes(normalizeLookup(query.matter))) return false;
  if (query.text && !haystack.includes(normalizeLookup(query.text))) return false;
  if (query.preset === "all" || query.text) return true;
  return terms.some((term) => haystack.includes(normalizeLookup(term)));
}

function matchesSignal(signal, { query, terms, matterHints }) {
  const haystack = normalizeLookup(signal.searchText);
  if (query.matter && !haystack.includes(normalizeLookup(query.matter))) return false;
  if (query.preset === "all" || terms.some((term) => haystack.includes(normalizeLookup(term)))) return true;
  return matterHints.some((hint) => hint && haystack.includes(hint));
}

function nearbySignals(signals, feedback, windowMinutes) {
  const center = toDate(feedback.receivedAt || feedback.occurredAt);
  if (!center) return [];
  const windowMs = windowMinutes * 60 * 1000;
  return signals.filter((signal) => {
    const date = toDate(signal.receivedAt || signal.lastSeenAt || signal.firstSeenAt);
    return date && Math.abs(date.getTime() - center.getTime()) <= windowMs;
  }).slice(0, 8);
}

function nearbyHeartbeats(heartbeats, feedback, windowMinutes, matterHints = []) {
  const center = toDate(feedback.receivedAt || feedback.occurredAt);
  if (!center) return [];
  const windowMs = windowMinutes * 60 * 1000;
  return heartbeats.filter((heartbeat) => {
    const date = toDate(heartbeat.capturedAt || heartbeat.receivedAt);
    return date && Math.abs(date.getTime() - center.getTime()) <= windowMs;
  }).map((heartbeat) => summarizeHeartbeat(heartbeat, matterHints)).filter((heartbeat) => heartbeat.journeys.length || heartbeat.matterHealth.length || heartbeat.counters.failedJobs || heartbeat.counters.slowStages).slice(0, 8);
}

function summarizeHeartbeat(heartbeat, matterHints = []) {
  const payload = heartbeat.payload || {};
  return {
    heartbeatId: heartbeat.heartbeatId,
    capturedAt: heartbeat.capturedAt,
    receivedAt: heartbeat.receivedAt,
    counters: payload.counters || {},
    activeSessions: payload.activeSessions ?? null,
    journeys: summarizeJourneys(payload.journeys, matterHints),
    matterHealth: summarizeMatterHealth(payload.matterHealth, matterHints),
  };
}

function summarizeJourneys(journeys = [], matterHints = []) {
  return (Array.isArray(journeys) ? journeys : [])
    .filter((journey) => matchesMatterHints(journey.matter || journey.matterName || journey.activeMatterName || "", matterHints))
    .map((journey) => ({
      jobId: cleanText(journey.jobId || journey.id || "", 200),
      traceId: cleanText(journey.traceId || "", 200),
      matter: cleanText(journey.matter || journey.matterName || journey.activeMatterName || "", 300),
      route: cleanText(journey.route || "", 120),
      screen: cleanText(journey.screen || "", 120),
      lastAction: cleanText(journey.lastAction || "", 120),
      currentStage: cleanText(journey.currentStage || journey.title || journey.stage || "", 180),
      currentStageStatus: cleanText(journey.currentStageStatus || journey.status || "", 80),
      lastError: cleanText(journey.lastError || journey.error || "", 300),
      patienceRisk: cleanText(journey.patienceRisk || "", 80),
    }));
}

function summarizeMatterHealth(health = [], matterHints = []) {
  return (Array.isArray(health) ? health : [])
    .filter((item) => matchesMatterHints(item.matter || item.matterName || "", matterHints))
    .map((item) => ({
      matter: cleanText(item.matter || item.matterName || "", 300),
      prepareState: cleanText(item.prepareState || "", 80),
      nextStepLabel: cleanText(item.nextStepLabel || "", 160),
      attentionState: cleanText(item.attentionState || "", 80),
      blockers: Number(item.blockers || 0),
      warnings: Number(item.warnings || 0),
      checkedAt: toIso(item.checkedAt),
    }));
}

function matchesMatterHints(value, matterHints = []) {
  if (!matterHints.length) return true;
  const normalized = normalizeLookup(value);
  return matterHints.some((hint) => hint && normalized.includes(hint));
}

function countOpenFeedback(feedback, { query, terms }) {
  const counts = new Map();
  for (const item of feedback) {
    if (item.status !== "new") continue;
    if (!matchesInvestigation(item.searchText, { query, terms })) continue;
    const key = item.classification || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([classification, count]) => ({ classification, count })).sort((a, b) => a.classification.localeCompare(b.classification));
}

function investigationTerms(query) {
  if (query.text) return [query.text];
  if (query.preset === "large-files") return [...LARGE_FILE_TERMS];
  return [];
}

function normalizePreset(value) {
  const preset = String(value || "").trim().toLowerCase();
  if (!preset || preset === "large" || preset === "large-files" || preset === "large_files") return "large-files";
  if (preset === "all" || preset === "any") return "all";
  throw new Error("--preset must be large-files or all");
}

function normalizeFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  if (format === "markdown" || format === "md") return "markdown";
  if (format === "json") return "json";
  throw new Error("--format must be markdown or json");
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function cleanText(value, maxLength) {
  return redactSensitiveText(String(value || "").replace(/\s+/g, " ").trim()).slice(0, maxLength);
}

function normalizeLookup(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  return toDate(value)?.toISOString() || "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runMothershipInvestigate();
}
