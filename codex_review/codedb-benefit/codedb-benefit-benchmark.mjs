#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "codex_review", "codedb-benefit");
const codedbBin = process.env.CODEDB_BIN || "/Users/aksingh/bin/codedb";

const tasks = [
  {
    id: "skill-workspace-ux",
    query: "SkillIdeaSession",
    expected: [
      "react-ui/src/components/command/SkillIdeaSession.tsx",
      "react-ui/src/hooks/useSkillIdeaSessionMachine.ts",
      "react-ui/src/lib/skillIdeaSessionActions.ts",
      "react-ui/src/components/command/CommandPanel.tsx",
    ],
  },
  {
    id: "skills-page-progress",
    query: "Skills in Progress",
    expected: ["react-ui/src/views/SkillsPage.tsx"],
  },
  {
    id: "new-matter-upload",
    query: "No files attached",
    expected: [
      "react-ui/src/views/NewMatterForm.tsx",
      "services/runtime-db-storage-service.mjs",
    ],
  },
  {
    id: "feedback-capture",
    query: "Have a problem",
    expected: [
      "react-ui/src/components/command/CommandPanel.tsx",
      "services/private-beta-feedback-service.mjs",
    ],
  },
  {
    id: "runtime-db-storage",
    query: "createMatterFromUploadedFiles",
    expected: ["services/runtime-db-storage-service.mjs"],
  },
  {
    id: "copilot-selector",
    query: "Copilot strength",
    expected: [
      "react-ui/src/components/command/CommandPanel.tsx",
      "react-ui/src/lib/copilotModels.ts",
    ],
  },
  {
    id: "list-of-dates",
    query: "createListOfDates",
    expected: [
      "create-listofdates-engine.mjs",
      "services/create-listofdates-service.mjs",
    ],
  },
  {
    id: "ocr-repair",
    query: "ocr_repair_status",
    expected: [
      "extract-engine.mjs",
      "services/chained-ocr-provider.mjs",
    ],
  },
  {
    id: "custom-skill-receipts",
    query: "receiptState",
    expected: [
      "services/configurable-skill-runs-service.mjs",
      "react-ui/src/views/ActivityPage.tsx",
    ],
  },
  {
    id: "private-beta-auth",
    query: "Login required",
    expected: [
      "services/private-beta-auth-service.mjs",
      "routes/private-beta-auth-routes.mjs",
    ],
  },
];

function run(command, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const ended = process.hrtime.bigint();
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    ms: Number(ended - started) / 1e6,
    stdout,
    stderr,
    bytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
  };
}

function runWarmed(command, args) {
  run(command, args);
  return run(command, args);
}

function codedbSearch(query) {
  return runWarmed(codedbBin, [repoRoot, "search", "--paths-only", "--max-results", "12", query]);
}

function rgSearch(query) {
  return runWarmed("rg", [
    "-n",
    "--glob",
    "!codex_review/**",
    "--glob",
    "!docs/**",
    "--glob",
    "!test/**",
    "--glob",
    "!evals/**",
    "--glob",
    "!FOR_AKSINGH.md",
    query,
    ".",
  ]);
}

function isCurrentSourcePath(candidate) {
  if (!candidate || candidate.startsWith(".")) return false;
  if (
    candidate.startsWith("docs/") ||
    candidate.startsWith("test/") ||
    candidate.startsWith("evals/") ||
    candidate.startsWith("codex_review/") ||
    candidate === "FOR_AKSINGH.md"
  ) {
    return false;
  }
  return (
    candidate.startsWith("react-ui/src/") ||
    candidate.startsWith("services/") ||
    candidate.startsWith("routes/") ||
    candidate.startsWith("shared/") ||
    candidate.startsWith("db/") ||
    candidate.startsWith("listofdates/") ||
    candidate.endsWith(".mjs") ||
    candidate.endsWith(".ts") ||
    candidate.endsWith(".tsx")
  );
}

function normalizeCandidatePaths(output) {
  const paths = new Set();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
    const match = line.match(/^(.+?):\d+(?::|$)/) || line.match(/^(.+?)\s+\(/);
    if (!match) continue;
    let candidate = match[1].trim();
    if (candidate.startsWith("./")) candidate = candidate.slice(2);
    if (!candidate || candidate.includes(" ")) continue;
    if (!isCurrentSourcePath(candidate)) continue;
    paths.add(candidate);
  }
  return [...paths];
}

function score(candidates, expected) {
  const hitSet = new Set(candidates);
  const found = expected.filter((file) => hitSet.has(file));
  const recall = expected.length ? found.length / expected.length : 1;
  const noise = Math.max(0, candidates.length - found.length);
  return { found, missing: expected.filter((file) => !hitSet.has(file)), recall, noise };
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function fmtMs(n) {
  return `${n.toFixed(2)}ms`;
}

function formatNoiseComparison(value) {
  if (value > 0) return `${pct(value)} less noise from codedb`;
  if (value < 0) return `${pct(Math.abs(value))} more noise from codedb`;
  return "same noise count";
}

mkdirSync(outDir, { recursive: true });

const rows = [];
for (const task of tasks) {
  const codedb = codedbSearch(task.query);
  const rg = rgSearch(task.query);
  const codedbCandidates = normalizeCandidatePaths(codedb.stdout);
  const rgCandidates = normalizeCandidatePaths(rg.stdout);
  rows.push({
    ...task,
    codedb,
    rg,
    codedbCandidates,
    rgCandidates,
    codedbScore: score(codedbCandidates, task.expected),
    rgScore: score(rgCandidates, task.expected),
  });
}

const totals = rows.reduce(
  (acc, row) => {
    acc.codedbMs += row.codedb.ms;
    acc.rgMs += row.rg.ms;
    acc.codedbBytes += row.codedb.bytes;
    acc.rgBytes += row.rg.bytes;
    acc.codedbRecall += row.codedbScore.recall;
    acc.rgRecall += row.rgScore.recall;
    acc.codedbNoise += row.codedbScore.noise;
    acc.rgNoise += row.rgScore.noise;
    return acc;
  },
  {
    codedbMs: 0,
    rgMs: 0,
    codedbBytes: 0,
    rgBytes: 0,
    codedbRecall: 0,
    rgRecall: 0,
    codedbNoise: 0,
    rgNoise: 0,
  },
);

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  taskCount: rows.length,
  totals,
  averages: {
    codedbMs: totals.codedbMs / rows.length,
    rgMs: totals.rgMs / rows.length,
    codedbBytes: totals.codedbBytes / rows.length,
    rgBytes: totals.rgBytes / rows.length,
    codedbRecall: totals.codedbRecall / rows.length,
    rgRecall: totals.rgRecall / rows.length,
    codedbNoise: totals.codedbNoise / rows.length,
    rgNoise: totals.rgNoise / rows.length,
  },
  rows: rows.map((row) => ({
    id: row.id,
    query: row.query,
    expected: row.expected,
    codedb: {
      ms: row.codedb.ms,
      bytes: row.codedb.bytes,
      status: row.codedb.status,
      candidates: row.codedbCandidates,
      ...row.codedbScore,
    },
    rg: {
      ms: row.rg.ms,
      bytes: row.rg.bytes,
      status: row.rg.status,
      candidates: row.rgCandidates.slice(0, 80),
      ...row.rgScore,
    },
  })),
};

const speedRatio = totals.rgMs / Math.max(1, totals.codedbMs);
const byteReduction = 1 - totals.codedbBytes / Math.max(1, totals.rgBytes);
const noiseReduction = 1 - totals.codedbNoise / Math.max(1, totals.rgNoise);

const markdown = `# codedb Benefit Benchmark

Generated: ${summary.generatedAt}

Scope: Matter Workbench orientation benchmark. This measures source-code discovery efficiency, not implementation quality.

Method: each command is warmed once, then measured once. Candidate/noise scoring excludes docs, tests, evals, legacy vanilla frontend, and this review folder so the metric focuses on current source-code owner files. codedb is capped to the top 12 path hits, matching how it should be used for orientation instead of broad grep replacement.

## Summary

| Metric | codedb | rg baseline | Result |
| --- | ---: | ---: | --- |
| Tasks | ${rows.length} | ${rows.length} | Real repo owner-file tasks |
| Total latency | ${fmtMs(totals.codedbMs)} | ${fmtMs(totals.rgMs)} | codedb ${speedRatio.toFixed(1)}x faster in this run |
| Total output | ${totals.codedbBytes} bytes | ${totals.rgBytes} bytes | ${pct(byteReduction)} fewer bytes from codedb |
| Avg owner-file recall | ${pct(summary.averages.codedbRecall)} | ${pct(summary.averages.rgRecall)} | Higher is better |
| Total noise files | ${totals.codedbNoise} | ${totals.rgNoise} | ${formatNoiseComparison(noiseReduction)} |

## Interpretation

- codedb helps most as a first-pass map: fast path/file/symbol discovery with small output.
- rg remains useful for exact-text verification and for catching files codedb did not surface.
- This benchmark intentionally uses simple one-query discovery. Real development should still read source ranges and run tests.

## Per-Task Results

| Task | Query | codedb recall/noise | rg recall/noise | codedb bytes | rg bytes |
| --- | --- | ---: | ---: | ---: | ---: |
${rows
  .map(
    (row) =>
      `| ${row.id} | \`${row.query}\` | ${pct(row.codedbScore.recall)} / ${row.codedbScore.noise} | ${pct(row.rgScore.recall)} / ${row.rgScore.noise} | ${row.codedb.bytes} | ${row.rg.bytes} |`,
  )
  .join("\n")}

## Misses To Remember

${rows
  .filter((row) => row.codedbScore.missing.length || row.rgScore.missing.length)
  .map(
    (row) =>
      `- ${row.id}: codedb missing [${row.codedbScore.missing.join(", ") || "none"}]; rg missing [${row.rgScore.missing.join(", ") || "none"}]`,
  )
  .join("\n") || "- No expected-owner misses in this run."}

## Raw Data

See \`codedb-benefit-results.json\`.
`;

writeFileSync(path.join(outDir, "codedb-benefit-results.json"), JSON.stringify(summary, null, 2));
writeFileSync(path.join(outDir, "codedb-benefit-report.md"), markdown);

console.log(markdown);
