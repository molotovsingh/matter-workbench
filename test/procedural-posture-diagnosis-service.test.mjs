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
  postureDiagnosisSchemas,
} from "../services/procedural-posture-diagnosis-service.mjs";

const servicePath = new URL("../services/procedural-posture-diagnosis-service.mjs", import.meta.url);
const contractPath = new URL("../services/procedural-posture-diagnosis-contract.mjs", import.meta.url);

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
  await writeFile(path.join(root, "10_Library", "Case Timeline.md"), "# Case Timeline\n\n| Date | Event | Legal Relevance | Source |\n| --- | --- | --- | --- |\n| 2026-01-01 | Notice issued. | Records notice. | Notice |\n");
  await writeFile(path.join(root, "10_Library", "Case Timeline.json"), `${JSON.stringify({
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
    path: "10_Library/Case Timeline.json",
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
    simple_case_view: "This looks like a notice-led civil matter. The record does not yet show a filed court case, so the legal team should first confirm whether any proceeding already exists.",
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
    legal_routes: [{
      route_number: 1,
      route_title: "Confirm live status and complete record",
      route_summary: "First confirm whether a case is already filed and collect the complete record before choosing a filing.",
      when_to_use: "the current record only shows a notice and no proceeding number or court order",
      why_this_route: "the next step changes if a proceeding has already been filed outside the supplied papers",
      court_or_forum: "Civil court / appropriate forum to be confirmed",
      statutory_references: ["Verify limitation, forum, and applicable civil procedure before filing"],
      what_to_confirm: ["Whether proceedings are already filed", "Forum and limitation", "Complete notice record"],
      priority: "primary",
    }, {
      route_number: 2,
      route_title: "Notice response route",
      route_summary: "If no case is filed, prepare a response or pre-filing strategy based on the notice.",
      when_to_use: "the lawyer confirms that the matter is still pre-filing",
      why_this_route: "the visible source-backed event is a notice requiring legal response",
      court_or_forum: "No court yet / forum to be selected if filing becomes necessary",
      statutory_references: ["Verify governing statute and limitation after reading the notice"],
      what_to_confirm: ["Notice date", "Relief claimed", "Client instructions"],
      priority: "secondary",
    }],
    recommended_route: {
      route_number: 1,
      route_title: "Confirm live status and complete record",
      recommendation: "Start by confirming the live posture before drafting.",
      reason: "The supplied record does not show whether any court case already exists.",
      next_step: "Check case status, limitation, forum, and complete notice papers.",
    },
    next_best_actions: ["Confirm whether proceedings already exist", "Collect complete notice papers", "Confirm forum and limitation before drafting"],
    governing_law: [{ text: "Governing framework cannot be fixed without forum confirmation.", source_refs: ["FILE-0001 p1.b1"] }],
    central_facts: [{ text: "The supplied record shows a notice event.", source_refs: ["FILE-0001 p1.b1"] }],
    adverse_or_difficult_facts: [{ text: "The record does not show whether any proceeding was already filed.", source_refs: ["FILE-0001 p1.b1"] }],
    missing_information: ["Proceeding number, if any", "Forum confirmation"],
    lawyer_to_confirm: ["Court/forum", "Procedural stage", "Priority filing/remedy"],
    internal_source_handles: ["FILE-0001 p1.b1"],
    critique_handling: [{ critique_signal: "Avoid overconfidence", disposition: "accepted", reason: "Marked forum medium confidence." }],
  };
}

function critiqueFixture() {
  return {
    schema_version: "posture_diagnosis_critique/v1",
    overall_risk: "low",
    serious_issues: [],
    missed_possibilities: [],
    overconfidence_flags: ["Keep forum confidence provisional."],
    adverse_fact_gaps: [],
    source_grounding_gaps: [],
    recommended_revisions: ["Keep the result concise and provisional."],
    questions_for_lawyer: ["Confirm whether a proceeding exists."],
    verdict: "usable_with_revisions",
  };
}

test("procedural posture prompts require provisional, adverse-fact-aware diagnosis", () => {
  const prompts = buildPostureDiagnosisPrompts();
  assert.match(prompts.proposerSystem, /provisional Filing and Procedural Posture Diagnosis/i);
  assert.match(prompts.proposerSystem, /simple Indian legal English/i);
  assert.match(prompts.proposerSystem, /all probable legal routes supported by the current record/i);
  assert.match(prompts.proposerSystem, /statutory references/i);
  assert.match(prompts.proposerSystem, /Material adverse or inconvenient facts must be surfaced/i);
  assert.match(prompts.proposerSystem, /overlapping proceedings, forums, or tracks/i);
  assert.match(prompts.proposerSystem, /multiple procedural tracks/i);
  assert.match(prompts.proposerSystem, /what cannot be confirmed/i);
  assert.match(prompts.proposerSystem, /Deduplicate repeated source labels/i);
  assert.match(prompts.proposerSystem, /Do not put raw FILE handles, hashes, storage paths/i);
  assert.match(prompts.criticSystem, /unsupported leaps/i);
  assert.match(prompts.criticSystem, /conflated proceedings\/forums/i);
  assert.match(prompts.finalizerSystem, /prose-like legal routes section/i);
  assert.match(prompts.finalizerSystem, /conservative current-posture paragraph/i);
  assert.match(prompts.finalizerSystem, /recommended route and next best actions/i);
});

test("procedural posture schema requires standardized legal routes", () => {
  const schemas = postureDiagnosisSchemas();
  assert.ok(schemas.finalDiagnosis.required.includes("simple_case_view"));
  assert.ok(schemas.finalDiagnosis.required.includes("legal_routes"));
  assert.ok(schemas.finalDiagnosis.required.includes("recommended_route"));
  assert.ok(schemas.finalDiagnosis.required.includes("next_best_actions"));
  assert.deepEqual(
    schemas.finalDiagnosis.properties.legal_routes.items.required,
    ["route_number", "route_title", "route_summary", "when_to_use", "why_this_route", "court_or_forum", "statutory_references", "what_to_confirm", "priority"],
  );
});

test("procedural posture output contract is separated from orchestration", async () => {
  const serviceSource = await readFile(servicePath, "utf8");
  const contractSource = await readFile(contractPath, "utf8");

  assert.match(serviceSource, /procedural-posture-diagnosis-contract\.mjs/);
  assert.doesNotMatch(serviceSource, /function legalRouteSchema/);
  assert.doesNotMatch(serviceSource, /function renderLegalRoutesMarkdown/);
  assert.match(contractSource, /export function renderProceduralPostureDiagnosisMarkdown/);
  assert.match(contractSource, /export function normalizeLegalRoutes/);
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
  assert.match(markdown, /## Simple case view/);
  assert.match(markdown, /## Legal routes available from current record/);
  assert.match(markdown, /### Route 1: Confirm live status and complete record/);
  assert.match(markdown, /Statutory references to check: Verify limitation, forum, and applicable civil procedure before filing\./);
  assert.match(markdown, /## Recommended route/);
  assert.doesNotMatch(markdown, /FILE-0001/);
  assert.doesNotMatch(markdown, /20_Workshop\//);
  assert.doesNotMatch(markdown, /10_Library\//);
  assert.doesNotMatch(markdown, /Internal source handles/i);
  assert.deepEqual(json.internal_source_handles, ["FILE-0001 p1.b1"]);
  assert.equal(json.simple_case_view, "This looks like a notice-led civil matter. The record does not yet show a filed court case, so the legal team should first confirm whether any proceeding already exists.");
  assert.equal(json.legal_routes.length, 2);
  assert.equal(json.recommended_route.route_title, "Confirm live status and complete record");
  assert.deepEqual(json.next_best_actions, ["Confirm whether proceedings already exist", "Collect complete notice papers", "Confirm forum and limitation before drafting"]);
});

test("procedural posture retries truncated provider JSON once", async () => {
  const root = await matterRoot();
  const invocations = [];
  const service = createProceduralPostureDiagnosisService({
    matterStore: store(root),
    env: {
      POSTURE_DIAGNOSIS_MAX_OUTPUT_TOKENS: "8000",
      POSTURE_DIAGNOSIS_RETRY_MAX_OUTPUT_TOKENS: "12000",
    },
    aiProviderService: {
      resolveTask: () => ({ providerConfig: { provider: "openrouter" } }),
      invoke: async (request) => {
        invocations.push(request);
        if (invocations.length === 1) {
          const error = new Error("posture diagnosis proposer response was not valid JSON: Unexpected end of JSON input");
          error.code = "provider.invalid_json";
          throw error;
        }
        if (request.schemaName === "posture_diagnosis_critique") {
          return { parsed: critiqueFixture(), aiRun: { provider: "openrouter", model: request.overrides?.model } };
        }
        return { parsed: finalDiagnosisFixture(), aiRun: { provider: "openrouter", model: request.overrides?.model } };
      },
    },
    now: () => new Date("2026-06-29T10:00:00.000Z"),
  });

  const result = await service.runDiagnosis({ overwrite: true, matterContextPacketOverride: contextPacket });

  assert.equal(result.state, "written");
  assert.equal(invocations.length, 4);
  assert.equal(invocations[0].schemaName, "posture_diagnosis_draft");
  assert.equal(invocations[0].overrides.maxOutputTokens, 8000);
  assert.equal(invocations[1].schemaName, "posture_diagnosis_draft");
  assert.equal(invocations[1].overrides.maxOutputTokens, 12000);
  assert.match(invocations[1].userPayload.retry_instructions, /invalid JSON/);
  assert.match(invocations[1].userPayload.retry_instructions, /complete JSON object/);
});

test("procedural posture status detects stale upstream changes", async () => {
  const root = await matterRoot();
  const service = createProceduralPostureDiagnosisService({
    matterStore: store(root),
    diagnosisProvider: async () => finalDiagnosisFixture(),
  });
  await service.runDiagnosis({ overwrite: true, matterContextPacketOverride: contextPacket });

  await utimes(path.join(root, "10_Library", "Case Timeline.md"), new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:00.000Z"));
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
