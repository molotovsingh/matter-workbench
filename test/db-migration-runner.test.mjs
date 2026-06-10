import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const runnerPath = new URL("../scripts/db-migrate.mjs", import.meta.url);
const doctorPath = new URL("../scripts/db-doctor.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const transitionDocPath = new URL("../docs/future-design-decisions/react-only-cutover-database-transition.md", import.meta.url);

test("database migration runner discovers numbered SQL migrations", async () => {
  const {
    listMigrationFiles,
    migrationVersionFromFile,
  } = await import(runnerPath.href);

  const migrations = await listMigrationFiles();

  assert.deepEqual(
    migrations.map((migration) => migration.fileName),
    [
      "001_control_plane.sql",
      "002_tenant_rls.sql",
      "003_tenant_reference_integrity.sql",
      "004_user_membership_integrity.sql",
      "005_storage_object_lifecycle.sql",
      "006_job_execution_leases.sql",
      "007_local_matter_import_ledger.sql",
      "008_job_worker_functions.sql",
      "009_incident_helper_functions.sql",
      "010_advisory_snapshot_functions.sql",
      "011_custom_skill_lifecycle_functions.sql",
      "012_tenant_org_profile.sql",
      "013_hosted_auth_session_model.sql",
      "014_tenant_sessions_user_rls.sql",
      "015_storage_object_payloads.sql",
      "016_source_descriptors_storage_object_link.sql",
    ],
  );
  assert.equal(migrationVersionFromFile("001_control_plane.sql"), "001_control_plane");
  assert.equal(migrationVersionFromFile("002_tenant_rls.sql"), "002_tenant_rls");
  assert.equal(migrationVersionFromFile("003_tenant_reference_integrity.sql"), "003_tenant_reference_integrity");
  assert.equal(migrationVersionFromFile("004_user_membership_integrity.sql"), "004_user_membership_integrity");
  assert.equal(migrationVersionFromFile("005_storage_object_lifecycle.sql"), "005_storage_object_lifecycle");
  assert.equal(migrationVersionFromFile("006_job_execution_leases.sql"), "006_job_execution_leases");
  assert.equal(migrationVersionFromFile("007_local_matter_import_ledger.sql"), "007_local_matter_import_ledger");
  assert.equal(migrationVersionFromFile("008_job_worker_functions.sql"), "008_job_worker_functions");
  assert.equal(migrationVersionFromFile("009_incident_helper_functions.sql"), "009_incident_helper_functions");
  assert.equal(migrationVersionFromFile("010_advisory_snapshot_functions.sql"), "010_advisory_snapshot_functions");
  assert.equal(migrationVersionFromFile("011_custom_skill_lifecycle_functions.sql"), "011_custom_skill_lifecycle_functions");
  assert.equal(migrationVersionFromFile("012_tenant_org_profile.sql"), "012_tenant_org_profile");
  assert.equal(migrationVersionFromFile("013_hosted_auth_session_model.sql"), "013_hosted_auth_session_model");
  assert.equal(migrationVersionFromFile("014_tenant_sessions_user_rls.sql"), "014_tenant_sessions_user_rls");
  assert.equal(migrationVersionFromFile("015_storage_object_payloads.sql"), "015_storage_object_payloads");
  assert.equal(migrationVersionFromFile("016_source_descriptors_storage_object_link.sql"), "016_source_descriptors_storage_object_link");
  assert.throws(() => migrationVersionFromFile("control_plane.sql"), /numbered migration/);
});

test("database migration runner rejects missing migration numbers", async () => {
  const { listMigrationFiles } = await import(runnerPath.href);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mwb-migrations-"));

  try {
    await writeFile(path.join(tempDir, "001_control_plane.sql"), "select 1;\n");
    await writeFile(path.join(tempDir, "003_tenant_reference_integrity.sql"), "select 3;\n");

    await assert.rejects(
      () => listMigrationFiles({ migrationsDir: tempDir }),
      /Missing database migration number 002 before 003_tenant_reference_integrity\.sql/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("database migration runner builds idempotent schema_migrations SQL", async () => {
  const {
    buildSchemaMigrationsSql,
    buildMigrationApplySql,
    computeMigrationChecksum,
  } = await import(runnerPath.href);

  assert.match(buildSchemaMigrationsSql(), /create table if not exists schema_migrations/i);
  assert.match(buildSchemaMigrationsSql(), /checksum_sha256 text not null/i);

  const sql = buildMigrationApplySql({
    version: "001_control_plane",
    fileName: "001_control_plane.sql",
    sql: "select 1;",
    checksumSha256: computeMigrationChecksum("select 1;"),
  });

  assert.match(sql, /begin;/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /select 1;/i);
  assert.match(sql, /insert into schema_migrations \(version, file_name, checksum_sha256\)/i);
  assert.match(sql, /commit;/i);
});

test("database migration runner detects edited applied migrations", async () => {
  const {
    classifyMigrationStatus,
    computeMigrationChecksum,
    parseAppliedMigrationRows,
  } = await import(runnerPath.href);

  const checksum = computeMigrationChecksum("select 1;");
  const applied = parseAppliedMigrationRows(`001_control_plane\t${checksum}\n`);

  assert.equal(
    classifyMigrationStatus({
      migration: { version: "001_control_plane", checksumSha256: checksum },
      applied,
    }),
    "applied",
  );
  assert.equal(
    classifyMigrationStatus({
      migration: { version: "001_control_plane", checksumSha256: computeMigrationChecksum("select 2;") },
      applied,
    }),
    "checksum_mismatch",
  );
});

test("database migration runner parses safe CLI modes", async () => {
  const { parseArgs } = await import(runnerPath.href);

  assert.deepEqual(parseArgs(["--list"]), { mode: "list", databaseUrl: "" });
  assert.deepEqual(parseArgs(["--dry-run"]), { mode: "dry-run", databaseUrl: "" });
  assert.deepEqual(parseArgs(["--url", "postgres://example"]), { mode: "apply", databaseUrl: "postgres://example" });
  assert.throws(() => parseArgs(["--url"]), /requires a value/);
  assert.throws(() => parseArgs(["--wat"]), /Unknown option/);
});

test("package exposes database migration scripts", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:migrations:list"], "node scripts/db-migrate.mjs --list");
  assert.equal(pkg.scripts["db:migrations:check"], "node scripts/db-migrate.mjs --dry-run");
  assert.equal(pkg.scripts["db:migrate"], "node scripts/db-migrate.mjs");
  assert.equal(pkg.scripts["db:doctor"], "node scripts/db-doctor.mjs");
});

test("database doctor reports readiness without leaking connection secrets", async () => {
  const {
    buildDoctorReport,
    redactDatabaseUrl,
  } = await import(doctorPath.href);

  const redacted = redactDatabaseUrl("postgres://mw_user:secret_password@db.example.com:5432/mwb?sslmode=require");
  assert.equal(redacted, "postgres://mw_user:***@db.example.com:5432/mwb?sslmode=require");

  const report = buildDoctorReport({
    databaseUrl: "postgres://mw_user:secret_password@db.example.com:5432/mwb?sslmode=require",
    psql: { available: true, version: "psql (PostgreSQL) 16.9" },
    migrations: [
      { status: "pending", version: "001_control_plane", fileName: "001_control_plane.sql" },
      { status: "pending", version: "002_tenant_rls", fileName: "002_tenant_rls.sql" },
      { status: "pending", version: "003_tenant_reference_integrity", fileName: "003_tenant_reference_integrity.sql" },
      { status: "pending", version: "004_user_membership_integrity", fileName: "004_user_membership_integrity.sql" },
      { status: "pending", version: "005_storage_object_lifecycle", fileName: "005_storage_object_lifecycle.sql" },
      { status: "pending", version: "006_job_execution_leases", fileName: "006_job_execution_leases.sql" },
      { status: "pending", version: "007_local_matter_import_ledger", fileName: "007_local_matter_import_ledger.sql" },
      { status: "pending", version: "008_job_worker_functions", fileName: "008_job_worker_functions.sql" },
      { status: "pending", version: "009_incident_helper_functions", fileName: "009_incident_helper_functions.sql" },
      { status: "pending", version: "010_advisory_snapshot_functions", fileName: "010_advisory_snapshot_functions.sql" },
      { status: "pending", version: "011_custom_skill_lifecycle_functions", fileName: "011_custom_skill_lifecycle_functions.sql" },
      { status: "pending", version: "012_tenant_org_profile", fileName: "012_tenant_org_profile.sql" },
    ],
  }).join("\n");

  assert.match(report, /database_url: configured/);
  assert.match(report, /database_url_redacted: postgres:\/\/mw_user:\*\*\*@db\.example\.com:5432\/mwb\?sslmode=require/);
  assert.doesNotMatch(report, /secret_password/);
  assert.match(report, /psql: available/);
  assert.match(report, /psql_command: psql/);
  assert.match(report, /psql_source: unknown/);
  assert.match(report, /001_control_plane\s+pending\s+001_control_plane\.sql/);
  assert.match(report, /002_tenant_rls\s+pending\s+002_tenant_rls\.sql/);
  assert.match(report, /003_tenant_reference_integrity\s+pending\s+003_tenant_reference_integrity\.sql/);
  assert.match(report, /004_user_membership_integrity\s+pending\s+004_user_membership_integrity\.sql/);
  assert.match(report, /005_storage_object_lifecycle\s+pending\s+005_storage_object_lifecycle\.sql/);
  assert.match(report, /006_job_execution_leases\s+pending\s+006_job_execution_leases\.sql/);
  assert.match(report, /007_local_matter_import_ledger\s+pending\s+007_local_matter_import_ledger\.sql/);
  assert.match(report, /008_job_worker_functions\s+pending\s+008_job_worker_functions\.sql/);
  assert.match(report, /009_incident_helper_functions\s+pending\s+009_incident_helper_functions\.sql/);
  assert.match(report, /010_advisory_snapshot_functions\s+pending\s+010_advisory_snapshot_functions\.sql/);
  assert.match(report, /011_custom_skill_lifecycle_functions\s+pending\s+011_custom_skill_lifecycle_functions\.sql/);
  assert.match(report, /012_tenant_org_profile\s+pending\s+012_tenant_org_profile\.sql/);
  assert.match(report, /ready_to_apply: yes/);
});

test("database doctor uses the resolved psql command", async () => {
  const { detectPsql } = await import(doctorPath.href);
  const calls = [];

  const psql = detectPsql({
    env: {},
    resolve: () => ({ command: "/opt/homebrew/opt/libpq/bin/psql", source: "discovered" }),
    spawn: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "psql (PostgreSQL) 17.10\n", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    { command: "/opt/homebrew/opt/libpq/bin/psql", args: ["--version"] },
  ]);
  assert.equal(psql.available, true);
  assert.equal(psql.command, "/opt/homebrew/opt/libpq/bin/psql");
  assert.equal(psql.source, "discovered");
});

test("database migration runner uses the resolved psql command", async () => {
  const { runPsql } = await import(runnerPath.href);
  const calls = [];

  const stdout = runPsql({
    databaseUrl: "postgres://example",
    sql: "select 1;",
    env: { MWB_PSQL_BIN: "/custom/bin/psql" },
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, input: options.input, env: options.env });
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
  });

  assert.equal(stdout, "ok\n");
  assert.deepEqual(calls, [
    {
      command: "/custom/bin/psql",
      args: ["postgres://example", "-v", "ON_ERROR_STOP=1"],
      input: "select 1;",
      env: { MWB_PSQL_BIN: "/custom/bin/psql" },
    },
  ]);
});

test("database doctor reports hydration readiness when migrations are already applied", async () => {
  const { buildDoctorReport } = await import(doctorPath.href);

  const report = buildDoctorReport({
    databaseUrl: "postgres://mw_user:secret_password@db.example.com:5432/mwb",
    psql: { available: true, version: "psql (PostgreSQL) 16.9" },
    migrations: [
      { status: "applied", version: "001_control_plane", fileName: "001_control_plane.sql" },
      { status: "applied", version: "002_tenant_rls", fileName: "002_tenant_rls.sql" },
    ],
  }).join("\n");

  assert.match(report, /migration_summary: applied=2 pending=0 checksum_mismatch=0 unknown=0/);
  assert.match(report, /ready_to_apply: no/);
  assert.match(report, /ready_to_hydrate: yes/);
  assert.match(report, /next: Run shadow hydration or report with MWB_DATABASE_URL set\./);
  assert.doesNotMatch(report, /secret_password/);
});

test("database doctor stays read-only and clear when no database URL is configured", async () => {
  const { buildDoctorReport } = await import(doctorPath.href);

  const report = buildDoctorReport({
    databaseUrl: "",
    psql: { available: false, error: "psql not found" },
    migrations: [
      { status: "unknown", version: "001_control_plane", fileName: "001_control_plane.sql" },
    ],
  }).join("\n");

  assert.match(report, /database_url: missing/);
  assert.match(report, /psql: unavailable - psql not found/);
  assert.match(report, /001_control_plane\s+unknown\s+001_control_plane\.sql/);
  assert.match(report, /ready_to_apply: no/);
  assert.match(report, /next: Set MWB_DATABASE_URL or DATABASE_URL before applying migrations\./);
});

test("database doctor reports migration inventory errors without throwing", async () => {
  const { runDoctor } = await import(doctorPath.href);
  let callCount = 0;

  const lines = await runDoctor({
    argv: [],
    env: { MWB_DATABASE_URL: "postgres://mw_user:secret_password@db.example.com/mwb" },
    spawn: () => ({ status: 0, stdout: "psql (PostgreSQL) 16.9" }),
    plan: async ({ databaseUrl }) => {
      callCount += 1;
      if (databaseUrl) {
        throw new Error("psql failed: password=secret_password");
      }
      return [
        { status: "unknown", version: "001_control_plane", fileName: "001_control_plane.sql" },
      ];
    },
  });

  const report = lines.join("\n");
  assert.equal(callCount, 2);
  assert.match(report, /database_url: configured/);
  assert.match(report, /database_inspection: failed - psql failed: password=\*\*\*/);
  assert.doesNotMatch(report, /secret_password/);
  assert.match(report, /ready_to_apply: no/);
});

test("database transition docs expose the read-only doctor command", async () => {
  assert.match(await readFile(readmePath, "utf8"), /npm run db:doctor/);
  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:doctor/);
  assert.match(dbReadme, /ready_to_hydrate/);
  assert.match(dbReadme, /MWB_PSQL_BIN/);
  assert.match(await readFile(transitionDocPath, "utf8"), /npm run db:doctor/);
  assert.match(await readFile(transitionDocPath, "utf8"), /MWB_PSQL_BIN/);
});

test("database transition docs describe shadow snapshot freshness limits", async () => {
  const transitionDoc = await readFile(transitionDocPath, "utf8");

  assert.match(transitionDoc, /db:shadow:snapshot[\s\S]*one[- ]run evidence/i);
  assert.match(transitionDoc, /db:shadow:snapshot[\s\S]*not live truth/i);
  assert.match(transitionDoc, /db:shadow:snapshot[\s\S]*repo changes/i);
  assert.match(transitionDoc, /db:shadow:snapshot[\s\S]*local matter/i);
});

test("database transition docs list every preparatory migration", async () => {
  const docs = [
    await readFile(readmePath, "utf8"),
    await readFile(dbReadmePath, "utf8"),
    await readFile(transitionDocPath, "utf8"),
  ].join("\n");

  assert.match(docs, /001_control_plane\.sql/);
  assert.match(docs, /002_tenant_rls\.sql/);
  assert.match(docs, /003_tenant_reference_integrity\.sql/);
  assert.match(docs, /004_user_membership_integrity\.sql/);
  assert.match(docs, /005_storage_object_lifecycle\.sql/);
  assert.match(docs, /006_job_execution_leases\.sql/);
  assert.match(docs, /007_local_matter_import_ledger\.sql/);
  assert.match(docs, /008_job_worker_functions\.sql/);
  assert.match(docs, /009_incident_helper_functions\.sql/);
  assert.match(docs, /010_advisory_snapshot_functions\.sql/);
  assert.match(docs, /011_custom_skill_lifecycle_functions\.sql/);
  assert.match(docs, /012_tenant_org_profile\.sql/);
  assert.match(docs, /013_hosted_auth_session_model\.sql/);
  assert.match(docs, /014_tenant_sessions_user_rls\.sql/);
});
