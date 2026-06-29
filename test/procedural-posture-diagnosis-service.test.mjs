import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CASE_ANALYSIS_QA_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
  buildPostureDiagnosisPrompts,
  createProceduralPostureDiagnosisService,
} from "../services/procedural-posture-diagnosis-service.mjs";

function store(root) {
  return {
    ensureMatterRoot: () => root,
    resolveExistingMatter: async () => ({ matterPath: root }),
  };
}

async function matterRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "posture-diagnosis-"));
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await mkdir(path.join(root, "20_Workshop"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Client v Opponent",
    client_name: "Client",
    opposite_party: "Opponent",
    matter_type: "Civil",
    jurisdiction: "India",
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# Case Timeline\n\n| Date | Event | Legal Relevance | Source |\n| --- | --- | --- | --- |\n| 2026-01-01 | Notice issued. | Records notice. | Notice |\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.json"), `${JSON.stringify({
    schema_version: "list-of-dates/v1",
    entries: [{
      date_iso: "2026-01-01",
      event: "Notice issued.",
      legal_relevance: "Records notice before filing.",
      citation: "FILE-0001 p1.b1",
      perspective: "record_neutral",
    }],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    schema_version: "source-index/v1",
    sources: [{ file_id: "FILE-0001", source_label: "Notice" }],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "20_Workshop", "The Story.md"), "# The Story\n\nAt a glance\nThe matter concerns a notice and possible response filing.\n");
  return root;
}

const contextPacket = {
  schema_version: "matter-context/v1",
  matter: { matter_name: "Client v Opponent", client_name: "Client" },
  sources: [{ file_id: "FILE-0001", source_label: "Notice", sample_citations: ["FILE-0001 p1.b1"] }],
  evidence_blocks: [{ citation: "FILE-0001 p1.b1", source_label: "Notice", text: "Notice issued on 1 January 2026." }],
  library_artifacts: [{
    kind: "list_of_dates",
    path: "10_Library/List of Dates.json",
    entry_count: 1,
    entries: [{
      date_iso: "2026-01-01",
      event: "Notice issued.",
      legal_relevance: "Records notice before filing.",
      citation: "FILE-0001 p1.b1",
      perspective: "record_neutral",
    }],
  }],
  warnings: [],
};

function finalDiagnosisFixture() {
  return {
    schema_version: "posture_diagnosis_final/v1",
    status: "provisional_mw_inferred",
    short_diagnosis: "The record suggests a pre-filing notice-response posture, subject to lawyer confirmation.",
    court_forum: {
      value: "Civil court / appropriate forum to be confirmed",
      confidence: "medium",
      why: "The supplied record shows a notice but no filed proceeding.",
      source_refs: ["FILE-0001 p1.b1"],
      lawyer_to_confirm: "Confirm forum and pecuniary/territorial jurisdiction.",
    },
    procedural_posture: {
      value: "Pre-filing / response to notice",
      confidence: "high",
      why: "The timeline and story show notice but no proceeding number or order.",
      source_refs: ["FILE-0001 p1.b1"],
      lawyer_to_confirm: "Confirm no proceeding has already been filed.",
    },
    possible_filings: [{
      priority: "primary",
      filing_or_remedy: "Notice response or pre-filing strategy note",
      reason: "The visible record is notice-led and does not show an existing case.",
      key_facts: ["Notice issued on 1 January 2026"],
      caveats: ["Forum and limitation require lawyer review"],
      source_refs: ["FILE-0001 p1.b1"],
    }],
    recommended_working_path: {
      priority: "primary",
      filing_or_remedy: "Confirm posture before drafting a notice response",
      reason: "The next step depends on whether any proceeding exists outside the supplied record.",
      key_facts: ["No proceeding is visible"],
      caveats: ["Lawyer must confirm"],
      source_refs: ["FILE-0001 p1.b1"],
    },
    governing_law: [{ text: "Governing framework cannot be fixed without forum confirmation.", source_refs: ["FILE-0001 p1.b1"] }],
    central_facts: [{ text: "The supplied record shows a notice event.", source_refs: ["FILE-0001 p1.b1"] }],
    adverse_or_difficult_facts: [{ text: "The record does not show whether any proceeding was already filed.", source_refs: ["FILE-0001 p1.b1"] }],
    missing_information: ["Proceeding number, if any", "Forum confirmation"],
    lawyer_to_confirm: ["Court/forum", "Procedural stage", "Priority filing/remedy"],
    internal_source_handles: ["FILE-0001 p1.b1"],
    critique_handling: [{ critique_signal: "Avoid overconfidence", disposition: "accepted", reason: "Marked forum medium confidence." }],
  };
}

test("procedural posture prompts require provisional, adverse-fact-aware diagnosis", () => {
  const prompts = buildPostureDiagnosisPrompts();
  assert.match(prompts.proposerSystem, /provisional Filing and Procedural Posture Diagnosis/i);
  assert.match(prompts.proposerSystem, /Material adverse or inconvenient facts must be surfaced/i);
  assert.match(prompts.criticSystem, /unsupported leaps/i);
  assert.match(prompts.finalizerSystem, /must remain provisional/i);
});

test("procedural posture diagnosis refuses to run without a Case Timeline", async () => {
  const root = await matterRoot();
  const service = createProceduralPostureDiagnosisService({
    matterStore: store(root),
    diagnosisProvider: async () => finalDiagnosisFixture(),
  });

  await assert.rejects(
    () => service.runDiagnosis({
      overwrite: true,
      matterContextPacketOverride: { ...contextPacket, library_artifacts: [] },
    }),
    /Build the Case Timeline/,
  );
});

test("procedural posture diagnosis writes markdown and JSON sidecar", async () => {
  const root = await matterRoot();
  const calls = [];
  const service = createProceduralPostureDiagnosisService({
    matterStore: store(root),
    diagnosisProvider: async ({ packet }) => {
      calls.push(packet);
      return finalDiagnosisFixture();
    },
    now: () => new Date("2026-06-29T10:00:00.000Z"),
  });

  const result = await service.runDiagnosis({
    overwrite: true,
    matterContextPacketOverride: contextPacket,
  });

  assert.equal(result.state, "written");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].matter_story.path, "20_Workshop/The Story.md");
  const markdown = await readFile(path.join(root, PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE), "utf8");
  const json = JSON.parse(await readFile(path.join(root, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE), "utf8"));
  assert.match(markdown, /^# Filing and Procedural Posture Diagnosis/);
  assert.match(markdown, /Status: Provisional — lawyer confirmation required/);
  assert.equal(json.schema_version, "procedural-posture-diagnosis/v1");
  assert.equal(json.status, "mw_inferred");
  assert.equal(json.confirmation.state, "unconfirmed");
  assert.equal(json.court_forum.value, "Civil court / appropriate forum to be confirmed");
});

test("procedural posture status detects stale upstream changes", async () => {
  const root = await matterRoot();
  const service = createProceduralPostureDiagnosisService({
    matterStore: store(root),
    diagnosisProvider: async () => finalDiagnosisFixture(),
  });
  await service.runDiagnosis({ overwrite: true, matterContextPacketOverride: contextPacket });

  await utimes(path.join(root, "10_Library", "List of Dates.md"), new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:00.000Z"));
  await utimes(path.join(root, PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE), new Date("2026-06-29T11:00:00.000Z"), new Date("2026-06-29T11:00:00.000Z"));
  await utimes(path.join(root, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE), new Date("2026-06-29T11:00:00.000Z"), new Date("2026-06-29T11:00:00.000Z"));

  const status = await service.readDiagnosisStatus(root);
  assert.equal(status.state, "stale");
  assert.equal(status.stale, true);
});

test("procedural posture confirmation requires correction reason and appends Q&A", async () => {
  const root = await matterRoot();
  const service = createProceduralPostureDiagnosisService({
    matterStore: store(root),
    diagnosisProvider: async () => finalDiagnosisFixture(),
    now: () => new Date("2026-06-29T13:00:00.000Z"),
  });
  await service.runDiagnosis({ overwrite: true, matterContextPacketOverride: contextPacket });

  await assert.rejects(
    () => service.recordConfirmation({ decision: "corrected", reasonOrCorrection: "" }),
    /reason or correction/i,
  );

  const result = await service.recordConfirmation({
    decision: "corrected",
    reasonOrCorrection: "Proceeding has already been filed before the district court.",
    actor: "lawyer",
  });

  assert.equal(result.state, "corrected");
  const json = JSON.parse(await readFile(path.join(root, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE), "utf8"));
  const qna = await readFile(path.join(root, CASE_ANALYSIS_QA_RELATIVE), "utf8");
  assert.equal(json.status, "lawyer_corrected");
  assert.equal(json.confirmation.state, "corrected");
  assert.match(qna, /# Case Analysis Q&A/);
  assert.match(qna, /Procedural posture confirmation/);
  assert.match(qna, /Proceeding has already been filed/);
});
