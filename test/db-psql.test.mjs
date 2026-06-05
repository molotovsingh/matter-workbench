import assert from "node:assert/strict";
import test from "node:test";

const psqlPath = new URL("../scripts/db-psql.mjs", import.meta.url);

test("psql resolver honors explicit MWB_PSQL_BIN before discovered paths", async () => {
  const { resolvePsqlCommand } = await import(psqlPath.href);

  assert.deepEqual(
    resolvePsqlCommand({
      env: { MWB_PSQL_BIN: "/custom/bin/psql" },
      exists: () => true,
    }),
    { command: "/custom/bin/psql", source: "MWB_PSQL_BIN" },
  );
});

test("psql resolver discovers Homebrew libpq when psql is not on PATH", async () => {
  const { resolvePsqlCommand } = await import(psqlPath.href);

  assert.deepEqual(
    resolvePsqlCommand({
      env: {},
      exists: (candidate) => candidate === "/opt/homebrew/opt/libpq/bin/psql",
    }),
    { command: "/opt/homebrew/opt/libpq/bin/psql", source: "discovered" },
  );
});

test("psql resolver falls back to PATH command", async () => {
  const { resolvePsqlCommand } = await import(psqlPath.href);

  assert.deepEqual(
    resolvePsqlCommand({
      env: {},
      exists: () => false,
    }),
    { command: "psql", source: "PATH" },
  );
});

test("psql connection args split credentials into environment variables", async () => {
  const { psqlConnectionArgs } = await import(psqlPath.href);

  assert.deepEqual(
    psqlConnectionArgs("postgres://mwb_user:pw%21@db.example:5432/matter_workbench_shadow", {
      env: { MWB_PSQL_BIN: "/custom/bin/psql" },
    }),
    {
      command: "/custom/bin/psql",
      source: "MWB_PSQL_BIN",
      args: [
        "-h",
        "db.example",
        "-p",
        "5432",
        "-U",
        "mwb_user",
        "-d",
        "matter_workbench_shadow",
      ],
      env: { PGPASSWORD: "pw!" },
    },
  );
});
