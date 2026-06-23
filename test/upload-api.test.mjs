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
    env: { MATTERS_HOME: mattersHome, ...(options.env || {}) },
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
    await run({ app, baseUrl, mattersHome });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

test("config exposes the configured upload byte limit for browser preflight", async () => {
  await withServer(async ({ baseUrl }) => {
    const config = await getJson(baseUrl, "/api/config");

    assert.equal(config.maxUploadBytes, 12345);
  }, { maxUploadBytes: 12345 });
});

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
    assert.equal(created.intakeSizingReport.schema_version, "intake-sizing-report/v1");
    assert.equal(created.intakeSizingReport.recommendedPreparationMode, "immediate");
    assert.equal(created.intakeSizingReport.typeMix.text, 1);

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
    assert.equal(updated.intakeAdded.sizingReport.schema_version, "intake-sizing-report/v1");
    assert.equal(updated.intakeAdded.sizingReport.typeMix.text, 1);
  });
});

test("multipart add-files serializes filesystem intake allocation per matter", async () => {
  await withServer(async ({ app, baseUrl, mattersHome }) => {
    const createForm = new FormData();
    createForm.set("name", "Concurrent Upload Matter");
    createForm.set("metadata", JSON.stringify({
      matterName: "Concurrent Upload Matter",
      clientName: "Client A",
      oppositeParty: "Opposite B",
      matterType: "Consumer",
      jurisdiction: "Delhi",
    }));
    createForm.set("paths", JSON.stringify(["initial.txt"]));
    appendTextFile(createForm, "files", "initial.txt", "Initial evidence.");
    await postMultipart(baseUrl, "/api/matters/new", createForm);

    const originalNextIntakeNumber = app.services.matterStore.nextIntakeNumber;
    let inFlightAllocations = 0;
    let maxConcurrentAllocations = 0;
    app.services.matterStore.nextIntakeNumber = async (...args) => {
      inFlightAllocations += 1;
      maxConcurrentAllocations = Math.max(maxConcurrentAllocations, inFlightAllocations);
      try {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return await originalNextIntakeNumber(...args);
      } finally {
        inFlightAllocations -= 1;
      }
    };

    function addForm(label, filename, text) {
      const form = new FormData();
      form.set("label", label);
      form.set("paths", JSON.stringify([filename]));
      appendTextFile(form, "files", filename, text);
      return form;
    }

    const [first, second] = await Promise.all([
      postMultipart(baseUrl, "/api/matters/add-files", addForm("Race One", "race-one.txt", "Race one evidence.")),
      postMultipart(baseUrl, "/api/matters/add-files", addForm("Race Two", "race-two.txt", "Race two evidence.")),
    ]);

    assert.equal(maxConcurrentAllocations, 1);
    assert.deepEqual(
      [first.intakeAdded.intakeId, second.intakeAdded.intakeId].sort(),
      ["INTAKE-02", "INTAKE-03"],
    );
    assert.equal(new Set([
      first.intakeAdded.intakeDirName,
      second.intakeAdded.intakeDirName,
    ]).size, 2);

    const matterRoot = path.join(mattersHome, "Concurrent Upload Matter");
    const firstRegister = await readFile(
      path.join(matterRoot, "00_Inbox", first.intakeAdded.intakeDirName, "File Register.csv"),
      "utf8",
    );
    const secondRegister = await readFile(
      path.join(matterRoot, "00_Inbox", second.intakeAdded.intakeDirName, "File Register.csv"),
      "utf8",
    );
    const fileIds = Array.from(new Set(
      `${firstRegister}\n${secondRegister}`.match(/FILE-\d{4}/g) || [],
    )).sort();
    assert.deepEqual(fileIds, ["FILE-0002", "FILE-0003"]);
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
    assert.equal(created.intakeSizingReport.schema_version, "intake-sizing-report/v1");
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
      async createMatterFromUploadedFiles({ name, metadata, files, relativePaths, intakeSizingReport }) {
        calls.push(["create", name, files.length, relativePaths, intakeSizingReport?.recommendedPreparationMode]);
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
    assert.equal(updated.intakeAdded.sizingReport.schema_version, "intake-sizing-report/v1");
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
      async addUploadedFilesToMatter({ matter, label, files, relativePaths, intakeSizingReport }) {
        calls.push(["add", matter.name, label, files.length, relativePaths, intakeSizingReport?.recommendedPreparationMode]);
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

test("multipart runtime DB add-files returns a stable code when no matter is active", async () => {
  await withServer(async ({ baseUrl }) => {
    const addForm = new FormData();
    addForm.set("label", "Follow Up");
    addForm.set("paths", JSON.stringify(["receipt.txt"]));
    appendTextFile(addForm, "files", "receipt.txt", "Receipt issued on 2 January 2026.");

    const { response, payload } = await postMultipartRaw(baseUrl, "/api/matters/add-files", addForm);

    assert.equal(response.status, 409);
    assert.match(payload.error, /No matter is active/);
    assert.equal(payload.code, "upload.matter_required");
  }, {
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [],
      findMatterFolder: async () => null,
    },
    runtimeDbStorageService: {
      enabled: true,
      addUploadedFilesToMatter: async () => {
        throw new Error("should not allocate without an active matter");
      },
      readWorkspace: async () => ({}),
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

test("multipart upload accepts lawyer-style matter captions and derives a safe storage name", async () => {
  await withServer(async ({ baseUrl, mattersHome }) => {
    const createForm = new FormData();
    createForm.set("name", "State/Rajesh Mehra");
    createForm.set("metadata", JSON.stringify({
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
      matterType: "Criminal",
      jurisdiction: "Delhi",
    }));
    createForm.set("paths", JSON.stringify(["baazi.pdf"]));
    appendTextFile(createForm, "files", "baazi.pdf", "PDF placeholder text.");

    const created = await postMultipart(baseUrl, "/api/matters/new", createForm);

    assert.equal(created.folderName, "State - Rajesh Mehra");
    assert.equal(created.metadata.matterName, "State/Rajesh Mehra");
    const matterJson = JSON.parse(await readFile(path.join(mattersHome, "State - Rajesh Mehra", "matter.json"), "utf8"));
    assert.equal(matterJson.matter_name, "State/Rajesh Mehra");
  });
});

test("multipart upload rejects matter captions that collide after storage-name cleanup", async () => {
  await withServer(async ({ baseUrl }) => {
    const firstForm = new FormData();
    firstForm.set("name", "State - Rajesh Mehra");
    firstForm.set("metadata", JSON.stringify({ matterName: "State - Rajesh Mehra" }));
    firstForm.set("paths", JSON.stringify(["first.txt"]));
    appendTextFile(firstForm, "files", "first.txt", "First matter.");
    await postMultipart(baseUrl, "/api/matters/new", firstForm);

    const secondForm = new FormData();
    secondForm.set("name", "State/Rajesh Mehra");
    secondForm.set("metadata", JSON.stringify({ matterName: "State/Rajesh Mehra" }));
    secondForm.set("paths", JSON.stringify(["second.txt"]));
    appendTextFile(secondForm, "files", "second.txt", "Second matter.");

    const { response, payload } = await postMultipartRaw(baseUrl, "/api/matters/new", secondForm);

    assert.equal(response.status, 409);
    assert.match(payload.error, /already exists/i);
    assert.match(payload.error, /State - Rajesh Mehra/);
    assert.equal(payload.code, "upload.matter_exists");
  });
});

test("multipart runtime DB upload accepts lawyer-style captions and keeps legal caption metadata", async () => {
  const runtimeMatters = [];
  const calls = [];
  await withServer(async ({ baseUrl }) => {
    const createForm = new FormData();
    createForm.set("name", "State/Rajesh Mehra");
    createForm.set("metadata", JSON.stringify({
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
    }));
    createForm.set("paths", JSON.stringify(["baazi.pdf"]));
    appendTextFile(createForm, "files", "baazi.pdf", "PDF placeholder text.");

    const created = await postMultipart(baseUrl, "/api/matters/new", createForm);

    assert.equal(created.folderName, "State - Rajesh Mehra");
    assert.equal(created.inputLabel, "postgres:State - Rajesh Mehra");
    assert.equal(created.metadata.matterName, "State/Rajesh Mehra");
    assert.deepEqual(calls[0], ["create", "State - Rajesh Mehra", "State/Rajesh Mehra"]);
  }, {
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => runtimeMatters,
      findMatterFolder: async (name) => runtimeMatters.find((matter) => matter.name === name || matter.matterName === name) || null,
    },
    runtimeDbStorageService: {
      enabled: true,
      async createMatterFromUploadedFiles({ name, metadata }) {
        calls.push(["create", name, metadata.matterName]);
        const matter = {
          id: "33333333-3333-4333-8333-333333333333",
          name,
          matterName: metadata.matterName,
          clientName: metadata.clientName,
          oppositeParty: metadata.oppositeParty,
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

test("multipart upload rejects duplicate relative paths instead of overwriting earlier files", async () => {
  await withServer(async ({ baseUrl }) => {
    const form = new FormData();
    form.set("name", "Duplicate Path Matter");
    form.set("metadata", JSON.stringify({ matterName: "Duplicate Path Matter" }));
    form.set("paths", JSON.stringify(["same.txt", "same.txt"]));
    appendTextFile(form, "files", "first.txt", "First body should not be overwritten.");
    appendTextFile(form, "files", "second.txt", "Second body should not overwrite silently.");

    const { response, payload } = await postMultipartRaw(baseUrl, "/api/matters/new", form);

    assert.equal(response.status, 400);
    assert.equal(payload.code, "upload.duplicate_paths");
    assert.match(payload.error, /duplicate uploaded file path/i);
  });
});

test("multipart upload route returns stable codes for invalid multipart requests", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/matters/new`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.error, /expected multipart/i);
    assert.equal(payload.code, "upload.multipart_required");
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
    assert.match(payload.error, /too large for one batch/i);
    assert.equal(payload.code, "upload.too_large");
  }, { maxUploadBytes: 10 });
});

test("multipart upload route applies upload byte limit from environment", async () => {
  await withServer(async ({ baseUrl }) => {
    const form = new FormData();
    form.set("name", "Too Large Env Matter");
    form.set("metadata", JSON.stringify({
      matterName: "Too Large Env Matter",
    }));
    form.set("paths", JSON.stringify(["large-env.txt"]));
    appendTextFile(form, "files", "large-env.txt", "This upload is deliberately larger than the env limit.");

    const { response, payload } = await postMultipartRaw(baseUrl, "/api/matters/new", form);
    assert.equal(response.status, 413);
    assert.match(payload.error, /upload fewer files/i);
    assert.equal(payload.code, "upload.too_large");
  }, { env: { MWB_MAX_UPLOAD_BYTES: "10" } });
});

test("multipart upload returns a stable error code when no files are attached", async () => {
  await withServer(async ({ baseUrl }) => {
    const form = new FormData();
    form.set("name", "Empty Matter");
    form.set("metadata", JSON.stringify({ matterName: "Empty Matter" }));
    form.set("paths", JSON.stringify([]));

    const { response, payload } = await postMultipartRaw(baseUrl, "/api/matters/new", form);

    assert.equal(response.status, 400);
    assert.equal(payload.error, "Attach at least one source file before creating a matter.");
    assert.equal(payload.code, "upload.no_files_attached");
  });
});

test("upload service delegates browser upload planning to intake adapter", async () => {
  const source = await readFile("services/upload-service.mjs", "utf8");
  assert.match(source, /planBrowserNewMatterUpload/);
  assert.match(source, /planBrowserAddFilesUpload/);
  assert.match(source, /from "\.\/intake\/browser-upload-adapter\.mjs"/);
});
