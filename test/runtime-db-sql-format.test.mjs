import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicUuid,
  sqlInteger,
  sqlString,
  sqlTextArray,
  sqlUuid,
  sqlUuidOrNull,
  stringValue,
} from "../services/runtime-db-sql-format.mjs";

test("runtime DB SQL format helpers quote and clamp values deterministically", () => {
  assert.equal(sqlString("O'Reilly"), "'O''Reilly'");
  assert.equal(sqlTextArray(["alpha", "O'Reilly"]), "ARRAY['alpha', 'O''Reilly']::text[]");
  assert.equal(sqlInteger(12.9), "12");
  assert.equal(sqlInteger("bad"), "0");
  assert.equal(sqlUuid("11111111-1111-4111-8111-111111111111"), "'11111111-1111-4111-8111-111111111111'::uuid");
  assert.equal(sqlUuidOrNull(""), "null");
  assert.equal(stringValue("  ok  "), "ok");
  assert.match(deterministicUuid("runtime-db-test"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(deterministicUuid("runtime-db-test"), deterministicUuid("runtime-db-test"));
});
