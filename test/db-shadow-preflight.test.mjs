import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preflightPath = new URL("../scripts/db-shadow-preflight.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);

test("shadow DB preflight reports dry-run success while waiting for database URL", async () => {
  const {
    buildShadowPreflightReport,
    renderShadowPreflightReport,
  } = await import(preflightPath.href);

  const report = await buildShadowPreflightReport({
    runDoctorFn: async () => [
      "Matter Workbench database doctor",
      "database_url: missing",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: no",
      "ready_to_hydrate: no",
      "next: Set MWB_DATABASE_URL or DATABASE_URL before applying migrations.",
    ],
    runHydrationFn: () => ({
      mode: "dry-run",
      success: true,
      steps: [
        { script: "db:hydrate:dry-run", ok: true },
        { script: "db:skills:hydrate:dry-run", ok: true },
      ],
      failedStep: null,
    }),
  });

  assert.equal(report.databaseUrl, "missing");
  assert.equal(report.psql, "available");
  assert.equal(report.dryRunSuccess, true);
  assert.equal(report.readyToApplyMigrations, false);
  assert.equal(report.readyToHydrateShadow, false);
  assert.match(report.next, /Set MWB_DATABASE_URL/);

  const rendered = renderShadowPreflightReport(report).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB preflight/);
  assert.match(rendered, /mode: read-only/);
  assert.match(rendered, /database_url: missing/);
  assert.match(rendered, /psql: available/);
  assert.match(rendered, /dry_run_success: yes/);
  assert.match(rendered, /ready_to_apply_migrations: no/);
  assert.match(rendered, /ready_to_hydrate_shadow: no/);
  assert.match(rendered, /next: Set MWB_DATABASE_URL/);
});

test("shadow DB preflight reports migration apply as next action when schema has pending migrations", async () => {
  const { buildShadowPreflightReport } = await import(preflightPath.href);

  const report = await buildShadowPreflightReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: yes",
      "ready_to_hydrate: no",
      "next: Apply with MWB_DATABASE_URL set and npm run db:migrate.",
    ],
    runHydrationFn: () => ({
      mode: "dry-run",
      success: true,
      steps: [{ script: "db:hydrate:dry-run", ok: true }],
      failedStep: null,
    }),
  });

  assert.equal(report.databaseUrl, "configured");
  assert.equal(report.readyToApplyMigrations, true);
  assert.equal(report.readyToHydrateShadow, false);
  assert.match(report.next, /db:migrate/);
});

test("shadow DB preflight reports hydration readiness when migrations are already applied", async () => {
  const {
    buildShadowPreflightReport,
    renderShadowPreflightReport,
  } = await import(preflightPath.href);

  const report = await buildShadowPreflightReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: no",
      "ready_to_hydrate: yes",
      "next: Run shadow hydration or report with MWB_DATABASE_URL set.",
    ],
    runHydrationFn: () => ({
      mode: "dry-run",
      success: true,
      steps: [{ script: "db:hydrate:dry-run", ok: true }],
      failedStep: null,
    }),
  });

  assert.equal(report.readyToApplyMigrations, false);
  assert.equal(report.readyToHydrateShadow, true);
  assert.match(report.next, /shadow hydration/);

  const rendered = renderShadowPreflightReport(report).join("\n");
  assert.match(rendered, /ready_to_hydrate_shadow: yes/);
  assert.match(rendered, /dry_run_steps:/);
  assert.match(rendered, /db:hydrate:dry-run: ok/);
});

test("shadow DB preflight preserves redacted dry-run failure evidence", async () => {
  const {
    buildShadowPreflightReport,
    renderShadowPreflightReport,
  } = await import(preflightPath.href);

  const report = await buildShadowPreflightReport({
    runDoctorFn: async () => [
      "database_url: configured",
      "database_url_redacted: postgres://mwb_user:***@db.example/matter_workbench_shadow",
      "psql: available - psql (PostgreSQL) 18.4",
      "ready_to_apply: no",
      "ready_to_hydrate: yes",
      "next: Run shadow hydration or report with MWB_DATABASE_URL set.",
    ],
    runHydrationFn: () => ({
      mode: "dry-run",
      success: false,
      steps: [
        { script: "db:hydrate:dry-run", ok: true },
        {
          script: "db:skills:hydrate:dry-run",
          ok: false,
          stderr: "failed with postgres://mwb_user:secret@db.example/matter_workbench_shadow and OPENAI_API_KEY=sk-test",
        },
      ],
      failedStep: { script: "db:skills:hydrate:dry-run" },
    }),
  });

  assert.equal(report.dryRunSuccess, false);
  assert.equal(report.failedDryRunStep, "db:skills:hydrate:dry-run");

  const rendered = renderShadowPreflightReport(report).join("\n");
  assert.match(rendered, /dry_run_success: no/);
  assert.match(rendered, /failed_dry_run_step: db:skills:hydrate:dry-run/);
  assert.match(rendered, /postgres:\/\/mwb_user:\*\*\*@db\.example/);
  assert.match(rendered, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.doesNotMatch(rendered, /mwb_user:secret|sk-test|matter_workbench_shadow/);
});

test("package and database docs expose the shadow DB preflight command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:preflight"], "node scripts/db-shadow-preflight.mjs");

  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:shadow:preflight/);
  assert.match(dbReadme, /one-command read-only readiness check/i);

  const handoffDoc = await readFile(handoffDocPath, "utf8");
  assert.match(handoffDoc, /npm run db:shadow:preflight/);
  assert.match(handoffDoc, /waiting for database URL/i);
});
