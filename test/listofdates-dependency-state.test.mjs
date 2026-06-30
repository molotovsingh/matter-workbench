import assert from "node:assert/strict";
import test from "node:test";
import {
  CASE_TIMELINE_DEPENDENCY_STATES,
  classifyCaseTimelineDependencyState,
} from "../services/case-timeline-dependency-state.mjs";
import {
  classifyListOfDatesDependencyState,
  LIST_OF_DATES_DEPENDENCY_STATES,
} from "../services/listofdates-dependency-state.mjs";

const snapshotTarget = {
  json: {
    source_snapshot: [
      {
        file_id: "FILE-0001",
        content_hash: "hash-one",
        document_type: "notice",
        document_date: "2026-05-01",
        needs_review: false,
      },
    ],
  },
};

function sourceIndexSource(patch = {}) {
  return {
    file_id: "FILE-0001",
    content_hash: "hash-one",
    document_type: "notice",
    document_date: "2026-05-01",
    needs_review: false,
    ...patch,
  };
}

test("classifyCaseTimelineDependencyState treats source label-only changes as render refresh", () => {
  const state = classifyCaseTimelineDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource({
          display_label: "Confirmed updated label",
          confirmed_label: "Confirmed updated label",
        }),
      ],
    },
  });

  assert.equal(state, CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED);
  assert.equal(classifyListOfDatesDependencyState, classifyCaseTimelineDependencyState);
  assert.equal(LIST_OF_DATES_DEPENDENCY_STATES, CASE_TIMELINE_DEPENDENCY_STATES);
});

test("classifyCaseTimelineDependencyState treats source metadata changes as review", () => {
  const state = classifyCaseTimelineDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource({ document_type: "pleading" }),
      ],
    },
  });

  assert.equal(state, CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED);
});

test("classifyCaseTimelineDependencyState treats content or document-set changes as regeneration", () => {
  const contentState = classifyCaseTimelineDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource({ content_hash: "hash-two" }),
      ],
    },
  });
  const newDocumentState = classifyCaseTimelineDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource(),
        sourceIndexSource({ file_id: "FILE-0002", content_hash: "hash-extra" }),
      ],
    },
  });
  const extractionState = classifyCaseTimelineDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "extraction_record" },
    sourceIndex: { sources: [sourceIndexSource()] },
  });

  assert.equal(contentState, CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED);
  assert.equal(newDocumentState, CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED);
  assert.equal(extractionState, CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED);
});
