import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMatterStatusService } from "../services/matter-status-service.mjs";

test("matter status derives pipeline state from existing artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-status-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "file_id\nFILE-0001\n");
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "file_id,status\nFILE-0001,extracted\n");
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "{}\n");
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    ai_run: {
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct",
      returnedProvider: "akashml/fp8",
    },
  })}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.json"), `${JSON.stringify({
    ai_run: {
      provider: "openrouter",
      model: "openai/gpt-4.1",
      returnedProvider: "Friendli",
    },
  })}\n`);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const status = await service.readMatterStatus();
  assert.equal(status.matterName, path.basename(root));
  assert.deepEqual(status.stages.map((stage) => [stage.slash, stage.state]), [
    ["/matter-init", "present"],
    ["/extract", "present"],
    ["/describe_sources", "present"],
    ["/create_listofdates", "present"],
  ]);
  assert.ok(status.stages.find((stage) => stage.slash === "/extract").artifacts.some((artifact) => artifact.includes("_extracted")));
  assert.equal(status.stages.find((stage) => stage.slash === "/describe_sources").aiRun.returnedProvider, "akashml/fp8");
  assert.equal(status.stages.find((stage) => stage.slash === "/create_listofdates").aiRun.model, "openai/gpt-4.1");
});

test("matter status treats missing artifacts as not run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-status-missing-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const status = await service.readMatterStatus();
  assert.deepEqual(status.stages.map((stage) => [stage.slash, stage.state]), [
    ["/matter-init", "not_run"],
    ["/extract", "not_run"],
    ["/describe_sources", "not_run"],
    ["/create_listofdates", "not_run"],
  ]);
  assert.equal(status.stages.find((stage) => stage.slash === "/matter-init").artifacts.length, 1);
});
