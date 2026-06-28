import test from "node:test";
import assert from "node:assert/strict";

import {
  createRuntimeDbMatterIndex,
  defaultRuntimeDbTenantId,
  isRuntimeDbModeEnabled,
  isRuntimeDbStorageModeEnabled,
} from "../services/runtime-db-matter-index.mjs";

test("runtime DB matter index is disabled unless explicitly requested", () => {
  assert.equal(isRuntimeDbModeEnabled({}), false);
  assert.equal(isRuntimeDbModeEnabled({ MWB_RUNTIME_DB: "filesystem" }), false);
  assert.equal(isRuntimeDbModeEnabled({ MWB_RUNTIME_DB: "postgres" }), true);
  assert.equal(isRuntimeDbStorageModeEnabled({}), false);
  assert.equal(isRuntimeDbStorageModeEnabled({ MWB_RUNTIME_DB_STORAGE: "postgres" }), true);

  const index = createRuntimeDbMatterIndex({ env: {} });
  assert.equal(index.enabled, false);
  assert.equal(index.storageMode, "local-filesystem");
});

test("runtime DB matter index fails closed without cutover approval", () => {
  assert.throws(
    () => createRuntimeDbMatterIndex({
      env: {
        MWB_RUNTIME_DB: "postgres",
        MWB_DATABASE_URL: "postgres://runtime:secret@example.test/mwb",
      },
    }),
    /MWB_DB_RUNTIME_CUTOVER_APPROVED/,
  );
});

test("runtime DB matter index fails closed without database URL", () => {
  assert.throws(
    () => createRuntimeDbMatterIndex({
      env: {
        MWB_RUNTIME_DB: "postgres",
        MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      },
    }),
    /MWB_DATABASE_URL/,
  );
});

test("runtime DB matter index lists active matter folders from Postgres JSON", async () => {
  const calls = [];
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
      MWB_RUNTIME_DB_STORAGE: "postgres",
    },
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input, env: options.env });
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            id: "matter-1",
            name: "Atlas Folder",
            matterName: "Atlas Construction vs Diptishree",
            clientName: "Diptishree",
          },
        ]),
        stderr: "",
      };
    },
  });

  assert.equal(index.enabled, true);
  assert.equal(index.storageMode, "postgres");
  assert.deepEqual(await index.listMatterFolders(), [
    {
      id: "matter-1",
      name: "Atlas Folder",
      matterName: "Atlas Construction vs Diptishree",
      clientName: "Diptishree",
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
    },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].input, /pg_roles/i);
  assert.match(calls[0].input, /rolsuper/i);
  assert.match(calls[0].input, /rolbypassrls/i);
  assert.match(calls[0].input, /current_user/i);
  assert.match(calls[0].input, /set_config\('app\.tenant_id'/);
  assert.match(calls[0].input, new RegExp(defaultRuntimeDbTenantId()));
  assert.match(calls[0].input, /from matters m/i);
  assert.match(calls[0].input, /matter_import_batches/i);
  assert.equal(calls[0].env.PGPASSWORD, "secret");
});

test("runtime DB matter index prefers a dedicated runtime database URL", async () => {
  const calls = [];
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://admin:admin-secret@db.example/mwb",
      MWB_RUNTIME_DATABASE_URL: "postgres://runtime:runtime-secret@db.example/mwb",
    },
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input, env: options.env });
      return { status: 0, stdout: "[]", stderr: "" };
    },
  });

  assert.equal(index.enabled, true);
  assert.equal(index.databaseUrlRedacted, "postgres://runtime:***@db.example/mwb");
  assert.deepEqual(await index.listMatterFolders(), []);
  assert.ok(calls[0].args.includes("-U"));
  assert.equal(calls[0].args[calls[0].args.indexOf("-U") + 1], "runtime");
  assert.equal(calls[0].env.PGPASSWORD, "runtime-secret");
});

test("runtime DB matter index can resolve by legal matter name or local folder name", async () => {
  const calls = [];
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
      MWB_RUNTIME_DB_TENANT_ID: "11111111-1111-4111-8111-111111111111",
    },
    spawn: (command, args, options) => {
      calls.push(options.input);
      return {
        status: 0,
        stdout: JSON.stringify([{
          id: "matter-2",
          name: "Roma Folder",
          matterName: "Taori Vs Roma Builders",
        }]),
        stderr: "",
      };
    },
  });

  assert.deepEqual(await index.findMatterFolder("Taori Vs Roma Builders"), {
    id: "matter-2",
    name: "Roma Folder",
    matterName: "Taori Vs Roma Builders",
    clientName: "",
    oppositeParty: "",
    matterType: "",
    jurisdiction: "",
  });
  assert.match(calls[0], /m\.name = 'Taori Vs Roma Builders'/);
  assert.match(calls[0], /source_root_hint = 'Taori Vs Roma Builders'/);
  assert.match(calls[0], /11111111-1111-4111-8111-111111111111/);
});

test("runtime DB matter index redacts database credentials from query failures", async () => {
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:top-secret@db.example/mwb",
    },
    spawn: () => ({
      status: 1,
      stdout: "",
      stderr: "connection failed for postgres://runtime:top-secret@db.example/mwb",
    }),
  });

  await assert.rejects(
    () => index.listMatterFolders(),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.matter_index.query_failed");
      assert.match(error.message, /runtime DB query failed/);
      assert.doesNotMatch(error.message, /top-secret/);
      assert.match(error.message, /\*\*\*/);
      return true;
    },
  );
});

test("runtime DB matter index fails closed on malformed Postgres JSON", async () => {
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
    },
    spawn: () => ({
      status: 0,
      stdout: "not-json",
      stderr: "",
    }),
  });

  await assert.rejects(
    () => index.listMatterFolders(),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.matter_index.no_json");
      assert.match(error.message, /runtime DB query returned no matter JSON/);
      return true;
    },
  );
});

test("runtime DB matter index exposes stable code on invalid Postgres JSON", async () => {
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
    },
    spawn: () => ({
      status: 0,
      stdout: "[not-json]",
      stderr: "",
    }),
  });

  await assert.rejects(
    () => index.listMatterFolders(),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.matter_index.invalid_json");
      assert.match(error.message, /runtime DB query returned invalid matter JSON/);
      return true;
    },
  );
});

test("runtime DB matter index can archive and reopen matters without delete SQL", async () => {
  const calls = [];
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
      MWB_RUNTIME_DB_STORAGE: "postgres",
    },
    spawn: (command, args, options) => {
      calls.push(options.input);
      if (/\n\s*status = 'active',/i.test(options.input) && /from candidate/i.test(options.input)) {
        return {
          status: 0,
          stdout: JSON.stringify([{
            id: "matter-archive-1",
            name: "Closed Folder",
            matterName: "Closed Client Matter",
            status: "active",
            archivedAt: "",
          }]),
          stderr: "",
        };
      }
      if (/\n\s*status = 'archived',/i.test(options.input)) {
        return {
          status: 0,
          stdout: JSON.stringify([{
            id: "matter-archive-1",
            name: "Closed Folder",
            matterName: "Closed Client Matter",
            status: "archived",
            archivedAt: "2026-06-27 10:00:00+00",
            archiveReason: "Client paused instructions",
          }]),
          stderr: "",
        };
      }
      if (/status = 'active'/i.test(options.input) && /from candidate/i.test(options.input)) {
        return {
          status: 0,
          stdout: JSON.stringify([{
            id: "matter-archive-1",
            name: "Closed Folder",
            matterName: "Closed Client Matter",
            status: "active",
            archivedAt: "",
          }]),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    },
  });

  assert.deepEqual(await index.archiveMatter("Closed Client Matter", { reason: "Client paused instructions" }), {
    id: "matter-archive-1",
    name: "Closed Folder",
    matterName: "Closed Client Matter",
    clientName: "",
    oppositeParty: "",
    matterType: "",
    jurisdiction: "",
    status: "archived",
    archivedAt: "2026-06-27 10:00:00+00",
    archiveReason: "Client paused instructions",
  });
  assert.deepEqual(await index.reopenMatter("Closed Client Matter"), {
    id: "matter-archive-1",
    name: "Closed Folder",
    matterName: "Closed Client Matter",
    clientName: "",
    oppositeParty: "",
    matterType: "",
    jurisdiction: "",
  });

  assert.match(calls[0], /update matters m/i);
  assert.match(calls[0], /status = 'archived'/i);
  assert.match(calls[0], /archived_at = now\(\)/i);
  assert.match(calls[0], /archive_reason = 'Client paused instructions'/i);
  assert.match(calls[0], /reopened_at = null/i);
  assert.match(calls[0], /order by lower\(coalesce\(nullif\(latest_import\.source_root_hint, ''\), m\.name\)\)/i);
  assert.doesNotMatch(calls[0], /lower\(folder_name\)/i);
  assert.doesNotMatch(calls[0], /delete\s+from/i);
  assert.match(calls[1], /update matters m/i);
  assert.match(calls[1], /status = 'active'/i);
  assert.match(calls[1], /archived_at = null/i);
  assert.match(calls[1], /archive_reason = null/i);
  assert.match(calls[1], /reopened_at = now\(\)/i);
  assert.doesNotMatch(calls[1], /delete\s+from/i);
});

test("runtime DB matter index lists archived matters only when requested", async () => {
  const calls = [];
  const index = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
    },
    spawn: (command, args, options) => {
      calls.push(options.input);
      return {
        status: 0,
        stdout: JSON.stringify([{
          id: "matter-archived",
          name: "Archived Folder",
          matterName: "Archived Client Matter",
          status: "archived",
          archivedAt: "2026-06-27 10:00:00+00",
        }]),
        stderr: "",
      };
    },
  });

  assert.deepEqual(await index.listMatterFolders({ includeArchived: true }), [{
    id: "matter-archived",
    name: "Archived Folder",
    matterName: "Archived Client Matter",
    clientName: "",
    oppositeParty: "",
    matterType: "",
    jurisdiction: "",
    status: "archived",
    archivedAt: "2026-06-27 10:00:00+00",
  }]);
  assert.match(calls[0], /m\.status in \('active', 'archived'\)/i);
});
