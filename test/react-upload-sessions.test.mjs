import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const uploadSessionsPath = new URL("../react-ui/src/lib/uploadSessions.ts", import.meta.url);

const DRAFT_STORAGE_KEY = "matter-workbench.upload-session-drafts.v1";

test("React upload sessions persist failed durable sessions and resume missing files", async () => {
  const apiState = {
    uploaded: new Set(),
    uploadCalls: [],
    failOnIndex: 1,
    commitCalls: 0,
  };
  const { module, cleanup } = await importUploadSessions({
    createUploadSession: async () => sessionFor(apiState),
    getUploadSession: async () => sessionFor(apiState),
    uploadSessionFile: async (_sessionId, formData) => {
      const index = Number(formData.get("fileIndex"));
      apiState.uploadCalls.push(index);
      if (index === apiState.failOnIndex) {
        const error = new Error("network interruption");
        error.code = "upload.network_failed";
        throw error;
      }
      apiState.uploaded.add(index);
      return sessionFor(apiState);
    },
    commitUploadSession: async () => {
      apiState.commitCalls += 1;
      return { folderName: "Resume Matter", fileCount: 1, directoryCount: 1, tree: { name: "Resume Matter", kind: "directory", path: "" }, metadata: {} };
    },
  });
  const storage = installLocalStorage();
  const files = [collectedFile("one.txt", "first"), collectedFile("two.txt", "second")];

  try {
    await assert.rejects(
      () => module.createMatterWithUploadSession({ name: "Resume Matter", metadata: { matterName: "Resume Matter" }, files }),
      /network interruption/,
    );
    assert.deepEqual(apiState.uploadCalls, [0, 1]);
    assert.equal(apiState.commitCalls, 0);

    const draft = module.findMatchingUploadSessionDraft({ action: "create_matter", matterName: "Resume Matter", files });
    assert.ok(draft);
    assert.equal(draft.sessionId, "session_1");
    assert.equal(draft.expectedFileCount, 2);
    assert.match(storage.getItem(DRAFT_STORAGE_KEY), /Resume Matter/);

    apiState.failOnIndex = -1;
    apiState.uploadCalls = [];
    const result = await module.createMatterWithUploadSession({
      name: "Resume Matter",
      metadata: { matterName: "Resume Matter" },
      files,
      resumeDraft: draft,
    });

    assert.equal(result.folderName, "Resume Matter");
    assert.deepEqual(apiState.uploadCalls, [1]);
    assert.equal(apiState.commitCalls, 1);
    assert.equal(storage.getItem(DRAFT_STORAGE_KEY), null);
  } finally {
    uninstallLocalStorage();
    await cleanup();
  }
});

test("React upload session drafts require the same selected paths and sizes", async () => {
  const cancelled = [];
  const { module, cleanup } = await importUploadSessions({
    createUploadSession: async () => sessionFor({ uploaded: new Set() }),
    getUploadSession: async () => sessionFor({ uploaded: new Set() }),
    uploadSessionFile: async () => sessionFor({ uploaded: new Set([0]) }),
    commitUploadSession: async () => ({ folderName: "Draft Matter", fileCount: 1, directoryCount: 1, tree: { name: "Draft Matter", kind: "directory", path: "" }, metadata: {} }),
    cancelUploadSession: async (sessionId) => {
      cancelled.push(sessionId);
      return { ...sessionFor({ uploaded: new Set() }), id: sessionId, status: "cancelled" };
    },
  });
  installLocalStorage();
  const files = [collectedFile("evidence/one.txt", "first")];

  try {
    await module.createMatterWithUploadSession({ name: "Draft Matter", metadata: { matterName: "Draft Matter" }, files });
    assert.equal(module.findUploadSessionDraft({ action: "create_matter", matterName: "Draft Matter" }), null, "successful commits clear drafts");

    const draft = {
      schemaVersion: "upload-session-draft/v1",
      action: "add_files",
      sessionId: "session_2",
      matterName: "Existing Matter",
      expectedFileCount: 1,
      expectedBytes: 5,
      files: [{ index: 0, relativePath: "evidence/one.txt", name: "one.txt", size: 5, lastModified: 0 }],
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ "add_files:existing matter": draft }));

    assert.equal(module.selectedFilesMatchUploadSessionDraft(draft, files), true);
    assert.equal(module.selectedFilesMatchUploadSessionDraft(draft, [collectedFile("evidence/one.txt", "larger payload")]), false);
    assert.equal(module.selectedFilesMatchUploadSessionDraft(draft, [collectedFile("evidence/two.txt", "first")]), false);
    assert.equal(module.findMatchingUploadSessionDraft({ action: "add_files", matterName: "Existing Matter", files })?.sessionId, "session_2");
    await module.cancelUploadSessionDraft(draft);
    assert.deepEqual(cancelled, ["session_2"]);
    assert.equal(window.localStorage.getItem(DRAFT_STORAGE_KEY), null);
  } finally {
    uninstallLocalStorage();
    await cleanup();
  }
});

async function importUploadSessions(api) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-upload-sessions-"));
  const apiModulePath = path.join(dir, "client.mjs");
  const uploadSessionsModulePath = path.join(dir, "uploadSessions.mjs");
  await writeFile(apiModulePath, "export const api = globalThis.__mwbUploadSessionsApi;");
  const source = await readFile(uploadSessionsPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText.replace("from '../api/client';", `from '${apiModulePath}';`);
  await writeFile(uploadSessionsModulePath, transpiled);
  globalThis.__mwbUploadSessionsApi = api;
  const module = await import(`${uploadSessionsModulePath}?t=${Date.now()}-${Math.random()}`);
  return {
    module,
    cleanup: async () => {
      delete globalThis.__mwbUploadSessionsApi;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function sessionFor(state) {
  return {
    id: "session_1",
    status: state.uploaded?.size ? "uploaded" : "pending",
    action: "create_matter",
    matterName: "Resume Matter",
    expectedFileCount: 2,
    receivedFileCount: state.uploaded?.size || 0,
    items: [...(state.uploaded || [])].map((index) => ({ id: `item_${index}`, fileIndex: index, relativePath: index === 0 ? "one.txt" : "two.txt", originalName: index === 0 ? "one.txt" : "two.txt", status: "uploaded" })),
  };
}

function collectedFile(relativePath, text) {
  const file = new Blob([text], { type: "text/plain" });
  Object.defineProperty(file, "name", { value: relativePath.split("/").pop() || relativePath });
  Object.defineProperty(file, "lastModified", { value: 0 });
  return { relativePath, file };
}

function installLocalStorage() {
  const data = new Map();
  const storage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: (key) => data.delete(String(key)),
    clear: () => data.clear(),
  };
  globalThis.window = { localStorage: storage };
  return storage;
}

function uninstallLocalStorage() {
  delete globalThis.window;
}
