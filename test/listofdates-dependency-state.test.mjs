import assert from "node:assert/strict";
import test from "node:test";
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

test("classifyListOfDatesDependencyState treats source label-only changes as render refresh", () => {
  const state = classifyListOfDatesDependencyState({
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

  assert.equal(state, LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED);
});

test("classifyListOfDatesDependencyState treats source metadata changes as review", () => {
  const state = classifyListOfDatesDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource({ document_type: "pleading" }),
      ],
    },
  });

  assert.equal(state, LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED);
});

test("classifyListOfDatesDependencyState treats content or document-set changes as regeneration", () => {
  const contentState = classifyListOfDatesDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource({ content_hash: "hash-two" }),
      ],
    },
  });
  const newDocumentState = classifyListOfDatesDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "source_index" },
    sourceIndex: {
      sources: [
        sourceIndexSource(),
        sourceIndexSource({ file_id: "FILE-0002", content_hash: "hash-extra" }),
      ],
    },
  });
  const extractionState = classifyListOfDatesDependencyState({
    target: snapshotTarget,
    newestInput: { inputKind: "extraction_record" },
    sourceIndex: { sources: [sourceIndexSource()] },
  });

  assert.equal(contentState, LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED);
  assert.equal(newDocumentState, LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED);
  assert.equal(extractionState, LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED);
});
