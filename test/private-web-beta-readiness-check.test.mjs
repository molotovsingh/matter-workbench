import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluatePrivateWebBetaReadiness,
  parsePrivateWebBetaReadinessArgs,
  renderPrivateWebBetaReadiness,
} from "../scripts/private-web-beta-readiness-check.mjs";
import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";

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
  MWB_PRIVATE_BETA_METRICS_SYNC_URL: "https://mothership.example.test/v1/metrics",
  MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN: "metrics-token",
  MWB_PRIVATE_BETA_INSTALL_ID: "firm-beta-01",
  MWB_PRIVATE_BETA_TELEMETRY_MODE: "firm_internal",
  OPENAI_API_KEY: "sk-test",
  OPENROUTER_API_KEY: "or-test",
  MISTRAL_API_KEY: "mistral-test",
  GEMINI_API_KEY: "gemini-test",
};

test("private web beta readiness passes for HTTPS, auth, runtime DB, and mothership sync", () => {
  const report = evaluatePrivateWebBetaReadiness({ env: READY_ENV, now: "2026-06-07T12:00:00.000Z" });

  assert.equal(report.schemaVersion, "private-web-beta-readiness/v1");
  assert.equal(report.ready, true);
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.checks.every((check) => check.status !== "block"), true);
  assert.equal(report.checks.find((check) => check.id === "runtime_db")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "mothership_sync")?.status, "pass");
  assert.match(report.checks.find((check) => check.id === "mothership_sync")?.message || "", /backend metrics/i);
});

test("private web beta readiness blocks public web exposure without HTTPS, auth, runtime DB, or sync", () => {
  const report = evaluatePrivateWebBetaReadiness({
    env: {
      MWB_PRIVATE_BETA_PUBLIC_URL: "http://172.16.37.128:4191",
      MWB_PRIVATE_BETA_AUTH: "optional",
      MWB_RUNTIME_DB: "filesystem",
    },
    now: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.ready, false);
  assert.ok(report.summary.blockers >= 4);
  assert.equal(report.checks.find((check) => check.id === "public_url")?.status, "block");
  assert.equal(report.checks.find((check) => check.id === "private_access")?.status, "block");
  assert.equal(report.checks.find((check) => check.id === "runtime_db")?.status, "block");
  assert.equal(report.checks.find((check) => check.id === "mothership_sync")?.status, "block");
});

test("private web beta readiness accepts signal sync fallback through feedback mothership", () => {
  const env = {
    ...READY_ENV,
    MWB_PRIVATE_BETA_SIGNAL_SYNC_URL: "",
    MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN: "",
    MWB_PRIVATE_BETA_METRICS_SYNC_URL: "",
    MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN: "",
  };
  const report = evaluatePrivateWebBetaReadiness({ env });
  const sync = report.checks.find((check) => check.id === "mothership_sync");

  assert.equal(report.ready, true);
  assert.equal(sync.status, "pass");
  assert.match(sync.message, /signal and metrics fallback/i);
});

test("private web beta readiness accepts loopback HTTP mothership sync for same-VM deployments", () => {
  const env = {
    ...READY_ENV,
    MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL: "http://127.0.0.1:4192/api/beta-feedback",
    MWB_PRIVATE_BETA_SIGNAL_SYNC_URL: "http://127.0.0.1:4192/api/beta-signals",
    MWB_PRIVATE_BETA_METRICS_SYNC_URL: "http://127.0.0.1:4192/v1/metrics",
  };
  const report = evaluatePrivateWebBetaReadiness({ env });
  const sync = report.checks.find((check) => check.id === "mothership_sync");

  assert.equal(report.ready, true);
  assert.equal(sync.status, "pass");
  assert.match(sync.message, /loopback/i);
});

test("private web beta readiness accepts operator-managed tester account files", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-readiness-users-"));
  const usersFile = path.join(tmp, "private-beta-users.json");
  await writeFile(
    usersFile,
    `${JSON.stringify({
      schemaVersion: "private-beta-users/v1",
      users: [
        {
          username: "tester-one",
          role: "tester",
          passwordHash: hashPrivateBetaPassword("secret", { salt: "readiness", iterations: 1_000 }),
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const report = evaluatePrivateWebBetaReadiness({
    env: {
      ...READY_ENV,
      MWB_PRIVATE_BETA_USERNAME: "",
      MWB_PRIVATE_BETA_PASSWORD: "",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.checks.find((check) => check.id === "private_access")?.status, "pass");
  assert.match(report.checks.find((check) => check.id === "private_access")?.message || "", /tester account file/i);
});

test("private web beta readiness warns when runtime DB URL falls back to a generic database URL", () => {
  const env = {
    ...READY_ENV,
    MWB_RUNTIME_DATABASE_URL: "",
    MWB_DATABASE_URL: "postgres://runtime:secret@db/matter_workbench",
  };
  const report = evaluatePrivateWebBetaReadiness({ env });

  assert.equal(report.ready, true);
  assert.equal(report.checks.find((check) => check.id === "runtime_db")?.status, "warn");
});

test("private web beta readiness renders without leaking configured secret values", () => {
  const report = evaluatePrivateWebBetaReadiness({ env: READY_ENV });
  const rendered = renderPrivateWebBetaReadiness(report).join("\n");

  assert.match(rendered, /private web beta readiness/i);
  assert.match(rendered, /ready: yes/);
  assert.doesNotMatch(rendered, /private-password/);
  assert.doesNotMatch(rendered, /feedback-token/);
  assert.doesNotMatch(rendered, /postgres:\/\/runtime:secret/);
});

test("private web beta readiness arg parser supports JSON and URL override", () => {
  assert.deepEqual(parsePrivateWebBetaReadinessArgs(["--public-url", "https://beta.example.test/", "--json"], {}), {
    publicUrl: "https://beta.example.test",
    json: true,
  });
});

test("package and docs expose the private web beta readiness pack", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["private-web:readiness-check"], "node scripts/private-web-beta-readiness-check.mjs");

  const docsIndex = await readFile(new URL("../docs/README.md", import.meta.url), "utf8");
  assert.match(docsIndex, /Private Web Beta Readiness Pack/);

  const readinessDoc = await readFile(new URL("../docs/private-web-beta-readiness-pack.md", import.meta.url), "utf8");
  assert.match(readinessDoc, /not public SaaS/i);
  assert.match(readinessDoc, /MWB_PRIVATE_BETA_AUTH=required/);
  assert.match(readinessDoc, /private-web:readiness-check/);
});
