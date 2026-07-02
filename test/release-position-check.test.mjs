import assert from "node:assert/strict";
import test from "node:test";

const modulePath = new URL("../scripts/release-position-check.mjs", import.meta.url);

function defaultNote(release, hash) {
  return [
    `# Matter Workbench ${release}`,
    "",
    "Date: 2026-06-25",
    "",
    "## Release Position",
    "",
    "Release as:",
    "",
    "```text",
    release,
    "```",
    "",
    "Tag target / deployed commit:",
    "",
    "```text",
    `${hash} Some commit subject`,
    "```",
    "",
    "## Included Since beta.6",
    "- migrated a thing;",
    "",
    "## Live Deployment Evidence",
    "https://example.invalid",
    "",
    "## Validation",
    "full test suite: passing",
    "",
    "## Not Promised",
    "nothing new promised",
    "",
    "## Operator Notes",
    "no workflow change",
    "",
  ].join("\n");
}

function defaultCurrentPointer(release, hash = "abc1234") {
  return [
    "# Current Matter Workbench Release",
    "",
    "Status: Current release pointer",
    "",
    `Release: [${release}](${release}.md)`,
    "",
    "Tag target / deployed commit:",
    "",
    "```text",
    `${hash} Some commit subject`,
    "```",
    "",
  ].join("\n");
}

function defaultDocsReadme(release, prev) {
  return [
    "| Current release pointer | [Current Matter Workbench Release](releases/current.md) |",
    "",
    "## Release History",
    "",
    `| [${prev}](releases/${prev}.md) | Beta 3 prior release marker. |`,
    `| [${release}](releases/${release}.md) | Beta 3 release marker. |`,
    "",
  ].join("\n");
}

function buildFixture(overrides = {}) {
  const release = overrides.release || "v1.0.0-beta.7";
  const prev = "v1.0.0-beta.6";
  const noteHash = overrides.noteHash || "abc1234";
  const tagType = overrides.tagType || "tag";
  const tagSha = overrides.tagSha || "1111111111111111111111111111111111111111";
  const noteSha = overrides.noteSha || tagSha;

  const files = {
    "docs/releases/current.md": overrides.currentPointer ?? defaultCurrentPointer(overrides.currentRelease || release, noteHash),
    [`docs/releases/${release}.md`]: overrides.note ?? defaultNote(release, noteHash),
    "docs/README.md": overrides.docsReadme ?? defaultDocsReadme(release, prev),
  };

  const readFileFn = async (relPath) => {
    if (relPath in files) return files[relPath];
    throw new Error(`ENOENT ${relPath}`);
  };

  const gitRunner = overrides.gitRunner || (async ({ args }) => {
    if (args[0] === "cat-file") return { ok: true, stdout: `${tagType}\n` };
    if (args[0] === "rev-parse") {
      const ref = args[args.length - 1];
      if (ref === `${release}^{commit}`) return { ok: true, stdout: `${tagSha}\n` };
      if (ref === noteHash) return { ok: true, stdout: `${noteSha}\n` };
      return { ok: false, stdout: "", stderr: "bad ref" };
    }
    return { ok: false, stdout: "" };
  });

  return { release, readFileFn, gitRunner };
}

async function load() {
  return import(modulePath.href);
}

function checkById(result, id) {
  return result.checks.find((check) => check.id === id);
}

test("passes clean when tag, note, and current pointer all agree", async () => {
  const { runReleasePositionCheck } = await load();
  const fixture = buildFixture();
  const result = await runReleasePositionCheck(fixture);
  assert.equal(result.ok, true, JSON.stringify(result.failedChecks));
  assert.deepEqual(result.failedChecks, []);
  assert.equal(result.release, "v1.0.0-beta.7");
});

test("resolves the release from docs/releases/current.md when none is passed", async () => {
  const { runReleasePositionCheck } = await load();
  const fixture = buildFixture();
  const result = await runReleasePositionCheck({
    readFileFn: fixture.readFileFn,
    gitRunner: fixture.gitRunner,
  });
  assert.equal(result.release, "v1.0.0-beta.7");
  assert.equal(result.ok, true);
});

test("fails when the tag points somewhere other than the note's tag target", async () => {
  const { runReleasePositionCheck } = await load();
  const fixture = buildFixture({
    tagSha: "1111111111111111111111111111111111111111",
    noteSha: "2222222222222222222222222222222222222222",
  });
  const result = await runReleasePositionCheck(fixture);
  assert.equal(result.ok, false);
  assert.ok(result.failedChecks.includes("tag_matches_note"));
  assert.equal(checkById(result, "tag_matches_note").ok, false);
  // The other invariants are independent and should still pass.
  assert.equal(checkById(result, "current_pointer").ok, true);
});

test("fails when a required release-note field is missing", async () => {
  const { runReleasePositionCheck } = await load();
  const release = "v1.0.0-beta.7";
  const note = defaultNote(release, "abc1234").replace("## Not Promised\nnothing new promised\n", "");
  const result = await runReleasePositionCheck(buildFixture({ note }));
  assert.equal(result.ok, false);
  const noteCheck = checkById(result, "note_present_and_complete");
  assert.equal(noteCheck.ok, false);
  assert.ok(noteCheck.missing.includes("not_promised"));
});

test("fails when the current release pointer disagrees", async () => {
  const { runReleasePositionCheck } = await load();
  const result = await runReleasePositionCheck(buildFixture({ currentRelease: "v1.0.0-beta.6" }));
  assert.equal(result.ok, false);
  const pointer = checkById(result, "current_pointer");
  assert.equal(pointer.ok, false);
  assert.ok(pointer.summary.includes("release=v1.0.0-beta.6"));
});

test("fails when a versioned history row still carries the Current marker", async () => {
  const { runReleasePositionCheck } = await load();
  const release = "v1.0.0-beta.7";
  const prev = "v1.0.0-beta.6";
  const staleDocsReadme = [
    "| Current release pointer | [Current Matter Workbench Release](releases/current.md) |",
    "",
    "## Release History",
    "",
    `| [${prev}](releases/${prev}.md) | Current Beta 3 stale release marker. |`,
    `| [${release}](releases/${release}.md) | Beta 3 release marker. |`,
    "",
  ].join("\n");
  const result = await runReleasePositionCheck(buildFixture({ docsReadme: staleDocsReadme }));
  assert.equal(result.ok, false);
  const stale = checkById(result, "no_versioned_current_marker");
  assert.equal(stale.ok, false);
  assert.ok(stale.summary.includes("v1.0.0-beta.6"));
});

test("fails when the release tag is lightweight rather than annotated", async () => {
  const { runReleasePositionCheck } = await load();
  const result = await runReleasePositionCheck(buildFixture({ tagType: "commit" }));
  assert.equal(result.ok, false);
  assert.equal(checkById(result, "tag_annotated").ok, false);
});

test("fails gracefully when the release cannot be resolved", async () => {
  const { runReleasePositionCheck } = await load();
  const result = await runReleasePositionCheck({
    readFileFn: async () => { throw new Error("ENOENT"); },
    gitRunner: async () => ({ ok: false, stdout: "" }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.failedChecks.includes("release_resolved"));
});

test("parseReleasePositionCheckArgs reads --release and --json", async () => {
  const { parseReleasePositionCheckArgs } = await load();
  const parsed = parseReleasePositionCheckArgs(["--release", "v1.0.0-beta.9", "--json"], {});
  assert.equal(parsed.release, "v1.0.0-beta.9");
  assert.equal(parsed.json, true);
});
