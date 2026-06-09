import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rollbackPath = new URL("../scripts/private-vm-rollback.mjs", import.meta.url);

test("private VM rollback parser requires an explicit target release and rejects passwords", async () => {
  const { parsePrivateVmRollbackArgs } = await import(rollbackPath.href);

  assert.deepEqual(
    parsePrivateVmRollbackArgs([
      "--host",
      "172.16.37.128",
      "--user",
      "aks",
      "--deployment-root",
      "/home/aks/matter-workbench-deployments",
      "--to",
      "498f83e",
      "--base-url",
      "http://127.0.0.1:4191/",
      "--dry-run",
    ], {}),
    {
      host: "172.16.37.128",
      user: "aks",
      deploymentRoot: "/home/aks/matter-workbench-deployments",
      targetRelease: "498f83e",
      baseUrl: "http://127.0.0.1:4191",
      serviceName: "matter-workbench-runtime.service",
      json: false,
      dryRun: true,
      skipServiceCheck: false,
      skipUiHardening: false,
    },
  );

  assert.throws(
    () => parsePrivateVmRollbackArgs(["--host", "vm.example.test", "--password", "secret"], {}),
    /does not accept passwords/i,
  );
});

test("private VM rollback plan switches current, restarts service, and verifies target app", async () => {
  const { buildPrivateVmRollbackPlan } = await import(rollbackPath.href);

  const plan = buildPrivateVmRollbackPlan({
    host: "172.16.37.128",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    targetRelease: "498f83e",
    baseUrl: "http://127.0.0.1:4191",
  });

  assert.equal(plan.remote, "aks@172.16.37.128");
  assert.equal(plan.targetDir, "/home/aks/matter-workbench-deployments/498f83e");
  assert.equal(plan.currentLink, "/home/aks/matter-workbench-deployments/current");
  assert.equal(plan.steps[0].id, "preflight");
  assert.match(plan.steps[0].command.join(" "), /test -d '\/home\/aks\/matter-workbench-deployments\/498f83e\/app'/);
  assert.match(plan.steps[0].command.join(" "), /systemctl --user show-environment/);

  const activate = plan.steps.find((step) => step.id === "activate_rollback");
  assert.ok(activate);
  assert.match(activate.command.join(" "), /ln -sfn '\/home\/aks\/matter-workbench-deployments\/498f83e' '\/home\/aks\/matter-workbench-deployments\/current'/);
  assert.match(activate.command.join(" "), /systemctl --user restart 'matter-workbench-runtime\.service'/);
  assert.match(activate.command.join(" "), /readlink -f '\/home\/aks\/matter-workbench-deployments\/current'/);

  const serviceCheck = plan.steps.find((step) => step.id === "service_check");
  assert.ok(serviceCheck);
  assert.match(serviceCheck.command.join(" "), /cd '\/home\/aks\/matter-workbench-deployments\/498f83e\/app'/);
  assert.match(serviceCheck.command.join(" "), /private-vm:service-check/);
  assert.match(serviceCheck.command.join(" "), /--base-url 'http:\/\/127\.0\.0\.1:4191'/);
});

test("private VM rollback aborts before activation when preflight fails", async () => {
  const { runPrivateVmRollback } = await import(rollbackPath.href);
  const executed = [];

  const result = await runPrivateVmRollback({
    host: "vm.example.test",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    targetRelease: "498f83e",
    baseUrl: "http://127.0.0.1:4191",
    commandRunner: async (step) => {
      executed.push(step.id);
      return { ok: false, code: 1, error: "target missing" };
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(executed, ["preflight"]);
  assert.deepEqual(result.stepResults.map((step) => step.id), ["preflight"]);
});

test("private VM rollback dry-run returns the plan without executing commands", async () => {
  const { runPrivateVmRollback } = await import(rollbackPath.href);
  const executed = [];

  const result = await runPrivateVmRollback({
    host: "vm.example.test",
    user: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
    targetRelease: "498f83e",
    baseUrl: "http://127.0.0.1:4191",
    dryRun: true,
    commandRunner: async (step) => {
      executed.push(step.id);
      return { ok: true };
    },
  });

  assert.equal(result.schemaVersion, "private-vm-rollback/v1");
  assert.equal(result.executed, false);
  assert.equal(result.success, true);
  assert.deepEqual(executed, []);
  assert.equal(result.plan.steps.length > 0, true);
});

test("package and docs expose the private VM rollback command", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["private-vm:rollback"], "node scripts/private-vm-rollback.mjs");

  const readme = await readFile(new URL("../deployment/private-vm/README.md", import.meta.url), "utf8");
  assert.match(readme, /private-vm:rollback/);
  assert.match(readme, /--to/);

  const deploymentDoc = await readFile(new URL("../docs/private-beta-codex-deployment.md", import.meta.url), "utf8");
  assert.match(deploymentDoc, /private-vm:rollback/);
});
