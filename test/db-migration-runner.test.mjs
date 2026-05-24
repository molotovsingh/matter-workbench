import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerPath = new URL("../scripts/db-migrate.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

test("database migration runner discovers numbered SQL migrations", async () => {
  const {
    listMigrationFiles,
    migrationVersionFromFile,
  } = await import(runnerPath.href);

  const migrations = await listMigrationFiles();

  assert.deepEqual(
    migrations.map((migration) => migration.fileName),
    ["001_control_plane.sql", "002_tenant_rls.sql"],
  );
  assert.equal(migrationVersionFromFile("001_control_plane.sql"), "001_control_plane");
  assert.equal(migrationVersionFromFile("002_tenant_rls.sql"), "002_tenant_rls");
  assert.throws(() => migrationVersionFromFile("control_plane.sql"), /numbered migration/);
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
});
