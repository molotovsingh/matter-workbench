import assert from "node:assert/strict";
import test from "node:test";

const scriptPath = new URL("../scripts/system-health-report.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

const {
  parseSystemHealthReportArgs,
  renderSystemHealthReport,
} = await import(scriptPath.href);

test("system health report CLI parses safe read-only options", () => {
  assert.equal(parseSystemHealthReportArgs(["--json"]).json, true);
  assert.equal(parseSystemHealthReportArgs(["--app-dir", "/tmp/app"]).appDir, "/tmp/app");
  assert.equal(parseSystemHealthReportArgs(["--limit", "25"]).recentLimit, 25);
  assert.throws(() => parseSystemHealthReportArgs(["--app-dir"]), /requires a value/);
  assert.throws(() => parseSystemHealthReportArgs(["--limit", "0"]), /positive integer/);
  assert.throws(() => parseSystemHealthReportArgs(["--wat"]), /Unknown option/);
});

test("system health report renders compact read-only text", () => {
  const text = renderSystemHealthReport({
    schema_version: "system-health/v1",
    generatedAt: "2026-06-16T12:00:00.000Z",
    status: "warning",
    runtime: { storageMode: "filesystem", nodeVersion: "v26.3.0" },
    summary: { ok: 2, warning: 1, error: 0 },
    checks: [
      { id: "provider.routes_ready", status: "warning", label: "Provider routes ready", message: "1 route needs setup.", recommendation: "Configure provider keys." },
    ],
    recommendations: ["Configure provider keys."],
  });

  assert.match(text, /Matter Workbench system health/);
  assert.match(text, /status: warning/);
  assert.match(text, /\[warning\] provider\.routes_ready/);
  assert.doesNotMatch(text, /API key value/);
});

test("package exposes system health report command", async () => {
  const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["system-health:report"], "node scripts/system-health-report.mjs");
});
