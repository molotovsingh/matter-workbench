import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveConfigurableSkillRunArtifacts,
  writeConfigurableSkillRunArtifacts,
} from "../services/configurable-skill-run-artifacts.mjs";

test("configurable skill run artifacts resolve markdown and JSON paths inside the matter", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "configurable-skill-artifacts-"));
  try {
    const { outputPaths, filePaths } = resolveConfigurableSkillRunArtifacts({
      matterRoot,
      skill: {
        targetLane: "20_Workshop",
        outputArtifact: "Party and Officer Map.md",
      },
    });

    assert.deepEqual(outputPaths, {
      markdown: "20_Workshop/Party and Officer Map.md",
      json: "20_Workshop/Party and Officer Map.json",
    });
    assert.equal(filePaths.markdown, path.join(matterRoot, "20_Workshop", "Party and Officer Map.md"));
    assert.equal(filePaths.json, path.join(matterRoot, "20_Workshop", "Party and Officer Map.json"));
  } finally {
    await rm(matterRoot, { recursive: true, force: true });
  }
});

test("configurable skill run artifacts write markdown and metadata atomically", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "configurable-skill-artifacts-"));
  try {
    const { outputPaths, filePaths } = resolveConfigurableSkillRunArtifacts({
      matterRoot,
      skill: {
        targetLane: "30_Drafts",
        outputArtifact: "Draft Legal Output.md",
      },
    });
    await writeConfigurableSkillRunArtifacts({
      filePaths,
      markdown: "# Draft\n\nFILE-0001 p1.b1",
      metadata: {
        schema_version: "configurable-skill-run/v1",
        outputPath: outputPaths.markdown,
      },
      runId: "run_123",
    });

    assert.equal(
      await readFile(path.join(matterRoot, "30_Drafts", "Draft Legal Output.md"), "utf8"),
      "# Draft\n\nFILE-0001 p1.b1\n",
    );
    const metadata = JSON.parse(await readFile(
      path.join(matterRoot, "30_Drafts", "Draft Legal Output.json"),
      "utf8",
    ));
    assert.equal(metadata.outputPath, "30_Drafts/Draft Legal Output.md");
    assert.equal(metadata.runId, "run_123");
    assert.match(metadata.markdown, /FILE-0001 p1\.b1/);
  } finally {
    await rm(matterRoot, { recursive: true, force: true });
  }
});
