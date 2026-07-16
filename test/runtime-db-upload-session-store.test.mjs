import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeDbUploadSessionStore,
  normalizeUploadMetadata,
  normalizeUploadSessionRow,
} from "../services/runtime-db-upload-session-store.mjs";

test("runtime DB upload session store owns session and item reads", async () => {
  const queries = [];
  const client = {
    async query(text, values = []) {
      const sql = String(text);
      queries.push({ sql, values });
      if (/from upload_sessions us/i.test(sql)) {
        return { rows: [{
          id: "session-1",
          status: "uploaded",
          action: "add_files",
          matter_name: "Matter A",
          expected_file_count: "1",
          received_file_count: "1",
          expected_bytes: "5",
          received_bytes: "5",
          matter: { id: "matter-1", name: "Matter A" },
        }] };
      }
      if (/from upload_session_items/i.test(sql)) {
        return { rows: [{
          id: "item-1",
          file_index: "0",
          relative_path: "00_Inbox/source.txt",
          original_name: "source.txt",
          received_size_bytes: "5",
          status: "uploaded",
        }] };
      }
      return { rows: [] };
    },
  };
  const store = createRuntimeDbUploadSessionStore({
    tenantId: "tenant-1",
    withRuntimeDbClient: async (operation) => operation(client),
    queryJson: () => ({}),
    normalizeMatter: (matter) => ({ id: matter.id, name: matter.name, normalized: true }),
  });

  const session = await store.readUploadSession("session-1");

  assert.equal(session.id, "session-1");
  assert.equal(session.items[0].relativePath, "00_Inbox/source.txt");
  assert.deepEqual(session.matter, { id: "matter-1", name: "Matter A", normalized: true });
  assert.match(queries[0].sql, /from upload_sessions us/i);
  assert.match(queries[1].sql, /null::bytea as payload/i);
});

test("runtime DB upload session normalization preserves the existing public shape", () => {
  assert.deepEqual(normalizeUploadMetadata({
    clientName: "  Acme\nLtd  ",
    custom_1: 42,
    invalid$key: "drop",
    nested: { drop: true },
  }), {
    clientName: "Acme Ltd",
    custom_1: "42",
  });

  assert.deepEqual(normalizeUploadSessionRow({
    id: "session-1",
    status: "pending",
    expected_file_count: "2",
    received_file_count: "1",
    expected_bytes: "10",
    received_bytes: "5",
    metadata_json: '{"custom":"value"}',
    created_at: "2026-07-11T00:00:00.000Z",
  }), {
    id: "session-1",
    matterId: "",
    intakeId: "",
    idempotencyKey: "",
    status: "pending",
    action: "create_matter",
    matterName: "",
    label: "",
    metadata: { custom: "value" },
    expectedFileCount: 2,
    expectedBytes: 10,
    receivedFileCount: 1,
    receivedBytes: 5,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "",
    finishedAt: "",
    committedAt: "",
    errorCode: "",
    errorMessage: "",
    matter: null,
    items: [],
  });
});
