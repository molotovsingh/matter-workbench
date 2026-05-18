import { escapeHtml } from "./dom-utils.js";
import { redactSensitiveText } from "./secret-redaction.js";
import {
  SKILL_SAMPLE_STATE,
  isSkillSampleStaleState,
  normalizeSkillSampleState,
} from "../shared/skill-sample-states.mjs";

export { SKILL_SAMPLE_STATE } from "../shared/skill-sample-states.mjs";

export function formatSkillSampleCopy(sample, { version, approved } = {}) {
  const state = getSampleState(sample);
  const warnings = getSampleWarnings(sample);
  const statusText = state === SKILL_SAMPLE_STATE.APPROVED_STALE
    ? "Approved earlier, now stale. Regenerate before creating a skill."
    : approved
      ? "Sample approved. Creation and validation required before the skill is runnable."
      : state === SKILL_SAMPLE_STATE.STALE
        ? "Stale after design brief changes. Regenerate before approval."
        : "Awaiting review";
  const lines = [
    "# Skill Sample Output",
    "",
    `- Sample: v${Number(version || getSampleVersion(sample, 1))}`,
    `- Status: ${statusText}`,
    `- Ledger state: ${formatSampleStateLabel(state)}`,
    `- Matter: ${redactSensitiveText(getSampleMatter(sample).matterName || getSampleMatter(sample).folderName || "Selected matter")}`,
    `- Provider/model: ${redactSensitiveText(formatSampleProvider(sample))}`,
    `- Feedback: ${redactSensitiveText(getSampleFeedback(sample) || "None")}`,
    `- Warnings: ${redactSensitiveText(warnings.length ? warnings.join("; ") : "None")}`,
    "",
    approved && state !== SKILL_SAMPLE_STATE.APPROVED_STALE
      ? "This sample is approved, but it is not a runnable skill until creation and validation succeed."
      : "This is not a runnable skill. No prompt, code, slash command, provider runtime, or activation has been generated.",
    "",
    "## Sample",
    "",
    redactSensitiveText(getSampleMarkdown(sample)),
  ];
  return lines.join("\n");
}

export function renderSampleLedger(sampleReview = {}, { central = false } = {}) {
  const samples = getLedgerSamples(sampleReview);
  if (!samples.length) return "";
  const activeId = getSampleId(sampleReview.activeSample);
  const ordered = [...samples].sort((a, b) => getSampleVersion(b, 0) - getSampleVersion(a, 0));
  return `
      <section class="skill-sample-ledger" aria-label="Sample ledger">
        <div class="skill-sample-ledger-header">
          <strong>Sample Ledger</strong>
          <span class="muted">${escapeHtml(String(samples.length))} version${samples.length === 1 ? "" : "s"}</span>
        </div>
        <ul>
          ${ordered.map((sample) => {
            const sampleId = getSampleId(sample);
            const version = getSampleVersion(sample, 1);
            const state = getSampleState(sample);
            const matter = getSampleMatter(sample);
            const createdAt = getSampleCreatedAt(sample);
            const feedback = getSampleFeedback(sample);
            const isActive = activeId && sampleId === activeId;
            return `
              <li class="skill-sample-ledger-item ${isActive ? "active" : ""}">
                <div class="skill-sample-ledger-title">
                  <strong>Sample v${escapeHtml(String(version))}${isActive ? " · active" : ""}</strong>
                  <span class="sample-state ${escapeHtml(state)}">${escapeHtml(formatSampleStateLabel(state))}</span>
                </div>
                <dl class="skill-card-meta compact">
                  <div><dt>Matter</dt><dd>${escapeHtml(matter.matterName || matter.folderName || "Unknown")}</dd></div>
                  <div><dt>Provider</dt><dd>${escapeHtml(formatSampleProvider(sample))}</dd></div>
                  <div><dt>Created</dt><dd>${escapeHtml(createdAt || "Unknown")}</dd></div>
                  <div><dt>Feedback</dt><dd>${escapeHtml(feedback || "None")}</dd></div>
                </dl>
                ${central ? "" : `
                  <div class="command-interview-actions compact">
                    <button type="button" class="secondary" data-skill-interview-action="copy-ledger-sample" data-sample-id="${escapeHtml(sampleId)}">Copy Sample</button>
                  </div>
                `}
              </li>
            `;
          }).join("")}
        </ul>
        ${ordered.some((sample) => getSampleState(sample) === SKILL_SAMPLE_STATE.APPROVED_STALE)
          ? '<p class="muted">An approved stale sample is kept for review history, but it cannot create a skill. Regenerate and approve a current sample.</p>'
          : ""}
      </section>
    `;
}

export function getLedgerSamples(sampleReview = {}) {
  const byId = new Map();
  const samples = Array.isArray(sampleReview.samples) ? sampleReview.samples.map(normalizeUiSample) : [];
  const ledger = Array.isArray(sampleReview.ledger) ? sampleReview.ledger.map(normalizeUiSample) : [];
  for (const sample of samples) {
    byId.set(getSampleId(sample) || `version:${getSampleVersion(sample, byId.size + 1)}`, sample);
  }
  for (const sample of ledger) {
    byId.set(getSampleId(sample) || `version:${getSampleVersion(sample, byId.size + 1)}`, sample);
  }
  return [...byId.values()].sort((a, b) => getSampleVersion(a, 0) - getSampleVersion(b, 0));
}

export function applyActiveSampleState(sampleReview, sample) {
  const active = normalizeUiSample(sample);
  sampleReview.activeSample = active;
  const state = getSampleState(active);
  sampleReview.approved = state === SKILL_SAMPLE_STATE.APPROVED_CURRENT;
  sampleReview.stale = isSkillSampleStaleState(state);
  sampleReview.staleReason = state === SKILL_SAMPLE_STATE.APPROVED_STALE
    ? "This sample was approved earlier, but the design brief changed. Regenerate and approve a current sample before creating a skill."
    : state === SKILL_SAMPLE_STATE.STALE
      ? "Design brief changed after this sample was generated. Regenerate the sample before approving it."
      : "";
  return sampleReview;
}

export function ensureSampleReview(session = {}) {
  if (!session.sampleReview) {
    session.sampleReview = {
      samples: [],
      ledger: [],
      activeSample: null,
      approved: false,
      stale: false,
      staleReason: "",
      generating: false,
    };
  }
  if (!Array.isArray(session.sampleReview.samples)) session.sampleReview.samples = [];
  if (!Array.isArray(session.sampleReview.ledger)) session.sampleReview.ledger = session.sampleReview.samples;
  if (typeof session.sampleReview.stale !== "boolean") session.sampleReview.stale = false;
  if (typeof session.sampleReview.staleReason !== "string") session.sampleReview.staleReason = "";
  if (typeof session.sampleReview.generating !== "boolean") session.sampleReview.generating = false;
  return session.sampleReview;
}

export function markSampleReviewStale(session = {}, reason = "") {
  const sampleReview = ensureSampleReview(session);
  if (!sampleReview.activeSample) return sampleReview;
  sampleReview.approved = false;
  sampleReview.stale = true;
  sampleReview.staleReason = reason || "Design brief changed after this sample was generated. Regenerate the sample before approving it.";
  sampleReview.activeSample = {
    ...sampleReview.activeSample,
    state: sampleReview.activeSample.approved ? SKILL_SAMPLE_STATE.APPROVED_STALE : SKILL_SAMPLE_STATE.STALE,
    current: false,
  };
  sampleReview.ledger = getLedgerSamples(sampleReview).map((sample) => getSampleId(sample) === getSampleId(sampleReview.activeSample)
    ? sampleReview.activeSample
    : sample);
  session.sampleReview = sampleReview;
  return sampleReview;
}

export function normalizeUiSample(sample = {}) {
  const stored = sample.storedSample || sample.sample || {};
  const merged = { ...sample, ...stored };
  const aiRun = normalizeSampleAiRun(merged.aiRun || merged.ai_run || sample.ai_run || stored.aiRun);
  const matter = getSampleMatter(merged);
  const markdown = merged.sample_markdown || merged.sampleMarkdown || sample.sample_markdown || stored.sampleMarkdown || "";
  const id = String(merged.sample_id || merged.sampleId || merged.id || "").trim();
  return {
    ...merged,
    id,
    sample_id: id,
    version: Number.isInteger(merged.version) && merged.version > 0 ? merged.version : Number(merged.version || 0) || 1,
    generated_at: String(merged.generated_at || merged.createdAt || merged.created_at || "").trim(),
    createdAt: String(merged.createdAt || merged.generated_at || merged.created_at || "").trim(),
    approved: Boolean(merged.approved),
    approved_at: String(merged.approved_at || merged.approvedAt || "").trim(),
    approvedAt: String(merged.approvedAt || merged.approved_at || "").trim(),
    state: String(merged.state || "").trim(),
    current: typeof merged.current === "boolean" ? merged.current : undefined,
    matter: {
      matter_name: matter.matterName,
      folder_name: matter.folderName,
    },
    sample_markdown: markdown,
    sampleMarkdown: markdown,
    feedback: String(merged.feedback || ""),
    ai_run: aiRun,
    aiRun,
    warnings: normalizeSampleWarnings(merged.warnings || sample.warnings || stored.warnings),
  };
}

export function getSampleId(sample = {}) {
  return String(sample?.sample_id || sample?.sampleId || sample?.id || "").trim();
}

export function getSampleVersion(sample = {}, fallback = 1) {
  const version = Number(sample?.version || 0);
  return Number.isFinite(version) && version > 0 ? version : Number(fallback || 1);
}

export function getSampleMarkdown(sample = {}) {
  return String(sample?.sample_markdown || sample?.sampleMarkdown || "").trim();
}

export function getSampleMatter(sample = {}) {
  const matter = sample?.matter || {};
  return {
    matterName: String(matter.matter_name || matter.matterName || "").trim(),
    folderName: String(matter.folder_name || matter.folderName || "").trim(),
  };
}

export function getSampleAiRun(sample = {}) {
  return normalizeSampleAiRun(sample?.ai_run || sample?.aiRun || {});
}

export function getSampleWarnings(sample = {}) {
  return normalizeSampleWarnings(sample?.warnings);
}

export function normalizeSampleAiRun(aiRun = {}) {
  return {
    provider: String(aiRun.provider || "").trim(),
    model: String(aiRun.model || "").trim(),
    task: String(aiRun.task || "").trim(),
    policyPromptVersion: String(aiRun.policyPromptVersion || "").trim(),
  };
}

export function formatSampleProvider(sample = {}) {
  const aiRun = getSampleAiRun(sample);
  return [aiRun.provider, aiRun.model].filter(Boolean).join(" / ") || "configured provider";
}

export function getSampleState(sample = {}) {
  return normalizeSkillSampleState(sample);
}

export function isSampleStale(sample = {}) {
  const state = getSampleState(sample);
  return isSkillSampleStaleState(state);
}

export function findSampleByVersion(sampleReview = {}, version) {
  const targetVersion = Number(version || 0);
  return getLedgerSamples(sampleReview).find((sample) => getSampleVersion(sample, 0) === targetVersion) || null;
}

function getSampleFeedback(sample = {}) {
  return String(sample?.feedback || "").trim();
}

function getSampleCreatedAt(sample = {}) {
  return String(sample?.createdAt || sample?.created_at || sample?.generated_at || "").trim();
}

export function formatSampleStateLabel(state) {
  if (state === SKILL_SAMPLE_STATE.APPROVED_CURRENT) return "Approved current";
  if (state === SKILL_SAMPLE_STATE.APPROVED_STALE) return "Approved stale";
  if (state === SKILL_SAMPLE_STATE.STALE) return "Stale";
  return "Current";
}

function normalizeSampleWarnings(warnings) {
  return Array.isArray(warnings)
    ? warnings.map((warning) => String(warning || "").trim()).filter(Boolean).slice(0, 10)
    : [];
}
