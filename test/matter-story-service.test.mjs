import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DISPUTE_STORY_SKILL_SLASH,
  buildBriefDescriptionMatterJsonUpdate,
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

test("story description extraction preserves useful story sections and keeps risks at the end", () => {
  const description = extractBriefDescriptionFromStoryMarkdown([
    "# Matter Story",
    "",
    "## At a glance",
    "This is a landlord-tenant possession dispute.",
    "",
    "## What this matter is about",
    "The client says the tenancy was terminated but possession was not returned.",
    "",
    "## Main risks and missing facts",
    "The record does not yet show proof of service for the notice.",
    "",
    "## Internal audit/source handles",
    "- FILE-0001 p1.b1",
  ].join("\n"));

  assert.equal(description, [
    "At a glance\nThis is a landlord-tenant possession dispute.",
    "What this matter is about\nThe client says the tenancy was terminated but possession was not returned.",
    "Main risks and missing facts\nThe record does not yet show proof of service for the notice.",
  ].join("\n\n"));
  assert.doesNotMatch(description, /FILE-0001/);
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

test("story description update overwrites intake description and preserves it as original note", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "matter-story-existing-"));
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Client v Builder",
    brief_description: "Initial intake description.",
  }, null, 2)}\n`);

  const result = await updateBriefDescriptionFromStory({
    matterRoot,
    markdown: "Replacement Matter Workbench story.",
  });

  const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  assert.equal(result.state, "updated");
  assert.equal(matterJson.brief_description, "Replacement Matter Workbench story.");
  assert.equal(matterJson.original_intake_note, "Initial intake description.");
  assert.equal(matterJson.brief_description_source.author, "MW");
  assert.equal(matterJson.brief_description_source.based_on, "Current Case Timeline");
});

test("story status marks Matter Workbench story stale when List of Dates changed later", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "matter-story-stale-"));
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await mkdir(path.join(matterRoot, "20_Workshop"), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Client v Builder",
    brief_description: "Existing Matter Workbench story.",
    brief_description_source: { author: "MW", type: "matter_workbench_story" },
  }, null, 2)}\n`);
  await writeFile(path.join(matterRoot, "10_Library", "List of Dates.md"), "# List of Dates\n");
  await writeFile(path.join(matterRoot, "20_Workshop", "The Story.md"), "# The Story\n");
  await utimes(path.join(matterRoot, "20_Workshop", "The Story.md"), new Date("2026-06-20T09:00:00.000Z"), new Date("2026-06-20T09:00:00.000Z"));
  await utimes(path.join(matterRoot, "10_Library", "List of Dates.md"), new Date("2026-06-20T10:00:00.000Z"), new Date("2026-06-20T10:00:00.000Z"));

  const service = createMatterStoryService({
    matterStore: { ensureMatterRoot: () => matterRoot },
    configurableSkillsService: {
      listSkills: async () => ({ skills: [{ slash: DISPUTE_STORY_SKILL_SLASH, status: "active" }] }),
    },
  });

  const status = await service.readDisputeStoryStatus(matterRoot);
  assert.equal(status.storyMarkdownPresent, true);
  assert.equal(status.storyStale, true);
  assert.equal(status.briefDescriptionManagedByMatterWorkbench, true);
});

test("story description update skips current Matter Workbench story unless refresh is requested", () => {
  const { result, nextMatterJson } = buildBriefDescriptionMatterJsonUpdate({
    matterJson: {
      matter_name: "Client v Builder",
      brief_description: "Existing Matter Workbench story.",
      brief_description_source: { author: "MW", type: "matter_workbench_story" },
    },
    markdown: "Replacement story.",
  });

  assert.equal(result.state, "skipped_current_mw_story");
  assert.equal(result.author, "MW");
  assert.equal(nextMatterJson, null);
});

test("story description keeps all five overview sections including risks", () => {
  const section = (heading, body) => `${heading}\n${body}`;
  const markdown = [
    "# The Story",
    section("At a glance", "This is the initial overview of the criminal matter and parties. It identifies the incident, broad allegation, and current charge position."),
    section("What this matter is about", "This matter concerns the death following a parking-related altercation and the prosecution case arising from that incident. The defence position will turn on intent, causation, and the medical sequence."),
    section("Key dispute", "The central dispute is whether the conduct amounts to murder or a lesser offence. The parties also contest whether later medical complications broke or weakened the causal chain."),
    section("Procedural posture", "The FIR was registered after the incident and the case later moved to a more serious charge. The matter remains for lawyer review against the current List of Dates."),
    section("Main risks and missing facts", "The key risks are witness reliability, medical causation, CCTV interpretation, and proof of intention. Missing facts include the complete medical record, full CCTV chain, and any independent witness version."),
    "## Internal source handles",
    "FILE-0001 p1.b1",
  ].join("\n\n");

  const description = extractBriefDescriptionFromStoryMarkdown(markdown);

  assert.match(description, /At a glance/);
  assert.match(description, /What this matter is about/);
  assert.match(description, /Key dispute/);
  assert.match(description, /Procedural posture/);
  assert.match(description, /Main risks and missing facts/);
  assert.doesNotMatch(description, /FILE-0001/);
});

test("story description update can build a DB-native matter.json payload", () => {
  const { result, nextMatterJson } = buildBriefDescriptionMatterJsonUpdate({
    matterJson: {
      matter_name: "Client v Builder",
      intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
    },
    markdown: "# The Story\n\nThe dispute concerns delayed possession of the flat.\n\n## Sources\nFILE-0001 p1.b1",
    artifactPath: "20_Workshop/The Story.md",
    now: () => new Date("2026-06-19T00:00:00.000Z"),
  });

  assert.equal(result.state, "updated");
  assert.equal(nextMatterJson.brief_description, "The dispute concerns delayed possession of the flat.");
  assert.deepEqual(nextMatterJson.intakes, [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }]);
  assert.equal(nextMatterJson.brief_description_source.author, "MW");
  assert.equal(nextMatterJson.brief_description_source.basis_artifact, "10_Library/List of Dates.md");
  assert.equal(nextMatterJson.brief_description_source.updated_at, "2026-06-19T00:00:00.000Z");
});

test("matter story service runs native Story when no configured Story skill exists", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-story-native-"));
  const matterRoot = path.join(tmp, "Native Story Matter");
  await mkdir(matterRoot, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Native Story Matter",
    brief_description: "",
  }, null, 2)}\n`);

  const calls = [];
  const stageEvents = [];
  const service = createMatterStoryService({
    matterStore: {
      ensureMatterRoot: () => matterRoot,
      resolveExistingMatter: async (name) => ({ name, matterPath: matterRoot }),
    },
    configurableSkillsService: {
      listSkills: async () => ({ skills: [] }),
    },
    nativeRunProvider: async ({ skill, matterContext }) => {
      calls.push({ skill, matterContext });
      return "# The Story\n\nThe dispute concerns delayed payment under the supply contract.\n\n## Internal source handles\nFILE-0001 p1.b1";
    },
  });

  const result = await service.runDisputeStory({
    matterName: "Native Story Matter",
    overwrite: true,
    matterContextPacketOverride: {
      matter: { matter_name: "Native Story Matter" },
      sources: [],
      evidence_blocks: [],
      library_artifacts: [{ kind: "list_of_dates", path: "10_Library/List of Dates.json", entries: [] }],
      warnings: [],
    },
    stageRecorder: createRecordingStageRecorder(stageEvents),
  });
  const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  const markdown = await readFile(path.join(matterRoot, "20_Workshop", "The Story.md"), "utf8");

  assert.equal(result.state, "updated");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skill.slash, DISPUTE_STORY_SKILL_SLASH);
  assert.equal(calls[0].matterContext.library_artifacts[0].path, "10_Library/List of Dates.json");
  assert.match(markdown, /delayed payment/);
  assert.equal(matterJson.brief_description, "The dispute concerns delayed payment under the supply contract.");
  assert.equal(matterJson.brief_description_source.author, "MW");
  assert.deepEqual(stageEvents.map((event) => `${event.status}:${event.stage.id}`), [
    "running:build_packet",
    "succeeded:build_packet",
    "running:generate",
    "succeeded:generate",
    "running:persist",
    "succeeded:persist",
    "running:sync_matter_summary",
    "succeeded:sync_matter_summary",
  ]);
  assert.equal(stageEvents.find((event) => event.status === "succeeded" && event.stage.id === "generate")?.stage.salvageable, false);
});

test("matter story service attributes native provider failure to generate stage", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-story-native-provider-fail-"));
  const matterRoot = path.join(tmp, "Native Story Fail Matter");
  await mkdir(matterRoot, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Native Story Fail Matter",
    brief_description: "",
  }, null, 2)}\n`);

  const stageEvents = [];
  const service = createMatterStoryService({
    matterStore: {
      ensureMatterRoot: () => matterRoot,
      resolveExistingMatter: async (name) => ({ name, matterPath: matterRoot }),
    },
    configurableSkillsService: {
      listSkills: async () => ({ skills: [] }),
    },
    nativeRunProvider: async () => {
      const error = new Error("Unexpected end of JSON input");
      error.code = "provider.invalid_json";
      throw error;
    },
  });

  await assert.rejects(
    () => service.runDisputeStory({
      matterName: "Native Story Fail Matter",
      overwrite: true,
      matterContextPacketOverride: {
        matter: { matter_name: "Native Story Fail Matter" },
        sources: [],
        evidence_blocks: [],
        library_artifacts: [{ kind: "list_of_dates", path: "10_Library/List of Dates.json", entries: [] }],
        warnings: [],
      },
      stageRecorder: createRecordingStageRecorder(stageEvents),
    }),
    /Unexpected end of JSON input/,
  );

  assert.deepEqual(stageEvents.map((event) => `${event.status}:${event.stage.id}`), [
    "running:build_packet",
    "succeeded:build_packet",
    "running:generate",
    "failed:generate",
  ]);
  const failed = stageEvents.find((event) => event.status === "failed");
  assert.equal(failed.error.code, "provider.invalid_json");
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

function createRecordingStageRecorder(events) {
  return {
    startStage: async (stage) => events.push({ status: "running", stage }),
    succeedStage: async (stage) => events.push({ status: "succeeded", stage }),
    failStage: async (stage, error) => events.push({ status: "failed", stage, error }),
    skipStage: async (stage) => events.push({ status: "skipped", stage }),
  };
}
