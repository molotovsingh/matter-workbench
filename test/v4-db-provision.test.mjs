import assert from "node:assert/strict";
import test from "node:test";

import { assertProvisionState, assertV4FlagOff, buildV4RoleSql } from "../scripts/v4-db-provision.mjs";

const config = {
  databaseName: "matter_workbench_v4",
  migrationRole: "mwb_v4_migrator",
  runtimeRole: "mwb_v4_runtime",
  migrationUrl: "postgresql://mwb_v4_migrator:migrate@localhost/matter_workbench_v4",
  runtimeUrl: "postgresql://mwb_v4_runtime:runtime@localhost/matter_workbench_v4",
  poolMaximum: 16,
};

test("provision refuses to run with V4 enabled", () => {
  assert.doesNotThrow(() => assertV4FlagOff({ MWB_V4_INTAKE: "0" }));
  assert.throws(() => assertV4FlagOff({ MWB_V4_INTAKE: "1" }), { code: "v4_db.flag_must_be_off" });
});

test("role SQL creates distinct least-privileged identities and a 16-connection runtime role", () => {
  const sql = buildV4RoleSql(config);
  assert.match(sql.migration, /nosuperuser nocreatedb nocreaterole noinherit nobypassrls/i);
  assert.match(sql.runtime, /nosuperuser nocreatedb nocreaterole noinherit nobypassrls/i);
  assert.match(sql.runtime, /connection limit 16/i);
  assert.doesNotMatch(sql.runtime, /migration|admin/i);
});

test("correct existing state verifies idempotently", () => {
  const state = {
    database: { name: config.databaseName, owner: config.migrationRole },
    migrationRole: { name: config.migrationRole, superuser: false, createDatabase: false, createRole: false, inherit: false, bypassRls: false },
    runtimeRole: { name: config.runtimeRole, superuser: false, createDatabase: false, createRole: false, inherit: false, bypassRls: false, connectionLimit: 16 },
  };
  assert.equal(assertProvisionState(state, config), true);
});

test("ownership and role drift fail rather than being repaired", () => {
  const good = {
    database: { name: config.databaseName, owner: config.migrationRole },
    migrationRole: { name: config.migrationRole, superuser: false, createDatabase: false, createRole: false, inherit: false, bypassRls: false },
    runtimeRole: { name: config.runtimeRole, superuser: false, createDatabase: false, createRole: false, inherit: false, bypassRls: false, connectionLimit: 16 },
  };
  assert.throws(() => assertProvisionState({ ...good, database: { ...good.database, owner: "wrong" } }, config), { code: "v4_db.owner_conflict" });
  assert.throws(() => assertProvisionState({ ...good, runtimeRole: { ...good.runtimeRole, bypassRls: true } }, config), { code: "v4_db.role_conflict" });
  assert.throws(() => assertProvisionState({ ...good, runtimeRole: { ...good.runtimeRole, connectionLimit: 17 } }, config), { code: "v4_db.role_conflict" });
});
