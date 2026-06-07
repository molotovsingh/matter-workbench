import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parsePrivateBetaDeploymentPackArgs,
  renderPrivateBetaDeploymentPack,
  runPrivateBetaDeploymentPack,
} from "../scripts/private-beta-deployment-pack.mjs";

const READY_ENV = {
  MWB_PRIVATE_BETA_PUBLIC_URL: "https://mwb-beta.example.test",
  MWB_PRIVATE_BETA_AUTH: "required",
  MWB_PRIVATE_BETA_USERNAME: "operator",
  MWB_PRIVATE_BETA_PASSWORD: "private-password",
  MWB_RUNTIME_DB: "postgres",
  MWB_RUNTIME_DB_STORAGE: "postgres",
  MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
  MWB_RUNTIME_DATABASE_URL: "postgres://runtime:secret@db/matter_workbench",
  MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL: "https://mothership.example.test/api/beta-feedback",
  MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN: "feedback-token",
  MWB_PRIVATE_BETA_SIGNAL_SYNC_URL: "https://mothership.example.test/api/beta-signals",
  MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN: "signal-token",
  MWB_PRIVATE_BETA_INSTALL_ID: "firm-beta-01",
  MWB_PRIVATE_BETA_TELEMETRY_MODE: "firm_internal",
  OPENAI_API_KEY: "sk-test",
  OPENROUTER_API_KEY: "or-test",
  MISTRAL_API_KEY: "mistral-test",
  GEMINI_API_KEY: "gemini-test",
};

test("private beta deployment pack writes ordered deployment and observability evidence", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-deploy-pack-"));
  const result = await runPrivateBetaDeploymentPack({
    outDir,
    timestamp: "2026-06-07T15:00:00.000Z",
    env: READY_ENV,
    targetUrl: "https://mwb-beta.example.test",
    deploymentHost: "mwb-vm",
    deploymentUser: "aks",
    deploymentRoot: "/home/aks/matter-workbench-deployments",
  });

  assert.equal(result.schemaVersion, "private-beta-deployment-pack/v1");
  assert.equal(result.readyForHandoff, true);
  assert.equal(result.readiness.ready, true);
  assert.deepEqual(result.commandPhases.map((phase) => phase.id), [
    "source_release",
    "runtime_env",
    "deploy_artifact",
    "service_start",
    "https_access",
    "verification",
    "observability",
    "rollback",
    "sites_boundary",
  ]);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);

  const jsonText = await readFile(result.files.json, "utf8");
  assert.doesNotMatch(jsonText, /private-password/);
  assert.doesNotMatch(jsonText, /feedback-token/);
  assert.doesNotMatch(jsonText, /postgres:\/\/runtime:secret/);

  const rendered = renderPrivateBetaDeploymentPack(result).join("\n");
  assert.match(rendered, /Matter Workbench private beta deployment pack/);
  assert.match(rendered, /ready_for_handoff: yes/);
  assert.match(rendered, /Sites is parked for companion surfaces/);
  assert.match(rendered, /npm run private-web:readiness-check/);
});

test("private beta deployment pack fails handoff when readiness has blockers", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-deploy-pack-blocked-"));
  const result = await runPrivateBetaDeploymentPack({
    outDir,
    timestamp: "2026-06-07T15:00:00.000Z",
    env: {
      MWB_PRIVATE_BETA_PUBLIC_URL: "http://172.16.37.128:4191",
      MWB_PRIVATE_BETA_AUTH: "optional",
      MWB_RUNTIME_DB: "filesystem",
    },
  });

  assert.equal(result.readyForHandoff, false);
  assert.ok(result.readiness.summary.blockers > 0);
  assert.match(result.stopRules.join("\n"), /Do not hand the URL to beta testers/);
});

test("private beta deployment pack parser accepts target and output options", () => {
  assert.deepEqual(
    parsePrivateBetaDeploymentPackArgs([
      "--out-dir",
      "/tmp/packs",
      "--timestamp",
      "2026-06-07T15:00:00.000Z",
      "--target-url",
      "https://beta.example.test/",
      "--deployment-host",
      "mwb-vm",
      "--deployment-user",
      "aks",
      "--deployment-root",
      "/home/aks/deployments",
    ], {}),
    {
      outDir: "/tmp/packs",
      timestamp: "2026-06-07T15:00:00.000Z",
      targetUrl: "https://beta.example.test",
      deploymentHost: "mwb-vm",
      deploymentUser: "aks",
      deploymentRoot: "/home/aks/deployments",
      json: false,
    },
  );
});

test("package and docs expose the Codex deployment pack", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["private-beta:deployment-pack"], "node scripts/private-beta-deployment-pack.mjs");

  const docsIndex = await readFile(new URL("../docs/README.md", import.meta.url), "utf8");
  assert.match(docsIndex, /Codex Private Beta Deployment Pack/);

  const doc = await readFile(new URL("../docs/private-beta-codex-deployment.md", import.meta.url), "utf8");
  assert.match(doc, /boring, repeatable, and observable/i);
  assert.match(doc, /Sites becomes interesting later/i);
  assert.match(doc, /private-beta:deployment-pack/);
});
