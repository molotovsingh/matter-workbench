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
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    maxUploadBytes: options.maxUploadBytes,
    port: 0,
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
