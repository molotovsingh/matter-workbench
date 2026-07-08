import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
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
      policyPromptVersion: "legal-workbench-policy/v1",
    },
  })}\n`);
  await writeFile(path.join(root, "10_Library", "Case Timeline.md"), "# List of Dates\n");
  await writeFile(path.join(root, "10_Library", "Case Timeline.json"), `${JSON.stringify({
    counts: {
      entries: 36,
    },
    ai_run: {
      provider: "openrouter",
      model: "openai/gpt-4.1",
      returnedProvider: "Friendli",
      policyPromptVersion: "legal-workbench-policy/v1",
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
    ["/create_case_timeline", "present"],
  ]);
  assert.ok(status.stages.find((stage) => stage.slash === "/extract").artifacts.some((artifact) => artifact.includes("_extracted")));
  const sourceStage = status.stages.find((stage) => stage.slash === "/describe_sources");
  const listStage = status.stages.find((stage) => stage.slash === "/create_case_timeline");
  assert.equal(sourceStage.aiRun.returnedProvider, "akashml/fp8");
  assert.equal(sourceStage.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
  assert.equal(sourceStage.rerunAdvice.state, "current");
  assert.equal(sourceStage.rerunAdvice.shouldConfirm, true);
  assert.equal(sourceStage.rerunAdvice.policyPromptVersion, "legal-workbench-policy/v1");
  assert.equal(listStage.aiRun.model, "openai/gpt-4.1");
  assert.equal(listStage.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
  assert.equal(listStage.metrics.rows, 36);
  assert.equal(listStage.rerunAdvice.state, "current");
  assert.equal(listStage.rerunAdvice.shouldConfirm, true);
  assert.equal(listStage.rerunAdvice.policyPromptVersion, "legal-workbench-policy/v1");
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
    ["/create_case_timeline", "not_run"],
  ]);
  assert.equal(status.stages.find((stage) => stage.slash === "/matter-init").artifacts.length, 1);
});

test("rerun advice confirms current source descriptors and allows stale reruns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-source-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(root, "10_Library", "Source Index.json");
  await writeFile(recordPath, "{}\n");
  await writeFile(sourceIndexPath, `${JSON.stringify({
    generated_at: "2026-05-11T10:00:00.000Z",
    ai_run: {
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct",
      returnedProvider: "AkashML",
    },
  })}\n`);

  const oldDate = new Date("2026-05-11T09:00:00.000Z");
  const currentDate = new Date("2026-05-11T10:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(sourceIndexPath, currentDate, currentDate);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const current = await service.readRerunAdvice("/describe_sources");
  assert.equal(current.state, "current");
  assert.equal(current.shouldConfirm, true);
  assert.equal(current.artifactPath, "10_Library/Source Index.json");
  assert.equal(current.lastRunAt, "2026-05-11T10:00:00.000Z");
  assert.equal(current.provider, "AkashML");
  assert.match(current.message, /\/describe_sources/);
  assert.match(current.message, /Run it again anyway\?/);

  const newerRecordDate = new Date("2026-05-11T11:00:00.000Z");
  await utimes(recordPath, newerRecordDate, newerRecordDate);
  const stale = await service.readRerunAdvice("/describe_sources");
  assert.equal(stale.state, "stale");
  assert.equal(stale.shouldConfirm, false);
  assert.equal(stale.newestInputPath, "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json");
});

test("rerun advice marks source descriptors stale when extraction hashes changed despite older mtimes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-source-hash-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(root, "10_Library", "Source Index.json");
  await writeFile(recordPath, `${JSON.stringify({
    file_id: "FILE-0001",
    sha256: "hash-two",
  })}\n`);
  await writeFile(sourceIndexPath, `${JSON.stringify({
    generated_at: "2026-05-11T10:00:00.000Z",
    sources: [{
      file_id: "FILE-0001",
      sha256: "hash-one",
      content_hash: "hash-one",
    }],
  })}\n`);

  const oldDate = new Date("2026-05-11T09:00:00.000Z");
  const currentDate = new Date("2026-05-11T10:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(sourceIndexPath, currentDate, currentDate);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const advice = await service.readRerunAdvice("/describe_sources");
  assert.equal(advice.state, "stale");
  assert.equal(advice.shouldConfirm, false);
  assert.equal(advice.newestInputPath, "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json");
  assert.match(advice.reason, /changed source content/i);
});

test("rerun advice tolerates null extraction JSON records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-null-extraction-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(root, "10_Library", "Source Index.json");
  await writeFile(recordPath, "null\n");
  await writeFile(sourceIndexPath, `${JSON.stringify({
    generated_at: "2026-05-11T10:00:00.000Z",
    sources: [],
  })}\n`);

  const oldDate = new Date("2026-05-11T09:00:00.000Z");
  const currentDate = new Date("2026-05-11T10:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(sourceIndexPath, currentDate, currentDate);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const advice = await service.readRerunAdvice("/describe_sources");
  assert.equal(advice.state, "current");
  assert.equal(advice.shouldConfirm, true);
  assert.equal(advice.inputCount, 1);
});

test("rerun advice confirms current list of dates and skips missing artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-list-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(root, "10_Library", "Source Index.json");
  const listJsonPath = path.join(root, "10_Library", "Case Timeline.json");
  const listMarkdownPath = path.join(root, "10_Library", "Case Timeline.md");
  await writeFile(recordPath, "{}\n");
  await writeFile(sourceIndexPath, "{}\n");
  await writeFile(listMarkdownPath, "# List of Dates\n");
  await writeFile(listJsonPath, `${JSON.stringify({
    generated_at: "2026-05-11T12:00:00.000Z",
    ai_run: {
      provider: "openrouter",
      model: "openai/gpt-4.1",
      returnedProvider: "Friendli",
    },
  })}\n`);

  const oldDate = new Date("2026-05-11T11:00:00.000Z");
  const currentDate = new Date("2026-05-11T12:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(sourceIndexPath, oldDate, oldDate);
  await utimes(listJsonPath, currentDate, currentDate);
  await utimes(listMarkdownPath, currentDate, currentDate);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const current = await service.readRerunAdvice("/create_case_timeline");
  assert.equal(current.state, "current");
  assert.equal(current.shouldConfirm, true);
  assert.equal(current.artifactPath, "10_Library/Case Timeline.md");
  assert.equal(current.provider, "Friendli");
  assert.equal(current.model, "openai/gpt-4.1");
  assert.match(current.message, /No newer extraction records or Source Index changes were found/);

  const missingRoot = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-missing-list-test-"));
  await mkdir(path.join(missingRoot, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await writeFile(path.join(missingRoot, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "{}\n");
  const missingService = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => missingRoot,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });
  const missing = await missingService.readRerunAdvice("/create_case_timeline");
  assert.equal(missing.state, "missing");
  assert.equal(missing.shouldConfirm, false);
});

test("list of dates rerun advice classifies source-index-only changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-list-source-change-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(root, "10_Library", "Source Index.json");
  const listJsonPath = path.join(root, "10_Library", "Case Timeline.json");
  const listMarkdownPath = path.join(root, "10_Library", "Case Timeline.md");

  await writeFile(recordPath, "{}\n");
  await writeFile(sourceIndexPath, `${JSON.stringify(sourceIndexFixture({
    displayLabel: "Confirmed notice label",
    contentHash: "hash-one",
    documentType: "notice",
  }))}\n`);
  await writeFile(listMarkdownPath, "# List of Dates\n");
  await writeFile(listJsonPath, `${JSON.stringify({
    generated_at: "2026-05-11T12:00:00.000Z",
    source_snapshot: [
      {
        file_id: "FILE-0001",
        source_id: "FILE-0001",
        content_hash: "hash-one",
        source_label: "Original notice label",
        source_short_label: "Notice",
        document_type: "notice",
        document_date: "2026-05-01",
        needs_review: false,
        label_status: "suggested",
        label_revision: 1,
      },
    ],
  })}\n`);

  const oldDate = new Date("2026-05-11T11:00:00.000Z");
  const listDate = new Date("2026-05-11T12:00:00.000Z");
  const sourceDate = new Date("2026-05-11T13:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(listJsonPath, listDate, listDate);
  await utimes(listMarkdownPath, listDate, listDate);
  await utimes(sourceIndexPath, sourceDate, sourceDate);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const labelRefresh = await service.readRerunAdvice("/create_case_timeline");
  assert.equal(labelRefresh.state, "stale");
  assert.equal(labelRefresh.shouldConfirm, true);
  assert.equal(labelRefresh.dependencyState, "label_refresh_needed");
  assert.match(labelRefresh.message, /cheap label\/render refresh/);

  await writeFile(sourceIndexPath, `${JSON.stringify(sourceIndexFixture({
    displayLabel: "Confirmed notice label",
    contentHash: "hash-one",
    documentType: "pleading",
  }))}\n`);
  await utimes(sourceIndexPath, sourceDate, sourceDate);
  const review = await service.readRerunAdvice("/create_case_timeline");
  assert.equal(review.dependencyState, "chronology_review_needed");
  assert.equal(review.shouldConfirm, false);

  await writeFile(sourceIndexPath, `${JSON.stringify(sourceIndexFixture({
    displayLabel: "Confirmed notice label",
    contentHash: "hash-two",
    documentType: "notice",
  }))}\n`);
  await utimes(sourceIndexPath, sourceDate, sourceDate);
  const regeneration = await service.readRerunAdvice("/create_case_timeline");
  assert.equal(regeneration.dependencyState, "chronology_regeneration_needed");
  assert.equal(regeneration.shouldConfirm, false);
});

test("list of dates rerun advice detects source hash changes without relying on mtimes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-rerun-list-hash-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(root, "10_Library", "Source Index.json");
  const listJsonPath = path.join(root, "10_Library", "Case Timeline.json");
  const listMarkdownPath = path.join(root, "10_Library", "Case Timeline.md");

  await writeFile(recordPath, "{}\n");
  await writeFile(sourceIndexPath, `${JSON.stringify(sourceIndexFixture({
    displayLabel: "Confirmed notice label",
    contentHash: "hash-two",
    documentType: "notice",
  }))}\n`);
  await writeFile(listMarkdownPath, "# List of Dates\n");
  await writeFile(listJsonPath, `${JSON.stringify({
    generated_at: "2026-05-11T12:00:00.000Z",
    source_snapshot: [{
      file_id: "FILE-0001",
      content_hash: "hash-one",
      document_type: "notice",
      document_date: "2026-05-01",
      needs_review: false,
    }],
  })}\n`);

  const oldDate = new Date("2026-05-11T10:00:00.000Z");
  const listDate = new Date("2026-05-11T12:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(sourceIndexPath, oldDate, oldDate);
  await utimes(listJsonPath, listDate, listDate);
  await utimes(listMarkdownPath, listDate, listDate);

  const service = createMatterStatusService({
    matterStore: {
      ensureMatterRoot: () => root,
      listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    },
  });

  const advice = await service.readRerunAdvice("/create_case_timeline");
  assert.equal(advice.state, "stale");
  assert.equal(advice.shouldConfirm, false);
  assert.equal(advice.dependencyState, "chronology_regeneration_needed");
  assert.equal(advice.newestInputPath, "10_Library/Source Index.json");
});

function sourceIndexFixture({ displayLabel, contentHash, documentType }) {
  return {
    schema_version: "source-index/v1",
    sources: [
      {
        file_id: "FILE-0001",
        source_id: "FILE-0001",
        sha256: contentHash,
        content_hash: contentHash,
        source_path: "00_Inbox/Intake 01 - Initial/By Type/Notices/notice.pdf",
        display_label: displayLabel,
        short_label: "Notice",
        label_status: "confirmed",
        confirmed_label: displayLabel,
        document_type: documentType,
        document_date: "2026-05-01",
        needs_review: false,
      },
    ],
  };
}
