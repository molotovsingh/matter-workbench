#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  collectLocalMatterHydrationPlan,
  defaultMattersHome,
  inspectLocalMatterHydration,
  verifyLocalMatterHydration,
} from "./db-hydrate-local-matters.mjs";
import {
  collectLocalSkillHydrationPlan,
  inspectLocalSkillHydration,
  verifyLocalSkillHydration,
} from "./db-hydrate-local-skills.mjs";
import {
  collectLocalAdvisoryHydrationPlan,
  inspectLocalAdvisoryHydration,
  verifyLocalAdvisoryHydration,
} from "./db-hydrate-local-advisory.mjs";
import {
  collectLocalStorageHydrationPlan,
  inspectLocalStorageHydration,
  verifyLocalStorageHydration,
} from "./db-hydrate-local-storage.mjs";
import {
  collectLocalProviderRunHydrationPlan,
  inspectLocalProviderRunHydration,
  verifyLocalProviderRunHydration,
} from "./db-hydrate-local-provider-runs.mjs";
import {
  collectLocalJobHydrationPlan,
  inspectLocalJobHydration,
  verifyLocalJobHydration,
} from "./db-hydrate-local-jobs.mjs";
import {
  buildShadowCostEventPlan,
  collectLocalCostEventHydrationPlan,
  inspectLocalCostEventHydration,
  verifyLocalCostEventHydration,
} from "./db-hydrate-local-cost-events.mjs";
import {
  collectLocalAuditEventHydrationPlan,
  inspectLocalAuditEventHydration,
  verifyLocalAuditEventHydration,
} from "./db-hydrate-local-audit-events.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseArgs(argv = []) {
  const parsed = {
    json: false,
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
    matterQuery: "",
    slashQuery: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
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
    } else if (arg === "--matter") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matter requires a value");
      parsed.matterQuery = value;
      i += 1;
    } else if (arg === "--slash") {
      const value = argv[i + 1];
      if (!value) throw new Error("--slash requires a value");
      parsed.slashQuery = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function buildShadowDbReport({
  databaseUrl,
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  matterQuery = "",
  slashQuery = "",
  matterPlan,
  skillPlan,
  advisoryPlan,
  storagePlan,
  providerRunPlan,
  jobPlan,
  costEventPlan,
  auditEventPlan,
  collectMatterPlan = collectLocalMatterHydrationPlan,
  collectSkillPlan = collectLocalSkillHydrationPlan,
  collectAdvisoryPlan = collectLocalAdvisoryHydrationPlan,
  collectStoragePlan = collectLocalStorageHydrationPlan,
  collectProviderRunPlan = collectLocalProviderRunHydrationPlan,
  collectJobPlan = collectLocalJobHydrationPlan,
  collectCostEventPlan = collectLocalCostEventHydrationPlan,
  collectAuditEventPlan = collectLocalAuditEventHydrationPlan,
  verifyMatter = verifyLocalMatterHydration,
  inspectMatter = inspectLocalMatterHydration,
  verifySkill = verifyLocalSkillHydration,
  inspectSkill = inspectLocalSkillHydration,
  verifyAdvisory = verifyLocalAdvisoryHydration,
  inspectAdvisory = inspectLocalAdvisoryHydration,
  verifyStorage = verifyLocalStorageHydration,
  inspectStorage = inspectLocalStorageHydration,
  verifyProviderRuns = verifyLocalProviderRunHydration,
  inspectProviderRuns = inspectLocalProviderRunHydration,
  verifyJobs = verifyLocalJobHydration,
  inspectJobs = inspectLocalJobHydration,
  verifyCostEvents = verifyLocalCostEventHydration,
  inspectCostEvents = inspectLocalCostEventHydration,
  verifyAuditEvents = verifyLocalAuditEventHydration,
  inspectAuditEvents = inspectLocalAuditEventHydration,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before running the shadow DB report.");

  const resolvedMatterPlan = matterPlan || await collectMatterPlan({ mattersHome });
  const resolvedSkillPlan = skillPlan || await collectSkillPlan({ appDir, mattersHome });
  const resolvedAdvisoryPlan = advisoryPlan || await collectAdvisoryPlan({ appDir, mattersHome, matter: matterQuery });
  const resolvedStoragePlan = storagePlan || await collectStoragePlan({ appDir, mattersHome });
  const resolvedProviderRunPlan = providerRunPlan || await collectProviderRunPlan({ appDir, mattersHome });
  const resolvedJobPlan = jobPlan || await collectJobPlan({
    appDir,
    mattersHome,
    matterPlan: resolvedMatterPlan,
    providerRunPlan: resolvedProviderRunPlan,
  });
  const resolvedCostEventPlan = costEventPlan || (
    providerRunPlan
      ? buildShadowCostEventPlan({ providerRunPlan: resolvedProviderRunPlan, appDir, mattersHome })
      : await collectCostEventPlan({ appDir, mattersHome, providerRunPlan: resolvedProviderRunPlan })
  );
  const resolvedAuditEventPlan = auditEventPlan || await collectAuditEventPlan({
    appDir,
    mattersHome,
    matterPlan: resolvedMatterPlan,
  });
  const matterVerification = verifyMatter({ databaseUrl, plan: resolvedMatterPlan });
  const matterInspection = inspectMatter({ databaseUrl, plan: resolvedMatterPlan, matterQuery });
  const skillVerification = verifySkill({ databaseUrl, plan: resolvedSkillPlan });
  const skillInspection = inspectSkill({ databaseUrl, plan: resolvedSkillPlan, slashQuery });
  const advisoryVerification = verifyAdvisory({ databaseUrl, plan: resolvedAdvisoryPlan });
  const advisoryInspection = inspectAdvisory({ databaseUrl, plan: resolvedAdvisoryPlan });
  const storageVerification = verifyStorage({ databaseUrl, plan: resolvedStoragePlan });
  const storageInspection = inspectStorage({ databaseUrl, plan: resolvedStoragePlan });
  const providerRunVerification = verifyProviderRuns({ databaseUrl, plan: resolvedProviderRunPlan });
  const providerRunInspection = inspectProviderRuns({ databaseUrl, plan: resolvedProviderRunPlan });
  const jobVerification = verifyJobs({ databaseUrl, plan: resolvedJobPlan });
  const jobInspection = inspectJobs({ databaseUrl, plan: resolvedJobPlan });
  const costEventVerification = verifyCostEvents({ databaseUrl, plan: resolvedCostEventPlan });
  const costEventInspection = inspectCostEvents({ databaseUrl, plan: resolvedCostEventPlan });
  const auditEventVerification = verifyAuditEvents({ databaseUrl, plan: resolvedAuditEventPlan });
  const auditEventInspection = inspectAuditEvents({ databaseUrl, plan: resolvedAuditEventPlan });

  return {
    matched: Boolean(
      matterVerification.matched
      && skillVerification.matched
      && advisoryVerification.matched
      && storageVerification.matched
      && providerRunVerification.matched
      && jobVerification.matched
      && costEventVerification.matched
      && auditEventVerification.matched
    ),
    filters: {
      matter: matterQuery || "",
      slash: slashQuery || "",
    },
    matter: {
      verification: matterVerification,
      inspection: matterInspection,
    },
    skills: {
      verification: skillVerification,
      inspection: skillInspection,
    },
    advisory: {
      verification: advisoryVerification,
      inspection: advisoryInspection,
    },
    storage: {
      verification: storageVerification,
      inspection: storageInspection,
    },
    providerRuns: {
      verification: providerRunVerification,
      inspection: providerRunInspection,
    },
    jobs: {
      verification: jobVerification,
      inspection: jobInspection,
    },
    costEvents: {
      verification: costEventVerification,
      inspection: costEventInspection,
    },
    auditEvents: {
      verification: auditEventVerification,
      inspection: auditEventInspection,
    },
  };
}

export function renderShadowDbReport(report = {}) {
  const lines = [
    "Matter Workbench shadow DB report",
    `matched: ${report.matched ? "yes" : "no"}`,
    `matter_filter: ${report.filters?.matter || "(none)"}`,
    `slash_filter: ${report.filters?.slash || "(none)"}`,
    `matter_counts: ${report.matter?.verification?.matched ? "matched" : "mismatch"}`,
  ];

  appendCounts(lines, report.matter?.verification);
  appendMismatches(lines, report.matter?.verification);
  const matterTotals = report.matter?.inspection?.totals || {};
  lines.push("matter_totals:");
  lines.push(`  documents: ${matterTotals.documents || 0}`);
  lines.push(`  extraction_records: ${matterTotals.extractionRecords || 0}`);
  lines.push(`  source_descriptors: ${matterTotals.sourceDescriptors || 0}`);
  lines.push(`  matter_artifacts: ${matterTotals.matterArtifacts || 0}`);
  lines.push("matter_summaries:");
  for (const matter of report.matter?.inspection?.matters || []) {
    lines.push([
      `  ${matter.matterName}`,
      `documents=${matter.documents}`,
      `extractions=${matter.extractionRecords}`,
      `source_descriptors=${matter.sourceDescriptors}`,
      `artifacts=${matter.matterArtifacts}`,
      `next_file_number=${matter.nextFileNumber}`,
    ].join(" "));
  }
  if (!report.matter?.inspection?.matters?.length) lines.push("  (none)");

  lines.push(`skill_counts: ${report.skills?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.skills?.verification);
  appendMismatches(lines, report.skills?.verification);
  const skillTotals = report.skills?.inspection?.totals || {};
  lines.push("skill_totals:");
  lines.push(`  configurable_skills: ${skillTotals.configurableSkills || 0}`);
  lines.push(`  configurable_skill_versions: ${skillTotals.configurableSkillVersions || 0}`);
  lines.push(`  configurable_skill_runs: ${skillTotals.configurableSkillRuns || 0}`);
  lines.push("skill_summaries:");
  for (const skill of report.skills?.inspection?.skills || []) {
    lines.push(`  ${skill.slash} ${skill.title} status=${skill.status} versions=${skill.versionCount} runs=${skill.runCount}`);
  }
  if (!report.skills?.inspection?.skills?.length) lines.push("  (none)");

  lines.push(`advisory_counts: ${report.advisory?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.advisory?.verification);
  appendMismatches(lines, report.advisory?.verification);
  const advisoryTotals = report.advisory?.inspection?.totals || {};
  lines.push("advisory_totals:");
  lines.push(`  blockers: ${advisoryTotals.blocker || 0}`);
  lines.push(`  warnings: ${advisoryTotals.warning || 0}`);
  lines.push(`  info: ${advisoryTotals.info || 0}`);
  lines.push(`  incidents: ${advisoryTotals.incidents || 0}`);
  lines.push("latest_advisory_snapshots:");
  for (const snapshot of report.advisory?.inspection?.snapshots || []) {
    lines.push(`  ${snapshot.matterName} blockers=${snapshot.blocker} warnings=${snapshot.warning} info=${snapshot.info} incidents=${snapshot.incidentCount}`);
  }
  if (!report.advisory?.inspection?.snapshots?.length) lines.push("  (none)");

  lines.push(`storage_counts: ${report.storage?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.storage?.verification);
  appendMismatches(lines, report.storage?.verification);
  const storageTotals = report.storage?.inspection?.totals || {};
  lines.push("storage_totals:");
  lines.push(`  storage_objects: ${storageTotals.storageObjects || 0}`);
  lines.push("storage_roles:");
  for (const role of report.storage?.inspection?.roles || []) {
    lines.push(`  ${role.objectRole}: ${role.count}`);
  }
  if (!report.storage?.inspection?.roles?.length) lines.push("  (none)");

  lines.push(`provider_run_counts: ${report.providerRuns?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.providerRuns?.verification);
  appendMismatches(lines, report.providerRuns?.verification);
  const providerRunTotals = report.providerRuns?.inspection?.totals || {};
  lines.push("provider_run_totals:");
  lines.push(`  provider_runs: ${providerRunTotals.providerRuns || 0}`);
  lines.push("provider_run_groups:");
  for (const group of report.providerRuns?.inspection?.groups || []) {
    lines.push(`  ${group.taskClass} ${group.provider}/${group.model}: ${group.count}`);
  }
  if (!report.providerRuns?.inspection?.groups?.length) lines.push("  (none)");

  lines.push(`job_counts: ${report.jobs?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.jobs?.verification);
  appendMismatches(lines, report.jobs?.verification);
  const jobTotals = report.jobs?.inspection?.totals || {};
  lines.push("job_totals:");
  lines.push(`  processing_jobs: ${jobTotals.processingJobs || 0}`);
  lines.push("job_groups:");
  for (const group of report.jobs?.inspection?.groups || []) {
    lines.push(`  ${group.kind} ${group.status}: ${group.count}`);
  }
  if (!report.jobs?.inspection?.groups?.length) lines.push("  (none)");

  lines.push(`cost_event_counts: ${report.costEvents?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.costEvents?.verification);
  appendMismatches(lines, report.costEvents?.verification);
  const costEventTotals = report.costEvents?.inspection?.totals || {};
  lines.push("cost_event_totals:");
  lines.push(`  cost_events: ${costEventTotals.costEvents || 0}`);
  lines.push(`  actual_amount: ${costEventTotals.actualAmount || 0}`);
  lines.push("cost_event_groups:");
  for (const group of report.costEvents?.inspection?.groups || []) {
    lines.push(`  ${group.scope} ${group.confidence} ${group.provider}/${group.model}: count=${group.count} amount=${group.amount ?? ""}`);
  }
  if (!report.costEvents?.inspection?.groups?.length) lines.push("  (none)");

  lines.push(`audit_event_counts: ${report.auditEvents?.verification?.matched ? "matched" : "mismatch"}`);
  appendCounts(lines, report.auditEvents?.verification);
  appendMismatches(lines, report.auditEvents?.verification);
  const auditEventTotals = report.auditEvents?.inspection?.totals || {};
  lines.push("audit_event_totals:");
  lines.push(`  audit_events: ${auditEventTotals.auditEvents || 0}`);
  lines.push(`  provider_invoked_audit_events: ${auditEventTotals.providerInvokedAuditEvents || 0}`);
  lines.push("audit_event_groups:");
  for (const group of report.auditEvents?.inspection?.groups || []) {
    lines.push(`  ${group.action} provider_invoked=${group.providerRunInvoked ? "true" : "false"}: ${group.count}`);
  }
  if (!report.auditEvents?.inspection?.groups?.length) lines.push("  (none)");

  return lines;
}

function appendCounts(lines, verification = {}) {
  const expected = verification.expected || {};
  const counts = verification.counts || {};
  for (const key of Object.keys(expected)) {
    lines.push(`  ${key}: expected=${expected[key]} actual=${counts[key] || 0}`);
  }
}

function appendMismatches(lines, verification = {}) {
  if (!verification.mismatches?.length) return;
  lines.push("mismatches:");
  for (const mismatch of verification.mismatches) {
    lines.push(`  ${mismatch.key}: expected=${mismatch.expected} actual=${mismatch.actual}`);
  }
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
  const report = await buildShadowDbReport({
    databaseUrl,
    appDir: args.appDir,
    mattersHome: args.mattersHome,
    matterQuery: args.matterQuery,
    slashQuery: args.slashQuery,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const line of renderShadowDbReport(report)) console.log(line);
  }
  if (!report.matched) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
