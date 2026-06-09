import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployPath = new URL("../scripts/private-vm-rsync-deploy.mjs", import.meta.url);

test("private VM rsync deploy parser reads target options without accepting passwords", async () => {
  const { parsePrivateVmRsyncDeployArgs } = await import(deployPath.href);

  assert.deepEqual(
    parsePrivateVmRsyncDeployArgs([
      "--host",
      "172.16.37.128",
      "--user",
      "aks",
      "--deployment-root",
      "/home/aks/matter-workbench-deployments",
      "--commit",
      "abc1234",
      "--base-url",
      "http://127.0.0.1:4191/",
      "--dry-run",
    ], {}),
    {
      host: "172.16.37.128",
      user: "aks",
      deploymentRoot: "/home/aks/matter-workbench-deployments",
      commit: "abc1234",
      sourceDir: process.cwd(),
      baseUrl: "http://127.0.0.1:4191",
      serviceName: "matter-workbench-runtime.service",
      json: false,
      dryRun: true,
      allowDirty: false,
      skipServiceCheck: false,
      skipUiHardening: false,
    },
  );

  assert.throws(
    () => parsePrivateVmRsyncDeployArgs(["--password", "secret"], {}),
    /does not accept passwords/i,
  );
});

test("private VM rsync deploy plan builds a fresh release and excludes local-only data", async () => {
  const { buildPrivateVmRsyncDeployPlan } = await import(deployPath.href);

  const plan = buildPrivateVmRsyncDeployPlan({
    host: "172.16.37.128",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    commit: "abc1234",
    sourceDir: "/Users/aksingh/matter-workbench",
    baseUrl: "http://127.0.0.1:4191",
  });

  assert.equal(plan.remote, "aks@172.16.37.128");
  assert.equal(plan.releaseDir, "/home/aks/matter-workbench-deployments/abc1234");
  assert.equal(plan.appDir, "/home/aks/matter-workbench-deployments/abc1234/app");
  assert.equal(plan.steps[0].id, "preflight");

  const preflight = plan.steps[0];
  assert.match(preflight.command.join(" "), /command -v rsync/);
  assert.match(preflight.command.join(" "), /command -v node/);
  assert.match(preflight.command.join(" "), /command -v npm/);
  assert.match(preflight.command.join(" "), /systemctl --user show-environment/);
  assert.match(preflight.command.join(" "), /runtime\.env/);
  assert.match(preflight.command.join(" "), /test -d '\/home\/aks\/matter-workbench-deployments'/);

  const rsync = plan.steps.find((step) => step.id === "rsync_source");
  assert.ok(rsync);
  assert.match(rsync.command.join(" "), /rsync/);
  assert.match(rsync.command.join(" "), /git ls-files -z/);
  assert.match(rsync.command.join(" "), /--files-from=-/);
  assert.match(rsync.command.join(" "), /--delete/);
  assert.match(rsync.command.join(" "), /--include='\.env\.example'/);
  assert.match(rsync.command.join(" "), /--exclude='\.env'/);
  assert.match(rsync.command.join(" "), /--exclude='codex_review\/'/);
  assert.match(rsync.command.join(" "), /--exclude='claude_review\/'/);
  assert.match(rsync.command.join(" "), /--exclude='node_modules\/'/);
  assert.match(rsync.command.join(" "), /aks@172\.16\.37\.128:\/home\/aks\/matter-workbench-deployments\/abc1234\/app\//);

  const activate = plan.steps.find((step) => step.id === "activate_release");
  assert.ok(activate);
  assert.match(activate.command.join(" "), /ln -sfn/);
  assert.match(activate.command.join(" "), /systemctl --user restart 'matter-workbench-runtime\.service'/);

  assert.equal(plan.steps.some((step) => step.id === "service_check"), true);
  assert.equal(plan.steps.some((step) => step.id === "ui_hardening"), true);
});

test("private VM rsync deploy aborts before mutation when preflight fails", async () => {
  const { runPrivateVmRsyncDeploy } = await import(deployPath.href);
  const executed = [];

  const result = await runPrivateVmRsyncDeploy({
    host: "vm.example.test",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    commit: "abc1234",
    sourceDir: "/repo",
    baseUrl: "http://127.0.0.1:4191",
    commandRunner: async (step) => {
      executed.push(step.id);
      return { ok: false, code: 1, error: "rsync missing" };
    },
    gitDirtyChecker: async () => false,
  });

  assert.equal(result.success, false);
  assert.deepEqual(executed, ["preflight"]);
  assert.deepEqual(result.stepResults.map((step) => step.id), ["preflight"]);
});

test("private VM rsync deploy dry-run returns the plan without executing commands", async () => {
  const { runPrivateVmRsyncDeploy } = await import(deployPath.href);
  const executed = [];

  const result = await runPrivateVmRsyncDeploy({
    host: "vm.example.test",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    commit: "abc1234",
    sourceDir: "/repo",
    baseUrl: "http://127.0.0.1:4191",
    dryRun: true,
    commandRunner: async (step) => {
      executed.push(step.id);
      return { ok: true };
    },
    gitDirtyChecker: async () => false,
  });

  assert.equal(result.schemaVersion, "private-vm-rsync-deploy/v1");
  assert.equal(result.executed, false);
  assert.equal(result.success, true);
  assert.deepEqual(executed, []);
  assert.equal(result.plan.steps.length > 0, true);
});

test("private VM rsync deploy dry-run can preview commands with tracked edits", async () => {
  const { runPrivateVmRsyncDeploy } = await import(deployPath.href);

  const result = await runPrivateVmRsyncDeploy({
    host: "vm.example.test",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    commit: "abc1234",
    sourceDir: "/repo",
    baseUrl: "http://127.0.0.1:4191",
    dryRun: true,
    gitDirtyChecker: async () => true,
  });

  assert.equal(result.success, true);
  assert.equal(result.executed, false);
});

test("private VM rsync deploy refuses tracked dirty worktree unless explicitly allowed", async () => {
  const { runPrivateVmRsyncDeploy } = await import(deployPath.href);

  await assert.rejects(
    () => runPrivateVmRsyncDeploy({
      host: "vm.example.test",
      user: "aks",
      deploymentRoot: "/home/aks/matter-workbench-deployments",
      commit: "abc1234",
      sourceDir: "/repo",
      dryRun: false,
      gitDirtyChecker: async () => true,
    }),
    /tracked worktree has uncommitted changes/i,
  );
});

test("package and docs expose the private VM rsync deploy command", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["private-vm:rsync-deploy"], "node scripts/private-vm-rsync-deploy.mjs");

  const readme = await readFile(new URL("../deployment/private-vm/README.md", import.meta.url), "utf8");
  assert.match(readme, /private-vm:rsync-deploy/);
  assert.match(readme, /rsync/i);

  const deploymentDoc = await readFile(new URL("../docs/private-beta-codex-deployment.md", import.meta.url), "utf8");
  assert.match(deploymentDoc, /private-vm:rsync-deploy/);
});
