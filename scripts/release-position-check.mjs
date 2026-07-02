#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "release-position-check/v1";

// The release policy intentionally keeps one current-release pointer. Other
// docs should link to this file instead of hardcoding the active beta number.
const CURRENT_RELEASE_PATH = "docs/releases/current.md";
const DOCS_README_PATH = "docs/README.md";

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
  const currentSource = await safeRead(readFileFn, CURRENT_RELEASE_PATH);
  const currentRelease = parseCurrentRelease(currentSource);
  const targetRelease = release || currentRelease;

  if (!isReleaseTag(targetRelease)) {
    const fatal = normalizeCheck(
      "release_resolved",
      false,
      `Could not resolve a release. Pass --release or set Release in ${CURRENT_RELEASE_PATH}.`,
    );
    return finalize(targetRelease, [fatal]);
  }

  const noteSource = await safeRead(readFileFn, releaseNotePath(targetRelease));

  const checks = [
    await runCheck("current_pointer", () => checkCurrentPointer(targetRelease, currentSource)),
    await runCheck("note_present_and_complete", () => checkNoteComplete(targetRelease, noteSource)),
    await runCheck("tag_annotated", () => checkTagAnnotated(targetRelease, gitRunner)),
    await runCheck("tag_matches_note", () => checkTagMatchesNote(targetRelease, noteSource, gitRunner)),
    await runCheck("no_versioned_current_marker", () => checkNoVersionedCurrentMarker(readFileFn)),
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

async function checkCurrentPointer(release, currentSource) {
  if (!currentSource) {
    return { ok: false, summary: `missing current release pointer ${CURRENT_RELEASE_PATH}` };
  }
  const currentRelease = parseCurrentRelease(currentSource);
  const currentNotePath = firstCapture(currentSource, /Release:\s*\[v1\.0\.0-beta\.\d+\]\(([^)]+)\)/);
  const currentTagTarget = parseTagTargetHash(currentSource);
  const mismatches = [];
  if (currentRelease !== release) mismatches.push(`release=${currentRelease || "(not found)"}`);
  if (currentNotePath && currentNotePath !== `${release}.md`) mismatches.push(`release_note=${currentNotePath}`);
  return {
    ok: mismatches.length === 0,
    summary: mismatches.length
      ? mismatches.join(", ")
      : `current pointer names ${release}${currentTagTarget ? ` at ${currentTagTarget}` : ""}`,
    currentRelease,
    currentNotePath,
    currentTagTarget,
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

async function checkNoVersionedCurrentMarker(readFileFn) {
  const docsReadme = await safeRead(readFileFn, DOCS_README_PATH);
  // Current status should live in docs/releases/current.md. Versioned release
  // history rows should not carry a "Current" prefix that can go stale.
  const currentRowRe = /\|\s*\[(v1\.0\.0-beta\.\d+)\][^|]*\|\s*Current\b[^|]*\|/g;
  const marked = [];
  let match;
  while ((match = currentRowRe.exec(docsReadme)) !== null) marked.push(match[1]);

  return {
    ok: marked.length === 0,
    summary: marked.length
      ? `versioned history rows still marked current: ${marked.join(", ")}`
      : "no versioned release-history rows are marked Current",
    marked,
  };
}

async function resolveCommit(gitRunner, ref) {
  const result = await gitRunner({ args: ["rev-parse", "--verify", "--quiet", ref] });
  if (!result.ok) return "";
  return String(result.stdout || "").trim();
}

function parseCurrentRelease(currentSource) {
  return firstCapture(currentSource, /Release:\s*\[(v1\.0\.0-beta\.\d+)\]\([^)]+\)/)
    || firstCapture(currentSource, /^Release:\s*(v1\.0\.0-beta\.\d+)\s*$/m);
}

function parseTagTargetHash(source) {
  if (!source) return "";
  const block = firstCapture(
    source,
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

function normalizeCheck(id, ok, summary = "", extra = {}) {
  return { id, ok: Boolean(ok), summary, ...extra };
}

async function runGit({ args, cwd = process.cwd() }) {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    child.on("error", (error) => resolve({ ok: false, code: null, stdout, stderr: error.message }));
  });
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${arg} requires a value`);
  return value;
}

if (process.argv[1] === __filename) {
  try {
    const args = parseReleasePositionCheckArgs(process.argv.slice(2));
    const result = await runReleasePositionCheck(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderReleasePositionCheckResult(result).join("\n"));
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
