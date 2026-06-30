import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";

test("runtime DB upload sessions are created before file bytes and track file receipt", async () => {
  const db = createFakeUploadSessionDb();
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    createPgClient: async () => fakePgClient(db),
  });

  const created = await service.createUploadSession({
    action: "create_matter",
    name: "Durable Intake Matter",
    metadata: { clientName: "Client A" },
    expectedFileCount: 2,
    expectedBytes: 11,
    idempotencyKey: "test-session-1",
  });

  assert.equal(created.status, "pending");
  assert.equal(created.action, "create_matter");
  assert.equal(created.matterName, "Durable Intake Matter");
  assert.equal(created.expectedFileCount, 2);
  assert.equal(created.items.length, 0);

  const first = await service.appendUploadSessionFiles({
    sessionId: created.id,
    files: [{ index: 0, filename: "a.txt", bytes: Buffer.from("hello") }],
    relativePaths: ["a.txt"],
    fileIndexes: [0],
  });

  assert.equal(first.status, "uploading");
  assert.equal(first.receivedFileCount, 1);
  assert.equal(first.items[0].relativePath, "a.txt");
  assert.equal(first.items[0].status, "uploaded");

  const second = await service.appendUploadSessionFiles({
    sessionId: created.id,
    files: [{ index: 0, filename: "b.txt", bytes: Buffer.from("world!") }],
    relativePaths: ["b.txt"],
    fileIndexes: [1],
  });

  assert.equal(second.status, "uploaded");
  assert.equal(second.receivedFileCount, 2);
  assert.equal(second.receivedBytes, 11);
  assert.deepEqual(second.items.map((item) => item.relativePath), ["a.txt", "b.txt"]);
});

test("runtime DB upload sessions can be cancelled and staged payloads are cleared", async () => {
  const db = createFakeUploadSessionDb();
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    createPgClient: async () => fakePgClient(db),
  });

  const created = await service.createUploadSession({
    action: "create_matter",
    name: "Cancelled Intake Matter",
    expectedFileCount: 1,
    idempotencyKey: "test-session-cancel",
  });
  await service.appendUploadSessionFiles({
    sessionId: created.id,
    files: [{ index: 0, filename: "a.txt", bytes: Buffer.from("hello") }],
    relativePaths: ["a.txt"],
    fileIndexes: [0],
  });

  const cancelled = await service.cancelUploadSession(created.id);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.items[0].status, "cancelled");
  assert.equal(cancelled.items[0].payload, null);
  assert.equal(db.items.get(created.id)[0].payload, null);
});

function createFakeUploadSessionDb() {
  return {
    nextSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sessions: new Map(),
    items: new Map(),
  };
}

function fakePgClient(db) {
  return {
    async connect() {},
    async end() {},
    async query(sql, values = []) {
      const text = String(sql || "");
      if (/^begin\b/i.test(text) || /^commit\b/i.test(text) || /^rollback\b/i.test(text) || /mwb_runtime_role_guard/i.test(text) || /set_config\('app\.tenant_id'/i.test(text)) {
        return { rows: [] };
      }
      if (/select id from matters/i.test(text)) return { rows: [] };
      if (/insert into upload_sessions/i.test(text)) {
        const row = {
          id: db.nextSessionId,
          matter_id: null,
          intake_id: null,
          idempotency_key: values[0],
          status: "pending",
          expected_file_count: values[2],
          action: "create_matter",
          matter_name: values[3],
          label: "",
          metadata_json: JSON.parse(values[4]),
          expected_bytes: String(values[5]),
          received_file_count: 0,
          received_bytes: "0",
          created_at: new Date("2026-06-30T00:00:00Z"),
          updated_at: new Date("2026-06-30T00:00:00Z"),
          finished_at: null,
          committed_at: null,
          error_code: null,
          error_message: null,
          matter: null,
        };
        db.sessions.set(row.id, row);
        return { rows: [row] };
      }
      if (/from upload_sessions us/i.test(text)) {
        const row = db.sessions.get(values[0]);
        return { rows: row ? [row] : [] };
      }
      if (/from upload_session_items/i.test(text) && /order by file_index/i.test(text)) {
        const rows = [...(db.items.get(values[0]) || [])].sort((a, b) => a.file_index - b.file_index);
        return { rows };
      }
      if (/insert into upload_session_items/i.test(text)) {
        const [sessionId, fileIndex, relativePath, originalName, mimeType, expectedSizeBytes, receivedSizeBytes, sha256, payload] = values;
        const rows = db.items.get(sessionId) || [];
        const existingIndex = rows.findIndex((row) => row.file_index === fileIndex);
        const row = {
          id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(fileIndex).padStart(12, "0")}`,
          file_index: fileIndex,
          relative_path: relativePath,
          original_name: originalName,
          mime_type: mimeType,
          expected_size_bytes: String(expectedSizeBytes),
          received_size_bytes: String(receivedSizeBytes),
          sha256,
          payload,
          status: "uploaded",
          error_code: null,
          error_message: null,
          created_at: new Date("2026-06-30T00:00:01Z"),
          updated_at: new Date("2026-06-30T00:00:01Z"),
        };
        if (existingIndex >= 0) rows[existingIndex] = row;
        else rows.push(row);
        db.items.set(sessionId, rows);
        return { rows: [] };
      }
      if (/update upload_sessions us/i.test(text)) {
        const session = db.sessions.get(values[0]);
        const items = db.items.get(values[0]) || [];
        const receivedBytes = items.reduce((sum, row) => sum + Number(row.received_size_bytes || 0), 0);
        session.received_file_count = items.length;
        session.received_bytes = String(receivedBytes);
        session.status = items.length >= Number(session.expected_file_count) ? "uploaded" : "uploading";
        session.updated_at = new Date("2026-06-30T00:00:02Z");
        return { rows: [] };
      }
      if (/update upload_sessions\s+set status = 'cancelled'/i.test(text)) {
        const session = db.sessions.get(values[0]);
        session.status = "cancelled";
        session.finished_at = new Date("2026-06-30T00:00:03Z");
        session.updated_at = new Date("2026-06-30T00:00:03Z");
        return { rows: [] };
      }
      if (/update upload_session_items\s+set status = 'cancelled'/i.test(text)) {
        const rows = db.items.get(values[0]) || [];
        for (const row of rows) {
          if (row.status !== "committed") {
            row.status = "cancelled";
            row.payload = null;
            row.updated_at = new Date("2026-06-30T00:00:03Z");
          }
        }
        return { rows: [] };
      }
      throw new Error(`Unexpected fake pg query: ${text.slice(0, 160)}`);
    },
  };
}
