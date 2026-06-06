import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimeCheckPath = new URL("../scripts/db-runtime-cutover-check.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);

test("runtime cutover check fails closed while shadow acceptance still has blockers", async () => {
  const {
    buildRuntimeCutoverReport,
    renderRuntimeCutoverReport,
  } = await import(runtimeCheckPath.href);

  const report = await buildRuntimeCutoverReport({
    buildAcceptanceReport: async () => ({
      accepted: true,
      verifySuccess: true,
      runtimeCutoverReady: false,
      runtimeCutoverBlockers: [
        "object_storage_or_single_host_volume_policy",
        "pdf_storage_backup_restore_policy",
      ],
      next: "Shadow database accepted for handoff evidence; runtime remains filesystem-backed.",
    }),
  });

  assert.equal(report.shadowEvidenceAccepted, true);
  assert.equal(report.runtimeCutoverReady, false);
  assert.deepEqual(report.blockers, [
    "object_storage_or_single_host_volume_policy",
    "pdf_storage_backup_restore_policy",
  ]);

  const rendered = renderRuntimeCutoverReport(report).join("\n");
  assert.match(rendered, /runtime_cutover_ready: no/);
  assert.match(rendered, /shadow_evidence_accepted: yes/);
  assert.match(rendered, /object_storage_or_single_host_volume_policy/);
  assert.match(rendered, /runtime remains filesystem-backed/i);
});

test("runtime cutover check carries the reduced blocker set after local runtime policies are accepted", async () => {
  const { buildRuntimeCutoverReport } = await import(runtimeCheckPath.href);

  const report = await buildRuntimeCutoverReport({
    buildAcceptanceReport: async () => ({
      accepted: true,
      verifySuccess: true,
      runtimeCutoverReady: false,
      runtimeCutoverBlockers: [
        "hosted_auth_and_tenant_session_model",
      ],
      next: "Shadow database accepted for handoff evidence; runtime remains filesystem-backed.",
    }),
  });

  assert.equal(report.shadowEvidenceAccepted, true);
  assert.equal(report.runtimeCutoverReady, false);
  assert.deepEqual(report.blockers, [
    "hosted_auth_and_tenant_session_model",
  ]);
});

test("runtime cutover check reports explicit approval blocker when shadow has no blockers", async () => {
  const { buildRuntimeCutoverReport, renderRuntimeCutoverReport } = await import(runtimeCheckPath.href);

  const report = await buildRuntimeCutoverReport({
    buildAcceptanceReport: async () => ({
      accepted: true,
      verifySuccess: true,
      runtimeCutoverReady: true,
      runtimeCutoverBlockers: [],
      next: "Shadow database accepted for handoff evidence; runtime remains filesystem-backed.",
    }),
    env: {},
  });

  assert.equal(report.shadowEvidenceAccepted, true);
  assert.equal(report.runtimeCutoverReady, false);
  assert.deepEqual(report.blockers, ["runtime_cutover_not_approved"]);

  const rendered = renderRuntimeCutoverReport(report).join("\n");
  assert.match(rendered, /runtime_cutover_ready: no/);
  assert.match(rendered, /runtime_cutover_not_approved/);
  assert.match(rendered, /MWB_DB_RUNTIME_CUTOVER_APPROVED/);
});

test("runtime cutover check reports ready only after explicit approval", async () => {
  const { buildRuntimeCutoverReport, renderRuntimeCutoverReport } = await import(runtimeCheckPath.href);

  const report = await buildRuntimeCutoverReport({
    buildAcceptanceReport: async () => ({
      accepted: true,
      verifySuccess: true,
      runtimeCutoverReady: false,
      runtimeCutoverBlockers: [],
    }),
    env: { MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes" },
  });

  assert.equal(report.shadowEvidenceAccepted, true);
  assert.equal(report.runtimeCutoverReady, true);
  assert.deepEqual(report.blockers, []);

  const rendered = renderRuntimeCutoverReport(report).join("\n");
  assert.match(rendered, /runtime_cutover_ready: yes/);
  assert.match(rendered, /runtime_cutover_blockers:\n\s+\(none\)/);
});

test("runtime cutover check reports shadow acceptance failure as a blocker", async () => {
  const { buildRuntimeCutoverReport } = await import(runtimeCheckPath.href);

  const report = await buildRuntimeCutoverReport({
    buildAcceptanceReport: async () => ({
      accepted: false,
      verifySuccess: false,
      runtimeCutoverReady: false,
      runtimeCutoverBlockers: ["postgres_unavailable_user_behavior"],
      failedVerifyStep: "db:shadow:report",
      next: "Run db:shadow:acceptance after fixing shadow verification.",
    }),
  });

  assert.equal(report.shadowEvidenceAccepted, false);
  assert.equal(report.runtimeCutoverReady, false);
  assert.deepEqual(report.blockers, [
    "shadow_database_not_accepted",
    "postgres_unavailable_user_behavior",
  ]);
});

test("package and docs expose the runtime cutover stop check", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:runtime-cutover-check"], "node scripts/db-runtime-cutover-check.mjs");

  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:runtime-cutover-check/);
  assert.match(dbReadme, /fails closed/i);
  assert.match(dbReadme, /does not switch runtime/i);
  assert.match(dbReadme, /MWB_DB_RUNTIME_CUTOVER_APPROVED/);

  const handoffDoc = await readFile(handoffDocPath, "utf8");
  assert.match(handoffDoc, /npm run db:runtime-cutover-check/);
  assert.match(handoffDoc, /runtime cutover/i);
  assert.match(handoffDoc, /MWB_DB_RUNTIME_CUTOVER_APPROVED/);
});
