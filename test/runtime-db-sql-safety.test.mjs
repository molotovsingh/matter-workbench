import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureRuntimeDbSafeRoleSql,
  wrapRuntimeDbWriteTransaction,
} from "../services/runtime-db-sql-safety.mjs";

test("runtime DB safe-role helper prepends guard to ordinary SQL", () => {
  const sql = ensureRuntimeDbSafeRoleSql("select 1;");
  assert.match(sql, /pg_roles/);
  assert.match(sql, /rolsuper or rolbypassrls/);
  assert.ok(sql.indexOf("pg_roles") < sql.indexOf("select 1;"));
});

test("runtime DB safe-role helper also guards already-transactional SQL", () => {
  const sql = ensureRuntimeDbSafeRoleSql("begin;\nselect 1;\ncommit;");
  assert.match(sql, /pg_roles/);
  assert.ok(sql.indexOf("pg_roles") < sql.indexOf("begin;"));
});

test("runtime DB write wrapper places guard inside the transaction", () => {
  const sql = wrapRuntimeDbWriteTransaction("select 1;");
  assert.match(sql, /^begin;\n/);
  assert.ok(sql.indexOf("begin;") < sql.indexOf("pg_roles"));
  assert.ok(sql.indexOf("pg_roles") < sql.indexOf("select 1;"));
  assert.ok(sql.indexOf("select 1;") < sql.indexOf("commit;"));
});

test("runtime DB safe-role helper does not duplicate an existing guard", () => {
  const wrapped = wrapRuntimeDbWriteTransaction("select 1;");
  const sql = ensureRuntimeDbSafeRoleSql(wrapped);
  assert.equal(sql.match(/mwb_runtime_role_guard/g)?.length, 2);
});
