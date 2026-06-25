#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "release-position-check/v1";

// Files that must agree on the current release. Kept as repo-relative paths so
// the checker reads the same sources the release policy names by hand.
const CLOSURE_PACK_PATH = "scripts/private-beta-rc-closure-pack.mjs";
const DOCS_README_PATH = "docs/README.md";
const ROOT_README_PATH = "README.md";
const CHECKLIST_PATH = "docs/beta-operator-checklist.md";

// Structural markers the policy's "Required Release Note" section calls for.
// Each is a tolerant presence test against the note body, not an exact format.
const REQUIRED_NOTE_MARKERS = [
  { id: "date", test: /^Date:\s*\S+/m },
  { id: "release_position_heading", test: /^##\s+Release Position/m },
  { id: "tag_target_label", test: /Tag target \/ deployed commit:/ },
  { id: "deployed_surface", test: /^##\s+Live Deployment Evidence/m },
  { id: "included_changes", test: /^##\s+Included Since/m },
  { id: "validation_evidence", test: /^##\s+Validation/m },
  { id: "not_promised", test: /^##\s+Not Promised/m },
  { id: "operator_pointer", test: /^##\s+Operator Notes/m },
];

export function parseReleasePositionCheckArgs(argv = [], env = process.env) {
  const parsed = {
    release: env.MWB_RELEASE_POSITION_RELEASE || "",
    repoRoot: process.cwd(),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--release") {
      parsed.release = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--repo-root") {
      parsed.repoRoot = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

export async function runReleasePositionCheck({
  release = "",
  repoRoot = process.cwd(),
  readFileFn = (relPath) => readFile(path.join(repoRoot, relPath), "utf8"),
  gitRunner = runGit,
} = {}) {
  const closurePackSource = await safeRead(readFileFn, CLOSURE_PACK_PATH);
  const defaultRelease = firstCapture(closurePackSource, /DEFAULT_RELEASE\s*=\s*"(v1\.0\.0-beta\.\d+)"/);
  const targetRelease = release || defaultRelease;

  if (!isReleaseTag(targetRelease)) {
    const fatal = normalizeCheck(
      "release_resolved",
      false,
      `Could not resolve a release. Pass --release or set DEFAULT_RELEASE in ${CLOSURE_PACK_PATH}.`,
    );
    return finalize(targetRelease, [fatal]);
  }

  const releaseNumber = Number(targetRelease.match(/beta\.(\d+)$/)[1]);
  const noteSource = await safeRead(readFileFn, releaseNotePath(targetRelease));

  const checks = [
    await runCheck("note_present_and_complete", () => checkNoteComplete(targetRelease, noteSource)),
    await runCheck("tag_annotated", () => checkTagAnnotated(targetRelease, gitRunner)),
    await runCheck("tag_matches_note", () => checkTagMatchesNote(targetRelease, noteSource, gitRunner)),
    await runCheck("pointers_agree", () => checkPointersAgree(targetRelease, defaultRelease, readFileFn)),
    await runCheck("no_stale_current_marker", () => checkNoStaleCurrentMarker(targetRelease, releaseNumber, readFileFn)),
  ];

  return finalize(targetRelease, checks);
}

export function renderReleasePositionCheckResult(result = {}) {
  const lines = [
    "Matter Workbench release position check",
    `release: ${result.release || "(unresolved)"}`,
    `success: ${result.ok ? "yes" : "no"}`,
  ];
  for (const check of result.checks || []) {
    lines.push(`${check.id}: ${check.ok ? "ok" : "failed"}${check.summary ? ` — ${check.summary}` : ""}`);
  }
  if (result.failedChecks?.length) lines.push(`failed_checks: ${result.failedChecks.join(", ")}`);
  return lines;
}

function finalize(release, checks) {
  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
  return {
    schemaVersion: SCHEMA_VERSION,
    release,
    ok: failedChecks.length === 0,
    failedChecks,
    checks,
  };
}

async function checkNoteComplete(release, noteSource) {
  if (!noteSource) {
    return { ok: false, summary: `missing release note ${releaseNotePath(release)}` };
  }
  const releaseAs = firstCapture(noteSource, /Release as:\s*```text\s*\n\s*(v1\.0\.0-beta\.\d+)/);
  const missing = REQUIRED_NOTE_MARKERS.filter((marker) => !marker.test.test(noteSource)).map((marker) => marker.id);
  if (releaseAs !== release) missing.push("release_as_matches");
  return {
    ok: missing.length === 0,
    summary: missing.length ? `missing/incorrect: ${missing.join(", ")}` : "all required note fields present",
    missing,
  };
}

async function checkTagAnnotated(release, gitRunner) {
  const type = await gitRunner({ args: ["cat-file", "-t", release] });
  const tagType = String(type.stdout || "").trim();
  if (!type.ok) {
    return { ok: false, summary: `tag ${release} not found`, tagType };
  }
  return {
    ok: tagType === "tag",
    summary: tagType === "tag" ? "annotated tag" : `tag is "${tagType}", policy requires an annotated tag`,
    tagType,
  };
}

async function checkTagMatchesNote(release, noteSource, gitRunner) {
  const noteHash = parseTagTargetHash(noteSource);
  if (!noteHash) {
    return { ok: false, summary: "could not parse 'Tag target / deployed commit' hash from the note" };
  }
  const [tagSha, noteSha] = await Promise.all([
    resolveCommit(gitRunner, `${release}^{commit}`),
    resolveCommit(gitRunner, noteHash),
  ]);
  if (!tagSha) return { ok: false, summary: `tag ${release} does not resolve to a commit`, noteHash };
  if (!noteSha) return { ok: false, summary: `note commit ${noteHash} not found in repo`, noteHash };
  return {
    ok: tagSha === noteSha,
    summary: tagSha === noteSha
      ? `tag and note both point at ${noteHash}`
      : `tag points at ${tagSha.slice(0, 7)} but note claims ${noteHash}`,
    tagSha,
    noteSha,
    noteHash,
  };
}

async function checkPointersAgree(release, defaultRelease, readFileFn) {
  const docsReadme = await safeRead(readFileFn, DOCS_README_PATH);
  const rootReadme = await safeRead(readFileFn, ROOT_README_PATH);
  const checklist = await safeRead(readFileFn, CHECKLIST_PATH);

  const pointers = [
    { id: "closure_pack_default_release", value: defaultRelease },
    {
      id: "docs_readme_current_row",
      value: firstCapture(docsReadme, /Current release notes \|\s*\[(v1\.0\.0-beta\.\d+)\]/),
    },
    {
      id: "root_readme_release_marker",
      value: firstCapture(rootReadme, /\[(v1\.0\.0-beta\.\d+) release marker\]\(docs\/releases/),
    },
    {
      id: "checklist_status",
      value: firstCapture(checklist, /Status:\s*Current checklist for\s*`(v1\.0\.0-beta\.\d+)`/),
    },
    {
      id: "checklist_checkout",
      value: firstCapture(checklist, /git checkout\s+(v1\.0\.0-beta\.\d+)/),
    },
  ];

  const disagreements = pointers.filter((pointer) => pointer.value !== release);
  return {
    ok: disagreements.length === 0,
    summary: disagreements.length === 0
      ? `all ${pointers.length} current-release pointers name ${release}`
      : disagreements.map((pointer) => `${pointer.id}=${pointer.value || "(not found)"}`).join(", "),
    pointers,
  };
}

async function checkNoStaleCurrentMarker(release, releaseNumber, readFileFn) {
  const docsReadme = await safeRead(readFileFn, DOCS_README_PATH);
  // History rows whose description is prefixed "Current" must only ever mark the
  // live release. A leftover "Current" prefix on an older row is the classic
  // stale-pointer mistake the policy's grep is meant to catch.
  const currentRowRe = /\|\s*\[(v1\.0\.0-beta\.\d+)\][^|]*\|\s*Current\b[^|]*\|/g;
  const marked = [];
  let match;
  while ((match = currentRowRe.exec(docsReadme)) !== null) marked.push(match[1]);

  const stale = marked.filter((version) => version !== release);
  const prevRelease = `v1.0.0-beta.${releaseNumber - 1}`;
  return {
    ok: stale.length === 0 && marked.includes(release),
    summary: stale.length
      ? `stale "Current" history rows: ${stale.join(", ")} (previous release is ${prevRelease})`
      : marked.includes(release)
        ? `only ${release} is marked current in the release history`
        : `no "Current" history row found for ${release}`,
    marked,
  };
}

async function resolveCommit(gitRunner, ref) {
  const result = await gitRunner({ args: ["rev-parse", "--verify", "--quiet", ref] });
  if (!result.ok) return "";
  return String(result.stdout || "").trim();
}

function parseTagTargetHash(noteSource) {
  if (!noteSource) return "";
  const block = firstCapture(
    noteSource,
    /Tag target \/ deployed commit:\s*```text\s*\n([\s\S]*?)```/,
  );
  const firstLine = String(block || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
  return firstCapture(firstLine, /^([0-9a-f]{7,40})\b/);
}

function releaseNotePath(release) {
  return `docs/releases/${release}.md`;
}

function isReleaseTag(value) {
  return /^v1\.0\.0-beta\.\d+$/.test(String(value || ""));
}

function firstCapture(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1] : "";
}

async function safeRead(readFileFn, relPath) {
  try {
    return await readFileFn(relPath);
  } catch {
    return "";
  }
}

async function runCheck(id, fn) {
  try {
    const result = await fn();
    return normalizeCheck(id, result.ok, result.summary, result);
  } catch (error) {
    return normalizeCheck(id, false, error?.message || `${id} failed`);
  }
}

function normalizeCheck(id, ok, summary = "", detail = {}) {
  const { ok: _ok, summary: _summary, ...rest } = detail;
  return { id, ok: Boolean(ok), summary, ...rest };
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function runGit({ args = [] }) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ ok: false, stdout, stderr: error.message, exitCode: 1 }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr, exitCode: code }));
  });
}

async function main() {
  const args = parseReleasePositionCheckArgs(process.argv.slice(2));
  const result = await runReleasePositionCheck(args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const line of renderReleasePositionCheckResult(result)) console.log(line);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
