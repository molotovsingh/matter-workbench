import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DISPUTE_STORY_SKILL_SLASH,
  createMatterStoryService,
  extractBriefDescriptionFromStoryMarkdown,
  updateBriefDescriptionFromStory,
} from "../services/matter-story-service.mjs";

test("story description extraction keeps the lawyer-facing story and removes sources/audit text", () => {
  const markdown = [
    "# The Story",
    "",
    "This dispute is about delayed possession of a flat and the builder's demand for further payment.",
    "",
    "The client says the full amount was paid, but the builder did not complete handover.",
    "",
    "## Sources",
    "",
    "- Agreement dated 1 June 2014 (FILE-0001 p1.b2)",
    "",
    "Limits: OCR quality needs review.",
  ].join("\n");

  const description = extractBriefDescriptionFromStoryMarkdown(markdown);

  assert.equal(
    description,
    "This dispute is about delayed possession of a flat and the builder's demand for further payment.\n\nThe client says the full amount was paid, but the builder did not complete handover.",
  );
  assert.doesNotMatch(description, /FILE-0001/);
  assert.doesNotMatch(description, /Sources/i);
  assert.doesNotMatch(description, /Limits/i);
});

test("story description update fills blank matter description", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "matter-story-blank-"));
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Client v Builder",
    brief_description: "",
  }, null, 2)}\n`);

  const result = await updateBriefDescriptionFromStory({
    matterRoot,
    markdown: "The dispute concerns delayed possession and unpaid contractual relief.",
  });

  const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  assert.equal(result.state, "updated");
  assert.equal(matterJson.brief_description, "The dispute concerns delayed possession and unpaid contractual relief.");
});

test("story description update does not overwrite existing lawyer description by default", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "matter-story-existing-"));
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Client v Builder",
    brief_description: "Lawyer-entered dispute description.",
  }, null, 2)}\n`);

  const result = await updateBriefDescriptionFromStory({
    matterRoot,
    markdown: "Replacement generated story.",
  });

  const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  assert.equal(result.state, "skipped_nonblank");
  assert.equal(matterJson.brief_description, "Lawyer-entered dispute description.");
});

test("matter story service runs the configured story skill and writes blank intake description", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-story-service-"));
  const matterRoot = path.join(tmp, "Story Matter");
  await mkdir(matterRoot, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Story Matter",
    brief_description: "",
  }, null, 2)}\n`);

  const calls = [];
  const service = createMatterStoryService({
    matterStore: {
      ensureMatterRoot: () => matterRoot,
      resolveExistingMatter: async (name) => ({ name, matterPath: matterRoot }),
    },
    configurableSkillsService: {
      listSkills: async () => ({
        skills: [{ slash: DISPUTE_STORY_SKILL_SLASH, title: "The Story", status: "active" }],
      }),
      runSkill: async (body) => {
        calls.push(body);
        return {
          state: "written",
          markdown: "# The Story\n\nThe dispute is about unpaid airport advertising invoices.",
          outputPaths: { markdown: "20_Workshop/The Story.md" },
        };
      },
    },
  });

  const result = await service.runDisputeStory({ matterName: "Story Matter", overwrite: true });
  const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));

  assert.equal(result.state, "updated");
  assert.deepEqual(calls, [{
    slash: DISPUTE_STORY_SKILL_SLASH,
    overwrite: true,
    matterName: "Story Matter",
  }]);
  assert.equal(matterJson.brief_description, "The dispute is about unpaid airport advertising invoices.");
});
