import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const acceptancePath = new URL("../scripts/db-shadow-acceptance.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);

test("shadow DB acceptance passes when doctor is hydrated and verify pipeline succeeds", async () => {
  const {
    buildShadowAcceptanceReport,
    renderShadowAcceptanceReport,
  } = await import(acceptancePath.href);

  const report = await buildShadowAcceptanceReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: no",
      "ready_to_hydrate: yes",
      "next: Run shadow hydration or report with MWB_DATABASE_URL set.",
    ],
    runHydrationFn: () => ({
      mode: "verify",
      success: true,
      steps: [
        { script: "db:doctor", ok: true },
        { script: "db:hydrate:verify", ok: true },
        { script: "db:shadow:report", ok: true },
      ],
      failedStep: null,
    }),
    checkStorageBackupEvidenceFn: async () => ({ accepted: false }),
  });

  assert.equal(report.accepted, true);
  assert.equal(report.databaseUrl, "configured");
  assert.equal(report.psql, "available");
  assert.equal(report.readyToHydrateShadow, true);
  assert.equal(report.verifySuccess, true);
  assert.equal(report.runtimeCutoverReady, false);
  assert.ok(report.runtimeCutoverBlockers.includes("object_storage_or_single_host_volume_policy"));
  assert.ok(report.runtimeCutoverBlockers.includes("pdf_storage_backup_restore_policy"));
  assert.ok(!report.runtimeCutoverBlockers.includes("local_matter_import_policy"));
  assert.ok(!report.runtimeCutoverBlockers.includes("incident_advisory_preservation_policy"));

  const rendered = renderShadowAcceptanceReport(report).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB acceptance/);
  assert.match(rendered, /accepted: yes/);
  assert.match(rendered, /mode: read-only verify/);
  assert.match(rendered, /db:hydrate:verify: ok/);
  assert.match(rendered, /db:shadow:report: ok/);
  assert.match(rendered, /runtime_cutover_ready: no/);
  assert.match(rendered, /object_storage_or_single_host_volume_policy/);
  assert.match(rendered, /pdf_storage_backup_restore_policy/);
  assert.doesNotMatch(rendered, /local_matter_import_policy/);
  assert.doesNotMatch(rendered, /incident_advisory_preservation_policy/);
});

test("shadow DB acceptance removes the PDF storage blocker when storage backup evidence is current", async () => {
  const {
    buildShadowAcceptanceReport,
    renderShadowAcceptanceReport,
  } = await import(acceptancePath.href);

  const report = await buildShadowAcceptanceReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: no",
      "ready_to_hydrate: yes",
    ],
    runHydrationFn: () => ({
      mode: "verify",
      success: true,
      steps: [{ script: "db:shadow:report", ok: true }],
      failedStep: null,
    }),
    checkStorageBackupEvidenceFn: async () => ({
      accepted: true,
      manifest: "manifest.json",
      checkedObjects: 168,
      missingCurrentObjects: 0,
      hashMismatches: 0,
    }),
  });

  assert.equal(report.accepted, true);
  assert.equal(report.storageBackupEvidence.accepted, true);
  assert.ok(!report.runtimeCutoverBlockers.includes("pdf_storage_backup_restore_policy"));
  assert.ok(report.runtimeCutoverBlockers.includes("object_storage_or_single_host_volume_policy"));

  const rendered = renderShadowAcceptanceReport(report).join("\n");
  assert.match(rendered, /storage_backup_evidence: accepted/);
  assert.doesNotMatch(rendered, /pdf_storage_backup_restore_policy/);
});

test("shadow DB acceptance fails closed before verify when schema is not ready", async () => {
  const { buildShadowAcceptanceReport } = await import(acceptancePath.href);
  let verifyCalled = false;

  const report = await buildShadowAcceptanceReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: yes",
      "ready_to_hydrate: no",
      "next: Apply migrations with npm run db:migrate.",
    ],
    runHydrationFn: () => {
      verifyCalled = true;
      return { mode: "verify", success: true, steps: [], failedStep: null };
    },
    checkStorageBackupEvidenceFn: async () => ({ accepted: false }),
  });

  assert.equal(report.accepted, false);
  assert.equal(report.readyToApplyMigrations, true);
  assert.equal(report.readyToHydrateShadow, false);
  assert.equal(report.verifySuccess, false);
  assert.equal(verifyCalled, false);
  assert.match(report.next, /db:migrate/);
});

test("shadow DB acceptance redacts failed verify evidence", async () => {
  const {
    buildShadowAcceptanceReport,
    renderShadowAcceptanceReport,
  } = await import(acceptancePath.href);

  const report = await buildShadowAcceptanceReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "database_url_redacted: postgres://mwb_user:***@db.example/matter_workbench_shadow",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: no",
      "ready_to_hydrate: yes",
      "next: Run shadow hydration or report with MWB_DATABASE_URL set.",
    ],
    runHydrationFn: () => ({
      mode: "verify",
      success: false,
      steps: [
        { script: "db:doctor", ok: true },
        {
          script: "db:shadow:report",
          ok: false,
          stderr: "failed with postgres://mwb_user:secret@db.example/matter_workbench_shadow and OPENAI_API_KEY=sk-test",
        },
      ],
      failedStep: { script: "db:shadow:report" },
    }),
    checkStorageBackupEvidenceFn: async () => ({ accepted: false }),
  });

  const rendered = renderShadowAcceptanceReport(report).join("\n");
  assert.equal(report.accepted, false);
  assert.match(rendered, /accepted: no/);
  assert.match(rendered, /failed_verify_step: db:shadow:report/);
  assert.match(rendered, /postgres:\/\/mwb_user:\*\*\*@db\.example/);
  assert.match(rendered, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.doesNotMatch(rendered, /mwb_user:secret|sk-test|matter_workbench_shadow/);
});

test("package and docs expose the shadow DB acceptance command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:acceptance"], "node scripts/db-shadow-acceptance.mjs");

  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:shadow:acceptance/);
  assert.match(dbReadme, /read-only acceptance/i);
  assert.match(dbReadme, /runtime_cutover_ready/i);
  assert.match(dbReadme, /runtime-cutover blockers/i);

  const handoffDoc = await readFile(handoffDocPath, "utf8");
  assert.match(handoffDoc, /npm run db:shadow:acceptance/);
  assert.match(handoffDoc, /acceptance/i);
});
