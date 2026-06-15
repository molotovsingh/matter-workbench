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
      releaseLabel: "",
      releaseDate: "",
      releaseNote: "",
    },
  );

  assert.throws(
    () => parsePrivateVmRsyncDeployArgs(["--password", "secret"], {}),
    /does not accept passwords/i,
  );
});

test("private VM rsync deploy parser defaults deployment root to remote user home", async () => {
  const { parsePrivateVmRsyncDeployArgs } = await import(deployPath.href);

  const parsed = parsePrivateVmRsyncDeployArgs([
    "--host",
    "172.16.37.128",
    "--user",
    "aks",
    "--commit",
    "abc1234",
  ], {});

  assert.equal(parsed.deploymentRoot, "/home/aks/matter-workbench-deployments");
});

test("private VM rsync deploy plan and runner use remote-user deployment root defaults", async () => {
  const { buildPrivateVmRsyncDeployPlan, runPrivateVmRsyncDeploy } = await import(deployPath.href);

  const plan = buildPrivateVmRsyncDeployPlan({
    host: "172.16.37.128",
    user: "aks",
    commit: "abc1234",
    sourceDir: "/Users/aksingh/matter-workbench",
  });

  assert.equal(plan.deploymentRoot, "/home/aks/matter-workbench-deployments");
  assert.equal(plan.releaseDir, "/home/aks/matter-workbench-deployments/abc1234");
  assert.doesNotMatch(plan.steps[0].command.join(" "), /\$HOME\/matter-workbench-deployments/);

  const result = await runPrivateVmRsyncDeploy({
    host: "172.16.37.128",
    user: "aks",
    commit: "abc1234",
    sourceDir: "/repo",
    commitResolver: async () => "abc1234",
    dryRun: true,
    gitDirtyChecker: async () => false,
  });

  assert.equal(result.plan.deploymentRoot, "/home/aks/matter-workbench-deployments");
  assert.equal(result.plan.releaseDir, "/home/aks/matter-workbench-deployments/abc1234");
});

test("private VM rsync deploy stamps release metadata before restarting the service", async () => {
  const { buildPrivateVmRsyncDeployPlan } = await import(deployPath.href);

  const plan = buildPrivateVmRsyncDeployPlan({
    host: "172.16.37.128",
    user: "aks",
    commit: "abc1234",
    sourceDir: "/Users/aksingh/matter-workbench",
    releaseLabel: "Beta 3",
    releaseDate: "2026-06-15",
    releaseNote: "Small release byte for testers",
  });

  const activate = plan.steps.find((step) => step.id === "activate_release");
  const command = activate?.command.join(" ") || "";
  assert.match(command, /systemctl --user set-environment/);
  assert.match(command, /MWB_RELEASE_COMMIT='abc1234'/);
  assert.match(command, /MWB_RELEASE_LABEL='Beta 3'/);
  assert.match(command, /MWB_RELEASE_DATE='2026-06-15'/);
  assert.match(command, /MWB_RELEASE_NOTE='Small release byte for testers'/);
  assert.deepEqual(plan.release, {
    label: "Beta 3",
    commit: "abc1234",
    date: "2026-06-15",
    note: "Small release byte for testers",
  });
});

test("private VM rsync deploy direct APIs reject missing deployment root when user is unknown", async () => {
  const { buildPrivateVmRsyncDeployPlan, runPrivateVmRsyncDeploy } = await import(deployPath.href);

  assert.throws(
    () => buildPrivateVmRsyncDeployPlan({ host: "vm.example.test", commit: "abc1234" }),
    /deployment root/i,
  );

  await assert.rejects(
    () => runPrivateVmRsyncDeploy({
      host: "vm.example.test",
      commit: "abc1234",
      dryRun: true,
      gitDirtyChecker: async () => false,
    }),
    /deployment root/i,
  );
});

test("private VM rsync deploy rejects a release label that is not the checked-out commit", async () => {
  const { runPrivateVmRsyncDeploy } = await import(deployPath.href);

  await assert.rejects(
    () => runPrivateVmRsyncDeploy({
      host: "vm.example.test",
      user: "aks",
      commit: "wrong123",
      sourceDir: "/repo",
      dryRun: true,
      gitDirtyChecker: async () => false,
      commitResolver: async () => "abc1234",
    }),
    /does not match checked-out HEAD abc1234/i,
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

  const installAndBuild = plan.steps.find((step) => step.id === "install_and_build");
  assert.ok(installAndBuild);
  assert.match(
    installAndBuild.command.join(" "),
    /cp deployment\/private-vm\/matter-workbench-mothership\.service \"\$HOME\/\.config\/systemd\/user\/\"/,
  );
  assert.doesNotMatch(installAndBuild.command.join(" "), /mothership\.env/);

  const runtimeDbMigration = plan.steps.find((step) => step.id === "runtime_db_migrate");
  assert.ok(runtimeDbMigration);
  assert.match(runtimeDbMigration.command.join(" "), /runtime\.env/);
  assert.match(runtimeDbMigration.command.join(" "), /MWB_RUNTIME_DB/);
  assert.match(runtimeDbMigration.command.join(" "), /MWB_DATABASE_URL/);
  assert.match(runtimeDbMigration.command.join(" "), /npm run db:migrate --silent/);
  assert.ok(
    plan.steps.findIndex((step) => step.id === "install_and_build")
      < plan.steps.findIndex((step) => step.id === "runtime_db_migrate"),
  );
  assert.ok(
    plan.steps.findIndex((step) => step.id === "runtime_db_migrate")
      < plan.steps.findIndex((step) => step.id === "activate_release"),
  );

  const mothershipActivation = plan.steps.find((step) => step.id === "activate_mothership_if_configured");
  assert.ok(mothershipActivation);
  assert.match(mothershipActivation.command.at(-1), /^set -e; if /);
  assert.match(mothershipActivation.command.at(-1), /; then /);
  assert.match(mothershipActivation.command.at(-1), /; else /);
  assert.match(mothershipActivation.command.at(-1), /; fi$/);
  assert.match(mothershipActivation.command.join(" "), /test -r \"\$HOME\/\.config\/matter-workbench\/mothership\.env\"/);
  assert.match(mothershipActivation.command.join(" "), /cd '\/home\/aks\/matter-workbench-deployments\/abc1234\/app'/);
  assert.match(mothershipActivation.command.join(" "), /set -a; \. \"\$HOME\/\.config\/matter-workbench\/mothership\.env\"; set \+a/);
  assert.match(mothershipActivation.command.join(" "), /npm run mothership:migrate --silent/);
  assert.match(mothershipActivation.command.join(" "), /systemctl --user enable --now 'matter-workbench-mothership\.service'/);
  assert.match(mothershipActivation.command.join(" "), /systemctl --user restart 'matter-workbench-mothership\.service'/);
  assert.ok(
    mothershipActivation.command.at(-1).indexOf("mothership:migrate")
      < mothershipActivation.command.at(-1).indexOf("enable --now"),
  );
  assert.ok(
    mothershipActivation.command.at(-1).indexOf("enable --now")
      < mothershipActivation.command.at(-1).indexOf("restart 'matter-workbench-mothership.service'"),
  );
  assert.match(mothershipActivation.command.join(" "), /systemctl --user is-active 'matter-workbench-mothership\.service'/);
  assert.match(mothershipActivation.command.join(" "), /http:\/\/127\.0\.0\.1:4192\/health/);
  assert.match(mothershipActivation.command.join(" "), /health >\/dev\/null 2>&1/);
  assert.match(mothershipActivation.command.join(" "), /mothership env absent; skipping mothership activation/i);

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
    commitResolver: async () => "abc1234",
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
    commitResolver: async () => "abc1234",
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
    commitResolver: async () => "abc1234",
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
      commitResolver: async () => "abc1234",
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
  assert.match(readme, /matter-workbench-mothership\.service/);
  assert.match(readme, /mothership\.env/);

  const mothershipUnit = await readFile(
    new URL("../deployment/private-vm/matter-workbench-mothership.service", import.meta.url),
    "utf8",
  );
  assert.match(mothershipUnit, /EnvironmentFile=%h\/\.config\/matter-workbench\/mothership\.env/);
  assert.match(mothershipUnit, /ExecStart=.*scripts\/start-mothership-server\.mjs/);
  assert.match(mothershipUnit, /NoNewPrivileges=true/);

  const mothershipEnvExample = await readFile(
    new URL("../deployment/private-vm/mothership.env.example", import.meta.url),
    "utf8",
  );
  assert.match(mothershipEnvExample, /MOTHERSHIP_DATABASE_URL=/);
  assert.match(mothershipEnvExample, /MOTHERSHIP_HOST=127\.0\.0\.1/);
  assert.doesNotMatch(mothershipEnvExample, /postgres:\/\/[^:\s]+:[^<\s][^@\s]*@/);

  const deploymentDoc = await readFile(new URL("../docs/private-beta-codex-deployment.md", import.meta.url), "utf8");
  assert.match(deploymentDoc, /private-vm:rsync-deploy/);
});
