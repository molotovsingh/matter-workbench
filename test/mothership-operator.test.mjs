import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMothershipReport, renderMothershipReportMarkdown } from "../mothership/report.mjs";
import { parseMothershipOperatorArgs, runMothershipOperator } from "../scripts/mothership-operator.mjs";

test("mothership operator parses bounded commands without accepting secrets", () => {
  assert.deepEqual(
    parseMothershipOperatorArgs(["installations", "create", "--id", "firm-01", "--label", "Firm one"]),
    { command: "installations:create", options: { id: "firm-01", label: "Firm one" } },
  );
  assert.deepEqual(
    parseMothershipOperatorArgs(["report", "--since-days", "14", "--format", "json"]),
    { command: "report", options: { "since-days": "14", format: "json" } },
  );
  assert.throws(() => parseMothershipOperatorArgs(["report", "--token", "secret"]), /does not accept secrets/i);
});

test("mothership operator creates and revokes installations and prunes payloads", async () => {
  const output = [];
  const calls = [];
  const store = {
    registerInstallation: async (input) => {
      calls.push(["create", input]);
      return { ...input, rawToken: "mwb_ing_one-time-secret", tokenPrefix: "mwb_ing_one-time" };
    },
    revokeInstallation: async (input) => {
      calls.push(["revoke", input]);
      return true;
    },
    pruneExpired: async (input) => {
      calls.push(["prune", input]);
      return { feedbackDeleted: 2, signalsDeleted: 3, retentionDays: input.retentionDays };
    },
    health: async () => ({ database: "ready" }),
  };

  assert.equal(await runMothershipOperator({
    argv: ["installations", "create", "--id", "firm-01", "--label", "Firm one"],
    store,
    stdout: (line) => output.push(line),
  }), 0);
  assert.match(output.join("\n"), /mwb_ing_one-time-secret/);
  assert.match(output.join("\n"), /shown once/i);

  output.length = 0;
  assert.equal(await runMothershipOperator({ argv: ["installations", "revoke", "--id", "firm-01"], store, stdout: (line) => output.push(line) }), 0);
  assert.match(output.join("\n"), /Revoked installation firm-01/);

  output.length = 0;
  assert.equal(await runMothershipOperator({ argv: ["prune", "--retention-days", "180"], store, stdout: (line) => output.push(line) }), 0);
  assert.match(output.join("\n"), /feedback_deleted: 2/);
  assert.deepEqual(calls, [
    ["create", { installationId: "firm-01", label: "Firm one" }],
    ["revoke", { installationId: "firm-01" }],
    ["prune", { retentionDays: 180 }],
  ]);
});

test("mothership report prioritizes actionable evidence and redacts secrets", () => {
  const report = buildMothershipReport({
    sinceDays: 30,
    signals: [
      signalRow({ signal_id: "warning", severity: "warning", occurrence_count: 7, title: "OCR warning" }),
      signalRow({ signal_id: "error", severity: "error", occurrence_count: 1, title: "Job failed token=super-secret" }),
    ],
    feedback: [
      feedbackRow({ feedback_id: "feature", classification: "feature_idea", tryingToDo: "Add a dashboard" }),
      feedbackRow({ feedback_id: "confused", classification: "confusing_ux", tryingToDo: "Find a matter" }),
      feedbackRow({ feedback_id: "bug", classification: "bug", tryingToDo: "Run a skill" }),
    ],
  }, { generatedAt: "2026-06-10T12:00:00.000Z" });

  assert.deepEqual(report.items.map((item) => item.id), ["error", "warning", "bug", "confused", "feature"]);
  assert.deepEqual(report.summary, { criticalSignals: 1, repeatedWarnings: 1, bugs: 1, confusingUx: 1, featureIdeas: 1, total: 5 });

  const markdown = renderMothershipReportMarkdown(report);
  assert.match(markdown, /# Matter Workbench Beta Development Report/);
  assert.match(markdown, /Job failed token=\[redacted-secret\]/);
  assert.doesNotMatch(markdown, /super-secret/);
});

test("package exposes mothership operator commands", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["mothership:migrate"], "node mothership/db-migrate.mjs");
  assert.equal(pkg.scripts["mothership:serve"], "node scripts/start-mothership-server.mjs");
  assert.equal(pkg.scripts["mothership:operator"], "node scripts/mothership-operator.mjs");
  assert.equal(pkg.scripts["mothership:report"], "node scripts/mothership-operator.mjs report");
});

function signalRow(overrides = {}) {
  const { title = "Signal", ...rowOverrides } = overrides;
  return {
    installation_id: "firm-01",
    signal_id: "signal",
    source: "job_status",
    severity: "warning",
    occurrence_count: 1,
    received_at: "2026-06-10T10:00:00.000Z",
    payload: { title, details: {} },
    ...rowOverrides,
  };
}

function feedbackRow(overrides = {}) {
  const { tryingToDo = "Do something", ...rowOverrides } = overrides;
  return {
    installation_id: "firm-01",
    feedback_id: "feedback",
    classification: "bug",
    status: "new",
    received_at: "2026-06-10T10:00:00.000Z",
    payload: { tryingToDo, happenedInstead: "It failed" },
    ...rowOverrides,
  };
}
