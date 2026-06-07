import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/private-beta-rc-closure-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);
const checklistPath = new URL("../docs/beta-operator-checklist.md", import.meta.url);
const releasePath = new URL("../docs/releases/v1.0.0-beta.5.md", import.meta.url);
const docsPath = new URL("../docs/private-beta-rc-closure-pack.md", import.meta.url);

test("private beta RC closure pack writes release evidence across required gates", async () => {
  const { runPrivateBetaRcClosurePack, renderPrivateBetaRcClosurePackResult } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-"));
  const calls = [];

  const result = await runPrivateBetaRcClosurePack({
    outDir,
    timestamp: "2026-06-06T22:00:00.000Z",
    release: "v1.0.0-beta.5",
    baseUrl: "http://172.16.37.128:4191",
    gitInfoFn: async () => ({
      branch: "codex/matter-workbench-checkpoint-2026-05-17",
      commit: "abc1234",
      statusShort: "",
    }),
    localGateRunner: async ({ command, args }) => {
      calls.push(["local", command, args.join(" ")]);
      return {
        ok: true,
        command,
        args,
        stdout: "ok\nOPENAI_API_KEY=sk-secret\npostgres://runtime:runtime-secret@db.example/mwb\n",
        stderr: "",
        exitCode: 0,
      };
    },
    runtimeBrowserPackFn: async ({ outDir: nestedOutDir, timestamp }) => {
      calls.push(["browser", path.basename(nestedOutDir), timestamp]);
      return {
        passed: true,
        runtimeDb: { enabled: true, mode: "postgres/postgres", storageMode: "postgres" },
        writeSmoke: { passed: true },
        browser: {
          passed: true,
          driver: "injected-browser",
          checks: [{ key: "react_root_loaded", passed: true, detail: "React rendered" }],
          consoleErrors: [],
        },
        files: {
          markdown: path.join(nestedOutDir, "runtime-db-browser-acceptance-pack.md"),
          json: path.join(nestedOutDir, "runtime-db-browser-acceptance-pack.json"),
        },
      };
    },
    serviceCheckFn: async ({ baseUrl }) => {
      calls.push(["service", baseUrl]);
      return {
        passed: true,
        baseUrl,
        runtimeDbEnabled: true,
        matterCount: 15,
        targetMatter: "Bharat Nagpal Vs Gionee India",
        filePreviewReadable: true,
      };
    },
    opsPackFn: async ({ baseUrl }) => {
      calls.push(["ops", baseUrl]);
      return {
        success: true,
        deployment: { currentCommit: "abc1234", rollbackCandidate: "prev9999" },
        serviceCheck: { ok: true, runtimeDbEnabled: true, matterCount: 15 },
        logs: { ok: true },
        disk: { availableBytes: 1024 },
        files: {
          markdown: "/tmp/ops-pack.md",
          json: "/tmp/ops-pack.json",
          rollbackScript: "/tmp/rollback-plan.sh",
        },
      };
    },
    securityCheckFn: async ({ baseUrl }) => {
      calls.push(["security", baseUrl]);
      return {
        passed: true,
        checks: [
          { id: "access_posture", ok: true, message: "private host" },
          { id: "live_service_smoke", ok: true, message: "service ok" },
        ],
      };
    },
    recoverabilityPackFn: async ({ baseUrl }) => {
      calls.push(["recoverability", baseUrl]);
      return {
        success: true,
        steps: {
          dbBackup: { ok: true },
          dbRestore: { ok: true },
          storageBackup: { ok: true },
          storageRestoreCheck: { ok: true },
          serviceCheck: { ok: true },
        },
        files: {
          markdown: "/tmp/recoverability-pack.md",
          json: "/tmp/recoverability-pack.json",
        },
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.schemaVersion, "private-beta-rc-closure-pack/v1");
  assert.equal(result.release, "v1.0.0-beta.5");
  assert.equal(result.git.commit, "abc1234");
  assert.equal(result.localGates.ok, true);
  assert.equal(result.runtimeDbBrowser.ok, true);
  assert.equal(result.privateVmService.ok, true);
  assert.equal(result.privateVmOps.ok, true);
  assert.equal(result.privateVmSecurity.ok, true);
  assert.equal(result.privateVmRecoverability.ok, true);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);
  assert.deepEqual(calls.map((call) => call[0]), [
    "local",
    "local",
    "local",
    "browser",
    "service",
    "ops",
    "security",
    "recoverability",
  ]);

  const evidenceText = await readFile(result.files.json, "utf8");
  const evidence = JSON.parse(evidenceText);
  assert.equal(evidence.success, true);
  assert.equal(evidence.checks.length, 7);
  assert.doesNotMatch(evidenceText, /sk-secret/);
  assert.doesNotMatch(evidenceText, /runtime-secret/);
  assert.match(evidenceText, /\[redacted-secret\]|\*\*\*/);

  const rendered = renderPrivateBetaRcClosurePackResult(result).join("\n");
  assert.match(rendered, /Matter Workbench private beta RC closure pack/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /runtime_db_browser: ok/);
});

test("private beta RC closure pack fails closed when a required section fails", async () => {
  const { runPrivateBetaRcClosurePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-fail-"));

  const result = await runPrivateBetaRcClosurePack({
    outDir,
    timestamp: "2026-06-06T22:00:00.000Z",
    gitInfoFn: async () => ({ branch: "main", commit: "abc1234", statusShort: "" }),
    localGateRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
    runtimeBrowserPackFn: async () => ({ passed: false, error: "browser driver missing", files: {} }),
    serviceCheckFn: async () => ({ passed: true }),
    opsPackFn: async () => ({ success: true, deployment: {}, serviceCheck: { ok: true }, logs: { ok: true }, disk: {} }),
    securityCheckFn: async () => ({ passed: true, checks: [] }),
    recoverabilityPackFn: async () => ({ success: true, steps: {} }),
  });

  assert.equal(result.success, false);
  assert.match(result.failedChecks.join(","), /runtime_db_browser/);
  assert.equal(existsSync(result.files.markdown), true);
});

test("private beta RC closure pack treats skipped required gates as incomplete", async () => {
  const { runPrivateBetaRcClosurePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-skip-"));

  const result = await runPrivateBetaRcClosurePack({
    outDir,
    timestamp: "2026-06-06T22:00:00.000Z",
    gitInfoFn: async () => ({ branch: "main", commit: "abc1234", statusShort: "" }),
    skipLocalGates: true,
    runtimeBrowserPackFn: async () => ({ passed: true, writeSmoke: { passed: true }, browser: { passed: true, checks: [] } }),
    serviceCheckFn: async () => ({ passed: true }),
    opsPackFn: async () => ({ success: true, deployment: {}, serviceCheck: { ok: true }, logs: { ok: true }, disk: {} }),
    securityCheckFn: async () => ({ passed: true, checks: [] }),
    recoverabilityPackFn: async () => ({ success: true, steps: {} }),
  });

  assert.equal(result.success, false);
  assert.equal(result.localGates.skipped, true);
  assert.match(result.failedChecks.join(","), /local_verification/);
});

test("private beta RC closure pack can consume existing runtime browser evidence", async () => {
  const { parseRcClosurePackArgs, runPrivateBetaRcClosurePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-evidence-"));
  const browserEvidencePath = path.join(outDir, "runtime-browser-evidence.json");
  await writeFile(browserEvidencePath, JSON.stringify({
    schemaVersion: "runtime-db-browser-acceptance-pack/v1",
    passed: true,
    runtimeDb: { enabled: true, mode: "postgres/postgres", storageMode: "postgres" },
    writeSmoke: { passed: true },
    browser: {
      passed: true,
      driver: "playwright",
      checks: [{ key: "react_root_loaded", passed: true, detail: "React rendered" }],
      consoleErrors: [],
    },
    files: { json: browserEvidencePath },
  }), "utf8");

  assert.equal(
    parseRcClosurePackArgs(["--runtime-browser-evidence-json", browserEvidencePath], {}).runtimeBrowserEvidenceJson,
    browserEvidencePath,
  );

  let browserRunnerCalled = false;
  const result = await runPrivateBetaRcClosurePack({
    outDir,
    timestamp: "2026-06-06T22:00:00.000Z",
    runtimeBrowserEvidenceJson: browserEvidencePath,
    gitInfoFn: async () => ({ branch: "main", commit: "abc1234", statusShort: "" }),
    localGateRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
    runtimeBrowserPackFn: async () => {
      browserRunnerCalled = true;
      return { passed: false };
    },
    serviceCheckFn: async () => ({ passed: true }),
    opsPackFn: async () => ({ success: true, deployment: {}, serviceCheck: { ok: true }, logs: { ok: true }, disk: {} }),
    securityCheckFn: async () => ({ passed: true, checks: [] }),
    recoverabilityPackFn: async () => ({ success: true, steps: {} }),
  });

  assert.equal(browserRunnerCalled, false);
  assert.equal(result.success, true);
  assert.equal(result.runtimeDbBrowser.ok, true);
  assert.equal(result.runtimeDbBrowser.browserDriver, "playwright");
  assert.equal(result.runtimeDbBrowser.evidenceJsonPath, browserEvidencePath);
});

test("private beta RC closure pack can use supplied git metadata for deployment artifacts", async () => {
  const { parseRcClosurePackArgs, runPrivateBetaRcClosurePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-git-meta-"));

  const parsed = parseRcClosurePackArgs([
    "--git-branch",
    "codex/release-candidate",
    "--git-commit",
    "146c9c0",
  ], {});
  assert.equal(parsed.gitBranch, "codex/release-candidate");
  assert.equal(parsed.gitCommit, "146c9c0");

  const result = await runPrivateBetaRcClosurePack({
    outDir,
    timestamp: "2026-06-06T22:00:00.000Z",
    gitBranch: "codex/release-candidate",
    gitCommit: "146c9c0",
    gitInfoFn: async () => ({ branch: "", commit: "", statusShort: "", branchCommandOk: false, commitCommandOk: false, statusCommandOk: false }),
    localGateRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
    runtimeBrowserPackFn: async () => ({ passed: true, writeSmoke: { passed: true }, browser: { passed: true, checks: [] } }),
    serviceCheckFn: async () => ({ passed: true }),
    opsPackFn: async () => ({ success: true, deployment: {}, serviceCheck: { ok: true }, logs: { ok: true }, disk: {} }),
    securityCheckFn: async () => ({ passed: true, checks: [] }),
    recoverabilityPackFn: async () => ({ success: true, steps: {} }),
  });

  assert.equal(result.success, true);
  assert.equal(result.git.branch, "codex/release-candidate");
  assert.equal(result.git.commit, "146c9c0");
  assert.equal(result.git.branchCommandOk, false);
  assert.equal(result.git.commitCommandOk, false);
});

test("private beta RC closure pack passes auth and matters home to recoverability pack", async () => {
  const { runPrivateBetaRcClosurePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-recovery-auth-"));
  let recoverabilityOptions = null;

  const result = await runPrivateBetaRcClosurePack({
    outDir,
    timestamp: "2026-06-06T22:00:00.000Z",
    mattersHome: "/srv/mwb/matters",
    authUsername: "operator",
    authPassword: "private-secret",
    gitInfoFn: async () => ({ branch: "main", commit: "abc1234", statusShort: "" }),
    localGateRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
    runtimeBrowserPackFn: async () => ({ passed: true, writeSmoke: { passed: true }, browser: { passed: true, checks: [] } }),
    serviceCheckFn: async () => ({ passed: true }),
    opsPackFn: async () => ({ success: true, deployment: {}, serviceCheck: { ok: true }, logs: { ok: true }, disk: {} }),
    securityCheckFn: async () => ({ passed: true, checks: [] }),
    recoverabilityPackFn: async (options) => {
      recoverabilityOptions = options;
      return { success: true, steps: {} };
    },
  });

  assert.equal(result.success, true);
  assert.equal(recoverabilityOptions.mattersHome, "/srv/mwb/matters");
  assert.equal(recoverabilityOptions.authUsername, "operator");
  assert.equal(recoverabilityOptions.authPassword, "private-secret");
});

test("private beta RC closure pack sanitizes runtime env for local verification gates", async () => {
  const { runPrivateBetaRcClosurePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-rc-closure-pack-local-env-"));
  const gateEnvs = [];
  const dirtyEnv = {
    MWB_RUNTIME_DB: "postgres",
    MWB_RUNTIME_DB_STORAGE: "postgres",
    MWB_RUNTIME_DATABASE_URL: "postgres://runtime:secret@example/mwb",
    MWB_PRIVATE_BETA_AUTH: "required",
    MWB_PRIVATE_BETA_PASSWORD: "private-secret",
  };
  const previousEnv = Object.fromEntries(Object.keys(dirtyEnv).map((key) => [key, process.env[key]]));

  let result;
  try {
    Object.assign(process.env, dirtyEnv);
    result = await runPrivateBetaRcClosurePack({
      outDir,
      timestamp: "2026-06-06T22:00:00.000Z",
      gitInfoFn: async () => ({ branch: "main", commit: "abc1234", statusShort: "" }),
      localGateRunner: async ({ env }) => {
        gateEnvs.push(env);
        return { ok: true, stdout: "", stderr: "", exitCode: 0 };
      },
      runtimeBrowserPackFn: async () => ({ passed: true, writeSmoke: { passed: true }, browser: { passed: true, checks: [] } }),
      serviceCheckFn: async () => ({ passed: true }),
      opsPackFn: async () => ({ success: true, deployment: {}, serviceCheck: { ok: true }, logs: { ok: true }, disk: {} }),
      securityCheckFn: async () => ({ passed: true, checks: [] }),
      recoverabilityPackFn: async () => ({ success: true, steps: {} }),
    });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(result.success, true);
  assert.equal(gateEnvs.length, 3);
  for (const env of gateEnvs) {
    assert.equal(env.MWB_RUNTIME_DB, undefined);
    assert.equal(env.MWB_RUNTIME_DB_STORAGE, undefined);
    assert.equal(env.MWB_RUNTIME_DATABASE_URL, undefined);
    assert.equal(env.MWB_PRIVATE_BETA_AUTH, undefined);
    assert.equal(env.MWB_PRIVATE_BETA_PASSWORD, undefined);
  }
});

test("package and release docs expose the private beta RC closure pack", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-beta:rc-closure-pack"], "node scripts/private-beta-rc-closure-pack.mjs");

  const readme = await readFile(readmePath, "utf8");
  assert.match(readme, /v1\.0\.0-beta\.6/);
  assert.match(readme, /private-beta:rc-closure-pack/);

  const checklist = await readFile(checklistPath, "utf8");
  assert.match(checklist, /v1\.0\.0-beta\.6/);
  assert.match(checklist, /private-beta:rc-closure-pack/);

  const release = await readFile(releasePath, "utf8");
  assert.match(release, /Private Beta RC Closure/);
  assert.match(release, /runtime DB browser acceptance/i);
  assert.match(release, /private VM/i);

  const docs = await readFile(docsPath, "utf8");
  assert.match(docs, /private-beta:rc-closure-pack/);
  assert.match(docs, /local verification/i);
  assert.match(docs, /recoverability/i);
});
