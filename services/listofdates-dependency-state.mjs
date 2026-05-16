export const LIST_OF_DATES_DEPENDENCY_STATES = Object.freeze({
  LABEL_REFRESH_NEEDED: "label_refresh_needed",
  CHRONOLOGY_REVIEW_NEEDED: "chronology_review_needed",
  CHRONOLOGY_REGENERATION_NEEDED: "chronology_regeneration_needed",
});

export function classifyListOfDatesDependencyState({ target, newestInput = {}, sourceIndex = null } = {}) {
  if (newestInput.inputKind !== "source_index") {
    return LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED;
  }
  const snapshot = Array.isArray(target?.json?.source_snapshot) ? target.json.source_snapshot : [];
  if (!sourceIndex || !Array.isArray(sourceIndex.sources) || !snapshot.length) {
    return LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED;
  }
  const byFileId = new Map(sourceIndex.sources.map((source) => [source.file_id, normalizeSnapshotSource(source)]));
  const snapshotIds = new Set(snapshot.map((source) => source.file_id).filter(Boolean));
  if (sourceIndex.sources.some((source) => source?.file_id && !snapshotIds.has(source.file_id))) {
    return LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED;
  }
  let compared = 0;
  for (const previous of snapshot) {
    const current = byFileId.get(previous.file_id);
    if (!current) return LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED;
    compared += 1;
    if ((previous.content_hash || "") !== (current.content_hash || "")) {
      return LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED;
    }
    if (
      (previous.document_type || "") !== (current.document_type || "")
      || (previous.document_date || "") !== (current.document_date || "")
      || Boolean(previous.needs_review) !== Boolean(current.needs_review)
    ) {
      return LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED;
    }
  }
  return compared
    ? LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED
    : LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED;
}

function normalizeSnapshotSource(source = {}) {
  return {
    file_id: source.file_id || "",
    content_hash: source.content_hash || source.sha256 || "",
    document_type: source.document_type || "",
    document_date: source.document_date || "",
    needs_review: Boolean(source.needs_review),
  };
}
