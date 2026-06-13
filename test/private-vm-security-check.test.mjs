import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeAccessPosture,
  analyzeAuditJson,
  analyzeRuntimeEnvFile,
  analyzeServiceUnit,
  parseSecurityCheckArgs,
  renderPrivateVmSecurityCheck,
  runPrivateVmSecurityCheck,
} from "../scripts/private-vm-security-check.mjs";

test("security check args parse base URL, env path, audit JSON, and skips", () => {
  assert.deepEqual(
    parseSecurityCheckArgs([
      "--base-url",
      "http://172.16.37.128:4191/",
      "--runtime-env",
      "/tmp/runtime.env",
      "--audit-json",
      "/tmp/audit.json",
      "--audit-disposition",
      "docs/security/npm-audit-disposition.md",
      "--auth-username",
      "operator",
      "--auth-password",
      "secret",
      "--skip-service-check",
    ], {}),
    {
      baseUrl: "http://172.16.37.128:4191",
      runtimeEnvPath: "/tmp/runtime.env",
      serviceUnitPath: "deployment/private-vm/matter-workbench-runtime.service",
      auditJsonPath: "/tmp/audit.json",
      auditDispositionPath: "docs/security/npm-audit-disposition.md",
      authUsername: "operator",
      authPassword: "secret",
      skipRuntimeEnv: false,
      skipServiceCheck: true,
    },
  );
});

test("access posture accepts loopback and RFC1918 URLs but rejects public hosts", () => {
  assert.equal(analyzeAccessPosture("http://127.0.0.1:4191").ok, true);
  assert.equal(analyzeAccessPosture("http://172.16.37.128:4191").ok, true);
  assert.equal(analyzeAccessPosture("http://10.20.30.40:4191").ok, true);
  const publicResult = analyzeAccessPosture("http://203.0.113.20:4191");
  assert.equal(publicResult.ok, false);
  assert.match(publicResult.message, /Public private-beta access must use HTTPS/);
});

test("security check accepts public HTTPS only with private beta auth and secure cookies", async () => {
  const dir = await tempDir();
  const envPath = path.join(dir, "runtime.env");
  await writeFile(envPath, [
    "MWB_PRIVATE_BETA_AUTH=required",
    "MWB_PRIVATE_BETA_USERS_FILE=/tmp/mwb-users.json",
    "MWB_PRIVATE_BETA_COOKIE_SECURE=true",
    "",
  ].join("\n"), "utf8");
  await chmod(envPath, 0o600);

  const report = await runPrivateVmSecurityCheck({
    baseUrl: "https://mwb-beta.139.59.74.9.sslip.io",
    runtimeEnvPath: envPath,
    skipServiceCheck: true,
  });

  const access = report.checks.find((check) => check.id === "access_posture");
  assert.equal(access.ok, true);
  assert.match(access.message, /public HTTPS/);

  const unsafe = await runPrivateVmSecurityCheck({
    baseUrl: "http://mwb-beta.139.59.74.9.sslip.io",
    runtimeEnvPath: envPath,
    skipServiceCheck: true,
  });
  assert.equal(unsafe.checks.find((check) => check.id === "access_posture").ok, false);
});

test("runtime env file must exist with 0600 permissions and redacted findings", async () => {
  const dir = await tempDir();
  const envPath = path.join(dir, "runtime.env");
  await writeFile(envPath, "MWB_RUNTIME_DATABASE_URL=postgres://runtime:secret@example/mwb\n", "utf8");
  await chmod(envPath, 0o600);

  const ok = await analyzeRuntimeEnvFile(envPath);
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, "0600");
  assert.doesNotMatch(renderPrivateVmSecurityCheck({ passed: true, checks: [ok] }).join("\n"), /secret/);

  await chmod(envPath, 0o644);
  const weak = await analyzeRuntimeEnvFile(envPath);
  assert.equal(weak.ok, false);
  assert.match(weak.message, /mode 0600/);
});

test("service unit requires protected env file, restart policy, and no inline secrets", async () => {
  const good = await analyzeServiceUnit("deployment/private-vm/matter-workbench-runtime.service");
  assert.equal(good.ok, true);

  const dir = await tempDir();
  const badPath = path.join(dir, "bad.service");
  await writeFile(badPath, [
    "[Service]",
    "WorkingDirectory=/tmp/app",
    "Environment=MWB_RUNTIME_DATABASE_URL=postgres://runtime:secret@example/mwb",
    "ExecStart=node server.mjs",
  ].join("\n"), "utf8");
  const bad = await analyzeServiceUnit(badPath);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /EnvironmentFile/);
});

test("npm audit JSON is summarized without making dev audit a release blocker", async () => {
  const clean = analyzeAuditJson({ metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} });
  assert.equal(clean.ok, true);
  assert.equal(clean.summary, "0 total, 0 critical, 0 high, 0 moderate, 0 low");

  const high = analyzeAuditJson({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      xlsx: {
        name: "xlsx",
        severity: "high",
        via: [{ title: "Prototype Pollution", severity: "high" }],
      },
    },
  });
  assert.equal(high.ok, false);
  assert.match(high.message, /high or critical/);
  assert.match(high.details.join("\n"), /xlsx/);
});

test("npm audit JSON can pass with an explicit package disposition", async () => {
  const dir = await tempDir();
  const auditJsonPath = path.join(dir, "audit.json");
  const dispositionPath = path.join(dir, "disposition.md");
  await writeFile(auditJsonPath, JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: { xlsx: { name: "xlsx", severity: "high" } },
  }), "utf8");
  await writeFile(dispositionPath, "## xlsx\nAccepted for private beta with spreadsheet parser restrictions.\n", "utf8");

  const report = await runPrivateVmSecurityCheck({
    baseUrl: "http://127.0.0.1:4191",
    runtimeEnvPath: await goodEnvFile(dir),
    auditJsonPath,
    auditDispositionPath: dispositionPath,
    skipServiceCheck: true,
  });

  const auditCheck = report.checks.find((check) => check.id === "npm_audit");
  assert.equal(auditCheck.ok, true);
  assert.match(auditCheck.message, /documented disposition/);
});

test("security check composes access, env, service, audit, DB role proof, and service smoke", async () => {
  const dir = await tempDir();
  const envPath = path.join(dir, "runtime.env");
  const auditJsonPath = path.join(dir, "audit.json");
  await writeFile(envPath, "MWB_RUNTIME_DB=postgres\n", "utf8");
  await chmod(envPath, 0o600);
  await writeFile(auditJsonPath, JSON.stringify({ metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} }), "utf8");

  const report = await runPrivateVmSecurityCheck({
    baseUrl: "http://172.16.37.128:4191",
    runtimeEnvPath: envPath,
    auditJsonPath,
    authUsername: "operator",
    authPassword: "secret",
    serviceCheckFn: async ({ authUsername, authPassword }) => {
      assert.equal(authUsername, "operator");
      assert.equal(authPassword, "secret");
      return { passed: true, matterCount: 15, targetMatter: "Atlas" };
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.checks.some((check) => check.id === "access_posture" && check.ok), true);
  assert.equal(report.checks.some((check) => check.id === "runtime_env_permissions" && check.ok), true);
  assert.equal(report.checks.some((check) => check.id === "systemd_service_template" && check.ok), true);
  assert.equal(report.checks.some((check) => check.id === "runtime_db_role_proof" && check.ok), true);
  assert.equal(report.checks.some((check) => check.id === "live_service_smoke" && check.ok), true);
});

test("package and docs expose private VM security check", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["private-vm:security-check"], "node scripts/private-vm-security-check.mjs");

  const readme = await readFile(new URL("../deployment/private-vm/README.md", import.meta.url), "utf8");
  assert.match(readme, /private-vm:security-check/);
  assert.match(readme, /Do not expose the Node runtime directly to the public internet/);
  assert.match(readme, /public HTTPS beta URL/);
});

async function tempDir() {
  return await mkdir(path.join(os.tmpdir(), `mwb-private-vm-security-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
}

async function goodEnvFile(dir) {
  const envPath = path.join(dir, "runtime.env");
  await writeFile(envPath, "MWB_RUNTIME_DB=postgres\n", "utf8");
  await chmod(envPath, 0o600);
  return envPath;
}
