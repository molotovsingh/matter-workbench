import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const opsPackPath = new URL("../scripts/private-vm-ops-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const privateVmReadmePath = new URL("../deployment/private-vm/README.md", import.meta.url);

test("private VM ops pack writes service health, deployment state, logs, and rollback plan", async () => {
  const { runPrivateVmOpsPack, renderPrivateVmOpsPackResult } = await import(opsPackPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-vm-ops-"));
  const deploymentRoot = path.join(tmp, "deployments");
  const outDir = path.join(tmp, "ops-packs");
  await mkdir(path.join(deploymentRoot, "5eb89a8", "app"), { recursive: true });
  await mkdir(path.join(deploymentRoot, "938fca5", "app"), { recursive: true });
  await symlink(path.join(deploymentRoot, "5eb89a8"), path.join(deploymentRoot, "current"));

  const result = await runPrivateVmOpsPack({
    outDir,
    timestamp: "2026-06-06T16:30:00.000Z",
    baseUrl: "http://172.16.37.128:4191",
    deploymentRoot,
    serviceName: "matter-workbench-runtime.service",
    authUsername: "operator",
    authPassword: "service-secret",
    serviceCheckFn: async ({ baseUrl, authUsername, authPassword }) => {
      assert.equal(authUsername, "operator");
      assert.equal(authPassword, "service-secret");
      return {
        passed: true,
        baseUrl,
        authenticated: true,
        runtimeDbEnabled: true,
        matterCount: 15,
        targetMatter: "Bharat Nagpal Vs Gionee India",
        filePreviewReadable: true,
      };
    },
    commandRunner: async (command, args) => {
      if (command === "journalctl") {
        assert.deepEqual(args.slice(0, 5), ["--user", "-u", "matter-workbench-runtime.service", "-n", "80"]);
        return {
          ok: true,
          stdout: "service ready\npostgres://operator:secret@localhost/matter_workbench_shadow\n",
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${command}`);
    },
    statfsFn: async () => ({
      blocks: 1000,
      bfree: 250,
      bavail: 200,
      bsize: 4096,
    }),
    memorySnapshotFn: () => ({
      totalBytes: 16 * 1024 * 1024,
      freeBytes: 4 * 1024 * 1024,
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.deployment.currentCommit, "5eb89a8");
  assert.equal(result.deployment.rollbackCandidate, "938fca5");
  assert.equal(result.serviceCheck.ok, true);
  assert.equal(result.logs.ok, true);
  assert.equal(result.disk.availableBytes, 200 * 4096);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);
  assert.equal(existsSync(result.files.rollbackScript), true);

  const evidence = JSON.parse(await readFile(result.files.json, "utf8"));
  assert.equal(evidence.schemaVersion, "private-vm-ops-pack/v1");
  assert.equal(evidence.deployment.currentCommit, "5eb89a8");
  assert.equal(evidence.deployment.rollbackCandidate, "938fca5");
  assert.match(evidence.rollback.commands.join("\n"), /ln -sfn .*938fca5.*current/);
  assert.doesNotMatch(JSON.stringify(evidence), /operator:secret/);
  assert.match(JSON.stringify(evidence), /operator:\*\*\*/);

  const rollbackScript = await readFile(result.files.rollbackScript, "utf8");
  assert.match(rollbackScript, /set -euo pipefail/);
  assert.match(rollbackScript, /matter-workbench-runtime\.service/);
  assert.match(rollbackScript, /938fca5/);
  assert.match(rollbackScript, /MWB_PRIVATE_BETA_USERNAME/);
  assert.match(rollbackScript, /MWB_PRIVATE_BETA_PASSWORD/);
  assert.match(rollbackScript, /--auth-username "\$MWB_PRIVATE_BETA_USERNAME"/);
  assert.match(rollbackScript, /--auth-password "\$MWB_PRIVATE_BETA_PASSWORD"/);
  assert.doesNotMatch(rollbackScript, /service-secret/);

  const rendered = renderPrivateVmOpsPackResult(result).join("\n");
  assert.match(rendered, /Matter Workbench private VM ops pack/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /rollback_candidate: 938fca5/);
});

test("private VM ops pack fails closed when the live service check fails", async () => {
  const { runPrivateVmOpsPack } = await import(opsPackPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-vm-ops-fail-"));
  const deploymentRoot = path.join(tmp, "deployments");
  await mkdir(path.join(deploymentRoot, "5eb89a8", "app"), { recursive: true });
  await symlink(path.join(deploymentRoot, "5eb89a8"), path.join(deploymentRoot, "current"));

  const result = await runPrivateVmOpsPack({
    outDir: path.join(tmp, "ops-packs"),
    timestamp: "2026-06-06T16:30:00.000Z",
    deploymentRoot,
    serviceCheckFn: async () => ({
      passed: false,
      error: "Login required",
    }),
    commandRunner: async () => ({ ok: true, stdout: "", stderr: "" }),
    statfsFn: async () => ({ blocks: 1, bfree: 1, bavail: 1, bsize: 4096 }),
  });

  assert.equal(result.success, false);
  assert.equal(result.serviceCheck.ok, false);
  assert.match(result.failedChecks.join(","), /service_check/);
  assert.equal(existsSync(result.files.markdown), true);
});

test("private VM ops pack redacts secret-looking log lines", async () => {
  const { runPrivateVmOpsPack } = await import(opsPackPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-vm-ops-redact-"));
  const deploymentRoot = path.join(tmp, "deployments");
  await mkdir(path.join(deploymentRoot, "5eb89a8", "app"), { recursive: true });
  await symlink(path.join(deploymentRoot, "5eb89a8"), path.join(deploymentRoot, "current"));

  const result = await runPrivateVmOpsPack({
    outDir: path.join(tmp, "ops-packs"),
    timestamp: "2026-06-06T16:30:00.000Z",
    deploymentRoot,
    serviceCheckFn: async () => ({ passed: true }),
    commandRunner: async () => ({
      ok: true,
      stdout: "OPENAI_API_KEY=sk-test-secret\nMWB_PRIVATE_BETA_PASSWORD=plain-secret\n",
      stderr: "",
    }),
    statfsFn: async () => ({ blocks: 1, bfree: 1, bavail: 1, bsize: 4096 }),
  });

  const evidenceText = await readFile(result.files.json, "utf8");
  assert.doesNotMatch(evidenceText, /sk-test-secret/);
  assert.doesNotMatch(evidenceText, /plain-secret/);
  assert.match(evidenceText, /\[redacted-secret\]/);
});

test("package and private VM docs expose the ops pack command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-vm:ops-pack"], "node scripts/private-vm-ops-pack.mjs");

  const readme = await readFile(privateVmReadmePath, "utf8");
  assert.match(readme, /private-vm:ops-pack/);
  assert.match(readme, /rollback/i);
  assert.match(readme, /incident/i);
});
