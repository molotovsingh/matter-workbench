import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { createWorkbenchServer } from "../server.mjs";
import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";
import { hashDesignBrief } from "../services/skill-samples-service.mjs";
import {
  getJson,
  postJson,
  runtimeDbMatter,
  runtimeDbTestPaths,
  startRuntimeDbTestServer,
} from "../test-support/runtime-db-api-fixtures.mjs";

test("runtime DB matter index drives /api/matters and switch while workspace reads local storage", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api");
  const matterRoot = path.join(mattersHome, "DB Listed Matter");
  await mkdir(path.join(matterRoot, "00_Inbox"), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
    matter_name: "DB Listed Matter",
    client_name: "Runtime Client",
  }, null, 2));

  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      listMatterFolders: async () => [
        { name: "DB Listed Matter", matterName: "Legal Caption" },
      ],
      findMatterFolder: async (name) => (
        name === "DB Listed Matter" || name === "Legal Caption"
          ? { name: "DB Listed Matter", matterName: "Legal Caption" }
          : null
      ),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const matters = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(matters.matters, [
      { name: "DB Listed Matter", matterName: "Legal Caption" },
    ]);

    const workspace = await postJson(baseUrl, "/api/switch-matter", { name: "Legal Caption" });
    assert.equal(workspace.metadata.matterName, "DB Listed Matter");
    assert.equal(workspace.metadata.clientName, "Runtime Client");

    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.activeMatterName, "DB Listed Matter");
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode lists matters even when local matters home is unset", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-api-no-home");
  const matter = runtimeDbMatter();
  const server = await startRuntimeDbTestServer({
    appDir,
    env: {},
    matter,
  });

  try {
    const matters = await getJson(server.baseUrl, "/api/matters");

    assert.equal(matters.enabled, true);
    assert.equal(matters.mattersHome, null);
    assert.deepEqual(matters.matters, [matter]);
  } finally {
    await server.close();
  }
});

test("runtime DB postgres storage mode exposes first-class upload session endpoints", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-upload-session-api");
  const calls = [];
  const session = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "pending",
    action: "create_matter",
    matterName: "Session Matter",
    expectedFileCount: 1,
    receivedFileCount: 0,
    items: [],
  };
  const runtimeMatter = runtimeDbMatter({ id: "matter-1", name: "Session Matter", matterName: "Session Matter" });
  const server = await startRuntimeDbTestServer({
    appDir,
    env: {},
    matter: runtimeMatter,
    runtimeDbStorageService: {
      enabled: true,
      async createUploadSession(body) {
        calls.push(["create", body.action, body.name, body.expectedFileCount]);
        return session;
      },
      async readUploadSession(sessionId) {
        calls.push(["read", sessionId]);
        return session;
      },
      async appendUploadSessionFiles(input) {
        calls.push(["files", input.sessionId, input.relativePaths, input.fileIndexes, input.files.map((file) => file.filename)]);
        return { ...session, status: "uploaded", receivedFileCount: 1 };
      },
      async commitUploadSession(sessionId) {
        calls.push(["commit", sessionId]);
        return {
          session: { ...session, status: "committed", receivedFileCount: 1 },
          matter: { id: "matter-1", name: "Session Matter" },
        };
      },
      async cancelUploadSession(sessionId) {
        calls.push(["cancel", sessionId]);
        return { ...session, status: "cancelled" };
      },
      async readWorkspace() {
        calls.push(["workspace"]);
        return {
          folderName: "Session Matter",
          inputLabel: "postgres:Session Matter",
          metadata: { matterName: "Session Matter" },
          fileCount: 0,
          directoryCount: 0,
          tree: { name: "Session Matter", kind: "directory", path: "", children: [] },
        };
      },
    },
  });

  try {
    const created = await postJson(server.baseUrl, "/api/upload-sessions", {
      action: "create_matter",
      name: "Session Matter",
      expectedFileCount: 1,
    });
    assert.equal(created.id, session.id);

    const read = await getJson(server.baseUrl, `/api/upload-sessions/${session.id}`);
    assert.equal(read.id, session.id);

    const form = new FormData();
    form.set("fileIndex", "0");
    form.set("paths", JSON.stringify(["note.txt"]));
    form.append("files", new Blob(["hello"], { type: "text/plain" }), "note.txt");
    const filesResponse = await fetch(`${server.baseUrl}/api/upload-sessions/${session.id}/files`, { method: "POST", body: form });
    const filesText = await filesResponse.text();
    assert.equal(filesResponse.ok, true, filesText);
    const uploaded = JSON.parse(filesText);
    assert.equal(uploaded.status, "uploaded");

    const committed = await postJson(server.baseUrl, `/api/upload-sessions/${session.id}/commit`);
    assert.equal(committed.folderName, "Session Matter");
    assert.equal(committed.uploadSession.status, "committed");

    const cancelled = await postJson(server.baseUrl, `/api/upload-sessions/${session.id}/cancel`);
    assert.equal(cancelled.id, session.id);
    assert.equal(cancelled.status, "cancelled");

    assert.deepEqual(calls, [
      ["create", "create_matter", "Session Matter", 1],
      ["read", session.id],
      ["files", session.id, ["note.txt"], [0], ["note.txt"]],
      ["commit", session.id],
      ["workspace"],
      ["cancel", session.id],
    ]);
  } finally {
    await server.close();
  }
});

test("runtime DB postgres storage mode exposes config custody label", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-config-mode");
  const server = await startRuntimeDbTestServer({
    appDir,
    env: {},
  });

  try {
    const config = await getJson(server.baseUrl, "/api/config");

    assert.equal(config.runtimeStorageMode, "postgres");
    assert.equal(config.workspaceModeLabel, "DB workspace");
  } finally {
    await server.close();
  }
});

test("runtime DB config exposes sanitized release metadata for the title bar", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-config-release");
  const server = await startRuntimeDbTestServer({
    appDir,
    env: {
      MWB_RELEASE_VERSION: "v1.0.0-beta.77",
      MWB_RELEASE_CODENAME: "Notice Bell\nignored",
      MWB_RELEASE_LABEL: "Beta 3\nignored",
      MWB_RELEASE_COMMIT: "5d10ca7",
      MWB_RELEASE_DATE: "2026-06-15",
      MWB_RELEASE_NOTE: "Release byte for testers",
    },
  });

  try {
    const configResponse = await fetch(`${server.baseUrl}/api/config`);
    const config = await configResponse.json();

    assert.equal(configResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual(config.release, {
      version: "v1.0.0-beta.77",
      codename: "Notice Bell ignored",
      label: "Beta 3 ignored",
      commit: "5d10ca7",
      date: "2026-06-15",
      note: "Release byte for testers",
    });
  } finally {
    await server.close();
  }
});

test("runtime DB config suppresses invalid release commit text", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-config-release-invalid");
  const server = await startRuntimeDbTestServer({
    appDir,
    env: {
      MWB_RELEASE_LABEL: "Beta 3",
      MWB_RELEASE_COMMIT: "not a commit",
    },
  });

  try {
    const config = await getJson(server.baseUrl, "/api/config");

    assert.equal(config.release.label, "Beta 3");
    assert.equal(config.release.commit, "");
  } finally {
    await server.close();
  }
});

test("runtime DB postgres storage mode serves workspace and files without local matter folder", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-storage");
  const rawBytes = Buffer.from("%PDF-1.7");
  const calls = [];

  const runtimeMatter = runtimeDbMatter();
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Listed Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readWorkspace(matter) {
        calls.push(["workspace", matter.name]);
        return {
          folderName: matter.name,
          inputLabel: `postgres:${matter.name}`,
          metadata: {
            matterName: matter.matterName,
            clientName: matter.clientName,
            oppositeParty: "",
            matterType: "",
            jurisdiction: "",
          },
          fileCount: 1,
          directoryCount: 1,
          tree: {
            name: matter.name,
            kind: "directory",
            path: "",
            children: [{
              name: "List of Dates.md",
              kind: "file",
              path: "10_Library/List of Dates.md",
              size: 15,
              previewable: true,
              previewKind: "text",
            }],
          },
        };
      },
      async readFilePreview(relativePath, matter) {
        calls.push(["preview", matter.name, relativePath]);
        return {
          path: relativePath,
          name: "List of Dates.md",
          ext: "md",
          content: "# List of Dates",
        };
      },
      async readMatterStatus(matter) {
        calls.push(["status", matter.name]);
        return {
          matterRoot: `postgres:${matter.name}`,
          matterName: matter.name,
          stages: [],
        };
      },
      async readPrepareMatterPlan(matter) {
        calls.push(["prepare", matter.name]);
        return {
          schema_version: "prepare-matter-plan/v1",
          matter: { name: matter.matterName, folderName: matter.name },
          metadata: { missing: [], complete: true },
          stages: [],
          downstream: {},
          nextStep: { state: "complete", label: "Core preparation is current", message: "Review advisory.", stage: "", slash: "" },
          warnings: [],
        };
      },
      async readMatterAttention(matter) {
        calls.push(["attention", matter.name]);
        return {
          schema_version: "matter-attention/v1",
          generated_at: "2026-06-06T00:00:00.000Z",
          matterName: matter.matterName,
          matterRoot: `postgres:${matter.name}`,
          summary: { total: 0, blocker: 0, warning: 0, info: 0, state: "clear" },
          items: [],
        };
      },
      async getRawFile(relativePath, matter) {
        calls.push(["raw", matter.name, relativePath]);
        return {
          contentType: "application/pdf",
          fileSize: rawBytes.length,
          safeFilename: "agreement.pdf",
          stream: Readable.from(rawBytes),
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const workspace = await postJson(baseUrl, "/api/switch-matter", { name: "Legal Caption" });
    assert.equal(workspace.inputLabel, "postgres:DB Listed Matter");
    assert.equal(workspace.metadata.clientName, "Runtime Client");

    const currentWorkspace = await getJson(baseUrl, "/api/workspace");
    assert.equal(currentWorkspace.inputLabel, "postgres:DB Listed Matter");

    const preview = await getJson(baseUrl, "/api/file?path=10_Library/List%20of%20Dates.md");
    assert.equal(preview.content, "# List of Dates");

    const status = await getJson(baseUrl, "/api/matter-status");
    assert.equal(status.matterRoot, "postgres:DB Listed Matter");

    const prepare = await getJson(baseUrl, "/api/prepare-matter");
    assert.equal(prepare.schema_version, "prepare-matter-plan/v1");

    const attention = await getJson(baseUrl, "/api/matter-attention");
    assert.equal(attention.schema_version, "matter-attention/v1");

    const raw = await fetch(`${baseUrl}/api/file-raw?path=00_Inbox/Intake%2001/Originals/agreement.pdf`);
    assert.equal(raw.ok, true);
    assert.equal(raw.headers.get("content-type"), "application/pdf");
    assert.equal(await raw.text(), "%PDF-1.7");

    const extract = await fetch(`${baseUrl}/api/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Legal Caption" }),
    });
    const extractBody = await extract.json();
    assert.equal(extract.status, 409);
    assert.equal(extractBody.code, "matter_workflow.extraction_required");

    assert.deepEqual(calls, [
      ["workspace", "DB Listed Matter"],
      ["workspace", "DB Listed Matter"],
      ["preview", "DB Listed Matter", "10_Library/List of Dates.md"],
      ["status", "DB Listed Matter"],
      ["prepare", "DB Listed Matter"],
      ["attention", "DB Listed Matter"],
      ["raw", "DB Listed Matter", "00_Inbox/Intake 01/Originals/agreement.pdf"],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB file API returns stable read-side codes for DB payload misses", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-api-read-errors");
  const calls = [];
  const matter = runtimeDbMatter();
  const runtimeDbStorageService = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
    spawn: jsonApiSpawn(calls, {}),
  });
  const server = await startRuntimeDbTestServer({
    appDir,
    matter,
    runtimeDbStorageService,
  });

  try {
    const missing = await fetch(`${server.baseUrl}/api/file?matter=${encodeURIComponent(matter.matterName)}&path=${encodeURIComponent("10_Library/List of Dates.md")}`);
    const missingPayload = await missing.json();
    assert.equal(missing.status, 404);
    assert.equal(missingPayload.code, "runtime_db.read.file_not_found");
    assert.match(missingPayload.error, /10_Library\/List of Dates\.md/);

    const sql = calls.map((call) => call.input || "").join("\n");
    assert.match(sql, /DB Listed Matter\/10_Library\/List of Dates\.md/);
    assert.match(sql, /Legal Caption\/10_Library\/List of Dates\.md/);
    assert.doesNotMatch(sql, /postgres:/i);

    const escaped = await fetch(`${server.baseUrl}/api/file?matter=${encodeURIComponent(matter.matterName)}&path=${encodeURIComponent("../secret.txt")}`);
    const escapedPayload = await escaped.json();
    assert.equal(escaped.status, 400);
    assert.equal(escapedPayload.code, "runtime_db.read.path_outside_matter");
  } finally {
    await server.close();
  }
});

test("runtime DB prepare-matter run queues the next needed backend stage", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-prepare-run-queue");
  const matter = runtimeDbMatter({ name: "Queued Matter", matterName: "Queued Matter" });
  const calls = [];
  const server = await startRuntimeDbTestServer({
    appDir,
    matter,
    runtimeDbProcessingWorkerService: {
      enabled: () => true,
      supportedKinds: () => ["source_labels", "case_timeline", "matter_story", "posture_diagnosis"],
      start() {},
      stop() {},
    },
    runtimeDbStorageService: {
      enabled: true,
      async readPrepareMatterPlan(currentMatter, options) {
        calls.push(["plan", currentMatter.name, options.includeDisputeStory]);
        return {
          schema_version: "prepare-matter-plan/v1",
          matterName: currentMatter.name,
          stages: [
            { id: "describe-sources", slash: "/describe_sources", label: "Label sources", state: "current", action: "skip_current" },
            { id: "create-listofdates", slash: "/create_listofdates", label: "Build Case Timeline", state: "missing", action: "confirm_paid_run" },
            { id: "dispute-story", slash: "/the_story", label: "Write dispute story", state: "blocked", action: "blocked", reason: "Case Timeline is required first." },
          ],
          nextStep: { state: "needs_run", label: "Build Case Timeline", stage: "create-listofdates", slash: "/create_listofdates" },
        };
      },
      async listProcessingJobs(filters) {
        calls.push(["list", filters.kind, filters.status, filters.matterName]);
        return { schema_version: "runtime-db-processing-jobs/v1", jobs: [] };
      },
      async enqueueProcessingJob(input) {
        calls.push(["enqueue", input.kind, input.idempotencyKey, input.metadata.preparationChain, input.metadata.reason]);
        return {
          id: "job-case-timeline",
          kind: input.kind,
          status: "queued",
          matterName: matter.name,
          metadata: input.metadata,
        };
      },
    },
  });

  try {
    const result = await postJson(server.baseUrl, "/api/prepare-matter/run", {
      matterName: matter.name,
      mode: "needed",
      runId: "prep_test_queue",
      reason: "operator requested needed preparation",
    });

    assert.equal(result.schema_version, "prepare-matter-run/v1");
    assert.equal(result.state, "queued");
    assert.equal(result.kind, "case_timeline");
    assert.equal(result.stage.slash, "/create_listofdates");
    assert.equal(result.job.id, "job-case-timeline");
    assert.equal(result.alreadyQueued, false);
    assert.deepEqual(calls, [
      ["plan", "Queued Matter", true],
      ["list", "case_timeline", "queued", "Queued Matter"],
      ["list", "case_timeline", "running", "Queued Matter"],
      ["list", "case_timeline", "retrying", "Queued Matter"],
      ["enqueue", "case_timeline", `manual-prepare:${matter.id}:prep_test_queue:case_timeline`, "manual_needed/v1", "operator requested needed preparation"],
    ]);
  } finally {
    await server.close();
  }
});

test("runtime DB prepare-matter run returns an active stage job instead of duplicating it", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-prepare-run-existing");
  const matter = runtimeDbMatter({ name: "Queued Matter", matterName: "Queued Matter" });
  const calls = [];
  const activeJob = { id: "job-existing", kind: "case_timeline", status: "running", matterName: matter.name };
  const server = await startRuntimeDbTestServer({
    appDir,
    matter,
    runtimeDbProcessingWorkerService: {
      enabled: () => true,
      supportedKinds: () => ["case_timeline"],
      start() {},
      stop() {},
    },
    runtimeDbStorageService: {
      enabled: true,
      async readPrepareMatterPlan() {
        return {
          schema_version: "prepare-matter-plan/v1",
          matterName: matter.name,
          stages: [{ id: "create-listofdates", slash: "/create_listofdates", label: "Build Case Timeline", state: "missing", action: "run" }],
          nextStep: { state: "needs_run", label: "Build Case Timeline", stage: "create-listofdates", slash: "/create_listofdates" },
        };
      },
      async listProcessingJobs(filters) {
        calls.push(["list", filters.status]);
        return { schema_version: "runtime-db-processing-jobs/v1", jobs: filters.status === "running" ? [activeJob] : [] };
      },
      async enqueueProcessingJob() {
        calls.push(["enqueue"]);
        throw new Error("should not enqueue duplicate");
      },
    },
  });

  try {
    const result = await postJson(server.baseUrl, "/api/prepare-matter/run", { matterName: matter.name });

    assert.equal(result.state, "queued");
    assert.equal(result.kind, "case_timeline");
    assert.equal(result.alreadyQueued, true);
    assert.equal(result.job.id, activeJob.id);
    assert.deepEqual(calls, [["list", "queued"], ["list", "running"]]);
  } finally {
    await server.close();
  }
});

test("runtime DB raw file route contains stream failures without crashing the server", async () => {
  const { appDir } = await runtimeDbTestPaths("runtime-db-raw-stream-error");
  const matter = runtimeDbMatter();
  let sourceStreamErrored = false;
  const server = await startRuntimeDbTestServer({
    appDir,
    matter,
    runtimeDbStorageService: {
      enabled: true,
      async getRawFile() {
        const stream = new Readable({
          read() {
            this.push("partial");
            this.destroy(Object.assign(new Error("synthetic raw stream failure"), { code: "E_SYNTHETIC_RAW" }));
          },
        });
        stream.once("error", () => {
          sourceStreamErrored = true;
        });
        return {
          contentType: "application/octet-stream",
          fileSize: 1024,
          safeFilename: "broken.bin",
          stream,
        };
      },
    },
  });
  const uncaught = [];
  const onUncaught = (error) => { uncaught.push(error); };
  process.on("uncaughtException", onUncaught);

  try {
    let requestFailed = false;
    try {
      const response = await fetch(
        `${server.baseUrl}/api/file-raw?path=broken.bin&matter=${encodeURIComponent(matter.name)}`,
      );
      await response.arrayBuffer();
    } catch {
      requestFailed = true;
    }

    const config = await getJson(server.baseUrl, "/api/config");
    assert.equal(requestFailed, true);
    assert.equal(sourceStreamErrored, true);
    assert.equal(config.runtimeStorageMode, "postgres");
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
    await server.close();
  }
});

test("runtime DB postgres storage mode checks upload overlap from DB custody rows", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-overlap");
  const duplicateHash = "a".repeat(64);
  const runtimeMatter = runtimeDbMatter({
    id: "11111111-1111-4111-8111-111111111111",
    name: "DB Existing Matter",
    matterName: "DB Existing Matter",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (name === runtimeMatter.name ? runtimeMatter : null),
    },
    runtimeDbStorageService: {
      enabled: true,
      async checkUploadedFileOverlap(hashes) {
        calls.push(["overlap", hashes]);
        return {
          warnings: [{
            matterName: "DB Existing Matter",
            overlapCount: 1,
            totalIncoming: 1,
            matterTotalFiles: 3,
            overlapPercent: 100,
          }],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const result = await postJson(baseUrl, "/api/matters/check-overlap", {
      hashes: [duplicateHash],
    });

    assert.deepEqual(calls, [["overlap", [duplicateHash]]]);
    assert.deepEqual(result.warnings, [{
      matterName: "DB Existing Matter",
      overlapCount: 1,
      totalIncoming: 1,
      matterTotalFiles: 3,
      overlapPercent: 100,
    }]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs matter-init from DB-native custody", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-init");
  const runtimeMatter = runtimeDbMatter({
    id: "22222222-2222-4222-8222-222222222222",
    name: "DB Direct Init Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Init Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async initializeMatter(matter, options) {
        calls.push(["init", matter.name, matter.matterName, options.metadata.clientName]);
        return {
          operationResult: {
            counts: { scannedFiles: 1, uniqueFiles: 1 },
            intake: { intake_id: "INTAKE-01" },
          },
          persisted: [
            { relativePath: "00_Inbox/Intake 01 - Initial/Originals/agreement.txt", objectRole: "source_original" },
            { relativePath: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__agreement.txt", objectRole: "source_working_copy" },
            { relativePath: "00_Inbox/Intake 01 - Initial/File Register.csv", objectRole: "matter_artifact" },
            { relativePath: "matter.json", objectRole: "matter_artifact" },
          ],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native matter-init");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/matter-init", {
      matterName: "Legal Caption",
      metadata: {
        matterName: "Legal Caption",
        clientName: "Runtime Client",
      },
    });

    assert.equal(result.counts.scannedFiles, 1);
    assert.equal(result.matterRoot, "postgres:DB Direct Init Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "00_Inbox/Intake 01 - Initial/Originals/agreement.txt",
      "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__agreement.txt",
      "00_Inbox/Intake 01 - Initial/File Register.csv",
      "matter.json",
    ]);
    assert.deepEqual(calls, [["init", "DB Direct Init Matter", "Legal Caption", "Runtime Client"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native matter-init helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-init");
  const runtimeMatter = runtimeDbMatter({
    id: "22222222-2222-4222-8222-222222222222",
    name: "DB Init Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Init Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        const sourceDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files");
        await mkdir(sourceDir, { recursive: true });
        await writeFile(path.join(sourceDir, "agreement.txt"), "Agreement text");
        await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
          matter_name: matter.matterName,
          client_name: matter.clientName,
        }, null, 2));
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [
            { relativePath: "00_Inbox/Intake 01 - Initial/File Register.csv", objectRole: "matter_artifact" },
          ],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/matter-init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Legal Caption",
        metadata: {
          matterName: "Legal Caption",
          clientName: "Runtime Client",
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.matter_init_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs extract from DB-native custody", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-extract");
  const runtimeMatter = runtimeDbMatter({
    id: "33333333-3333-4333-8333-333333333333",
    name: "DB Direct Extract Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Extract Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async extractDocuments(matter, options) {
        calls.push(["extract", matter.name, matter.matterName, options.forceRefresh]);
        return {
          operationResult: {
            counts: { extracted: 1, failed: 0 },
            perIntake: [{ intake_id: "INTAKE-01", extracted: 1, cached: 0, skipped: 0, failed: 0 }],
          },
          persisted: [
            { relativePath: "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", objectRole: "extraction_payload" },
            { relativePath: "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.txt", objectRole: "other" },
            { relativePath: "00_Inbox/Intake 01 - Initial/Extraction Log.csv", objectRole: "matter_artifact" },
          ],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native extract");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/extract", {
      matterName: "Legal Caption",
      forceRefresh: true,
    });

    assert.equal(result.counts.extracted, 1);
    assert.equal(result.counts.failed, 0);
    assert.equal(result.matterRoot, "postgres:DB Direct Extract Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json",
      "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.txt",
      "00_Inbox/Intake 01 - Initial/Extraction Log.csv",
    ]);
    assert.deepEqual(calls, [["extract", "DB Direct Extract Matter", "Legal Caption", true]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native extraction helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-extract");
  const runtimeMatter = runtimeDbMatter({
    id: "33333333-3333-4333-8333-333333333333",
    name: "DB Extract Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Extract Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
        const workingCopyPath = path.join(intakeDir, "By Type", "Text Notes", "FILE-0001__note.txt");
        await mkdir(path.dirname(workingCopyPath), { recursive: true });
        await writeFile(workingCopyPath, "Important fact paragraph.");
        await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
          matter_name: matter.matterName,
          intakes: [{
            intake_id: "INTAKE-01",
            intake_dir: "00_Inbox/Intake 01 - Initial",
          }],
        }, null, 2));
        await writeFile(path.join(intakeDir, "File Register.csv"), [
          "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status,engine_version,notes",
          "FILE-0001,INTAKE-01,source/note.txt,,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__note.txt,Text Notes,note.txt,abc,25,,unique,test,",
          "",
        ].join("\n"));
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [
            { relativePath: "00_Inbox/Intake 01 - Initial/Extraction Log.csv", objectRole: "matter_artifact" },
            { relativePath: "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", objectRole: "extraction_payload" },
          ],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Legal Caption",
        forceRefresh: true,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.extraction_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs source labels from DB-native custody", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-sources");
  const runtimeMatter = runtimeDbMatter({
    id: "44444444-4444-4444-8444-444444444444",
    name: "DB Direct Source Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    sourceDescriptorProvider: async () => ({ sources: [] }),
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Source Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async describeSources(matter, options) {
        calls.push(["describe", matter.name, matter.matterName, Boolean(options.sourceDescriptorProvider)]);
        return {
          operationResult: {
            counts: { recordsRead: 1, sourcePackets: 1, descriptors: 1 },
            outputPaths: { json: "10_Library/Source Index.json" },
          },
          persisted: [{ relativePath: "10_Library/Source Index.json", objectRole: "matter_artifact" }],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native source labels");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/describe-sources", {
      matterName: "Legal Caption",
    });

    assert.equal(result.counts.recordsRead, 1);
    assert.equal(result.counts.descriptors, 1);
    assert.equal(result.matterRoot, "postgres:DB Direct Source Matter");
    assert.deepEqual(result.dbPersistence.persisted, [
      { relativePath: "10_Library/Source Index.json", objectRole: "matter_artifact" },
    ]);
    assert.deepEqual(calls, [["describe", "DB Direct Source Matter", "Legal Caption", true]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native source-label helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-sources");
  const runtimeMatter = runtimeDbMatter({
    id: "44444444-4444-4444-8444-444444444444",
    name: "DB Source Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Source Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    sourceDescriptorProvider: async ({ sources }) => ({
      sources: sources.map((source) => sourceDescriptorForPacket(source)),
    }),
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [
            { relativePath: "10_Library/Source Index.json", objectRole: "matter_artifact" },
          ],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/describe-sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Legal Caption" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.source_labels_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs create-listofdates from DB-native custody", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-chronology");
  const runtimeMatter = runtimeDbMatter({
    id: "55555555-5555-4555-8555-555555555555",
    name: "DB Direct Chronology Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Chronology Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async createListOfDates(matter, options) {
        calls.push(["create-list", matter.name, matter.matterName, Boolean(options.aiProvider)]);
        return {
          operationResult: {
            counts: { recordsRead: 1, entries: 1 },
            outputPaths: {
              json: "10_Library/List of Dates.json",
              csv: "10_Library/List of Dates.csv",
              markdown: "10_Library/List of Dates.md",
            },
          },
          persisted: [
            { relativePath: "10_Library/List of Dates.json", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.csv", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.md", objectRole: "matter_artifact" },
          ],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native List of Dates");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/create-listofdates", {
      matterName: "Legal Caption",
    });

    assert.equal(result.counts.recordsRead, 1);
    assert.equal(result.counts.entries, 1);
    assert.equal(result.matterRoot, "postgres:DB Direct Chronology Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "10_Library/List of Dates.json",
      "10_Library/List of Dates.csv",
      "10_Library/List of Dates.md",
    ]);
    assert.deepEqual(calls, [["create-list", "DB Direct Chronology Matter", "Legal Caption", false]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs two-pass create-listofdates from DB-native custody", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-chronology-two-pass");
  const runtimeMatter = runtimeDbMatter({
    id: "55555555-5555-4555-8555-555555555555",
    name: "DB Direct Two Pass Chronology Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome, CREATE_LISTOFDATES_TWO_PASS_ENABLED: "1" },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Two Pass Chronology Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async createListOfDates(matter, options) {
        calls.push(["create-list", matter.name, matter.matterName, options.env.CREATE_LISTOFDATES_TWO_PASS_ENABLED]);
        return {
          operationResult: {
            generationMode: "two_pass",
            counts: { recordsRead: 1, entries: 1 },
            outputPaths: {
              candidates: "10_Library/List of Dates Candidates.json",
              json: "10_Library/List of Dates.json",
              csv: "10_Library/List of Dates.csv",
              markdown: "10_Library/List of Dates.md",
            },
          },
          persisted: [
            { relativePath: "10_Library/List of Dates Candidates.json", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.json", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.csv", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.md", objectRole: "matter_artifact" },
          ],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native two-pass List of Dates");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/create-listofdates", {
      matterName: "Legal Caption",
    });

    assert.equal(result.generationMode, "two_pass");
    assert.equal(result.matterRoot, "postgres:DB Direct Two Pass Chronology Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "10_Library/List of Dates Candidates.json",
      "10_Library/List of Dates.json",
      "10_Library/List of Dates.csv",
      "10_Library/List of Dates.md",
    ]);
    assert.deepEqual(calls, [["create-list", "DB Direct Two Pass Chronology Matter", "Legal Caption", "1"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native List of Dates helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-lod");
  const runtimeMatter = runtimeDbMatter({
    id: "55555555-5555-4555-8555-555555555555",
    name: "DB Chronology Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Chronology Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    aiProvider: async () => ({
      entries: [{
        date_iso: "2026-04-20",
        date_text: "20 April 2026",
        event: "Agreement was signed by Runtime Client and the opposite party.",
        event_type: "agreement",
        legal_relevance: "Supports the client's chronology because the cited source records the agreement date.",
        issue_tags: ["agreement"],
        perspective: "record_neutral",
        citation: "FILE-0001 p1.b1",
        needs_review: false,
        confidence: 0.91,
      }],
    }),
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [
            { relativePath: "10_Library/List of Dates.json", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.md", objectRole: "matter_artifact" },
          ],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/create-listofdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Legal Caption" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.list_of_dates_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native List of Dates label-refresh helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-lod-refresh");
  const runtimeMatter = runtimeDbMatter({
    id: "66666666-6666-4666-8666-666666666666",
    name: "DB Refresh Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Refresh Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeListOfDatesRefreshMatter(matterRoot, matter);
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [
            { relativePath: "10_Library/List of Dates.json", objectRole: "matter_artifact" },
            { relativePath: "10_Library/List of Dates.md", objectRole: "matter_artifact" },
          ],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/create-listofdates/refresh-labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Legal Caption" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.label_refresh_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode refreshes List of Dates labels through DB-native storage service", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-lod-refresh");
  const runtimeMatter = runtimeDbMatter({
    id: "65656565-6565-4565-8565-656565656565",
    name: "DB Direct Refresh Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Refresh Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async refreshListOfDatesSourceLabels(matter, options) {
        calls.push(["db-refresh", matter.name, matter.matterName, Boolean(options.dryRun)]);
        return {
          operationResult: {
            refreshMode: "label_refresh",
            counts: { refreshedEntries: 1 },
            outputPaths: { json: "10_Library/List of Dates.json" },
          },
          persisted: [{ relativePath: "10_Library/List of Dates.json", objectRole: "matter_artifact" }],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native label refresh");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/create-listofdates/refresh-labels", {
      matterName: "Legal Caption",
    });

    assert.equal(result.refreshMode, "label_refresh");
    assert.equal(result.matterRoot, "postgres:DB Direct Refresh Matter");
    assert.deepEqual(result.dbPersistence.persisted, [
      { relativePath: "10_Library/List of Dates.json", objectRole: "matter_artifact" },
    ]);
    assert.deepEqual(calls, [["db-refresh", "DB Direct Refresh Matter", "Legal Caption", false]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native matter context helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-context");
  const runtimeMatter = runtimeDbMatter({
    id: "77777777-7777-4777-8777-777777777777",
    name: "DB Context Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Context Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterRead(matter, operation) {
        calls.push(["read", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        return operation({ matterRoot, matter });
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const contextResponse = await fetch(`${baseUrl}/api/matter-context?matter=Legal%20Caption`);
    const contextPayload = await contextResponse.json();
    assert.equal(contextResponse.status, 409);
    assert.equal(contextPayload.code, "matter_workflow.context_required");

    const searchResponse = await fetch(`${baseUrl}/api/matter-context/search?matter=Legal%20Caption&q=agreement`);
    const searchPayload = await searchResponse.json();
    assert.equal(searchResponse.status, 409);
    assert.equal(searchPayload.code, "matter_workflow.context_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native copilot context helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-copilot");
  const runtimeMatter = runtimeDbMatter({
    id: "88888888-8888-4888-8888-888888888888",
    name: "DB Copilot Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome, OPENAI_API_KEY: "sk-test" },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Copilot Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    matterCopilotProvider: async ({ question, matterContext }) => {
      calls.push(["provider", question, matterContext.evidence_blocks.length]);
      assert.equal(matterContext.evidence_blocks[0].citation, "FILE-0001 p1.b1");
      return {
        answer_status: "answered",
        answer_markdown: "The materialized record says the agreement was signed on 20 April 2026.",
        confidence: 0.82,
        sources: [{
          raw_citation: "FILE-0001 p1.b1",
          source_label: "Agreement note",
          snippet: "Agreement was signed on 20 April 2026.",
        }],
        warnings: [],
      };
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterRead(matter, operation) {
        calls.push(["read", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        return operation({ matterRoot, matter });
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/matter-copilot/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Legal Caption",
        question: "When was the agreement signed?",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.context_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode reads matter context from DB-native packet service when available", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-context");
  const runtimeMatter = runtimeDbMatter({
    id: "89898989-8989-4989-8989-898989898989",
    name: "DB Direct Context Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Context Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(matter) {
        calls.push(["packet", matter.name, matter.matterName]);
        return directRuntimeDbMatterContextPacket(matter);
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native matter context");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const context = await getJson(baseUrl, "/api/matter-context?matter=Legal%20Caption");
    assert.equal(context.schema_version, "matter-context-preview/v1");
    assert.equal(context.matterRoot, "postgres:DB Direct Context Matter");
    assert.equal(context.matterName, "Legal Caption");
    assert.equal(context.counts.evidence_blocks_included, 1);

    const search = await getJson(baseUrl, "/api/matter-context/search?matter=Legal%20Caption&q=agreement");
    assert.equal(search.schema_version, "matter-context-search/v1");
    assert.equal(search.matterRoot, "postgres:DB Direct Context Matter");
    assert.equal(search.counts.matches, 1);
    assert.match(search.results[0].snippet, /Agreement was signed/);
    assert.deepEqual(calls, [
      ["packet", "DB Direct Context Matter", "Legal Caption"],
      ["packet", "DB Direct Context Matter", "Legal Caption"],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode answers copilot from DB-native packet service when available", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-copilot");
  const runtimeMatter = runtimeDbMatter({
    id: "78787878-7878-4787-8787-787878787878",
    name: "DB Direct Copilot Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome, OPENAI_API_KEY: "sk-test" },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Copilot Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    matterCopilotProvider: async ({ question, matterContext }) => {
      calls.push(["provider", question, matterContext.evidence_blocks.length]);
      return {
        answer_status: "answered",
        answer_markdown: "The DB-native packet says the agreement was signed on 20 April 2026.",
        confidence: 0.82,
        sources: [{
          raw_citation: "FILE-0001 p1.b1",
          source_label: "Agreement note",
          snippet: "Agreement was signed on 20 April 2026.",
        }],
        warnings: [],
      };
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(matter) {
        calls.push(["packet", matter.name, matter.matterName]);
        return directRuntimeDbMatterContextPacket(matter);
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native copilot context");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const answer = await postJson(baseUrl, "/api/matter-copilot/answer", {
      matterName: "Legal Caption",
      question: "When was the agreement signed?",
    });

    assert.equal(answer.schema_version, "matter-copilot-answer/v1");
    assert.equal(answer.matterRoot, "postgres:DB Direct Copilot Matter");
    assert.equal(answer.matterName, "Legal Caption");
    assert.equal(answer.answer_status, "answered");
    assert.deepEqual(calls, [
      ["packet", "DB Direct Copilot Matter", "Legal Caption"],
      ["provider", "When was the agreement signed?", 1],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode scans doctor issues from DB-native service when available", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-doctor-scan");
  const runtimeMatter = runtimeDbMatter({
    id: "56565656-5656-4565-8565-565656565656",
    name: "DB Direct Doctor Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Doctor Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readDoctorScan(matter) {
        calls.push(["doctor-scan", matter.name, matter.matterName]);
        return { issues: [{ id: "legacy-layout", severity: "warning" }] };
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native doctor scan");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const scan = await postJson(baseUrl, "/api/doctor/scan", { matterName: "Legal Caption" });

    assert.equal(scan.issues[0].id, "legacy-layout");
    assert.equal(scan.matterRoot, "postgres:DB Direct Doctor Matter");
    assert.equal(scan.matterName, "Legal Caption");
    assert.deepEqual(calls, [["doctor-scan", "DB Direct Doctor Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode reads rerun advice from DB-native status service when available", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-rerun");
  const runtimeMatter = runtimeDbMatter({
    id: "67676767-6767-4767-8767-676767676767",
    name: "DB Direct Advice Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Advice Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readRerunAdvice(skill, matter) {
        calls.push(["advice", skill, matter.name, matter.matterName]);
        return {
          skill: "/create_listofdates",
          label: "list of dates",
          state: "current",
          shouldConfirm: true,
          artifactPath: "10_Library/List of Dates.md",
        };
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native rerun advice");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const advice = await getJson(baseUrl, "/api/rerun-advice?matter=Legal%20Caption&skill=%2Fcreate_listofdates");

    assert.equal(advice.state, "current");
    assert.equal(advice.matterRoot, "postgres:DB Direct Advice Matter");
    assert.equal(advice.matterName, "Legal Caption");
    assert.deepEqual(calls, [["advice", "/create_listofdates", "DB Direct Advice Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native status and doctor scan helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-read-tools");
  const runtimeMatter = runtimeDbMatter({
    id: "99999999-9999-4999-8999-999999999999",
    name: "DB Read Tools Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Read Tools Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterRead(matter, operation) {
        calls.push(["read", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeListOfDatesRefreshMatter(matterRoot, matter);
        return operation({ matterRoot, matter });
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const adviceResponse = await fetch(`${baseUrl}/api/rerun-advice?matter=Legal%20Caption&skill=%2Fcreate_listofdates`);
    const advicePayload = await adviceResponse.json();
    assert.equal(adviceResponse.status, 409);
    assert.equal(advicePayload.code, "matter_workflow.status_required");

    const scanResponse = await fetch(`${baseUrl}/api/doctor/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Legal Caption" }),
    });
    const scanPayload = await scanResponse.json();
    assert.equal(scanResponse.status, 409);
    assert.equal(scanPayload.code, "matter_workflow.doctor_scan_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs doctor fix from DB-native custody", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-doctor-fix");
  const runtimeMatter = runtimeDbMatter({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Direct Doctor Fix Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Doctor Fix Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async fixDoctorIssues(matter, fixIds) {
        calls.push(["fix", matter.name, matter.matterName, fixIds]);
        return {
          operationResult: {
            applied: [{ id: "legacy-layout", ok: true, log: ["fixed"], backupDir: ".doctor-backups/test" }],
            failed: [],
            remaining: [],
          },
          persisted: [
            { relativePath: "00_Inbox/Intake 01 - Initial/File Register.csv", objectRole: "matter_artifact" },
            { relativePath: "matter.json", objectRole: "matter_artifact" },
          ],
          deleted: [
            { relativePath: "00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv" },
          ],
        };
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native doctor fix");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/doctor/fix", {
      matterName: "Legal Caption",
      fixIds: ["legacy-layout"],
    });

    assert.equal(result.matterRoot, "postgres:DB Direct Doctor Fix Matter");
    assert.equal(result.applied[0].id, "legacy-layout");
    assert.deepEqual(result.remaining, []);
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "00_Inbox/Intake 01 - Initial/File Register.csv",
      "matter.json",
    ]);
    assert.deepEqual(calls, [["fix", "DB Direct Doctor Fix Matter", "Legal Caption", ["legacy-layout"]]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native doctor fix helpers", async () => {
  const { tmp, mattersHome } = await runtimeDbTestPaths("runtime-db-api-doctor-fix");
  const runtimeMatter = runtimeDbMatter({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Doctor Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Doctor Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/doctor/fix`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Legal Caption",
        fixIds: ["legacy-layout"],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.doctor_fix_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs configurable skills from DB-native context", async () => {
  const { appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-custom-skill");
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  const configurableSkillRunsPath = path.join(appDir, "configurable-skill-runs.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_story",
      slash: "/the_story",
      title: "The Story",
      description: "Tell the matter story for internal lawyer review.",
      status: "active",
      version: 1,
      familyId: "skill_story",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/The Story.md",
      matterRequired: true,
      paidProviderCall: true,
      sourceBacked: "required",
      promptConfig: {
        prompt: "Tell the story from the matter record.",
        citationPolicy: "Use raw FILE citations.",
      },
      modelPolicy: {
        task: "configurable_skill_run",
        provider: "openai-direct",
        model: "gpt-5.4",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
      validation: { status: "passed", messages: [], validatedAt: "2026-06-06T00:00:00.000Z" },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }],
  }, null, 2)}\n`);
  const runtimeMatter = runtimeDbMatter({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Direct Skill Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath,
    configurableSkillRunsPath,
    configurableSkillRunProvider: async ({ matterContext }) => {
      calls.push(["provider", matterContext.evidence_blocks[0].citation]);
      return "# The Story\n\nRuntime Client signed the agreement. (FILE-0001 p1.b1)\n";
    },
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Skill Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(matter) {
        calls.push(["packet", matter.name, matter.matterName]);
        return directRuntimeDbMatterContextPacket(matter);
      },
      async artifactExists(matter, relativePath) {
        calls.push(["exists", matter.name, relativePath]);
        return false;
      },
      async persistTextArtifacts(matter, files) {
        calls.push(["persist", matter.name, files.map((file) => file.relativePath)]);
        return files.map((file) => ({ relativePath: file.relativePath, objectRole: "matter_artifact" }));
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native configurable skill run");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/configurable-skills/run", {
      slash: "/the_story",
      matterName: "Legal Caption",
    });

    assert.equal(result.state, "written");
    assert.equal(result.runRecord.matterRoot, "postgres:DB Direct Skill Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "20_Workshop/The Story.md",
      "20_Workshop/The Story.json",
    ]);
    assert.deepEqual(calls, [
      ["packet", "DB Direct Skill Matter", "Legal Caption"],
      ["exists", "DB Direct Skill Matter", "20_Workshop/The Story.md"],
      ["provider", "FILE-0001 p1.b1"],
      ["persist", "DB Direct Skill Matter", ["20_Workshop/The Story.md", "20_Workshop/The Story.json"]],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native configurable skill helpers", async () => {
  const { tmp, appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-custom-skill");
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  const configurableSkillRunsPath = path.join(appDir, "configurable-skill-runs.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_story",
      slash: "/the_story",
      title: "The Story",
      description: "Tell the matter story for internal lawyer review.",
      status: "active",
      version: 1,
      familyId: "skill_story",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/The Story.md",
      matterRequired: true,
      paidProviderCall: true,
      sourceBacked: "required",
      promptConfig: {
        prompt: "Tell the story from the matter record.",
        citationPolicy: "Use raw FILE citations.",
      },
      modelPolicy: {
        task: "configurable_skill_run",
        provider: "openai-direct",
        model: "gpt-5.4",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
      validation: { status: "passed", messages: [], validatedAt: "2026-06-06T00:00:00.000Z" },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }],
  }, null, 2)}\n`);
  const runtimeMatter = runtimeDbMatter({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Skill Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath,
    configurableSkillRunsPath,
    configurableSkillRunProvider: async () => "# The Story\n\nRuntime Client signed the agreement. (FILE-0001 p1.b1)\n",
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Skill Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        const operationResult = await operation({ matterRoot, matter });
        return {
          operationResult,
          persisted: [{ relativePath: "20_Workshop/The Story.md" }],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/configurable-skills/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slash: "/the_story",
        matterName: "Legal Caption",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "skill_factory.context_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs matter story from DB-native custody", async () => {
  const { appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-direct-matter-story");
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_story",
      slash: "/the_story",
      title: "The Story",
      description: "Tell the matter story for internal lawyer review.",
      status: "active",
      version: 1,
      familyId: "skill_story",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/The Story.md",
      matterRequired: true,
      paidProviderCall: true,
      sourceBacked: "required",
      promptConfig: {
        prompt: "Tell the story from the matter record.",
        citationPolicy: "Use raw FILE citations.",
      },
      modelPolicy: {
        task: "configurable_skill_run",
        provider: "openai-direct",
        model: "gpt-5.4",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
      validation: { status: "passed", messages: [], validatedAt: "2026-06-06T00:00:00.000Z" },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }],
  }, null, 2)}\n`);
  const runtimeMatter = runtimeDbMatter({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Direct Story Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const persistedMatterJson = [];
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath,
    configurableSkillRunsPath: path.join(appDir, "configurable-skill-runs.json"),
    configurableSkillRunProvider: async ({ matterContext }) => {
      calls.push(["provider", matterContext.evidence_blocks[0].citation]);
      return [
        "# The Story",
        "",
        "The dispute is about unpaid runtime story invoices.",
        "",
        "## Internal audit/source handles",
        "",
        "- FILE-0001 p1.b1",
        "",
      ].join("\n");
    },
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Direct Story Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(matter) {
        calls.push(["packet", matter.name, matter.matterName]);
        return directRuntimeDbMatterContextPacket(matter);
      },
      async readMatterJson(matter) {
        calls.push(["matter-json", matter.name]);
        return {
          matter_name: matter.matterName,
          client_name: matter.clientName,
          intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
        };
      },
      async artifactExists(matter, relativePath) {
        calls.push(["exists", matter.name, relativePath]);
        return false;
      },
      async persistTextArtifacts(matter, files) {
        calls.push(["persist-artifacts", matter.name, files.map((file) => file.relativePath)]);
        return files.map((file) => ({ relativePath: file.relativePath, objectRole: "matter_artifact" }));
      },
      async persistMatterJson(matter, matterJson) {
        calls.push(["persist-matter-json", matter.name, matterJson.brief_description]);
        persistedMatterJson.push(matterJson);
        return [{ relativePath: "matter.json", objectRole: "matter_artifact" }];
      },
      async runMaterializedMatterWrite() {
        throw new Error("materialized write should not be used for DB-native matter story");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const result = await postJson(baseUrl, "/api/matter-story", {
      matterName: "Legal Caption",
      overwrite: true,
    });

    assert.equal(result.state, "updated");
    assert.equal(result.description, "The dispute is about unpaid runtime story invoices.");
    assert.equal(result.runRecord.matterRoot, "postgres:DB Direct Story Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "20_Workshop/The Story.md",
      "20_Workshop/The Story.json",
      "matter.json",
    ]);
    assert.equal(persistedMatterJson[0].brief_description, "The dispute is about unpaid runtime story invoices.");
    assert.deepEqual(persistedMatterJson[0].intakes, [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }]);
    assert.deepEqual(calls, [
      ["packet", "DB Direct Story Matter", "Legal Caption"],
      ["matter-json", "DB Direct Story Matter"],
      ["exists", "DB Direct Story Matter", "20_Workshop/The Story.md"],
      ["provider", "FILE-0001 p1.b1"],
      ["persist-artifacts", "DB Direct Story Matter", ["20_Workshop/The Story.md", "20_Workshop/The Story.json"]],
      ["persist-matter-json", "DB Direct Story Matter", "The dispute is about unpaid runtime story invoices."],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs procedural posture diagnosis from DB-native custody", async () => {
  const { appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-posture-diagnosis");
  const runtimeMatter = runtimeDbMatter({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "DB Posture Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const persisted = [];
  const packet = directRuntimeDbMatterContextPacket(runtimeMatter);
  packet.library_artifacts.push({
    path: "10_Library/List of Dates.json",
    kind: "list_of_dates",
    entry_count: 1,
    entries: [{
      date_iso: "2026-04-20",
      event: "Agreement was signed.",
      legal_relevance: "Records agreement formation before posture review.",
      citation: "FILE-0001 p1.b1",
      perspective: "record_neutral",
    }],
  });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    proceduralPostureDiagnosisProvider: async () => proceduralPostureFinalDiagnosisFixture(),
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Posture Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(matter) {
        calls.push(["packet", matter.name]);
        return packet;
      },
      async readMatterJson(matter) {
        calls.push(["matter-json", matter.name]);
        return { matter_name: matter.matterName, client_name: matter.clientName };
      },
      async artifactExists(matter, relativePath) {
        calls.push(["exists", matter.name, relativePath]);
        return false;
      },
      async artifactStat(matter, relativePath) {
        const known = new Set([
          "10_Library/List of Dates.md",
          "10_Library/List of Dates.json",
          "10_Library/Source Index.json",
          "20_Workshop/The Story.md",
        ]);
        if (!known.has(relativePath)) return null;
        return { mtime: new Date("2026-06-29T10:00:00.000Z"), mtimeMs: Date.parse("2026-06-29T10:00:00.000Z"), isFile: () => true };
      },
      async readFilePreview(relativePath, matter) {
        calls.push(["preview", matter.name, relativePath]);
        if (relativePath === "20_Workshop/The Story.md") {
          return { content: "# The Story\n\nThe matter concerns agreement formation and no visible filed proceeding." };
        }
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      },
      async persistTextArtifacts(matter, files) {
        calls.push(["persist", matter.name, files.map((file) => file.relativePath)]);
        persisted.push(...files);
        return files.map((file) => ({ relativePath: file.relativePath, objectRole: "matter_artifact" }));
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const result = await postJson(baseUrl, "/api/procedural-posture-diagnosis", {
      matterName: "Legal Caption",
      overwrite: true,
    });

    assert.equal(result.state, "written");
    assert.equal(result.artifactPath, "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md",
      "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json",
    ]);
    assert.equal(persisted.length, 2);
    assert.match(String(persisted[0].text), /Filing and Procedural Posture Diagnosis/);
    assert.match(String(persisted[1].text), /procedural-posture-diagnosis\/v1/);
    assert.deepEqual(calls.map((call) => call[0]), ["packet", "matter-json", "exists", "preview", "persist"]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode fails closed without DB-native matter story helpers", async () => {
  const { tmp, appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-matter-story");
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_story",
      slash: "/the_story",
      title: "The Story",
      description: "Tell the matter story for internal lawyer review.",
      status: "active",
      version: 1,
      familyId: "skill_story",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/The Story.md",
      matterRequired: true,
      paidProviderCall: true,
      sourceBacked: "required",
      promptConfig: {
        prompt: "Tell the story from the matter record.",
        citationPolicy: "Use raw FILE citations.",
      },
      modelPolicy: {
        task: "configurable_skill_run",
        provider: "openai-direct",
        model: "gpt-5.4",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
      validation: { status: "passed", messages: [], validatedAt: "2026-06-06T00:00:00.000Z" },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }],
  }, null, 2)}\n`);
  const runtimeMatter = runtimeDbMatter({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Story Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath,
    configurableSkillRunsPath: path.join(appDir, "configurable-skill-runs.json"),
    configurableSkillRunProvider: async () => [
      "# The Story",
      "",
      "The dispute is about unpaid runtime invoices.",
      "",
      "## Internal audit/source handles",
      "",
      "- FILE-0001 p1.b1",
      "",
    ].join("\n"),
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Story Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async runMaterializedMatterWrite(matter, operation) {
        calls.push(["write", matter.name, matter.matterName]);
        const matterRoot = path.join(tmp, "materialized", matter.name);
        await writeExtractedTextMatter(matterRoot, matter);
        const operationResult = await operation({ matterRoot, matter });
        const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
        return {
          operationResult,
          persisted: [{ relativePath: "matter.json", briefDescription: matterJson.brief_description }],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const response = await fetch(`${baseUrl}/api/matter-story`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Legal Caption",
        overwrite: true,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, "matter_workflow.context_required");
    assert.deepEqual(calls, []);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode reads configurable skills from the runtime DB skill store", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-skills-store");
  const calls = [];
  const app = await createWorkbenchServer({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      tenantId: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
      listMatterFolders: async () => [],
      findMatterFolder: async () => null,
    },
    runtimeDbConfigurableSkillStore: {
      enabled: true,
      storePath: "postgres:configurable_skills",
      async readStore() {
        calls.push("read-db-skills");
        return {
          schema_version: "configurable-skills/v1",
          skills: [{
            id: "skill_story",
            title: "The Story",
            slash: "/the_story",
            description: "Tell the dispute story.",
            status: "active",
            version: 1,
            targetLane: "20_Workshop",
            outputArtifact: "20_Workshop/The Story.md",
            matterRequired: true,
            paidProviderCall: true,
            sourceBacked: "required",
            promptConfig: { prompt: "Tell the story.", citationPolicy: "Use sources." },
            modelPolicy: { task: "configurable_skill_run" },
            validation: { status: "passed", messages: [] },
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          }],
        };
      },
      async updateStore() {
        throw new Error("not used");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const result = await getJson(baseUrl, "/api/configurable-skills");

    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].id, "skill_story");
    assert.deepEqual(calls, ["read-db-skills"]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode reads skill ideas and samples from runtime DB services", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-skill-factory-stores");
  const calls = [];
  const idea = {
    id: "idea_route_plan",
    text: "Recommend law and forum.",
    status: "ready_for_review",
    matter: { matterName: "DB Matter", folderName: "DB Matter" },
    designBrief: {
      intendedUser: "advocate",
      problem: "Recommend law and forum.",
      expectedInputs: "matter record",
      expectedOutputArtifact: "20_Workshop/Filing Route Plan.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "medium",
      notes: "Include next steps.",
    },
    readiness: { ready: true },
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
  const app = await createWorkbenchServer({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      tenantId: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
      listMatterFolders: async () => [],
      findMatterFolder: async () => null,
    },
    runtimeDbSkillIdeasService: {
      enabled: true,
      async listIdeas() {
        calls.push("read-db-ideas");
        return { schema_version: "skill-ideas/v1", ideas: [idea] };
      },
      async getIdea(id) {
        calls.push(["get-db-idea", id]);
        return idea;
      },
    },
    runtimeDbSkillSamplesService: {
      enabled: true,
      async listSamplesForIdea({ ideaId }) {
        calls.push(["read-db-samples", ideaId]);
        return {
          schema_version: "skill-samples/v1",
          ideaId,
          designBriefHash: "hash",
          samples: [{ id: "sample_route_plan", ideaId, sampleMarkdown: "# Sample" }],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const ideas = await getJson(baseUrl, "/api/skill-ideas");
    const samples = await getJson(baseUrl, "/api/skill-ideas/idea_route_plan/samples");

    assert.equal(ideas.ideas[0].id, "idea_route_plan");
    assert.equal(samples.samples[0].id, "sample_route_plan");
    assert.deepEqual(calls, ["read-db-ideas", ["get-db-idea", "idea_route_plan"], ["read-db-samples", "idea_route_plan"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB sample output reads DB-native context before building sample", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-sample-output");
  const matter = runtimeDbMatter({ name: "Taori vs Roma Builder", matterName: "Taori vs Roma Builder" });
  const calls = [];
  const providerCalls = [];
  const app = await createWorkbenchServer({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [matter],
      findMatterFolder: async (name) => (name === matter.name || name === matter.matterName ? matter : null),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readWorkspace(targetMatter) {
        calls.push(["workspace", targetMatter.name]);
        return {
          folderName: targetMatter.name,
          inputLabel: `postgres:${targetMatter.name}`,
          metadata: {
            matterName: targetMatter.matterName,
            clientName: targetMatter.clientName,
            oppositeParty: "",
            matterType: "",
            jurisdiction: "",
          },
          fileCount: 1,
          directoryCount: 1,
          tree: { name: targetMatter.name, kind: "directory", path: "", children: [] },
        };
      },
      async readMatterContextPacket(targetMatter) {
        calls.push(["packet", targetMatter.name]);
        return directRuntimeDbMatterContextPacket(targetMatter);
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native sample output");
      },
    },
    skillSampleOutputProvider: async (payload) => {
      providerCalls.push(payload);
      return "# Sample\n\nReview from the current matter record.";
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: matter.name });
    const sample = await postJson(baseUrl, "/api/skill-ideas/sample-output", {
      idea: {
        id: "idea_taori",
        text: "discover issues from the matter record",
        status: "draft",
        matter: { matterName: matter.matterName, folderName: matter.name },
        designBrief: {
          intendedUser: "advocate",
          problem: "Find legal and factual issues.",
          expectedInputs: "matter record",
          expectedOutputArtifact: "20_Workshop/Issue Discovery.md",
          targetLane: "20_Workshop",
          paidPosture: "paid",
          riskLevel: "medium",
        },
      },
    });

    assert.equal(sample.schema_version, "skill-sample-output/v1");
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].matterContext.matter.folder_name, matter.name);
    assert.equal(providerCalls[0].matterContext.evidence_blocks[0].citation, "FILE-0001 p1.b1");
    assert.deepEqual(calls, [
      ["workspace", matter.name],
      ["packet", matter.name],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB sample output uses explicit active matter over stale saved idea matter", async () => {
  const { appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-sample-output-explicit-matter");
  const matter = runtimeDbMatter({ name: "Current Matter Folder", matterName: "Current Legal Caption" });
  const resolutionCalls = [];
  const providerCalls = [];
  const server = await startRuntimeDbTestServer({
    appDir,
    mattersHome,
    matter,
    runtimeMatterIndex: {
      async findMatterFolder(name) {
        resolutionCalls.push(name);
        return name === matter.name || name === matter.matterName ? matter : null;
      },
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(targetMatter) {
        return directRuntimeDbMatterContextPacket(targetMatter);
      },
    },
    skillSampleOutputProvider: async (payload) => {
      providerCalls.push(payload);
      return "# Sample\n\nBuilt from the explicitly selected current matter.";
    },
  });

  try {
    const sample = await postJson(server.baseUrl, "/api/skill-ideas/sample-output", {
      matterName: matter.name,
      idea: {
        id: "idea_stale_matter",
        text: "produce a simple list of parties in the matter",
        status: "draft",
        matter: { matterName: "Missing Matter", folderName: "Missing Matter" },
        designBrief: {
          intendedUser: "advocate",
          problem: "List parties.",
          expectedInputs: "matter record",
          expectedOutputArtifact: "20_Workshop/Parties.md",
          targetLane: "20_Workshop",
          paidPosture: "paid",
          riskLevel: "medium",
        },
      },
    });

    assert.equal(sample.schema_version, "skill-sample-output/v1");
    assert.equal(sample.matter.folder_name, matter.name);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].matterContext.matter.folder_name, matter.name);
    assert.deepEqual(resolutionCalls, [matter.name]);
  } finally {
    await server.close();
  }
});

test("runtime DB sample output provider failures are recorded as job telemetry", async () => {
  const { appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-api-sample-output-fail");
  const matter = runtimeDbMatter({ name: "Taori vs Roma Builder", matterName: "Taori vs Roma Builder" });
  const server = await startRuntimeDbTestServer({
    appDir,
    mattersHome,
    matter,
    env: {
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(targetMatter) {
        return directRuntimeDbMatterContextPacket(targetMatter);
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native sample output failures");
      },
    },
    skillSampleOutputProvider: async () => {
      const error = new Error("AI quota or billing limit reached. Ask the operator to check the AI account.");
      error.statusCode = 502;
      error.code = "provider.quota_exceeded";
      throw error;
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/skill-ideas/sample-output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: {
          id: "idea_taori",
          text: "discover issues from the matter record",
          matter: { matterName: matter.matterName, folderName: matter.name },
          designBrief: {
            intendedUser: "advocate",
            problem: "Find legal and factual issues.",
          },
        },
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.code, "assistant.unavailable");
    assert.match(payload.error, /Assistant is temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(payload), /provider|quota|billing|openrouter|openai/i);

    const jobs = await getJson(server.baseUrl, "/api/jobs?kind=skill_sample_output&status=failed&limit=5");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].kind, "skill_sample_output");
    assert.equal(jobs.jobs[0].label, "Generate skill sample");
    assert.equal(jobs.jobs[0].matterName, matter.name);
    assert.equal(jobs.jobs[0].errorCode, "provider.quota_exceeded");
    assert.equal(jobs.jobs[0].failureClass, "provider");
  } finally {
    await server.close();
  }
});

test("runtime DB skill creation validates approved samples through DB-native context without matters home", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-create-skill");
  const matter = runtimeDbMatter({ name: "Taori vs Roma Builder", matterName: "Taori vs Roma Builder" });
  const calls = [];
  const matterEventCalls = [];
  const store = { schema_version: "configurable-skills/v1", skills: [] };
  const idea = {
    id: "idea_issues",
    text: "discover legal and factual issues from the matter record",
    status: "ready_for_review",
    matter: { matterName: matter.matterName, folderName: matter.name },
    designBrief: {
      intendedUser: "advocate",
      problem: "Find legal and factual issues from the matter record.",
      expectedInputs: "matter record",
      expectedOutputArtifact: "20_Workshop/Issue Discovery.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "medium",
      notes: "Internal review only.",
    },
    readiness: { ready: true },
  };
  const sample = {
    id: "sample_issues",
    ideaId: idea.id,
    approved: true,
    matter: { matter_name: matter.matterName, folder_name: matter.name },
    sampleMarkdown: "# Issues Note\n\nTaori issue supported by the record (FILE-0001 p1.b1).",
    aiRun: { provider: "openai-direct", model: "gpt-5.4", task: "skill_sample_output" },
  };
  const app = await createWorkbenchServer({
    env: {
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [matter],
      findMatterFolder: async (name) => (name === matter.name || name === matter.matterName ? matter : null),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(targetMatter) {
        calls.push(["packet", targetMatter.name]);
        return directRuntimeDbMatterContextPacket(targetMatter);
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native skill creation validation");
      },
    },
    skillIdeasService: {
      getIdea: async (id) => {
        assert.equal(id, idea.id);
        return idea;
      },
    },
    skillSamplesService: {
      getApprovedCurrentSample: async ({ ideaId }) => {
        assert.equal(ideaId, idea.id);
        return sample;
      },
    },
    configurableSkillStore: {
      readStore: async () => store,
      updateStore: async (mutator, options = {}) => {
        const result = await mutator(store);
        if (typeof options.afterWriteSql === "function") {
          matterEventCalls.push(options.afterWriteSql({ result, store }));
        }
        return result;
      },
    },
    matterEventsService: {
      appendEventMutationSql: (event) => {
        matterEventCalls.push(event);
        return "insert into matter_events (...) values (...);";
      },
    },
    configurableSkillAuthoringProvider: async () => ({
      title: "Issue Discovery",
      slash: "/issue_discovery",
      description: "Find legal and factual issues from the current matter record.",
      target_lane: "20_Workshop",
      output_artifact: "20_Workshop/Issue Discovery.md",
      matter_required: true,
      paid_provider_call: true,
      source_backed: "required",
      prompt: "Prepare a source-backed issue discovery note for the active matter. Identify legal issues, factual issues, weaknesses, missing evidence, and next steps. Every material point must cite raw FILE-NNNN pX.bY citations and preserve uncertainty where the record is incomplete.",
      citation_policy: "Every material point must cite raw FILE-NNNN pX.bY citations.",
    }),
    configurableSkillRunProvider: async () => [
      "# Issue Discovery",
      "",
      "Taori issues include payment and possession questions supported by the matter record (FILE-0001 p1.b1).",
    ].join("\n"),
    skillRouterProvider: async () => ({
      intent: "new_skill",
      decision: "new_skill",
      confidence: 0.95,
      matched_skill: "",
      matched_skill_card: null,
      reason: "No overlapping skill.",
      suggested_next_step: "create_new",
      suggested_next_action: "Create the custom skill.",
      recommended_action: "new_skill",
      user_gate_required: false,
      mece_violation: false,
      legal_setting: {
        jurisdiction: "",
        forum: "",
        case_type: "",
        procedure_stage: "",
        side: "",
        relief_type: "",
      },
      override_requires: [],
      requires_confirmation: false,
    }),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const created = await postJson(baseUrl, `/api/skill-ideas/${idea.id}/create-skill`, {});

    assert.equal(created.skill.status, "active");
    assert.equal(created.skill.slash, "/issue_discovery");
    assert.deepEqual(calls, [["packet", matter.name]]);
    const canonicalEvent = matterEventCalls.find((entry) => entry?.eventType === "custom_skill.created");
    assert.ok(canonicalEvent, "expected runtime DB skill creation to prepare a custom_skill.created event");
    assert.equal(canonicalEvent.matterId, matter.id);
    assert.equal(canonicalEvent.matterName, matter.name);
    assert.equal(canonicalEvent.payload.source_idea_id, idea.id);
    assert.equal(canonicalEvent.payload.source_sample_id, sample.id);
    assert.equal(canonicalEvent.payload.slash, "/issue_discovery");
    assert.ok(matterEventCalls.includes("insert into matter_events (...) values (...);"));
  } finally {
    app.server.close();
  }
});

test("runtime DB skill creation uses explicit active matter over stale saved idea matter", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-create-skill-explicit-matter");
  const matter = runtimeDbMatter({ name: "Current Matter Folder", matterName: "Current Legal Caption" });
  const resolutionCalls = [];
  const packetCalls = [];
  const store = { schema_version: "configurable-skills/v1", skills: [] };
  const idea = {
    id: "idea_stale_create_matter",
    text: "produce a comparison chart of terms",
    status: "ready_for_review",
    matter: { matterName: "Missing Matter", folderName: "Missing Matter" },
    designBrief: {
      intendedUser: "advocate",
      problem: "Compare key terms.",
      expectedInputs: "matter record",
      expectedOutputArtifact: "20_Workshop/Comparison Chart.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "medium",
    },
    readiness: { ready: true },
  };
  const sample = {
    id: "sample_stale_create_matter",
    ideaId: idea.id,
    approved: true,
    matter: { matter_name: matter.matterName, folder_name: matter.name },
    sampleMarkdown: "# Comparison Chart\n\nCurrent-matter sample supported by the record (FILE-0001 p1.b1).",
    aiRun: { provider: "openai-direct", model: "gpt-5.4", task: "skill_sample_output" },
  };
  const app = await createWorkbenchServer({
    env: {
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [matter],
      findMatterFolder: async (name) => {
        resolutionCalls.push(name);
        return name === matter.name || name === matter.matterName ? matter : null;
      },
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(targetMatter) {
        packetCalls.push(targetMatter.name);
        return directRuntimeDbMatterContextPacket(targetMatter);
      },
      async runMaterializedMatterRead() {
        throw new Error("materialized read should not be used for DB-native skill creation validation");
      },
    },
    skillIdeasService: {
      getIdea: async (id) => {
        assert.equal(id, idea.id);
        return idea;
      },
      updateIdeaStatus: async () => ({ idea: { ...idea, status: "created" } }),
    },
    skillSamplesService: {
      getApprovedCurrentSample: async ({ ideaId }) => {
        assert.equal(ideaId, idea.id);
        return sample;
      },
    },
    configurableSkillStore: {
      readStore: async () => store,
      updateStore: async (mutator) => mutator(store),
    },
    configurableSkillAuthoringProvider: async () => ({
      title: "Comparison Chart",
      slash: "/comparison_chart",
      description: "Compare key terms from the current matter record.",
      target_lane: "20_Workshop",
      output_artifact: "20_Workshop/Comparison Chart.md",
      matter_required: true,
      paid_provider_call: true,
      source_backed: "required",
      prompt: "Prepare a source-backed comparison chart for the active matter.",
      citation_policy: "Use raw FILE citations for factual points.",
    }),
    configurableSkillRunProvider: async () => "# Comparison Chart\n\nCurrent matter run supported by the record (FILE-0001 p1.b1).",
    skillRouterProvider: async () => ({
      intent: "new_skill",
      decision: "new_skill",
      confidence: 0.95,
      matched_skill: "",
      matched_skill_card: null,
      reason: "No overlapping skill.",
      suggested_next_step: "create_new",
      suggested_next_action: "Create the custom skill.",
      recommended_action: "new_skill",
      user_gate_required: false,
      mece_violation: false,
      legal_setting: {},
      override_requires: [],
      requires_confirmation: false,
    }),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const created = await postJson(baseUrl, `/api/skill-ideas/${idea.id}/create-skill`, { matterName: matter.name });

    assert.equal(created.skill.status, "active");
    assert.equal(created.skill.slash, "/comparison_chart");
    assert.deepEqual(resolutionCalls, [matter.name]);
    assert.deepEqual(packetCalls, [matter.name]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode checks skill factory health from runtime DB services", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-skill-factory-health");
  const calls = [];
  const designBrief = {
    intendedUser: "advocate",
    problem: "Recommend law and forum.",
    expectedInputs: "matter record",
    expectedOutputArtifact: "20_Workshop/Filing Route Plan.md",
    targetLane: "20_Workshop",
    paidPosture: "paid",
    riskLevel: "medium",
    notes: "Include next steps.",
  };
  const sampleHash = hashDesignBrief(designBrief);
  const app = await createWorkbenchServer({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      tenantId: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
      listMatterFolders: async () => [],
      findMatterFolder: async () => null,
    },
    runtimeDbSkillIdeasService: {
      enabled: true,
      storePath: "postgres:skill_ideas",
      async listIdeas() {
        calls.push("db-ideas");
        return {
          schema_version: "skill-ideas/v1",
          ideas: [{
            id: "idea_route_plan",
            text: "Recommend law and forum.",
            status: "ready_for_review",
            matter: { matterName: "DB Matter", folderName: "DB Matter" },
            designBrief,
            readiness: { ready: true },
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          }],
        };
      },
    },
    runtimeDbSkillSamplesService: {
      enabled: true,
      storePath: "postgres:skill_samples",
      async listSamples() {
        calls.push("db-samples");
        return {
          schema_version: "skill-samples/v1",
          samples: [{
            id: "sample_route_plan",
            ideaId: "idea_route_plan",
            approved: true,
            designBriefHash: sampleHash,
          }],
        };
      },
    },
    runtimeDbConfigurableSkillStore: {
      enabled: true,
      storePath: "postgres:configurable_skills",
      async readStore() {
        calls.push("db-skills");
        return {
          schema_version: "configurable-skills/v1",
          skills: [{
            id: "skill_route_plan",
            title: "Filing Route Plan",
            slash: "/filing_route_plan",
            description: "Recommend law and forum.",
            status: "active",
            version: 1,
            familyId: "skill_route_plan",
            sourceIdeaId: "idea_route_plan",
            sourceSampleId: "sample_route_plan",
            approvedSampleHash: sampleHash,
            targetLane: "20_Workshop",
            outputArtifact: "20_Workshop/Filing Route Plan.md",
            matterRequired: true,
            paidProviderCall: true,
            sourceBacked: "required",
            promptConfig: { prompt: "Recommend law and forum.", citationPolicy: "Use sources." },
            modelPolicy: { task: "configurable_skill_run" },
            validation: { status: "passed", messages: [] },
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          }],
        };
      },
      async updateStore() {
        throw new Error("not used");
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const health = await getJson(baseUrl, "/api/skill-factory-health");

    assert.equal(health.schema_version, "skill-factory-health/v1");
    assert.equal(health.state, "ok");
    assert.equal(health.summary.ideas, 1);
    assert.equal(health.summary.samples, 1);
    assert.equal(health.summary.configurableSkills, 1);
    assert.deepEqual(health.storePaths, {
      ideas: "postgres:skill_ideas",
      samples: "postgres:skill_samples",
      skills: "postgres:configurable_skills",
    });
    assert.deepEqual(calls, ["db-ideas", "db-samples", "db-skills"]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode writes command interactions through runtime DB audit service", async () => {
  const { mattersHome } = await runtimeDbTestPaths("runtime-db-api-command-log");
  const runtimeMatter = runtimeDbMatter({
    id: "77777777-7777-4777-8777-777777777777",
    name: "DB Command Matter",
    matterName: "DB Command Matter",
    clientName: "Runtime Client",
    runtimeStorageMode: "postgres",
  });
  const calls = [];
  const app = await createWorkbenchServer({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      tenantId: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (name === runtimeMatter.name ? runtimeMatter : null),
    },
    runtimeDbCommandInteractionLogService: {
      enabled: true,
      logPath: "postgres:audit_events/command_interaction",
      async appendInteraction(entry) {
        calls.push(entry);
        return {
          schema_version: "command-interaction-log/v1",
          logged: true,
          path: "postgres:audit_events/command_interaction",
          timestamp: "2026-06-06T00:00:00.000Z",
        };
      },
      async readRecentInteractions() {
        return [];
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const result = await postJson(baseUrl, "/api/command-interactions", {
      matterName: "DB Command Matter",
      typed_input: "/describe_sources",
      matched_command: "/describe_sources",
      status: "failed",
    });

    assert.equal(result.path, "postgres:audit_events/command_interaction");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].matter.folderName, "DB Command Matter");
    assert.equal(calls[0].matched_command, "/describe_sources");
  } finally {
    app.server.close();
  }
});

function proceduralPostureFinalDiagnosisFixture() {
  return {
    schema_version: "posture_diagnosis_final/v1",
    status: "provisional_mw_inferred",
    short_diagnosis: "The visible DB record suggests pre-filing posture, subject to lawyer confirmation.",
    court_forum: {
      value: "Civil forum to be confirmed",
      confidence: "medium",
      why: "The record shows an agreement event but no filed proceeding.",
      source_refs: ["FILE-0001 p1.b1"],
      lawyer_to_confirm: "Confirm forum and whether proceedings exist outside the supplied record.",
    },
    procedural_posture: {
      value: "Pre-filing / posture uncertain",
      confidence: "medium",
      why: "No proceeding number, order, or filing is visible in the supplied packet.",
      source_refs: ["FILE-0001 p1.b1"],
      lawyer_to_confirm: "Confirm current stage.",
    },
    possible_filings: [{
      priority: "primary",
      filing_or_remedy: "Confirm forum before drafting",
      reason: "The record lacks a filed-proceeding marker.",
      key_facts: ["Agreement was signed"],
      caveats: ["Forum confirmation required"],
      source_refs: ["FILE-0001 p1.b1"],
    }],
    recommended_working_path: {
      priority: "primary",
      filing_or_remedy: "Confirm procedural status pack",
      reason: "The next drafting path depends on whether a proceeding exists.",
      key_facts: ["No filed proceeding visible"],
      caveats: ["Lawyer confirmation required"],
      source_refs: ["FILE-0001 p1.b1"],
    },
    governing_law: [{ text: "Governing framework requires forum confirmation.", source_refs: ["FILE-0001 p1.b1"] }],
    central_facts: [{ text: "Agreement execution is visible in the record.", source_refs: ["FILE-0001 p1.b1"] }],
    adverse_or_difficult_facts: [{ text: "The record is silent on any filed proceeding.", source_refs: ["FILE-0001 p1.b1"] }],
    missing_information: ["Forum", "Current stage"],
    lawyer_to_confirm: ["Court/forum", "Procedural stage", "Priority remedy"],
    internal_source_handles: ["FILE-0001 p1.b1"],
    critique_handling: [{ critique_signal: "Keep uncertainty", disposition: "accepted", reason: "Marked posture uncertain." }],
  };
}

function directRuntimeDbMatterContextPacket(matter) {
  return {
    schema_version: "matter-context-packet/v1",
    generated_at: "2026-04-28T10:00:00.000Z",
    matter: {
      folder_name: matter.name,
      matter_name: matter.matterName,
      client_name: matter.clientName,
      opposite_party: "",
      matter_type: "",
      jurisdiction: "",
      brief_description: "",
    },
    file_registers: [{
      intake_id: "INTAKE-01",
      intake_dir: "00_Inbox/Intake 01 - Initial",
      path: "00_Inbox/Intake 01 - Initial/File Register.csv",
      rows: [{ file_id: "FILE-0001" }],
    }],
    sources: [{
      source_id: "FILE-0001",
      content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      file_id: "FILE-0001",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
      original_name: "facts.txt",
      category: "Text Notes",
      intake_id: "INTAKE-01",
      intake_dir: "00_Inbox/Intake 01 - Initial",
      extraction_record_path: "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json",
      extraction_engine: "runtime-db-direct@test",
      page_count: 1,
      source_label: "Agreement note",
      source_short_label: "Agreement note",
      document_type: "agreement",
      document_date: "2026-04-20",
      needs_review: false,
      warnings: [],
      sample_citations: ["FILE-0001 p1.b1"],
    }],
    evidence_blocks: [{
      citation: "FILE-0001 p1.b1",
      source_id: "FILE-0001",
      content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      file_id: "FILE-0001",
      page: 1,
      block_id: "p1.b1",
      block_type: "paragraph",
      text: "Agreement was signed on 20 April 2026 by Runtime Client and the opposite party.",
      confidence: 0.98,
      needs_review: false,
      source_label: "Agreement note",
      source_short_label: "Agreement note",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
      extraction_engine: "runtime-db-direct@test",
    }],
    library_artifacts: [{
      path: "10_Library/Source Index.json",
      kind: "source_index",
      summary: "1 source descriptor(s)",
      schema_version: "source-index/v1",
      source_count: 1,
    }],
    limits: {
      included_sources: 1,
      omitted_sources: 0,
      included_blocks: 1,
      omitted_blocks: 0,
    },
    warnings: [],
  };
}

async function writeExtractedTextMatter(matterRoot, matter) {
  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  const extractedDir = path.join(intakeDir, "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: matter.matterName,
    client_name: matter.clientName,
    intakes: [{
      intake_id: "INTAKE-01",
      intake_dir: "00_Inbox/Intake 01 - Initial",
    }],
  }, null, 2)}\n`);
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status,engine_version,notes",
    "FILE-0001,INTAKE-01,source/facts.txt,,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,facts.txt,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,25,,unique,test,",
    "",
  ].join("\n"));
  await writeFile(path.join(extractedDir, "FILE-0001.json"), `${JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    engine: "text-extract@test",
    extracted_at: "2026-04-28T10:00:00.000Z",
    language_detected: ["en"],
    page_count: 1,
    warnings: [],
    pages: [{
      page: 1,
      ocr_required: false,
      confidence_avg: 0.98,
      needs_review: false,
      blocks: [{
        id: "p1.b1",
        type: "paragraph",
        text: "Agreement was signed on 20 April 2026 by Runtime Client and the opposite party.",
      }],
    }],
  }, null, 2)}\n`);
}

function sourceDescriptorForPacket(packet) {
  return {
    file_id: packet.file_id,
    source_id: packet.file_id,
    sha256: packet.sha256,
    content_hash: packet.content_hash,
    source_path: packet.source_path,
    display_label: "Agreement note dated 20 April 2026",
    short_label: "Agreement note",
    suggested_label: "Agreement note dated 20 April 2026",
    confirmed_label: "",
    label_status: "suggested",
    label_source: "model",
    label_reason: "The supplied source block records an agreement date.",
    label_revision: 1,
    confirmed_by: "",
    confirmed_at: "",
    document_type: "agreement",
    document_date: "2026-04-20",
    date_basis: "body_text",
    parties: {
      from: "",
      to: [],
      cc: [],
      author: "",
      court: "",
      judge: "",
      issuing_party: "",
      recipient_party: "",
      deponent: "",
      signatory: "",
    },
    confidence: 0.88,
    needs_review: false,
    evidence: [{ citation: "FILE-0001 p1.b1", reason: "The block records the agreement date." }],
    warnings: [],
  };
}

async function writeListOfDatesRefreshMatter(matterRoot, matter) {
  await writeExtractedTextMatter(matterRoot, matter);
  const libraryDir = path.join(matterRoot, "10_Library");
  await mkdir(libraryDir, { recursive: true });
  const source = sourceDescriptorForPacket({
    file_id: "FILE-0001",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
  });
  await writeFile(path.join(libraryDir, "Source Index.json"), `${JSON.stringify({
    schema_version: "source-index/v1",
    generated_at: "2026-04-28T10:00:00.000Z",
    sources: [source],
  }, null, 2)}\n`);
  await writeFile(path.join(libraryDir, "List of Dates.json"), `${JSON.stringify({
    schema_version: "list-of-dates/v1",
    engine_version: "create-listofdates-v1-ai",
    generated_at: "2026-04-28T10:00:00.000Z",
    matter: {
      matter_name: matter.matterName,
      client_name: matter.clientName,
    },
    source_record_count: 1,
    source_snapshot: [{
      file_id: "FILE-0001",
      source_id: "FILE-0001",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
      document_type: "agreement",
      document_date: "2026-04-20",
      needs_review: false,
      source_label: "Old source label",
      source_short_label: "Old label",
    }],
    entries: [{
      date_iso: "2026-04-20",
      date_text: "20 April 2026",
      event: "Agreement was signed by Runtime Client and the opposite party.",
      event_type: "agreement",
      legal_relevance: "Supports the client's chronology because the cited source records the agreement date.",
      issue_tags: ["agreement"],
      perspective: "record_neutral",
      citation: "FILE-0001 p1.b1",
      source_file_id: "FILE-0001",
      source_id: "FILE-0001",
      content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source_label: "Old source label",
      source_short_label: "Old label",
      file_id: "FILE-0001",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
      page: 1,
      block_id: "p1.b1",
      needs_review: false,
      confidence: 0.91,
    }],
  }, null, 2)}\n`);
}

function jsonApiSpawn(calls, payload) {
  return (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    return {
      status: 0,
      stdout: `${JSON.stringify(payload)}\n`,
      stderr: "",
    };
  };
}
