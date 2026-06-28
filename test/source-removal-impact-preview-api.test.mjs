import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runMatterInit } from "../matter-init-engine.mjs";
import { createWorkbenchServer } from "../server.mjs";
import { parseCsv } from "../shared/csv.mjs";

test("source-removal route removes a source from the active record without deleting bytes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "source-removal-route-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Removal Route Matter");
  const sourcePath = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "wrong-file.txt");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(sourcePath, "Wrong file bytes must be retained.");
  await runMatterInit({
    matterRoot,
    metadata: {
      clientName: "Removal Client",
      matterName: "Removal Route Matter",
      oppositeParty: "Other",
      matterType: "Test",
      jurisdiction: "Local",
    },
  });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const removeResponse = await fetch(`${baseUrl}/api/source-removal/remove-from-active-record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Removal Route Matter",
        fileId: "FILE-0001",
        reason: "Wrong client file uploaded to this matter.",
        idempotencyKey: "source-removal:route:FILE-0001:v1",
      }),
    });
    const result = await removeResponse.json();
    assert.equal(removeResponse.status, 200);
    assert.equal(result.schema_version, "source-removal-mutation/v1");
    assert.equal(result.file_id, "FILE-0001");
    assert.equal(result.state, "removed_from_active_record");
    assert.equal(result.physical_deletion, false);
    assert.match(JSON.stringify(result.warnings || []), /not deleted/i);

    const tombstone = await readFile(path.join(matterRoot, ".matter-workbench", "source-tombstones.json"), "utf8");
    assert.match(tombstone, /FILE-0001/);
    assert.match(tombstone, /removed_from_active_record/);
    assert.equal(await readFile(sourcePath, "utf8"), "Wrong file bytes must be retained.");

    const missingReason = await fetch(`${baseUrl}/api/source-removal/remove-from-active-record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterName: "Removal Route Matter",
        fileId: "FILE-0001",
        reason: "",
        idempotencyKey: "source-removal:route:FILE-0001:v2",
      }),
    });
    const missing = await missingReason.json();
    assert.equal(missingReason.status, 400);
    assert.equal(missing.code, "source_removal.reason_required");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("source-removal impact preview API is read-only and requires a FILE id", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "source-removal-preview-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Preview Matter");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "notice.txt"), "Preview event text must not leak.");
  await runMatterInit({
    matterRoot,
    metadata: {
      clientName: "Preview Client",
      matterName: "Preview Matter",
      oppositeParty: "Other",
      matterType: "Test",
      jurisdiction: "Local",
    },
  });
  await writeExtractionRecordFromRegister(matterRoot);

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const previewResponse = await fetch(`${baseUrl}/api/source-removal-impact-preview?matter=${encodeURIComponent("Preview Matter")}&fileId=FILE-0001`);
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200);
    assert.equal(preview.schema_version, "source-removal-impact-preview/v1");
    assert.equal(preview.file_id, "FILE-0001");
    assert.equal(preview.can_remove, true);
    assert.equal(preview.physical_deletion, false);
    assert.equal(preview.requires_reason, true);
    assert.equal(preview.requires_idempotency_key, true);
    assert.equal(preview.active_context.source_records, 1);
    assert.equal(preview.active_context.evidence_blocks, 1);
    assert.doesNotMatch(JSON.stringify(preview), /Preview event text must not leak/);

    const missingResponse = await fetch(`${baseUrl}/api/source-removal-impact-preview?matter=${encodeURIComponent("Preview Matter")}`);
    const missing = await missingResponse.json();
    assert.equal(missingResponse.status, 400);
    assert.equal(missing.code, "source_removal_preview.file_id_required");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

async function writeExtractionRecordFromRegister(matterRoot) {
  const registerPath = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv");
  const [row] = parseCsv(await readFile(registerPath, "utf8"));
  const extractedDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await writeFile(path.join(extractedDir, `${row.file_id}.json`), `${JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: row.file_id,
    sha256: row.sha256,
    source_path: row.working_copy_path || row.source_path,
    pages: [{ page: 1, blocks: [{ id: "p1.b1", text: "Preview event text must not leak." }] }],
  }, null, 2)}\n`);
}
