import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MW_LIST_OF_DATES_JSON_RELATIVE,
  MW_LIST_OF_DATES_OUTPUT_RELATIVE,
  buildMwListOfDatesStatus,
  createMwListOfDatesService,
} from "../services/mw-list-of-dates-service.mjs";
import {
  PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
} from "../services/procedural-posture-diagnosis-service.mjs";

function store(root) {
  return {
    ensureMatterRoot: () => root,
    resolveExistingMatter: async () => ({ matterPath: root }),
  };
}

async function writeMatterFixture({ confirmationState = "confirmed" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mw-lod-"));
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await mkdir(path.join(root, "20_Workshop", "Case Analysis"), { recursive: true });
  await writeJson(root, "matter.json", {
    matter_name: "Client v Opponent",
    client_name: "Client",
    opposite_party: "Opponent",
  });
  await writeJson(root, "10_Library/Source Index.json", {
    schema_version: "source-index/v1",
    sources: [{ file_id: "FILE-0001", source_label: "Demand Notice" }],
  });
  await writeFile(path.join(root, "10_Library", "Case Timeline.md"), "# Case Timeline\n\n| Date | Event | Legal Relevance | Source |\n| --- | --- | --- | --- |\n| 2026-01-01 | Demand notice issued. | Notice before action. | Demand Notice |\n");
  await writeJson(root, "10_Library/Case Timeline.json", {
    schema_version: "list-of-dates/v1",
    entries: [{
      date_iso: "2026-01-01",
      date_text: "1 Jan 2026",
      event: "Demand notice issued.",
      legal_relevance: "Notice before action.",
      citation: "FILE-0001 p1.b1",
      supporting_sources: [{ citation: "FILE-0001 p1.b1", source_label: "Demand Notice" }],
    }],
  });
  await writeFile(path.join(root, "20_Workshop", "The Story.md"), "# The Story\n\nThe dispute concerns a demand notice and a contemplated filing.\n");
  await writeFile(path.join(root, PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE), "# Filing and Procedural Posture Diagnosis\n\nWorking path: response / filing.\n");
  await writeJson(root, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE, diagnosisFixture({ confirmationState }));
  return root;
}

function diagnosisFixture({ confirmationState = "confirmed" } = {}) {
  return {
    schema_version: "procedural-posture-diagnosis/v1",
    matter: { name: "Client v Opponent", client_side: "claimant" },
    court_forum: { value: "Commercial Court" },
    procedural_posture: { value: "Pre-filing demand and response stage" },
    recommended_working_path: {
      client_side: "claimant",
      filing_or_remedy: "civil recovery suit",
      reason: "The demand notice is central to the contemplated recovery filing.",
    },
    governing_law: [{ text: "Contract Act / CPC" }],
    adverse_or_difficult_facts: [{ text: "Delay may need explanation." }],
    missing_information: ["Latest payment ledger"],
    confirmation: {
      state: confirmationState,
      confirmed_at: confirmationState === "confirmed" ? "2026-07-01T00:00:00.000Z" : "",
      actor: "tester",
    },
  };
}

async function writeJson(root, relativePath, value) {
  const absolute = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

const provider = async ({ packet }) => {
  assert.equal(packet.case_timeline_rows.length, 1);
  assert.equal(packet.case_timeline_rows[0].timeline_row_id, "CT-0001");
  return {
    rows: [{
      case_timeline_row_ids: ["CT-0001"],
      treatment: "central",
      framed_event: "Demand notice issued.",
      relevance_to_working_posture: "Central to limitation and pre-suit narrative.",
      needs_lawyer_review: false,
      review_reason: "",
    }],
    adverse_or_difficult_facts: [{
      summary: "Delay may need explanation.",
      case_timeline_row_ids: ["CT-0001"],
      suggested_treatment: "Handle in lawyer review before filing.",
    }],
    facts_considered_but_not_emphasized: [],
    missing_information_or_documents: ["Latest payment ledger"],
  };
};

test("MW List of Dates writes downstream Case Analysis Markdown and JSON without internal handles", async () => {
  const root = await writeMatterFixture();
  const service = createMwListOfDatesService({ matterStore: store(root), mwListOfDatesProvider: provider });

  const result = await service.runMwListOfDates({ overwrite: true, runId: "job_test" });

  assert.equal(result.state, "written");
  assert.equal(result.artifactPath, MW_LIST_OF_DATES_OUTPUT_RELATIVE);
  assert.equal(result.sidecar.schema_version, "mw-list-of-dates/v1");
  assert.equal(result.sidecar.rows[0].case_timeline_row_ids[0], "CT-0001");
  assert.match(result.markdown, /# MW List of Dates/);
  assert.match(result.markdown, /## Chapter 1 — Working List of Dates/);
  assert.match(result.markdown, /## Chapter 2 — Basis, Assumptions, and Review Notes/);
  assert.match(result.markdown, /01\/01\/2026/);
  assert.match(result.markdown, /Relevance for the client's case/);
  assert.match(result.markdown, /Demand Notice/);
  assert.doesNotMatch(result.markdown, /<br>/i);
  assert.doesNotMatch(result.markdown, /FILE-0001/);
  assert.match(await readFile(path.join(root, ...MW_LIST_OF_DATES_OUTPUT_RELATIVE.split("/")), "utf8"), /MW-authored working List of Dates/);
  const sidecar = JSON.parse(await readFile(path.join(root, ...MW_LIST_OF_DATES_JSON_RELATIVE.split("/")), "utf8"));
  assert.equal(sidecar.receipt_id, "job_test");
  assert.equal(sidecar.based_on.procedural_diagnosis.confirmation_state, "confirmed");
});

test("MW List of Dates status blocks unconfirmed procedural diagnosis", async () => {
  const root = await writeMatterFixture({ confirmationState: "not_sure" });

  const status = await buildMwListOfDatesStatus({ matterRoot: root });

  assert.equal(status.state, "blocked_unconfirmed_diagnosis");
  assert.equal(status.confirmation.state, "not_sure");
});

test("MW List of Dates requires explicit reason before proceeding unconfirmed", async () => {
  const root = await writeMatterFixture({ confirmationState: "not_sure" });
  const service = createMwListOfDatesService({ matterStore: store(root), mwListOfDatesProvider: provider });

  await assert.rejects(
    () => service.runMwListOfDates({ overwrite: true, proceedUnconfirmed: true }),
    /reason/i,
  );

  const result = await service.runMwListOfDates({
    overwrite: true,
    proceedUnconfirmed: true,
    proceedUnconfirmedReason: "Urgent internal chronology review while diagnosis is pending.",
  });
  assert.equal(result.status, "provisional");
  assert.equal(result.sidecar.based_on.procedural_diagnosis.proceeded_unconfirmed, true);
  assert.match(result.markdown, /proceeded unconfirmed/);
});

test("MW List of Dates does not overwrite existing artifact unless overwrite is explicit", async () => {
  const root = await writeMatterFixture();
  const service = createMwListOfDatesService({ matterStore: store(root), mwListOfDatesProvider: provider });

  await service.runMwListOfDates({ overwrite: true });
  const second = await service.runMwListOfDates({ overwrite: false });

  assert.equal(second.state, "requires_overwrite");
});

test("MW List of Dates validation rejects broad grouped date-range rows", async () => {
  const root = await writeMatterFixture();
  await writeJson(root, "10_Library/Case Timeline.json", {
    schema_version: "list-of-dates/v1",
    entries: [{
      date_iso: "2026-01-01",
      date_text: "1 Jan 2026",
      event: "Demand notice issued.",
      legal_relevance: "Notice before action.",
      citation: "FILE-0001 p1.b1",
      supporting_sources: [{ citation: "FILE-0001 p1.b1", source_label: "Demand Notice" }],
    }, {
      date_iso: "2026-02-01",
      date_text: "1 Feb 2026",
      event: "Reply received.",
      legal_relevance: "Frames disputed liability.",
      citation: "FILE-0001 p2.b1",
      supporting_sources: [{ citation: "FILE-0001 p2.b1", source_label: "Demand Notice" }],
    }],
  });
  const service = createMwListOfDatesService({
    matterStore: store(root),
    mwListOfDatesProvider: async () => ({
      rows: [{
        case_timeline_row_ids: ["CT-0001", "CT-0002"],
        treatment: "central",
        framed_event: "The parties exchanged demand and reply correspondence.",
        relevance_to_working_posture: "Broad summary of the pre-suit exchange.",
        needs_lawyer_review: false,
        review_reason: "",
      }],
      adverse_or_difficult_facts: [{
        summary: "Delay may need explanation.",
        case_timeline_row_ids: ["CT-0001"],
        suggested_treatment: "Handle in lawyer review before filing.",
      }],
      facts_considered_but_not_emphasized: [],
      missing_information_or_documents: [],
    }),
  });

  await assert.rejects(
    () => service.runMwListOfDates({ overwrite: true }),
    /exactly one Case Timeline row/i,
  );
});

test("MW List of Dates validation fails if diagnosis adverse facts are omitted", async () => {
  const root = await writeMatterFixture();
  const service = createMwListOfDatesService({
    matterStore: store(root),
    mwListOfDatesProvider: async () => ({
      rows: [{
        case_timeline_row_ids: ["CT-0001"],
        treatment: "central",
        framed_event: "Demand notice issued.",
        relevance_to_working_posture: "Central to limitation and pre-suit narrative.",
        needs_lawyer_review: false,
        review_reason: "",
      }],
      adverse_or_difficult_facts: [],
      facts_considered_but_not_emphasized: [],
      missing_information_or_documents: [],
    }),
  });

  await assert.rejects(
    () => service.runMwListOfDates({ overwrite: true }),
    /adverse facts/i,
  );
});
