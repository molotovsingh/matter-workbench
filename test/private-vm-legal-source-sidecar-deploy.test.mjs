import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployPath = new URL("../scripts/private-vm-legal-source-sidecar-deploy.mjs", import.meta.url);

async function load() {
  return import(deployPath.href);
}

test("private VM Legal Source Sidecar parser reads target options without accepting secrets", async () => {
  const { parsePrivateVmLegalSourceSidecarDeployArgs } = await load();

  assert.deepEqual(
    parsePrivateVmLegalSourceSidecarDeployArgs([
      "--host",
      "172.16.37.128",
      "--user",
      "aks",
      "--sidecar-root",
      "/home/aks/matter-workbench-sidecars",
      "--legal-source-dir",
      "/Users/aksingh/legal-source-service",
      "--statutes-dir",
      "/Users/aksingh/statutes",
      "--statutes-port",
      "8788",
      "--legal-source-port",
      "8790",
      "--node-version",
      "22.16.0",
      "--configure-workbench-env",
      "--dry-run",
    ], {}),
    {
      host: "172.16.37.128",
      user: "aks",
      sidecarRoot: "/home/aks/matter-workbench-sidecars",
      legalSourceDir: "/Users/aksingh/legal-source-service",
      statutesDir: "/Users/aksingh/statutes",
      statutesPort: 8788,
      legalSourcePort: 8790,
      nodeVersion: "v22.16.0",
      nodeDistBaseUrl: "https://nodejs.org/dist",
      statutesServiceName: "mwb-statutes.service",
      legalSourceServiceName: "mwb-legal-source.service",
      workbenchServiceName: "matter-workbench-runtime.service",
      configureWorkbenchEnv: true,
      skipHealthCheck: false,
      dryRun: true,
      json: false,
    },
  );

  assert.throws(
    () => parsePrivateVmLegalSourceSidecarDeployArgs(["--legal-source-token", "secret"], {}),
    /does not accept secrets/i,
  );
});

test("private VM Legal Source Sidecar parser defaults sidecar root to remote user home", async () => {
  const { parsePrivateVmLegalSourceSidecarDeployArgs } = await load();

  const parsed = parsePrivateVmLegalSourceSidecarDeployArgs([
    "--host",
    "172.16.37.128",
    "--user",
    "aks",
  ], {});

  assert.equal(parsed.sidecarRoot, "/home/aks/matter-workbench-sidecars");
  assert.equal(parsed.statutesPort, 8788);
  assert.equal(parsed.legalSourcePort, 8790);
});

test("private VM Legal Source Sidecar plan syncs sidecars, builds corpus DB, installs services, and checks health", async () => {
  const { buildPrivateVmLegalSourceSidecarDeployPlan } = await load();

  const plan = buildPrivateVmLegalSourceSidecarDeployPlan({
    host: "172.16.37.128",
    user: "aks",
    sidecarRoot: "/home/aks/matter-workbench-sidecars",
    legalSourceDir: "/Users/aksingh/legal-source-service",
    statutesDir: "/Users/aksingh/statutes",
    configureWorkbenchEnv: true,
  });

  assert.equal(plan.schemaVersion, "private-vm-legal-source-sidecar-deploy/v1");
  assert.equal(plan.remote, "aks@172.16.37.128");
  assert.equal(plan.sidecarRoot, "/home/aks/matter-workbench-sidecars");
  assert.equal(plan.legalSourceRemoteDir, "/home/aks/matter-workbench-sidecars/legal-source-service");
  assert.equal(plan.statutesRemoteDir, "/home/aks/matter-workbench-sidecars/statutes");
  assert.equal(plan.nodeDir, "/home/aks/matter-workbench-sidecars/node");
  assert.equal(plan.statutesPort, 8788);
  assert.equal(plan.legalSourcePort, 8790);
  assert.equal(plan.health.statutes, "http://127.0.0.1:8788/health");
  assert.equal(plan.health.legalSource, "http://127.0.0.1:8790/health");

  assert.deepEqual(plan.steps.map((step) => step.id), [
    "preflight",
    "rsync_legal_source",
    "rsync_statutes",
    "install_node_runtime",
    "build_statutes_db",
    "install_systemd_units",
    "restart_sidecars",
    "configure_workbench_env",
    "health_check",
  ]);

  const preflight = plan.steps.find((step) => step.id === "preflight");
  assert.match(preflight.command.join(" "), /command -v rsync/);
  assert.match(preflight.command.join(" "), /command -v curl/);
  assert.match(preflight.command.join(" "), /command -v xz/);
  assert.match(preflight.command.join(" "), /systemctl --user show-environment/);

  const legalRsync = plan.steps.find((step) => step.id === "rsync_legal_source");
  assert.match(legalRsync.command.join(" "), /cd '\/Users\/aksingh\/legal-source-service'/);
  assert.match(legalRsync.command.join(" "), /rsync -az --delete/);
  assert.match(legalRsync.command.join(" "), /--exclude='\.git\/'/);
  assert.match(legalRsync.command.join(" "), /--exclude='\.env\.\*'/);
  assert.match(legalRsync.command.join(" "), /aks@172\.16\.37\.128:\/home\/aks\/matter-workbench-sidecars\/legal-source-service\//);

  const statutesRsync = plan.steps.find((step) => step.id === "rsync_statutes");
  assert.match(statutesRsync.command.join(" "), /--include='corpus\/\*\*\*'/);
  assert.match(statutesRsync.command.join(" "), /--include='bin\/\*\*\*'/);
  assert.match(statutesRsync.command.join(" "), /--include='src\/\*\*\*'/);
  assert.match(statutesRsync.command.join(" "), /--exclude='data\/'/);
  assert.match(statutesRsync.command.join(" "), /--exclude='\*\.db'/);
  assert.match(statutesRsync.command.join(" "), /--exclude='\*'/);

  const nodeInstall = plan.steps.find((step) => step.id === "install_node_runtime");
  assert.match(nodeInstall.command.join(" "), /NODE_VERSION='v22\.16\.0'/);
  assert.match(nodeInstall.command.join(" "), /nodejs\.org\/dist/);
  assert.match(nodeInstall.command.join(" "), /node-\$NODE_VERSION-linux-\$NODE_ARCH\.tar\.xz/);

  const buildDb = plan.steps.find((step) => step.id === "build_statutes_db");
  assert.match(buildDb.command.join(" "), /STATUTE_ACTS_DIR=\.\/corpus/);
  assert.match(buildDb.command.join(" "), /STATUTE_DB_PATH=\.\/data\/statutes\.db/);
  assert.match(buildDb.command.join(" "), /npm run build:corpus --silent/);

  const units = plan.steps.find((step) => step.id === "install_systemd_units");
  assert.match(units.command.join(" "), /mwb-statutes\.service/);
  assert.match(units.command.join(" "), /ExecStart=\/home\/aks\/matter-workbench-sidecars\/node\/bin\/node bin\/statutes\.mjs serve --host 127\.0\.0\.1 --port 8788/);
  assert.match(units.command.join(" "), /STATUTES_API_URL=http:\/\/127\.0\.0\.1:8788/);
  assert.match(units.command.join(" "), /LEGAL_SOURCE_WEB_ENABLED=0/);
  assert.match(units.command.join(" "), /NoNewPrivileges=true/);

  const configure = plan.steps.find((step) => step.id === "configure_workbench_env");
  assert.match(configure.command.join(" "), /COPILOT_WEB_RESEARCH_PROVIDER/);
  assert.match(configure.command.join(" "), /legal_source_sidecar/);
  assert.match(configure.command.join(" "), /COPILOT_LEGAL_SOURCE_SERVICE_URL/);
  assert.match(configure.command.join(" "), /systemctl --user restart 'matter-workbench-runtime\.service'/);
  assert.doesNotMatch(configure.command.join(" "), /TOKEN|PASSWORD|SECRET/);

  const health = plan.steps.find((step) => step.id === "health_check");
  assert.match(health.command.join(" "), /http:\/\/127\.0\.0\.1:8788\/health/);
  assert.match(health.command.join(" "), /http:\/\/127\.0\.0\.1:8790\/health/);
  assert.match(health.command.join(" "), /corpus_fingerprint/);
});

test("private VM Legal Source Sidecar plan can skip Workbench env updates and health check", async () => {
  const { buildPrivateVmLegalSourceSidecarDeployPlan } = await load();

  const plan = buildPrivateVmLegalSourceSidecarDeployPlan({
    host: "vm.example.test",
    user: "aks",
    skipHealthCheck: true,
  });

  assert.equal(plan.steps.some((step) => step.id === "configure_workbench_env"), false);
  assert.equal(plan.steps.some((step) => step.id === "health_check"), false);
});

test("private VM Legal Source Sidecar runner aborts before later mutation when preflight fails", async () => {
  const { runPrivateVmLegalSourceSidecarDeploy } = await load();
  const executed = [];

  const result = await runPrivateVmLegalSourceSidecarDeploy({
    host: "vm.example.test",
    user: "aks",
    legalSourceDir: "/sidecar",
    statutesDir: "/statutes",
    commandRunner: async (step) => {
      executed.push(step.id);
      return { ok: false, code: 1, error: "rsync missing" };
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(executed, ["preflight"]);
  assert.deepEqual(result.stepResults.map((step) => step.id), ["preflight"]);
});

test("private VM Legal Source Sidecar runner dry-run returns the plan without executing commands", async () => {
  const { runPrivateVmLegalSourceSidecarDeploy } = await load();
  const executed = [];

  const result = await runPrivateVmLegalSourceSidecarDeploy({
    host: "vm.example.test",
    user: "aks",
    legalSourceDir: "/sidecar",
    statutesDir: "/statutes",
    dryRun: true,
    commandRunner: async (step) => {
      executed.push(step.id);
      return { ok: true };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.executed, false);
  assert.equal(result.schemaVersion, "private-vm-legal-source-sidecar-deploy/v1");
  assert.equal(result.plan.steps.length > 0, true);
  assert.deepEqual(executed, []);
});

test("package and docs expose the private VM Legal Source Sidecar deploy command", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    pkg.scripts["private-vm:legal-source-sidecar-deploy"],
    "node scripts/private-vm-legal-source-sidecar-deploy.mjs",
  );

  const readme = await readFile(new URL("../deployment/private-vm/README.md", import.meta.url), "utf8");
  assert.match(readme, /private-vm:legal-source-sidecar-deploy/);
  assert.match(readme, /mwb-statutes\.service/);
  assert.match(readme, /mwb-legal-source\.service/);
  assert.match(readme, /8788/);
  assert.match(readme, /does not accept password, token, or secret command-line/);

  const checklist = await readFile(new URL("../docs/beta-operator-checklist.md", import.meta.url), "utf8");
  assert.match(checklist, /private-vm:legal-source-sidecar-deploy/);
  assert.match(checklist, /npm run build:corpus/);
  assert.match(checklist, /127\.0\.0\.1:8788/);
});
