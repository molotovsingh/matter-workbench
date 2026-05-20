import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommandInteractionLogService } from "../services/command-interaction-log-service.mjs";
import { createMatterAttentionService } from "../services/matter-attention-service.mjs";

test("matter attention aggregates developer blockers from existing matter traces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-test-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  await mkdir(intakeDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,working_copy_path,category,status,notes",
    "FILE-0001,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/PDFs/missing.pdf,PDFs,unique,",
    "FILE-0002,INTAKE-01,,Needs Review,unique,classification uncertain",
    "",
  ].join("\n"));
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), [
    "file_id,intake_id,status,low_confidence_pages,needs_review_pages,provider_warnings_count,notes",
    "FILE-0001,INTAKE-01,failed,0,0,0,unhandled parser error",
    "FILE-0002,INTAKE-01,ocr-required-all,0,0,0,scan has no embedded text",
    "FILE-0003,INTAKE-01,skipped-unsupported-format,0,0,0,legacy msg",
    "FILE-0004,INTAKE-01,skipped-duplicate,0,0,0,duplicate of prior file",
    "FILE-0005,INTAKE-01,extracted,2,3,1,weak OCR",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    source_record_count: 3,
    sources: [
      {
        source_id: "FILE-0001",
        file_id: "FILE-0001",
        display_label: "FILE-0001 raw document",
        short_label: "FILE-0001",
        label_status: "suggested",
        needs_review: false,
      },
      {
        source_id: "FILE-0002",
        file_id: "FILE-0002",
        display_label: "Unclear scan",
        short_label: "Unclear scan",
        label_status: "needs_review",
        needs_review: true,
      },
    ],
  })}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n");

  const commandLogPath = path.join(root, ".local", "command-interactions.jsonl");
  await mkdir(path.dirname(commandLogPath), { recursive: true });
  await writeFile(commandLogPath, [
    JSON.stringify({
      timestamp: "2026-05-16T09:58:00.000Z",
      matter: { folder_name: "Attention Matter" },
      typed_input: "/extract",
      matched_command: "/extract",
      status: "ran",
      status_bar: "Extract Complete",
      terminal_lines: ["old line: provider failed earlier", "[extract] totals: 1 extracted, 0 failed"],
    }),
    JSON.stringify({
      timestamp: "2026-05-16T09:59:00.000Z",
      matter: { folder_name: "Attention Matter" },
      typed_input: "/create_listofdates",
      matched_command: "/create_listofdates",
      status: "failed",
      errors: ["provider returned invalid chronology"],
    }),
    JSON.stringify({
      timestamp: "2026-05-16T10:00:00.000Z",
      matter: { folder_name: "Attention Matter" },
      typed_input: "/create_listofdates",
      matched_command: "/create_listofdates",
      status: "failed",
      errors: ["provider returned invalid chronology"],
    }),
    "",
  ].join("\n"));

  const service = createMatterAttentionService({
    matterStore: matterStoreFixture(root, "Attention Matter"),
    matterStatusService: {
      readMatterStatus: async () => ({
        stages: [
          { slash: "/extract", state: "present" },
          {
            slash: "/describe_sources",
            state: "present",
            rerunAdvice: {
              state: "stale",
              label: "source descriptors",
              reason: "newer extraction records were found",
              artifactPath: "10_Library/Source Index.json",
              newestInputPath: "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json",
              newestInputAt: "2026-05-16T10:05:00.000Z",
            },
          },
          {
            slash: "/create_listofdates",
            state: "present",
            rerunAdvice: {
              state: "stale",
              label: "list of dates",
              reason: "Only Source Index labels appear newer than this artifact.",
              dependencyState: "label_refresh_needed",
              artifactPath: "10_Library/List of Dates.md",
              newestInputPath: "10_Library/Source Index.json",
              newestInputAt: "2026-05-16T10:06:00.000Z",
            },
          },
        ],
      }),
    },
    configurableSkillRunsService: {
      listRuns: async () => ({
        runs: [
          {
            id: "run_failed",
            slash: "/party_officer_map",
            title: "Party and Officer Map",
            status: "failed",
            matterFolder: "Attention Matter",
            errorMessage: "source packet missing",
            finishedAt: "2026-05-16T10:07:00.000Z",
            outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
          },
          {
            id: "run_warning_new",
            slash: "/party_officer_map_2",
            title: "Party and Officer Map",
            status: "succeeded",
            matterFolder: "Attention Matter",
            warnings: ["Omitted 20 evidence block(s) due to maxBlocks=70"],
            finishedAt: "2026-05-16T10:06:00.000Z",
            outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
          },
          {
            id: "run_warning_old",
            slash: "/party_officer_map",
            title: "Party and Officer Map",
            status: "succeeded",
            matterFolder: "Attention Matter",
            warnings: ["Omitted 20 evidence block(s) due to maxBlocks=70"],
            finishedAt: "2026-05-16T09:06:00.000Z",
            outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
          },
        ],
      }),
    },
    commandInteractionLogService: createCommandInteractionLogService({
      appDir: root,
      logPath: commandLogPath,
    }),
    now: () => new Date("2026-05-16T10:08:00.000Z"),
  });

  const attention = await service.readMatterAttention();
  assert.equal(attention.schema_version, "matter-attention/v1");
  assert.equal(attention.summary.state, "blocked");
  assert.ok(attention.summary.blocker >= 3);
  assert.ok(attention.summary.warning >= 6);
  assertAttentionCode(attention, "working_copy_missing");
  assertAttentionCode(attention, "extraction_failed");
  assertAttentionCode(attention, "ocr_required_all");
  assertAttentionCode(attention, "ocr_low_confidence");
  assertAttentionCode(attention, "source_labels_need_review");
  assertAttentionCode(attention, "source_label_developer_name");
  assertAttentionCode(attention, "listofdates_json_missing");
  assertAttentionCode(attention, "custom_skill_failed");
  assertAttentionCode(attention, "command_failed");
  assert.equal(attention.items.filter((item) => item.code === "command_failed").length, 1);
  assert.ok(!attention.items.some((item) => /\/extract/.test(item.title)));
  assert.equal(
    attention.items.filter((item) => item.code === "custom_skill_warnings").length,
    1,
  );
  const staleChronology = attention.items.find((item) => item.code === "chronology_stale");
  assert.equal(
    staleChronology.detail,
    "Only Source Index labels appear newer than this artifact. Dependency state: label_refresh_needed. Newest input: 10_Library/Source Index.json.",
  );
  const skipped = attention.items.find((item) => item.code === "extraction_skipped");
  assert.equal(skipped.detail, "1 file(s) were skipped due to unsupported or otherwise non-extractable formats.");
});

test("matter attention stays clear for a coherent matter lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-clear-test-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  const workingCopy = path.join(intakeDir, "By Type", "Text Notes", "FILE-0001__facts.txt");
  await mkdir(path.dirname(workingCopy), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(workingCopy, "Facts\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,working_copy_path,category,status,notes",
    "FILE-0001,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,unique,",
    "",
  ].join("\n"));
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), [
    "file_id,intake_id,status,notes",
    "FILE-0001,INTAKE-01,extracted,",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    source_record_count: 1,
    sources: [
      {
        source_id: "source-1",
        file_id: "FILE-0001",
        display_label: "Client chronology note dated 1 May 2026",
        short_label: "Client chronology note",
        label_status: "confirmed",
        needs_review: false,
      },
    ],
  })}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.json"), `${JSON.stringify({
    entries: [],
  })}\n`);

  const service = createMatterAttentionService({
    matterStore: matterStoreFixture(root, "Clear Matter"),
    matterStatusService: {
      readMatterStatus: async () => ({
        stages: [
          { slash: "/extract", state: "present" },
          { slash: "/describe_sources", state: "present", rerunAdvice: { state: "current" } },
          { slash: "/create_listofdates", state: "present", rerunAdvice: { state: "current" } },
        ],
      }),
    },
    configurableSkillRunsService: {
      listRuns: async () => ({ runs: [] }),
    },
    now: () => new Date("2026-05-16T10:08:00.000Z"),
  });

  const attention = await service.readMatterAttention();
  assert.equal(attention.summary.state, "clear");
  assert.equal(attention.summary.total, 0);
  assert.deepEqual(attention.items, []);
});

test("matter attention reads command failures through the command log service", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-command-reader-test-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  const workingCopy = path.join(intakeDir, "By Type", "Text Notes", "FILE-0001__facts.txt");
  await mkdir(path.dirname(workingCopy), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(workingCopy, "Facts\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,working_copy_path,category,status,notes",
    "FILE-0001,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,unique,",
    "",
  ].join("\n"));
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), [
    "file_id,intake_id,status,notes",
    "FILE-0001,INTAKE-01,extracted,",
    "",
  ].join("\n"));

  const service = createMatterAttentionService({
    matterStore: matterStoreFixture(root, "Command Matter"),
    matterStatusService: {
      readMatterStatus: async () => ({
        stages: [
          { slash: "/extract", state: "present" },
          { slash: "/describe_sources", state: "not_run" },
          { slash: "/create_listofdates", state: "not_run" },
        ],
      }),
    },
    configurableSkillRunsService: {
      listRuns: async () => ({ runs: [] }),
    },
    commandInteractionLogService: {
      readRecentInteractions: async ({ limit }) => {
        assert.equal(limit, 200);
        return [
          {
            timestamp: "2026-05-16T10:07:00.000Z",
            matter: { folder_name: "Command Matter" },
            typed_input: "/describe_sources",
            matched_command: "/describe_sources",
            status: "failed",
            errors: ["provider unavailable"],
          },
        ];
      },
    },
    now: () => new Date("2026-05-16T10:08:00.000Z"),
  });

  const attention = await service.readMatterAttention();
  const commandFailure = attention.items.find((item) => item.code === "command_failed");
  assert.equal(commandFailure.title, "Command failed: /describe_sources");
  assert.equal(commandFailure.detail, "provider unavailable");
  assert.deepEqual(commandFailure.evidence, [{ path: "command-interactions.jsonl" }]);
});

function matterStoreFixture(root, matterName) {
  return {
    ensureMatterRoot: () => root,
    activeMatterNameWithinHome: () => matterName,
    listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
  };
}

function assertAttentionCode(attention, code) {
  assert.ok(
    attention.items.some((item) => item.code === code),
    `Expected attention item with code ${code}`,
  );
}
