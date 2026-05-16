export function normalizeSourceLabelText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function sourceLabelContainsFileId(value) {
  return /\bFILE-\d{4,}\b/.test(String(value || ""));
}

export function effectiveSourceLabel(source = {}) {
  const status = normalizeSourceLabelText(source.label_status).toLowerCase();
  const confirmed = normalizeSourceLabelText(source.confirmed_label);
  if ((status === "confirmed" || status === "overridden") && confirmed) return confirmed;
  return normalizeSourceLabelText(source.display_label || source.suggested_label);
}

export function effectiveShortSourceLabel(source = {}, fallback = "") {
  const status = normalizeSourceLabelText(source.label_status).toLowerCase();
  const confirmed = normalizeSourceLabelText(source.confirmed_label);
  if ((status === "confirmed" || status === "overridden") && confirmed) return confirmed;
  return normalizeSourceLabelText(source.short_label) || fallback;
}

export function sourceLabelMetadata(source = {}, { includeDisplayFields = false } = {}) {
  const label = effectiveSourceLabel(source);
  const shortLabel = effectiveShortSourceLabel(source, label);
  const metadata = {
    source_id: normalizeSourceLabelText(source.source_id || source.file_id),
    content_hash: normalizeSourceLabelText(source.content_hash || source.sha256),
    document_type: normalizeSourceLabelText(source.document_type).toLowerCase(),
    document_date: normalizeSourceLabelText(source.document_date),
    needs_review: Boolean(source.needs_review),
    label_status: normalizeSourceLabelText(source.label_status),
    label_revision: Number.isInteger(source.label_revision) ? source.label_revision : 0,
  };
  if (includeDisplayFields) {
    metadata.display_label = label;
    metadata.short_label = shortLabel;
  }
  if (label && !sourceLabelContainsFileId(label) && !sourceLabelContainsFileId(shortLabel)) {
    metadata.source_label = label;
    metadata.source_short_label = shortLabel || label;
  }
  return metadata;
}
