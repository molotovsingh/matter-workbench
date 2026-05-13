import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillSampleOutputService } from "../services/skill-sample-output-service.mjs";
import { toCsv } from "../shared/csv.mjs";

const HASH_ONE = "a".repeat(64);

test("skill sample output service generates a bounded review sample without writing matter artifacts", async () => {
  const matterRoot = await makeMatterRoot();
  const providerCalls = [];
  const service = createSkillSampleOutputService({
    matterStore: {
      getMatterRoot: () => matterRoot,
    },
    env: {},
    now: () => new Date("2026-05-13T06:00:00.000Z"),
    idFactory: () => "sample_test_1",
    sampleProvider: async (payload) => {
      providerCalls.push(payload);
      return "# Client Update Email\n\nDear Client,\n\nWe have reviewed the matter materials and are continuing work.";
    },
  });

  const output = await service.generateSampleOutput({
    idea: {
      id: "idea_test",
      text: "draft a warm client update email after reading the List of Dates",
      status: "incomplete",
      matter: {
        matterName: "Mehta vs Skyline",
        folderName: "Mehta vs Skyline",
      },
      designBrief: {
        intendedUser: "Lawyer preparing client communication",
        problem: "Draft a careful client update email.",
        expectedInputs: "List of Dates and matter metadata.",
        expectedOutputArtifact: "30_Drafts/Client Update Email.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "high",
        notes: "No raw FILE citations in the client email.",
      },
    },
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].idea.text, "draft a warm client update email after reading the List of Dates");
  assert.equal(providerCalls[0].matterContext.counts.sources, 1);
  assert.equal(providerCalls[0].matterContext.evidence_blocks[0].citation, "FILE-0001 p1.b1");
  assert.match(providerCalls[0].matterContext.evidence_blocks[0].text, /Agreement signed/);
  assert.doesNotMatch(JSON.stringify(providerCalls[0]), /SUPER_SECRET|debug log should not leave the app/i);
  assert.equal(output.schema_version, "skill-sample-output/v1");
  assert.equal(output.sample_id, "sample_test_1");
  assert.equal(output.generated_at, "2026-05-13T06:00:00.000Z");
  assert.equal(output.matter.matter_name, "Mehta vs Skyline");
  assert.match(output.sample_markdown, /^# Client Update Email/);
  assert.equal(output.ai_run.task, "skill_sample_output");
  assert.ok(output.warnings.includes("Sample output only. Creating a skill still requires approval and validation."));

  const libraryFiles = await readdir(path.join(matterRoot, "10_Library"));
  assert.deepEqual(libraryFiles.sort(), ["List of Dates.md", "Source Index.json"]);
});

test("skill sample output service includes feedback and previous sample for regeneration", async () => {
  const matterRoot = await makeMatterRoot();
  const providerCalls = [];
  const service = createSkillSampleOutputService({
    matterStore: {
      getMatterRoot: () => matterRoot,
    },
    env: {},
    sampleProvider: async (payload) => {
      providerCalls.push(payload);
      return "# Revised Sample\n\nMore cautious.";
    },
  });

  const output = await service.generateSampleOutput({
    idea: {
      text: "draft a warm client update email",
      designBrief: {
        expectedOutputArtifact: "30_Drafts/Client Update Email.md",
      },
    },
    feedback: "Make it more cautious.",
    previousSample: "# Sample v1\n\nToo confident.",
  });

  assert.equal(providerCalls[0].feedback, "Make it more cautious.");
  assert.match(providerCalls[0].previousSample, /Too confident/);
  assert.match(output.sample_markdown, /Revised Sample/);
});

test("skill sample output service requires a selected test matter", async () => {
  const service = createSkillSampleOutputService({
    matterStore: {
      getMatterRoot: () => null,
    },
    env: {},
    sampleProvider: async () => "# Sample",
  });

  await assert.rejects(
    () => service.generateSampleOutput({
      idea: {
        text: "draft a warm client update email",
      },
    }),
    /Pick a test matter before generating sample output/,
  );
});

async function makeMatterRoot() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-sample-test-"));
  const root = path.join(tmp, "Mehta vs Skyline");
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  await mkdir(path.join(intakeDir, "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Mehta vs Skyline",
    client_name: "Rohan Mehta",
    opposite_party: "Skyline Developers Pvt Ltd",
    matter_type: "consumer dispute",
    jurisdiction: "India",
    intakes: [{
      intake_id: "INTAKE-01",
      intake_dir: "00_Inbox/Intake 01 - Initial",
    }],
  }, null, 2)}\n`);
  await writeFile(
    path.join(intakeDir, "File Register.csv"),
    toCsv([{
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/agreement.pdf",
      original_path: "00_Inbox/Intake 01 - Initial/Originals/FILE-0001__agreement.pdf",
      working_copy_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__agreement.pdf",
      category: "PDFs",
      original_name: "agreement.pdf",
      sha256: HASH_ONE,
      size_bytes: "128",
      duplicate_of: "",
      status: "unique",
    }], [
      "file_id",
      "intake_id",
      "source_path",
      "original_path",
      "working_copy_path",
      "category",
      "original_name",
      "sha256",
      "size_bytes",
      "duplicate_of",
      "status",
    ]),
  );
  await writeFile(path.join(intakeDir, "_extracted", "FILE-0001.json"), `${JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: HASH_ONE,
    source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__agreement.pdf",
    pages: [{
      page: 1,
      blocks: [{
        id: "p1.b1",
        text: "Agreement signed on 20 April 2026. Possession remains pending.",
      }],
    }],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    schema_version: "source-index/v1",
    sources: [{
      file_id: "FILE-0001",
      sha256: HASH_ONE,
      source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__agreement.pdf",
      display_label: "Agreement between Mehta and Skyline, 20 April 2026",
      short_label: "Agreement, 20 Apr 2026",
      document_type: "agreement",
    }],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n\n| Date | Event |\n");
  await writeFile(path.join(root, ".env"), "SUPER_SECRET=never log this\n");
  await writeFile(path.join(root, "debug.log"), "debug log should not leave the app\n");
  return root;
}
