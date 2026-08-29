import assert from "node:assert/strict";
import test from "node:test";

import {
  V4_DATABASE_NAME,
  V4_POOL_MAX,
  assertSafeV4DatabaseName,
  loadV4DatabaseOperatorConfig,
  postureFingerprint,
  redactV4DatabaseText,
} from "../scripts/v4-db-operator-config.mjs";

test("V4 DB config fixes the database and pool identities", () => {
  assert.equal(V4_DATABASE_NAME, "matter_workbench_v4");
  assert.equal(V4_POOL_MAX, 16);
  assert.equal(assertSafeV4DatabaseName("matter_workbench_v4"), "matter_workbench_v4");
  assert.throws(() => assertSafeV4DatabaseName("matter_workbench_runtime"), { code: "v4_db.database_invalid" });
});

test("operator config separates migration and runtime identities", () => {
  const config = loadV4DatabaseOperatorConfig({
    MWB_V4_ADMIN_URL: "postgresql://admin:admin-secret@localhost/postgres",
    MWB_V4_MIGRATION_URL: "postgresql://mwb_v4_migrator:migration-secret@localhost/matter_workbench_v4",
    MWB_V4_DB_URL: "postgresql://mwb_v4_runtime:runtime-secret@localhost/matter_workbench_v4",
    MWB_V4_MIGRATION_ROLE: "mwb_v4_migrator",
    MWB_V4_RUNTIME_ROLE: "mwb_v4_runtime",
    MWB_V4_DB_POOL_MAX: "16",
    MWB_V4_AUTO_MIGRATE: "0",
  });
  assert.equal(config.databaseName, V4_DATABASE_NAME);
  assert.equal(config.migrationRole, "mwb_v4_migrator");
  assert.equal(config.runtimeRole, "mwb_v4_runtime");
  assert.equal(config.poolMaximum, 16);
  assert.equal(config.autoMigrate, false);
  assert.notEqual(config.migrationUrl, config.runtimeUrl);
});

test("operator config fails closed on unsafe role, URL and runtime posture", () => {
  const good = {
    MWB_V4_ADMIN_URL: "postgresql://admin:x@localhost/postgres",
    MWB_V4_MIGRATION_URL: "postgresql://mwb_v4_migrator:x@localhost/matter_workbench_v4",
    MWB_V4_DB_URL: "postgresql://mwb_v4_runtime:x@localhost/matter_workbench_v4",
    MWB_V4_MIGRATION_ROLE: "mwb_v4_migrator",
    MWB_V4_RUNTIME_ROLE: "mwb_v4_runtime",
    MWB_V4_DB_POOL_MAX: "16",
    MWB_V4_AUTO_MIGRATE: "0",
  };
  assert.throws(() => loadV4DatabaseOperatorConfig({ ...good, MWB_V4_RUNTIME_ROLE: "BAD ROLE" }), { code: "v4_db.role_invalid" });
  assert.throws(() => loadV4DatabaseOperatorConfig({ ...good, MWB_V4_DB_URL: "postgresql://u:x@localhost/matter_workbench_runtime" }), { code: "v4_db.database_invalid" });
  assert.throws(() => loadV4DatabaseOperatorConfig({ ...good, MWB_V4_DB_POOL_MAX: "17" }), { code: "v4_db.pool_max_invalid" });
  assert.throws(() => loadV4DatabaseOperatorConfig({ ...good, MWB_V4_AUTO_MIGRATE: "1" }), { code: "v4_db.auto_migrate_invalid" });
  assert.throws(() => loadV4DatabaseOperatorConfig({ ...good, MWB_V4_MIGRATION_ROLE: "mwb_v4_runtime" }), { code: "v4_db.identities_not_distinct" });
});

test("redaction removes database credentials without hiding non-secret names", () => {
  const input = "postgresql://mwb_v4_runtime:secret-value@db.example/matter_workbench_v4 token=abc password=hunter2";
  const redacted = redactV4DatabaseText(input);
  assert.doesNotMatch(redacted, /secret-value|abc|hunter2/);
  assert.match(redacted, /matter_workbench_v4/);
});

test("posture fingerprint is stable and excludes evidence paths and timestamps", () => {
  const base = {
    databaseName: V4_DATABASE_NAME,
    databaseHost: "beta-postgres",
    migrationRole: "mwb_v4_migrator",
    runtimeRole: "mwb_v4_runtime",
    poolMaximum: 16,
    autoMigrate: false,
    migrations: [{ name: "001_control_plane.sql", sha256: "a".repeat(64) }],
    backupPolicy: "private-vm-recoverability-pack/v1",
  };
  const first = postureFingerprint({ ...base, generatedAt: "yesterday", evidencePath: "/a" });
  const second = postureFingerprint({ ...base, generatedAt: "today", evidencePath: "/b" });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, postureFingerprint({ ...base, poolMaximum: 15 }));
});
