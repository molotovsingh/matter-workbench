import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPrivateVmRuntimeDefaults,
  parseRuntimeServerArgs,
} from "../scripts/start-runtime-server.mjs";

test("private VM runtime server parser accepts host and port", () => {
  assert.deepEqual(parseRuntimeServerArgs(["--host", "127.0.0.1", "--port", "4199"], {}), {
    host: "127.0.0.1",
    port: 4199,
  });
});

test("private VM runtime server parser defaults to service host and port", () => {
  assert.deepEqual(parseRuntimeServerArgs([], {}), {
    host: "0.0.0.0",
    port: 4191,
  });
});

test("private VM runtime server parser rejects invalid ports", () => {
  assert.throws(() => parseRuntimeServerArgs(["--port", "99999"], {}), /integer from 1 to 65535/);
  assert.throws(() => parseRuntimeServerArgs(["--port"], {}), /requires a value/);
});

test("private VM runtime server applies explicit runtime DB defaults without overriding existing values", () => {
  const env = {
    MWB_RUNTIME_DB: "postgres",
    MWB_RUNTIME_DB_STORAGE: "postgres",
    MWB_DB_RUNTIME_CUTOVER_APPROVED: "custom",
  };
  applyPrivateVmRuntimeDefaults(env);
  assert.equal(env.MWB_RUNTIME_DB, "postgres");
  assert.equal(env.MWB_RUNTIME_DB_STORAGE, "postgres");
  assert.equal(env.MWB_DB_RUNTIME_CUTOVER_APPROVED, "custom");

  const blank = {};
  applyPrivateVmRuntimeDefaults(blank);
  assert.equal(blank.MWB_RUNTIME_DB, "postgres");
  assert.equal(blank.MWB_RUNTIME_DB_STORAGE, "postgres");
  assert.equal(blank.MWB_DB_RUNTIME_CUTOVER_APPROVED, "yes");
});

