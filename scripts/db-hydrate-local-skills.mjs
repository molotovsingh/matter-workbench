#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { deriveConfigurableSkillRunReceipt } from "../shared/configurable-skill-run-receipts.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);

const SKILL_IDEAS_FILE = "skill-ideas.json";
const SKILL_SAMPLES_FILE = "skill-samples.json";
const CONFIGURABLE_SKILLS_FILE = "configurable-skills.json";
const CONFIGURABLE_SKILL_RUNS_FILE = "configurable-skill-runs.json";

export function parseArgs(argv = []) {
  const parsed = {
    dryRun: true,
    verify: false,
    inspect: false,
    json: false,
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
    slashQuery: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = false;
    } else if (arg === "--apply") {
      parsed.dryRun = false;
      parsed.verify = false;
      parsed.inspect = false;
    } else if (arg === "--verify") {
      parsed.dryRun = true;
      parsed.verify = true;
      parsed.inspect = false;
    } else if (arg === "--inspect") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--app-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--app-dir requires a value");
      parsed.appDir = path.resolve(value);
      i += 1;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else if (arg === "--slash") {
      const value = argv[i + 1];
      if (!value) throw new Error("--slash requires a value");
      parsed.slashQuery = normalizeSlash(value);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export function defaultMattersHome(env = process.env) {
  return path.resolve(
    env.MWB_MATTERS_HOME
    || env.MATTERS_HOME
    || path.join(os.homedir(), "matters-matter-workbench"),
  );
}

export async function collectLocalSkillHydrationReport(options = {}) {
  return skillHydrationReportFromPlan(await collectLocalSkillHydrationPlan(options));
}

export async function collectLocalSkillHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
} = {}) {
  const root = path.resolve(appDir);
  const matterIndex = await collectMatterIndex(mattersHome);
  const ideasStore = await readJsonStore(path.join(root, SKILL_IDEAS_FILE), "ideas");
  const samplesStore = await readJsonStore(path.join(root, SKILL_SAMPLES_FILE), "samples");
  const skillsStore = await readJsonStore(path.join(root, CONFIGURABLE_SKILLS_FILE), "skills");
  const runsStore = await readJsonStore(path.join(root, CONFIGURABLE_SKILL_RUNS_FILE), "runs");
  const warnings = [
    ...ideasStore.warnings,
    ...samplesStore.warnings,
    ...skillsStore.warnings,
    ...runsStore.warnings,
  ];

  const tenant = {
    id: deterministicUuid("tenant:local-shadow"),
    name: "Matter Workbench Local Shadow",
    type: "internal_test",
  };
  const user = {
    id: deterministicUuid("user:local-shadow"),
    email: "local-shadow@mwb.local",
    name: "Local Shadow User",
  };

  const ideas = ideasStore.items.map((idea) => normalizeIdea({ idea, matterIndex, userId: user.id, tenantId: tenant.id }));
  const ideaIds = new Set(ideas.map((idea) => idea.id));
  const samples = [];
  for (const sample of samplesStore.items) {
    const normalized = normalizeSample({ sample, matterIndex, tenantId: tenant.id });
    if (!ideaIds.has(normalized.ideaId)) {
      warnings.push(`${normalized.id || "(sample)"} references missing skill idea ${normalized.ideaId || "(blank)"}; skipped.`);
      continue;
    }
    samples.push(normalized);
  }

  const skills = skillsStore.items.map((skill) => normalizeSkill({ skill, tenantId: tenant.id, userId: user.id }));
  const skillByLocalId = new Map(skills.map((skill) => [skill.localId, skill]));
  const runs = [];
  for (const run of runsStore.items) {
    const normalized = normalizeRun({ run, skillByLocalId, matterIndex, tenantId: tenant.id });
    if (!normalized) {
      warnings.push(`${String(run?.id || "(run)").trim()} references missing custom skill ${String(run?.skillId || "").trim() || "(blank)"}; skipped.`);
      continue;
    }
    runs.push(normalized);
  }

  const totals = {
    ideas: ideas.length,
    samples: samples.length,
    configurableSkills: skills.length,
    configurableSkillVersions: skills.length,
    configurableSkillRuns: runs.length,
    skippedRuns: runsStore.items.length - runs.length,
    warnings: warnings.length,
  };

  return {
    mode: "dry-run",
    databaseWrites: false,
    appDir: root,
    mattersHome,
    tenant,
    user,
    totals,
    plannedRows: {
      tenants: 1,
      users: 1,
      skillIdeas: ideas.length,
      skillSamples: samples.length,
      configurableSkills: skills.length,
      configurableSkillVersions: skills.length,
      configurableSkillRuns: runs.length,
    },
    ideas,
    samples,
    skills,
    runs,
    warnings,
  };
}

export function skillHydrationReportFromPlan(plan = {}) {
  return {
    mode: plan.mode || "dry-run",
    databaseWrites: Boolean(plan.databaseWrites),
    appDir: plan.appDir || "",
    mattersHome: plan.mattersHome || "",
    totals: plan.totals || emptyTotals(),
    plannedRows: plan.plannedRows || {},
    warnings: plan.warnings || [],
  };
}

export function buildLocalSkillHydrationSql(plan = {}) {
  const tenant = plan.tenant || { id: deterministicUuid("tenant:local-shadow"), name: "Matter Workbench Local Shadow", type: "internal_test" };
  const user = plan.user || { id: deterministicUuid("user:local-shadow"), email: "local-shadow@mwb.local", name: "Local Shadow User" };
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenant.id)}, true);`,
    `insert into users (id, email, name, status) values (${sqlString(user.id)}, ${sqlString(user.email)}, ${sqlString(user.name)}, 'active') on conflict (email) do update set name = excluded.name, status = excluded.status;`,
    `insert into tenants (id, name, type, status) values (${sqlString(tenant.id)}, ${sqlString(tenant.name)}, ${sqlString(tenant.type || "internal_test")}, 'active') on conflict (id) do update set name = excluded.name, type = excluded.type, status = excluded.status;`,
    `insert into tenant_memberships (id, tenant_id, user_id, role, status) values (${sqlString(deterministicUuid(`tenant-membership:${tenant.id}:${user.id}`))}, ${sqlString(tenant.id)}, ${sqlString(user.id)}, 'owner', 'active') on conflict (tenant_id, user_id) do update set role = excluded.role, status = excluded.status;`,
  ];

  for (const idea of plan.ideas || []) appendSkillIdeaSql(lines, idea);
  for (const sample of plan.samples || []) appendSkillSampleSql(lines, sample);
  for (const skill of plan.skills || []) appendConfigurableSkillSql(lines, skill);
  for (const skill of plan.skills || []) appendConfigurableSkillVersionSql(lines, skill);
  for (const skill of plan.skills || []) {
    lines.push(`update configurable_skills set current_version_id = ${sqlString(skill.versionId)} where id = ${sqlString(skill.id)};`);
  }
  for (const run of plan.runs || []) appendConfigurableSkillRunSql(lines, run);

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalSkillHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying skill shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalSkillHydrationSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  return {
    databaseWrites: true,
    insertedRows: plan?.plannedRows || {},
    stdout: result.stdout || "",
  };
}

export function buildSkillHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Skill hydration plan is missing tenant.id.");
  const countQueries = skillHydrationCountKeys().map(([key, tableName]) => (
    `select ${sqlString(key)} as key, count(*)::int as count from ${tableName}`
  ));
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    `${countQueries.join("\nunion all\n")};`,
    "",
  ].join("\n");
}

export function verifyLocalSkillHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying skill shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildSkillHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedSkillHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return {
    matched: mismatches.length === 0,
    expected,
    counts,
    mismatches,
  };
}

export function buildSkillInspectionSql({ tenantId, slashQuery = "" } = {}) {
  if (!tenantId) throw new Error("Skill hydration plan is missing tenant.id.");
  const whereClause = slashQuery ? `where cs.slash = ${sqlString(normalizeSlash(slashQuery))}` : "";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with skill_rows as (",
    "  select",
    "    cs.id::text as skill_id,",
    "    cs.title,",
    "    cs.slash,",
    "    cs.status,",
    "    count(distinct csv.id)::int as version_count,",
    "    count(distinct csr.id)::int as run_count",
    "  from configurable_skills cs",
    "  left join configurable_skill_versions csv on csv.skill_id = cs.id",
    "  left join configurable_skill_runs csr on csr.skill_id = cs.id",
    `  ${whereClause}`,
    "  group by cs.id, cs.title, cs.slash, cs.status",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(skill_rows) order by slash), '[]'::jsonb)::text from skill_rows;",
    "",
  ].join("\n");
}

export function inspectLocalSkillHydration({
  databaseUrl,
  plan,
  slashQuery = "",
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting skill shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildSkillInspectionSql({ tenantId: plan?.tenant?.id, slashQuery }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const skills = parsePsqlJsonArray(result.stdout || "").map(normalizeInspectionSkill);
  return {
    tenantId: plan?.tenant?.id || "",
    slashQuery: normalizeSlash(slashQuery),
    skills,
    totals: {
      configurableSkills: skills.length,
      configurableSkillVersions: skills.reduce((sum, skill) => sum + skill.versionCount, 0),
      configurableSkillRuns: skills.reduce((sum, skill) => sum + skill.runCount, 0),
    },
  };
}

export function renderSkillHydrationReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local skill DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `app_dir: ${report.appDir || ""}`,
    "totals:",
    `  skill_ideas: ${totals.ideas || 0}`,
    `  skill_samples: ${totals.samples || 0}`,
    `  configurable_skills: ${totals.configurableSkills || 0}`,
    `  configurable_skill_versions: ${totals.configurableSkillVersions || 0}`,
    `  configurable_skill_runs: ${totals.configurableSkillRuns || 0}`,
    `  skipped_runs: ${totals.skippedRuns || 0}`,
    `  warnings: ${totals.warnings || 0}`,
    "planned_rows:",
  ];
  for (const [key, value] of Object.entries(report.plannedRows || {})) {
    lines.push(`  ${toSnakeCase(key)}: ${value}`);
  }
  for (const warning of report.warnings || []) {
    lines.push(`warning: ${warning}`);
  }
  return lines;
}

export function renderSkillHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench skill shadow hydration verification",
    `matched: ${result.matched ? "yes" : "no"}`,
    "row_counts:",
  ];
  const expected = result.expected || {};
  const counts = result.counts || {};
  for (const key of Object.keys(expected)) {
    lines.push(`  ${key}: expected=${expected[key]} actual=${counts[key] || 0}`);
  }
  if (result.mismatches?.length) {
    lines.push("mismatches:");
    for (const mismatch of result.mismatches) {
      lines.push(`  ${mismatch.key}: expected=${mismatch.expected} actual=${mismatch.actual}`);
    }
  }
  return lines;
}

export function renderSkillHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench skill shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `slash_filter: ${result.slashQuery || "(none)"}`,
    `skills: ${result.skills?.length || 0}`,
    "skill_summaries:",
  ];
  for (const skill of result.skills || []) {
    lines.push(`  ${skill.slash} ${skill.title} status=${skill.status} versions=${skill.versionCount} runs=${skill.runCount}`);
  }
  if (!result.skills?.length) lines.push("  (none)");
  return lines;
}

async function readJsonStore(filePath, arrayKey) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      items: Array.isArray(parsed?.[arrayKey]) ? parsed[arrayKey] : [],
      warnings: Array.isArray(parsed?.[arrayKey]) ? [] : [`${path.basename(filePath)} is missing ${arrayKey} array.`],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { items: [], warnings: [] };
    return { items: [], warnings: [`${path.basename(filePath)} is unreadable: ${error.message}`] };
  }
}

async function collectMatterIndex(mattersHome) {
  const byName = new Map();
  const byFolder = new Map();
  try {
    const entries = await readdir(mattersHome, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const matterRoot = path.join(mattersHome, entry.name);
      const matterJsonPath = path.join(matterRoot, "matter.json");
      if (!await fileExists(matterJsonPath)) continue;
      const matterJson = JSON.parse(await readFile(matterJsonPath, "utf8"));
      const matterName = stringValue(matterJson.matter_name) || entry.name;
      const row = {
        id: deterministicUuid(`matter:${entry.name}:${matterName}`),
        name: matterName,
        folderName: entry.name,
      };
      byName.set(matterName, row);
      byFolder.set(entry.name, row);
    }
  } catch {
    // Matter links are optional in this shadow pass.
  }
  return { byName, byFolder };
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function normalizeIdea({ idea = {}, matterIndex, tenantId, userId }) {
  const matter = normalizeMatterSummary(idea.matter);
  const matterRow = findMatter(matterIndex, matter);
  return {
    id: stringValue(idea.id),
    tenantId,
    matterId: matterRow?.id || "",
    createdByUserId: userId,
    text: stringValue(idea.text),
    status: normalizeIdeaStatus(idea.status),
    matterName: matter.matterName,
    matterFolderName: matter.folderName,
    designBrief: objectValue(idea.designBrief),
    readiness: objectValue(idea.readiness),
    createdAt: timestampOrEmpty(idea.createdAt),
    updatedAt: timestampOrEmpty(idea.updatedAt || idea.createdAt),
  };
}

function normalizeSample({ sample = {}, matterIndex, tenantId }) {
  const matter = normalizeMatterSummary(sample.matter);
  const matterRow = findMatter(matterIndex, matter);
  const sampleMarkdown = stringValue(sample.sampleMarkdown || sample.sample_markdown);
  return {
    id: stringValue(sample.id || sample.sample_id),
    tenantId,
    ideaId: stringValue(sample.ideaId || sample.idea_id),
    matterId: matterRow?.id || "",
    version: positiveInteger(sample.version, 1),
    approved: Boolean(sample.approved),
    approvedAt: timestampOrEmpty(sample.approvedAt),
    designBriefHash: stringValue(sample.designBriefHash),
    sampleMarkdownObjectKey: sampleMarkdown ? `local-skill-samples/${stringValue(sample.id || sample.sample_id)}.md` : "",
    sampleHash: sampleMarkdown ? sha256(sampleMarkdown) : "",
    aiRun: normalizeAiRun(sample.aiRun || sample.ai_run || sample.rawSample?.ai_run),
    feedback: stringValue(sample.feedback, 2000),
    warnings: normalizeWarnings(sample.warnings),
    rawSample: omitWorkProduct({
      matter,
      aiRun: objectValue(sample.aiRun || sample.ai_run),
      rawSample: objectValue(sample.rawSample),
    }),
    createdAt: timestampOrEmpty(sample.createdAt),
  };
}

function normalizeSkill({ skill = {}, tenantId, userId }) {
  const localId = stringValue(skill.id);
  const version = positiveInteger(skill.version, 1);
  const id = deterministicUuid(`configurable-skill:${localId}`);
  const versionId = deterministicUuid(`configurable-skill-version:${localId}:${version}`);
  const lifecycle = objectValue(skill.lifecycle);
  return {
    id,
    localId,
    tenantId,
    createdByUserId: userId,
    title: stringValue(skill.title) || "Custom Skill",
    slash: normalizeSlash(skill.slash),
    status: normalizeSkillStatus(skill.status),
    version,
    versionId,
    previousStatus: normalizeOptionalSkillStatus(lifecycle.previousStatus),
    statusChangedAt: timestampOrEmpty(lifecycle.statusChangedAt || skill.updatedAt),
    statusChangedBy: userId,
    statusChangeReason: stringValue(lifecycle.reason, 500),
    currentVersionId: versionId,
    definition: {
      local_id: localId,
      family_id: stringValue(skill.familyId || localId),
      previous_skill_id: stringValue(skill.previousSkillId),
      replaced_by_skill_id: stringValue(skill.replacedBySkillId),
      description: stringValue(skill.description),
      target_lane: stringValue(skill.targetLane),
      output_artifact: stringValue(skill.outputArtifact),
      matter_required: skill.matterRequired !== false,
      paid_provider_call: skill.paidProviderCall !== false,
      source_backed: stringValue(skill.sourceBacked),
      prompt_config: objectValue(skill.promptConfig),
      model_policy: objectValue(skill.modelPolicy),
      validation: objectValue(skill.validation),
      source_sample_id: stringValue(skill.sourceSampleId),
      approved_sample_hash: stringValue(skill.approvedSampleHash),
    },
    sourceIdeaId: stringValue(skill.sourceIdeaId),
    policyPromptVersion: stringValue(skill.modelPolicy?.policyPromptVersion),
    createdAt: timestampOrEmpty(skill.createdAt),
    updatedAt: timestampOrEmpty(skill.updatedAt || skill.createdAt),
  };
}

function normalizeRun({ run = {}, skillByLocalId, matterIndex, tenantId }) {
  const localSkillId = stringValue(run.skillId);
  const skill = skillByLocalId.get(localSkillId);
  if (!skill) return null;
  const matter = {
    matterName: stringValue(run.matterName),
    folderName: stringValue(run.matterFolder),
  };
  const matterRow = findMatter(matterIndex, matter);
  const status = normalizeRunStatus(run.status);
  const outputPaths = objectValue(run.outputPaths);
  const receipt = deriveConfigurableSkillRunReceipt({
    status,
    outputPaths,
    outputAvailability: { markdown: "unknown", json: "unknown" },
    overwrite: stringValue(run.overwrite),
  });
  return {
    id: deterministicUuid(`configurable-skill-run:${stringValue(run.id)}`),
    localId: stringValue(run.id),
    tenantId,
    matterId: matterRow?.id || "",
    skillId: skill.id,
    skillVersionId: skill.versionId,
    status,
    receipt: {
      ...receipt,
      local_run_id: stringValue(run.id),
      slash: stringValue(run.slash),
      title: stringValue(run.title),
      matter,
      output_paths: outputPaths,
      warnings: normalizeWarnings(run.warnings),
    },
    startedAt: timestampOrEmpty(run.startedAt),
    finishedAt: timestampOrEmpty(run.finishedAt),
    errorCode: status === "failed" ? "local_skill_run_failed" : "",
    errorMessage: stringValue(run.errorMessage, 800),
    aiRun: normalizeAiRun(run.aiRun || run.ai_run),
  };
}

function normalizeAiRun(value) {
  const source = objectValue(value);
  const usage = objectValue(source.usage);
  return {
    provider: stringValue(source.provider),
    model: stringValue(source.model),
    task: stringValue(source.task),
    policyPromptVersion: stringValue(source.policyPromptVersion),
    policyVersion: stringValue(source.policyVersion),
    promptVersion: stringValue(source.promptVersion),
    returnedModel: stringValue(source.returnedModel),
    returnedProvider: stringValue(source.returnedProvider),
    usage: {
      promptTokens: positiveIntegerOrNull(usage.promptTokens ?? usage.inputTokens),
      completionTokens: positiveIntegerOrNull(usage.completionTokens ?? usage.outputTokens),
      totalTokens: positiveIntegerOrNull(usage.totalTokens),
      cost: numberOrNull(usage.cost ?? usage.costAmount),
    },
  };
}

function appendSkillIdeaSql(lines, idea) {
  lines.push(`insert into skill_ideas (id, tenant_id, matter_id, created_by_user_id, text, status, matter_name, matter_folder_name, design_brief_json, readiness_json, created_at, updated_at) values (${sqlString(idea.id)}, ${sqlString(idea.tenantId)}, ${sqlStringOrNull(idea.matterId)}, ${sqlString(idea.createdByUserId)}, ${sqlString(idea.text)}, ${sqlString(idea.status)}, ${sqlString(idea.matterName)}, ${sqlString(idea.matterFolderName)}, ${sqlJson(idea.designBrief)}, ${sqlJson(idea.readiness)}, ${sqlTimestampOrNow(idea.createdAt)}, ${sqlTimestampOrNow(idea.updatedAt)}) on conflict (id) do update set status = excluded.status, matter_id = excluded.matter_id, matter_name = excluded.matter_name, matter_folder_name = excluded.matter_folder_name, design_brief_json = excluded.design_brief_json, readiness_json = excluded.readiness_json, updated_at = excluded.updated_at;`);
}

function appendSkillSampleSql(lines, sample) {
  lines.push(`insert into skill_samples (id, tenant_id, idea_id, matter_id, version, approved, approved_at, design_brief_hash, sample_markdown_object_key, sample_hash, feedback, warnings_json, raw_sample_json, created_at, updated_at) values (${sqlString(sample.id)}, ${sqlString(sample.tenantId)}, ${sqlString(sample.ideaId)}, ${sqlStringOrNull(sample.matterId)}, ${sqlInteger(sample.version, 1)}, ${sqlBoolean(sample.approved)}, ${sqlTimestampOrNull(sample.approvedAt)}, ${sqlString(sample.designBriefHash)}, ${sqlString(sample.sampleMarkdownObjectKey)}, ${sqlString(sample.sampleHash)}, ${sqlString(sample.feedback)}, ${sqlJson(sample.warnings)}, ${sqlJson(sample.rawSample)}, ${sqlTimestampOrNow(sample.createdAt)}, ${sqlTimestampOrNow(sample.createdAt)}) on conflict (idea_id, version) do update set approved = excluded.approved, approved_at = excluded.approved_at, sample_markdown_object_key = excluded.sample_markdown_object_key, sample_hash = excluded.sample_hash, feedback = excluded.feedback, warnings_json = excluded.warnings_json, raw_sample_json = excluded.raw_sample_json, updated_at = excluded.updated_at;`);
}

function appendConfigurableSkillSql(lines, skill) {
  lines.push(`insert into configurable_skills (id, tenant_id, created_by_user_id, title, slash, status, current_version_id, previous_status, status_changed_at, status_changed_by, status_change_reason, created_at, updated_at) values (${sqlString(skill.id)}, ${sqlString(skill.tenantId)}, ${sqlString(skill.createdByUserId)}, ${sqlString(skill.title)}, ${sqlString(skill.slash)}, ${sqlString(skill.status)}, null, ${sqlStringOrNull(skill.previousStatus)}, ${sqlTimestampOrNull(skill.statusChangedAt)}, ${sqlString(skill.statusChangedBy)}, ${sqlString(skill.statusChangeReason)}, ${sqlTimestampOrNow(skill.createdAt)}, ${sqlTimestampOrNow(skill.updatedAt)}) on conflict (id) do update set title = excluded.title, slash = excluded.slash, status = excluded.status, previous_status = excluded.previous_status, status_changed_at = excluded.status_changed_at, status_changed_by = excluded.status_changed_by, status_change_reason = excluded.status_change_reason, updated_at = excluded.updated_at;`);
}

function appendConfigurableSkillVersionSql(lines, skill) {
  lines.push(`insert into configurable_skill_versions (id, tenant_id, skill_id, version_number, status, definition_json, source_idea_id, policy_prompt_version, created_by_user_id, created_at) values (${sqlString(skill.versionId)}, ${sqlString(skill.tenantId)}, ${sqlString(skill.id)}, ${sqlInteger(skill.version, 1)}, ${sqlString(skillVersionStatus(skill.status))}, ${sqlJson(skill.definition)}, ${sqlStringOrNull(skill.sourceIdeaId)}, ${sqlString(skill.policyPromptVersion)}, ${sqlString(skill.createdByUserId)}, ${sqlTimestampOrNow(skill.createdAt)}) on conflict (skill_id, version_number) do update set status = excluded.status, definition_json = excluded.definition_json, source_idea_id = excluded.source_idea_id, policy_prompt_version = excluded.policy_prompt_version;`);
}

function appendConfigurableSkillRunSql(lines, run) {
  lines.push(`insert into configurable_skill_runs (id, tenant_id, matter_id, skill_id, skill_version_id, status, receipt_json, started_at, finished_at, error_code, error_message) values (${sqlString(run.id)}, ${sqlString(run.tenantId)}, ${sqlStringOrNull(run.matterId)}, ${sqlString(run.skillId)}, ${sqlString(run.skillVersionId)}, ${sqlString(run.status)}, ${sqlJson(run.receipt)}, ${sqlTimestampOrNow(run.startedAt)}, ${sqlTimestampOrNull(run.finishedAt)}, ${sqlString(run.errorCode)}, ${sqlString(run.errorMessage)}) on conflict (id) do update set matter_id = excluded.matter_id, skill_id = excluded.skill_id, skill_version_id = excluded.skill_version_id, status = excluded.status, receipt_json = excluded.receipt_json, finished_at = excluded.finished_at, error_code = excluded.error_code, error_message = excluded.error_message;`);
}

function skillHydrationCountKeys() {
  return [
    ["skill_ideas", "skill_ideas"],
    ["skill_samples", "skill_samples"],
    ["configurable_skills", "configurable_skills"],
    ["configurable_skill_versions", "configurable_skill_versions"],
    ["configurable_skill_runs", "configurable_skill_runs"],
  ];
}

function expectedSkillHydrationCounts(plan = {}) {
  const plannedRows = plan.plannedRows || {};
  return {
    skill_ideas: plannedRows.skillIdeas || 0,
    skill_samples: plannedRows.skillSamples || 0,
    configurable_skills: plannedRows.configurableSkills || 0,
    configurable_skill_versions: plannedRows.configurableSkillVersions || 0,
    configurable_skill_runs: plannedRows.configurableSkillRuns || 0,
  };
}

function countMismatches({ expected = {}, counts = {} } = {}) {
  const mismatches = [];
  const seen = new Set();
  for (const key of Object.keys(counts)) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) continue;
    seen.add(key);
    if (expected[key] !== counts[key]) mismatches.push({ key, expected: expected[key], actual: counts[key] });
  }
  for (const [key, expectedCount] of Object.entries(expected)) {
    if (seen.has(key)) continue;
    if (expectedCount !== 0) mismatches.push({ key, expected: expectedCount, actual: 0 });
  }
  return mismatches;
}

function parsePipeCounts(stdout = "") {
  const counts = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) continue;
    const [key, value] = trimmed.split("|");
    const count = Number.parseInt(value, 10);
    if (!key || !Number.isFinite(count)) continue;
    counts[key] = count;
  }
  return counts;
}

function parsePsqlJsonArray(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON skill summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array skill summary.");
  return parsed;
}

function normalizeInspectionSkill(row = {}) {
  return {
    skillId: stringValue(row.skill_id),
    title: stringValue(row.title),
    slash: normalizeSlash(row.slash),
    status: stringValue(row.status),
    versionCount: Number(row.version_count) || 0,
    runCount: Number(row.run_count) || 0,
  };
}

function normalizeMatterSummary(matter = {}) {
  const source = matter && typeof matter === "object" ? matter : {};
  return {
    matterName: stringValue(source.matterName || source.matter_name),
    folderName: stringValue(source.folderName || source.folder_name),
  };
}

function findMatter(matterIndex, matter = {}) {
  if (!matterIndex) return null;
  return matterIndex.byFolder.get(matter.folderName) || matterIndex.byName.get(matter.matterName) || null;
}

function normalizeIdeaStatus(status) {
  const normalized = stringValue(status);
  return ["incomplete", "ready_for_review", "parked", "dismissed"].includes(normalized) ? normalized : "incomplete";
}

function normalizeSkillStatus(status) {
  const normalized = stringValue(status);
  return ["draft", "active", "disabled", "suspended", "archived", "deleted"].includes(normalized) ? normalized : "draft";
}

function normalizeOptionalSkillStatus(status) {
  const normalized = stringValue(status);
  return normalized ? normalizeSkillStatus(normalized) : "";
}

function skillVersionStatus(status) {
  if (status === "active") return "active";
  if (status === "draft") return "draft";
  return "disabled";
}

function normalizeRunStatus(status) {
  const normalized = stringValue(status);
  return ["running", "succeeded", "failed", "cancelled"].includes(normalized) ? normalized : "running";
}

function normalizeSlash(value) {
  const raw = stringValue(value).toLowerCase().replace(/[^a-z0-9_/]+/g, "_").replace(/_+/g, "_");
  if (!raw) return "";
  const slash = raw.startsWith("/") ? raw : `/${raw}`;
  return slash.replace(/\/+/g, "/").replace(/_$/g, "") || "";
}

function normalizeWarnings(warnings = []) {
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .map((warning) => stringValue(warning, 800))
    .filter(Boolean)
    .slice(0, 10);
}

function omitWorkProduct(value = {}) {
  const clone = JSON.parse(JSON.stringify(value || {}));
  delete clone.sampleMarkdown;
  delete clone.sample_markdown;
  if (clone.rawSample) {
    delete clone.rawSample.sampleMarkdown;
    delete clone.rawSample.sample_markdown;
  }
  return clone;
}

function emptyTotals() {
  return {
    ideas: 0,
    samples: 0,
    configurableSkills: 0,
    configurableSkillVersions: 0,
    configurableSkillRuns: 0,
    skippedRuns: 0,
    warnings: 0,
  };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value, maxLength = 1200) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function timestampOrEmpty(value) {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text : "";
}

function positiveInteger(value, fallback = 1) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveIntegerOrNull(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlStringOrNull(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function sqlTimestampOrNow(value) {
  const text = timestampOrEmpty(value);
  return text ? sqlString(text) : "now()";
}

function sqlTimestampOrNull(value) {
  const text = timestampOrEmpty(value);
  return text ? sqlString(text) : "null";
}

function sqlInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function sqlBoolean(value) {
  return value ? "true" : "false";
}

function toSnakeCase(value) {
  return String(value).replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function redactSecret(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const plan = await collectLocalSkillHydrationPlan({ appDir: args.appDir, mattersHome: args.mattersHome });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalSkillHydration({ databaseUrl, plan, slashQuery: args.slashQuery });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderSkillHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalSkillHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderSkillHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalSkillHydrationPlan({ databaseUrl, plan });
    const report = { ...skillHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderSkillHydrationReport(report)) console.log(line);
      console.log("skill_shadow_hydration: applied");
    }
    return;
  }
  const report = skillHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderSkillHydrationReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
