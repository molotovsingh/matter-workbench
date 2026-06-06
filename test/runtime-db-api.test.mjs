import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { createWorkbenchServer } from "../server.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("runtime DB matter index drives /api/matters and switch while workspace reads local storage", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-"));
  const mattersHome = path.join(tmp, "matters");
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

test("runtime DB postgres storage mode serves workspace and files without local matter folder", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-storage-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const rawBytes = Buffer.from("%PDF-1.7");
  const calls = [];

  const runtimeMatter = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "DB Listed Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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
    assert.match(extractBody.error, /DB storage mode/i);

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

test("runtime DB postgres storage mode runs matter-init through materialized DB write service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-init-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "DB Init Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const result = await postJson(baseUrl, "/api/matter-init", {
      matterName: "Legal Caption",
      metadata: {
        matterName: "Legal Caption",
        clientName: "Runtime Client",
      },
    });

    assert.equal(result.counts.scannedFiles, 1);
    assert.equal(result.matterRoot, "postgres:DB Init Matter");
    assert.deepEqual(result.dbPersistence.persisted, [
      { relativePath: "00_Inbox/Intake 01 - Initial/File Register.csv", objectRole: "matter_artifact" },
    ]);
    assert.deepEqual(calls, [["write", "DB Init Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs extract through materialized DB write service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-extract-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "DB Extract Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const result = await postJson(baseUrl, "/api/extract", {
      matterName: "Legal Caption",
      forceRefresh: true,
    });

    assert.equal(result.counts.extracted, 1);
    assert.equal(result.counts.failed, 0);
    assert.equal(result.matterRoot, "postgres:DB Extract Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "00_Inbox/Intake 01 - Initial/Extraction Log.csv",
      "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json",
    ]);
    assert.deepEqual(calls, [["write", "DB Extract Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs source labels through materialized DB write service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-sources-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "DB Source Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const result = await postJson(baseUrl, "/api/describe-sources", {
      matterName: "Legal Caption",
    });

    assert.equal(result.counts.recordsRead, 1);
    assert.equal(result.counts.descriptors, 1);
    assert.equal(result.matterRoot, "postgres:DB Source Matter");
    assert.deepEqual(result.dbPersistence.persisted, [
      { relativePath: "10_Library/Source Index.json", objectRole: "matter_artifact" },
    ]);
    assert.deepEqual(calls, [["write", "DB Source Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs create-listofdates through materialized DB write service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-lod-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "55555555-5555-4555-8555-555555555555",
    name: "DB Chronology Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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
        perspective: "client_favourable",
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

    const result = await postJson(baseUrl, "/api/create-listofdates", {
      matterName: "Legal Caption",
    });

    assert.equal(result.counts.recordsRead, 1);
    assert.equal(result.counts.entries, 1);
    assert.equal(result.matterRoot, "postgres:DB Chronology Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "10_Library/List of Dates.json",
      "10_Library/List of Dates.md",
    ]);
    assert.deepEqual(calls, [["write", "DB Chronology Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs list-of-dates label refresh through materialized DB write service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-lod-refresh-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "66666666-6666-4666-8666-666666666666",
    name: "DB Refresh Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const result = await postJson(baseUrl, "/api/create-listofdates/refresh-labels", {
      matterName: "Legal Caption",
    });

    assert.equal(result.refreshMode, "label_refresh");
    assert.equal(result.counts.refreshedEntries, 1);
    assert.equal(result.matterRoot, "postgres:DB Refresh Matter");
    assert.deepEqual(result.dbPersistence.persisted.map((item) => item.relativePath), [
      "10_Library/List of Dates.json",
      "10_Library/List of Dates.md",
    ]);
    assert.deepEqual(calls, [["write", "DB Refresh Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode reads matter context through materialized DB read service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-context-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "77777777-7777-4777-8777-777777777777",
    name: "DB Context Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const context = await getJson(baseUrl, "/api/matter-context?matter=Legal%20Caption");
    assert.equal(context.schema_version, "matter-context-preview/v1");
    assert.equal(context.counts.file_registers, 1);
    assert.equal(context.counts.evidence_blocks_included, 1);

    const search = await getJson(baseUrl, "/api/matter-context/search?matter=Legal%20Caption&q=agreement");
    assert.equal(search.schema_version, "matter-context-search/v1");
    assert.equal(search.counts.matches, 1);
    assert.match(search.results[0].snippet, /Agreement was signed/);
    assert.deepEqual(calls, [
      ["read", "DB Context Matter", "Legal Caption"],
      ["read", "DB Context Matter", "Legal Caption"],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode answers copilot from materialized DB matter context", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-copilot-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "88888888-8888-4888-8888-888888888888",
    name: "DB Copilot Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const answer = await postJson(baseUrl, "/api/matter-copilot/answer", {
      matterName: "Legal Caption",
      question: "When was the agreement signed?",
    });

    assert.equal(answer.schema_version, "matter-copilot-answer/v1");
    assert.equal(answer.answer_status, "answered");
    assert.equal(answer.sources[0].raw_citation, "FILE-0001 p1.b1");
    assert.deepEqual(calls, [
      ["read", "DB Copilot Matter", "Legal Caption"],
      ["provider", "When was the agreement signed?", 1],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode reads rerun advice and doctor scan through materialized DB read service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-read-tools-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "99999999-9999-4999-8999-999999999999",
    name: "DB Read Tools Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const advice = await getJson(baseUrl, "/api/rerun-advice?matter=Legal%20Caption&skill=%2Fcreate_listofdates");
    assert.equal(typeof advice.state, "string");

    const scan = await postJson(baseUrl, "/api/doctor/scan", {
      matterName: "Legal Caption",
    });
    assert.deepEqual(scan.issues, []);
    assert.deepEqual(calls, [
      ["read", "DB Read Tools Matter", "Legal Caption"],
      ["read", "DB Read Tools Matter", "Legal Caption"],
    ]);
  } finally {
    app.server.close();
  }
});

test("runtime DB postgres storage mode runs doctor fix through materialized DB write service", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-doctor-fix-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const runtimeMatter = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "DB Doctor Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
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

    const result = await postJson(baseUrl, "/api/doctor/fix", {
      matterName: "Legal Caption",
      fixIds: ["legacy-layout"],
    });

    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.remaining, []);
    assert.deepEqual(result.dbPersistence.persisted, []);
    assert.deepEqual(calls, [["write", "DB Doctor Matter", "Legal Caption"]]);
  } finally {
    app.server.close();
  }
});

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
      perspective: "client_favourable",
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
