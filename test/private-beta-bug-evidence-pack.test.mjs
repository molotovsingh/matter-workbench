import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/private-beta-bug-evidence-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const checklistPath = new URL("../docs/beta-operator-checklist.md", import.meta.url);
const docsPath = new URL("../docs/private-beta-bug-evidence-pack.md", import.meta.url);
const releasePath = new URL("../docs/releases/v1.0.0-beta.6.md", import.meta.url);

test("private beta bug evidence pack writes redacted handoff evidence", async () => {
  const { runPrivateBetaBugEvidencePack, renderPrivateBetaBugEvidencePackResult } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-bug-pack-"));
  const calls = [];

  const result = await runPrivateBetaBugEvidencePack({
    outDir,
    timestamp: "2026-06-07T10:30:00.000Z",
    baseUrl: "http://172.16.37.128:4191",
    matterName: "Techbeliever Vs GST",
    issueNote: "Skill output missing after OPENAI_API_KEY=sk-bug-secret and postgres://user:db-secret@example/mwb",
    authUsername: "operator",
    authPassword: "private-secret",
    serviceCheckFn: async (options) => {
      calls.push(["service", options.baseUrl, options.matterName, options.authUsername, options.authPassword]);
      return {
        passed: true,
        authenticated: true,
        runtimeDbEnabled: true,
        matterCount: 18,
        targetMatter: "Techbeliever Vs GST",
        filePreviewReadable: true,
      };
    },
    opsPackFn: async (options) => {
      calls.push(["ops", options.baseUrl, options.authUsername, options.authPassword]);
      return {
        success: true,
        deployment: { currentCommit: "abc1234", rollbackCandidate: "prev9999" },
        serviceCheck: { ok: true, runtimeDbEnabled: true, matterCount: 18 },
        logs: { ok: true },
        disk: { availableBytes: 1024 },
        files: {
          markdown: "/tmp/ops-pack.md",
          json: "/tmp/ops-pack.json",
          rollbackScript: "/tmp/rollback-plan.sh",
        },
      };
    },
    recentInteractionsFn: async () => [
      {
        timestamp: "2026-06-07T10:29:00.000Z",
        matter: { matter_name: "Techbeliever Vs GST" },
        typed_input: "run /the_story with Bearer hidden-token",
        status: "failed: output missing",
        matched_command: "/the_story",
      },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.schemaVersion, "private-beta-bug-evidence-pack/v1");
  assert.equal(result.issue.matterName, "Techbeliever Vs GST");
  assert.equal(result.serviceCheck.ok, true);
  assert.equal(result.opsPack.ok, true);
  assert.equal(result.recentInteractions.items.length, 1);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);
  assert.deepEqual(calls.map((call) => call[0]), ["service", "ops"]);

  const evidenceText = await readFile(result.files.json, "utf8");
  assert.doesNotMatch(evidenceText, /sk-bug-secret/);
  assert.doesNotMatch(evidenceText, /db-secret/);
  assert.doesNotMatch(evidenceText, /hidden-token/);
  assert.doesNotMatch(evidenceText, /private-secret/);
  assert.match(evidenceText, /\[redacted-secret\]|\*\*\*/);

  const markdown = await readFile(result.files.markdown, "utf8");
  assert.match(markdown, /Techbeliever Vs GST/);
  assert.match(markdown, /What To Attach/);
  assert.match(markdown, /ops-pack\.md/);

  const rendered = renderPrivateBetaBugEvidencePackResult(result).join("\n");
  assert.match(rendered, /Matter Workbench private beta bug evidence pack/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /service_check: ok/);
});

test("private beta bug evidence pack fails closed when service or ops evidence fails", async () => {
  const { runPrivateBetaBugEvidencePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-bug-pack-fail-"));

  const result = await runPrivateBetaBugEvidencePack({
    outDir,
    timestamp: "2026-06-07T10:30:00.000Z",
    serviceCheckFn: async () => ({ passed: false, error: "root fetch failed" }),
    opsPackFn: async () => ({ success: false, failedChecks: ["service_logs"], logs: { ok: false } }),
    recentInteractionsFn: async () => [],
  });

  assert.equal(result.success, false);
  assert.match(result.failedChecks.join(","), /service_check/);
  assert.match(result.failedChecks.join(","), /ops_pack/);
  assert.equal(existsSync(result.files.markdown), true);
});

test("private beta bug evidence pack parses operator issue options", async () => {
  const { parseBugEvidencePackArgs } = await import(packPath.href);

  const parsed = parseBugEvidencePackArgs([
    "--out-dir",
    ".local/bugs",
    "--timestamp",
    "2026-06-07T10:30:00.000Z",
    "--base-url",
    "http://172.16.37.128:4191/",
    "--matter",
    "Atlas Construction vs Diptishree",
    "--note",
    "overwrite confirmation broken",
    "--auth-username",
    "operator",
    "--auth-password",
    "secret",
    "--command-log",
    "/tmp/command-interactions.jsonl",
  ], {});

  assert.equal(parsed.baseUrl, "http://172.16.37.128:4191");
  assert.equal(parsed.matterName, "Atlas Construction vs Diptishree");
  assert.equal(parsed.issueNote, "overwrite confirmation broken");
  assert.equal(parsed.authUsername, "operator");
  assert.equal(parsed.authPassword, "secret");
  assert.equal(parsed.commandLogPath, "/tmp/command-interactions.jsonl");
});

test("package and operator docs expose the private beta bug evidence pack", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-beta:bug-evidence-pack"], "node scripts/private-beta-bug-evidence-pack.mjs");

  const checklist = await readFile(checklistPath, "utf8");
  assert.match(checklist, /private-beta:bug-evidence-pack/);
  assert.match(checklist, /bug evidence/i);

  const docs = await readFile(docsPath, "utf8");
  assert.match(docs, /private-beta:bug-evidence-pack/);
  assert.match(docs, /What it captures/i);

  const release = await readFile(releasePath, "utf8");
  assert.match(release, /v1\.0\.0-beta\.6/);
  assert.match(release, /bug evidence/i);
});
