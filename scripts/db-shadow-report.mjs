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
  collectMatterPlan = collectLocalMatterHydrationPlan,
  collectSkillPlan = collectLocalSkillHydrationPlan,
  verifyMatter = verifyLocalMatterHydration,
  inspectMatter = inspectLocalMatterHydration,
  verifySkill = verifyLocalSkillHydration,
  inspectSkill = inspectLocalSkillHydration,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before running the shadow DB report.");

  const resolvedMatterPlan = matterPlan || await collectMatterPlan({ mattersHome });
  const resolvedSkillPlan = skillPlan || await collectSkillPlan({ appDir, mattersHome });
  const matterVerification = verifyMatter({ databaseUrl, plan: resolvedMatterPlan });
  const matterInspection = inspectMatter({ databaseUrl, plan: resolvedMatterPlan, matterQuery });
  const skillVerification = verifySkill({ databaseUrl, plan: resolvedSkillPlan });
  const skillInspection = inspectSkill({ databaseUrl, plan: resolvedSkillPlan, slashQuery });

  return {
    matched: Boolean(matterVerification.matched && skillVerification.matched),
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
