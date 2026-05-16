import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceService } from "../services/workspace-service.mjs";

async function makeWorkspaceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-workspace-service-"));
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(root, ".env"), "OPENAI_API_KEY=secret\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n");
  const matterStore = {
    ensureMatterRoot: () => root,
    readMatterMetadata: async () => ({ matterName: "Workspace Matter" }),
    readPrimaryIntake: async () => null,
  };
  return { root, service: createWorkspaceService({ matterStore }) };
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

test("workspace service keeps root containment on direct preview paths", async () => {
  const { service } = await makeWorkspaceFixture();

  await assert.rejects(
    () => service.readFilePreview("../outside.md"),
    /outside the matter root/,
  );
});
