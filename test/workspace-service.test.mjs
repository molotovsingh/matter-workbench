import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceService } from "../services/workspace-service.mjs";

async function makeWorkspaceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-workspace-service-"));
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), "matter-workspace-service-other-"));
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await mkdir(path.join(otherRoot, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(otherRoot, "matter.json"), "{}\n");
  await writeFile(path.join(root, ".env"), "OPENAI_API_KEY=secret\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n");
  await writeFile(path.join(root, "10_Library", "Service Email.eml"), [
    "From: client@example.com",
    "To: lawyer@example.com",
    "Subject: Updated calculation sheets",
    "",
    "Please see attached calculation sheets.",
    "",
  ].join("\n"));
  await writeFile(path.join(otherRoot, "10_Library", "List of Dates.md"), "# Other Matter Dates\n");
  const matterStore = {
    ensureMatterRoot: () => root,
    readMatterMetadata: async (matterRoot = root) => ({ matterName: path.basename(matterRoot) }),
    readPrimaryIntake: async () => null,
  };
  return { otherRoot, root, service: createWorkspaceService({ matterStore }) };
}

test("workspace service previews ordinary files but blocks hidden direct paths", async () => {
  const { service } = await makeWorkspaceFixture();

  const preview = await service.readFilePreview("10_Library/List of Dates.md");
  assert.equal(preview.content, "# List of Dates\n");

  await assert.rejects(
    () => service.getRawFile(".env"),
    /hidden from workspace preview/,
  );
});

test("workspace service treats EML files as text-previewable source records", async () => {
  const { service } = await makeWorkspaceFixture();

  const workspace = await service.readWorkspace();
  const library = workspace.tree.children.find((node) => node.path === "10_Library");
  const email = library.children.find((node) => node.name === "Service Email.eml");

  assert.equal(email.previewable, true);
  assert.equal(email.previewKind, "text");

  const preview = await service.readFilePreview("10_Library/Service Email.eml");
  assert.match(preview.content, /Subject: Updated calculation sheets/);
  assert.equal(preview.path, "10_Library/Service Email.eml");
});

test("workspace service previews large EML files by parsing email text instead of raw MIME", async () => {
  const { root, service } = await makeWorkspaceFixture();
  const largeBody = "Calculation row 1, row 2, row 3.\n".repeat(20000);
  await writeFile(path.join(root, "10_Library", "Large Service Email.eml"), [
    "From: client@example.com",
    "To: lawyer@example.com",
    "Subject: Large service email",
    "",
    largeBody,
  ].join("\n"));

  const workspace = await service.readWorkspace();
  const library = workspace.tree.children.find((node) => node.path === "10_Library");
  const email = library.children.find((node) => node.name === "Large Service Email.eml");

  assert.equal(email.previewable, true);
  assert.equal(email.previewKind, "text");

  const preview = await service.readFilePreview("10_Library/Large Service Email.eml");
  assert.match(preview.content, /Subject: Large service email/);
  assert.match(preview.content, /Calculation row 1/);
  assert.match(preview.content, /Preview truncated/);
  assert.ok(preview.content.length < largeBody.length);
});

test("workspace service keeps root containment on direct preview paths", async () => {
  const { service } = await makeWorkspaceFixture();

  await assert.rejects(
    () => service.readFilePreview("../outside.md"),
    /outside the matter root/,
  );
});

test("workspace service can read an explicit matter root without changing active root", async () => {
  const { otherRoot, root, service } = await makeWorkspaceFixture();

  const workspace = await service.readWorkspace(otherRoot);
  assert.equal(workspace.folderName, path.basename(otherRoot));
  assert.equal(workspace.metadata.matterName, path.basename(otherRoot));

  const preview = await service.readFilePreview("10_Library/List of Dates.md", otherRoot);
  assert.equal(preview.content, "# Other Matter Dates\n");
  assert.equal(preview.path, "10_Library/List of Dates.md");

  const activePreview = await service.readFilePreview("10_Library/List of Dates.md");
  assert.equal(activePreview.content, "# List of Dates\n");
  assert.equal(path.basename(root).startsWith("matter-workspace-service-"), true);
});
