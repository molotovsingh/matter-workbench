import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";

async function postMultipart(baseUrl, pathName, form) {
  const { response, payload } = await postMultipartRaw(baseUrl, pathName, form);
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function postMultipartRaw(baseUrl, pathName, form) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  return { response, payload };
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

function appendTextFile(form, fieldName, filename, text) {
  form.append(fieldName, new Blob([text], { type: "text/plain" }), filename);
}

async function withServer(run, options = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-upload-api-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(appDir, { recursive: true });
  const app = await createWorkbenchServer({
    appDir,
    env: options.env || { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    maxUploadBytes: options.maxUploadBytes,
    port: 0,
    runtimeDbStorageService: options.runtimeDbStorageService,
    runtimeMatterIndex: options.runtimeMatterIndex,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    await run({ baseUrl, mattersHome });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

test("multipart upload creates a matter and adds a follow-up intake", async () => {
  await withServer(async ({ baseUrl, mattersHome }) => {
    const createForm = new FormData();
    createForm.set("name", "Upload Matter");
    createForm.set("metadata", JSON.stringify({
      matterName: "Upload Matter",
      clientName: "Client A",
      oppositeParty: "Opposite B",
      matterType: "Consumer",
      jurisdiction: "Delhi",
      briefDescription: "Uploaded through multipart API test.",
    }));
    createForm.set("paths", JSON.stringify(["evidence/notice.txt"]));
    appendTextFile(createForm, "files", "notice.txt", "Notice served on 1 January 2026.");

    const created = await postMultipart(baseUrl, "/api/matters/new", createForm);
    assert.equal(created.folderName, "Upload Matter");
    assert.equal(created.metadata.matterName, "Upload Matter");
    assert.ok(created.fileCount > 0);

    const matterRoot = path.join(mattersHome, "Upload Matter");
    const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
    assert.equal(matterJson.matter_name, "Upload Matter");
    const initialRegister = await readFile(
      path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
      "utf8",
    );
    assert.match(initialRegister, /notice\.txt/);

    const addForm = new FormData();
    addForm.set("label", "Follow Up");
    addForm.set("paths", JSON.stringify(["receipt.txt"]));
    appendTextFile(addForm, "files", "receipt.txt", "Receipt issued on 2 January 2026.");

    const updated = await postMultipart(baseUrl, "/api/matters/add-files", addForm);
    assert.equal(updated.folderName, "Upload Matter");
    assert.equal(updated.intakeAdded.intakeId, "INTAKE-02");
    assert.equal(updated.intakeAdded.label, "Follow Up");
    assert.equal(updated.intakeAdded.unique, 1);
    assert.equal(updated.intakeAdded.duplicatesInBatch, 0);
    assert.equal(updated.intakeAdded.duplicatesOfPrior, 0);
    assert.match(updated.intakeAdded.receivedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(updated.intakeAdded.intakeDirName, /Follow Up/);
  });
});

test("multipart upload creates runtime DB matter without a live matter folder", async () => {
  const runtimeMatters = [];
  const calls = [];
  await withServer(async ({ baseUrl, mattersHome }) => {
    const createForm = new FormData();
    createForm.set("name", "DB Upload Matter");
    createForm.set("metadata", JSON.stringify({
      matterName: "DB Upload Matter",
      clientName: "Runtime Client",
      oppositeParty: "Runtime Opposite",
      matterType: "Consumer",
      jurisdiction: "Delhi",
      briefDescription: "Created through runtime DB upload.",
    }));
    createForm.set("paths", JSON.stringify(["evidence/notice.txt"]));
    appendTextFile(createForm, "files", "notice.txt", "Notice served on 1 January 2026.");

    const created = await postMultipart(baseUrl, "/api/matters/new", createForm);

    assert.equal(created.inputLabel, "postgres:DB Upload Matter");
    assert.equal(created.metadata.clientName, "Runtime Client");
    assert.equal(created.fileCount, 2);
    assert.deepEqual(calls.map((call) => call[0]), ["create", "workspace"]);
    await assert.rejects(
      () => readFile(path.join(mattersHome, "DB Upload Matter", "matter.json"), "utf8"),
      /ENOENT/,
    );
  }, {
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => runtimeMatters,
      findMatterFolder: async (name) => runtimeMatters.find((matter) => matter.name === name || matter.matterName === name) || null,
    },
    runtimeDbStorageService: {
      enabled: true,
      async createMatterFromUploadedFiles({ name, metadata, files, relativePaths }) {
        calls.push(["create", name, files.length, relativePaths]);
        const matter = {
          id: "11111111-1111-4111-8111-111111111111",
          name,
          matterName: metadata.matterName,
          clientName: metadata.clientName,
          oppositeParty: metadata.oppositeParty,
          matterType: metadata.matterType,
          jurisdiction: metadata.jurisdiction,
          briefDescription: metadata.briefDescription,
          runtimeStorageMode: "postgres",
        };
        runtimeMatters.push(matter);
        return matter;
      },
      async readWorkspace(matter) {
        calls.push(["workspace", matter.name]);
        return {
          folderName: matter.name,
          inputLabel: `postgres:${matter.name}`,
          metadata: {
            matterName: matter.matterName,
            clientName: matter.clientName,
            oppositeParty: matter.oppositeParty,
            matterType: matter.matterType,
            jurisdiction: matter.jurisdiction,
          },
          fileCount: 2,
          directoryCount: 2,
          tree: {
            name: matter.name,
            kind: "directory",
            path: "",
            children: [],
          },
        };
      },
    },
  });
});

test("multipart upload creates runtime DB matter without configuring matters home", async () => {
  const runtimeMatters = [];
  const calls = [];
  await withServer(async ({ baseUrl }) => {
    const createForm = new FormData();
    createForm.set("name", "DB No Home Matter");
    createForm.set("metadata", JSON.stringify({
      matterName: "DB No Home Matter",
      clientName: "Runtime Client",
      oppositeParty: "Runtime Opposite",
      matterType: "Consumer",
      jurisdiction: "Delhi",
    }));
    createForm.set("paths", JSON.stringify(["notice.txt"]));
    appendTextFile(createForm, "files", "notice.txt", "Notice served on 1 January 2026.");

    const created = await postMultipart(baseUrl, "/api/matters/new", createForm);

    assert.equal(created.inputLabel, "postgres:DB No Home Matter");
    assert.equal(created.metadata.clientName, "Runtime Client");
    assert.deepEqual(calls.map((call) => call[0]), ["create", "workspace"]);
  }, {
    env: {},
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => runtimeMatters,
      findMatterFolder: async (name) => runtimeMatters.find((matter) => matter.name === name || matter.matterName === name) || null,
    },
    runtimeDbStorageService: {
      enabled: true,
      async createMatterFromUploadedFiles({ name, metadata }) {
        calls.push(["create", name]);
        const matter = {
          id: "22222222-2222-4222-8222-222222222222",
          name,
          matterName: metadata.matterName,
          clientName: metadata.clientName,
          oppositeParty: metadata.oppositeParty,
          matterType: metadata.matterType,
          jurisdiction: metadata.jurisdiction,
          runtimeStorageMode: "postgres",
        };
        runtimeMatters.push(matter);
        return matter;
      },
      async readWorkspace(matter) {
        calls.push(["workspace", matter.name]);
        return {
          folderName: matter.name,
          inputLabel: `postgres:${matter.name}`,
          metadata: {
            matterName: matter.matterName,
            clientName: matter.clientName,
          },
          fileCount: 2,
          directoryCount: 2,
          tree: {
            name: matter.name,
            kind: "directory",
            path: "",
            children: [],
          },
        };
      },
    },
  });
});

test("multipart add-files appends to runtime DB matter without a live matter folder", async () => {
  const runtimeMatters = [{
    id: "11111111-1111-4111-8111-111111111111",
    name: "DB Existing Matter",
    matterName: "DB Existing Matter",
    clientName: "Runtime Client",
    runtimeStorageMode: "postgres",
  }];
  const calls = [];
  await withServer(async ({ baseUrl, mattersHome }) => {
    const addForm = new FormData();
    addForm.set("matterName", "DB Existing Matter");
    addForm.set("label", "Follow Up");
    addForm.set("paths", JSON.stringify(["receipt.txt"]));
    appendTextFile(addForm, "files", "receipt.txt", "Receipt issued on 2 January 2026.");

    const updated = await postMultipart(baseUrl, "/api/matters/add-files", addForm);

    assert.equal(updated.inputLabel, "postgres:DB Existing Matter");
    assert.equal(updated.intakeAdded.intakeId, "INTAKE-02");
    assert.equal(updated.intakeAdded.unique, 1);
    assert.deepEqual(calls.map((call) => call[0]), ["add", "workspace"]);
    await assert.rejects(
      () => readFile(path.join(mattersHome, "DB Existing Matter", "00_Inbox", "Intake 02 - Follow Up", "Source Files", "receipt.txt"), "utf8"),
      /ENOENT/,
    );
  }, {
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => runtimeMatters,
      findMatterFolder: async (name) => runtimeMatters.find((matter) => matter.name === name || matter.matterName === name) || null,
    },
    runtimeDbStorageService: {
      enabled: true,
      async addUploadedFilesToMatter({ matter, label, files, relativePaths }) {
        calls.push(["add", matter.name, label, files.length, relativePaths]);
        return {
          intakeId: "INTAKE-02",
          intakeDirName: "Intake 02 - 2026-06-06 Follow Up",
          receivedDate: "2026-06-06",
          label,
          scanned: files.length,
          unique: files.length,
          duplicatesInBatch: 0,
          duplicatesOfPrior: 0,
        };
      },
      async readWorkspace(matter) {
        calls.push(["workspace", matter.name]);
        return {
          folderName: matter.name,
          inputLabel: `postgres:${matter.name}`,
          metadata: {
            matterName: matter.matterName,
            clientName: matter.clientName,
          },
          fileCount: 2,
          directoryCount: 2,
          tree: {
            name: matter.name,
            kind: "directory",
            path: "",
            children: [],
          },
        };
      },
    },
  });
});

test("multipart upload falls back to folder name when metadata omits matter name", async () => {
  await withServer(async ({ baseUrl, mattersHome }) => {
    const createForm = new FormData();
    createForm.set("name", "Fallback Matter Name");
    createForm.set("metadata", JSON.stringify({
      clientName: "Client A",
      oppositeParty: "Opposite B",
      matterType: "Consumer",
      jurisdiction: "Delhi",
    }));
    createForm.set("paths", JSON.stringify(["notice.txt"]));
    appendTextFile(createForm, "files", "notice.txt", "Notice served on 1 January 2026.");

    const created = await postMultipart(baseUrl, "/api/matters/new", createForm);
    assert.equal(created.folderName, "Fallback Matter Name");
    assert.equal(created.metadata.matterName, "Fallback Matter Name");

    const matterJson = JSON.parse(await readFile(path.join(mattersHome, "Fallback Matter Name", "matter.json"), "utf8"));
    assert.equal(matterJson.matter_name, "Fallback Matter Name");
  });
});

test("multipart add-files honors explicit matter without switching active matter", async () => {
  await withServer(async ({ baseUrl }) => {
    const firstForm = new FormData();
    firstForm.set("name", "First Upload Matter");
    firstForm.set("metadata", JSON.stringify({ matterName: "First Upload Matter" }));
    firstForm.set("paths", JSON.stringify(["first.txt"]));
    appendTextFile(firstForm, "files", "first.txt", "First matter file.");
    await postMultipart(baseUrl, "/api/matters/new", firstForm);

    const secondForm = new FormData();
    secondForm.set("name", "Second Upload Matter");
    secondForm.set("metadata", JSON.stringify({ matterName: "Second Upload Matter" }));
    secondForm.set("paths", JSON.stringify(["second.txt"]));
    appendTextFile(secondForm, "files", "second.txt", "Second matter file.");
    await postMultipart(baseUrl, "/api/matters/new", secondForm);

    const addForm = new FormData();
    addForm.set("matterName", "First Upload Matter");
    addForm.set("label", "Targeted Follow Up");
    addForm.set("paths", JSON.stringify(["targeted.txt"]));
    appendTextFile(addForm, "files", "targeted.txt", "Added to the first matter explicitly.");

    const updated = await postMultipart(baseUrl, "/api/matters/add-files", addForm);
    assert.equal(updated.folderName, "First Upload Matter");
    assert.equal(updated.intakeAdded.intakeId, "INTAKE-02");

    const activeWorkspace = await getJson(baseUrl, "/api/workspace");
    assert.equal(activeWorkspace.folderName, "Second Upload Matter");
  });
});

test("multipart upload route returns 413 when the configured byte limit is exceeded", async () => {
  await withServer(async ({ baseUrl }) => {
    const form = new FormData();
    form.set("name", "Too Large Matter");
    form.set("metadata", JSON.stringify({
      matterName: "Too Large Matter",
    }));
    form.set("paths", JSON.stringify(["large.txt"]));
    appendTextFile(form, "files", "large.txt", "This upload is deliberately larger than the test limit.");

    const { response, payload } = await postMultipartRaw(baseUrl, "/api/matters/new", form);
    assert.equal(response.status, 413);
    assert.match(payload.error, /upload too large/i);
  }, { maxUploadBytes: 10 });
});
