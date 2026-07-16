const FULL_SNIPPET_OVERLAP_SCORE = 1000;
const MAX_SNIPPET_LENGTH = 700;

export function buildSourceResolver(packet) {
  const byCitation = new Map();
  const byLabel = new Map();
  for (const block of Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : []) {
    if (block?.citation) {
      byCitation.set(block.citation, block);
      indexSourceLabel(byLabel, block.source_label, block);
      indexSourceLabel(byLabel, block.source_short_label, block);
    }
  }
  for (const artifact of Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : []) {
    if (artifact?.kind !== "list_of_dates" || !Array.isArray(artifact.entries)) continue;
    for (const entry of artifact.entries) {
      const entryBlock = addChronologyCitation(byCitation, entry, entry);
      indexSourceLabel(byLabel, entry.source_label, entryBlock);
      indexSourceLabel(byLabel, entry.source_short_label, entryBlock);
      for (const source of Array.isArray(entry.supporting_sources) ? entry.supporting_sources : []) {
        const sourceBlock = addChronologyCitation(byCitation, source, entry);
        indexSourceLabel(byLabel, source.source_label || entry.source_label, sourceBlock);
        indexSourceLabel(byLabel, source.source_short_label || entry.source_short_label, sourceBlock);
      }
    }
    for (const entry of Array.isArray(artifact.citation_index) ? artifact.citation_index : []) {
      const entryBlock = addChronologyCitation(byCitation, entry, entry);
      indexSourceLabel(byLabel, entry.source_label, entryBlock);
      indexSourceLabel(byLabel, entry.source_short_label, entryBlock);
    }
  }
  return { byCitation, byLabel };
}

export function normalizeSources(rawSources, sourceResolver) {
  const sources = [];
  const seen = new Set();
  let unsupportedCount = 0;
  for (const source of Array.isArray(rawSources) ? rawSources : []) {
    const sourceReference = normalizeText(source?.raw_citation);
    if (!sourceReference) continue;
    const block = resolveSourceReference(sourceReference, source, sourceResolver);
    const rawCitation = block?.citation || sourceReference;
    if (!block) {
      unsupportedCount += 1;
      continue;
    }
    if (seen.has(rawCitation)) continue;
    seen.add(rawCitation);
    sources.push({
      raw_citation: rawCitation,
      source_label: normalizeText(source?.source_label) || block.source_label || block.source_short_label || "",
      snippet: boundedText(source?.snippet || block.text, MAX_SNIPPET_LENGTH),
    });
  }
  return { sources, unsupportedCount };
}

export function answerHasUnsupportedRawCitations(answerMarkdown, sources = [], sourceResolver = {}) {
  const tokens = extractRawCitationTokens(answerMarkdown);
  if (!tokens.length) return false;
  const allowed = new Set(sources.map((source) => source.raw_citation).filter(Boolean));
  for (const token of tokens) {
    if (allowed.has(token)) continue;
    if (resolveSourceReference(token, { raw_citation: token }, sourceResolver)) continue;
    return true;
  }
  return false;
}

function addChronologyCitation(byCitation, source = {}, entry = {}) {
  const citation = normalizeText(source.citation);
  if (!citation) return null;
  if (byCitation.has(citation)) return byCitation.get(citation);
  const block = {
    citation,
    source_label: normalizeText(source.source_label) || normalizeText(entry.source_label),
    source_short_label: normalizeText(source.source_short_label) || normalizeText(entry.source_short_label),
    text: normalizeText(entry.source_excerpt) || normalizeText(entry.event),
  };
  byCitation.set(citation, block);
  return block;
}

function indexSourceLabel(byLabel, label, block) {
  const key = normalizeSourceReference(label);
  if (!key || !block?.citation) return;
  if (!byLabel.has(key)) byLabel.set(key, []);
  const blocks = byLabel.get(key);
  if (!blocks.some((candidate) => candidate.citation === block.citation)) blocks.push(block);
}

function resolveSourceReference(sourceReference, source = {}, sourceResolver = {}) {
  const byCitation = sourceResolver.byCitation || new Map();
  const direct = byCitation.get(sourceReference);
  if (direct) return direct;

  const byLabel = sourceResolver.byLabel || new Map();
  const candidates = byLabel.get(normalizeSourceReference(sourceReference)) || [];
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const snippet = normalizeText(source?.snippet);
  if (snippet) {
    const scored = candidates
      .map((block) => ({ block, score: sourceMatchScore(snippet, block.text) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) return scored[0].block;
  }

  const label = normalizeSourceReference(source?.source_label);
  if (label && label !== normalizeSourceReference(sourceReference)) {
    const labelCandidates = byLabel.get(label) || [];
    if (labelCandidates.length === 1) return labelCandidates[0];
  }

  return candidates[0];
}

function extractRawCitationTokens(text = "") {
  return [...new Set(String(text).match(/\bFILE-\d{4,}\s+p\d+\.b\d+\b/g) || [])];
}

function sourceMatchScore(snippet, blockText) {
  const snippetText = normalizeSourceReference(snippet);
  const evidenceText = normalizeSourceReference(blockText);
  if (!snippetText || !evidenceText) return 0;
  if (evidenceText.includes(snippetText) || snippetText.includes(evidenceText)) return FULL_SNIPPET_OVERLAP_SCORE;
  const words = new Set(snippetText.split(" ").filter((word) => word.length > 4));
  if (!words.size) return 0;
  let score = 0;
  for (const word of words) {
    if (evidenceText.includes(word)) score += 1;
  }
  return score;
}

function normalizeSourceReference(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function boundedText(value, maxLength) {
  return normalizeText(value).slice(0, maxLength);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
