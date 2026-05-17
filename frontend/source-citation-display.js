export function lawyerFacingSourceFragment(fragment = "", fallback = "Source label unavailable") {
  const raw = String(fragment || "");
  return lawyerFacingSourceLabel({
    label: raw,
    citation: raw,
    fallback,
  });
}

export function lawyerFacingSourceLabel({ label = "", citation = "", fallback = "Source label unavailable" } = {}) {
  const rawLabel = String(label || "");
  const rawCitation = String(citation || "");
  const cleanLabel = scrubTechnicalCitation(rawLabel) || fallback;
  const pageLabel = formatPageLabel(extractCitationPages(`${rawLabel} ${rawCitation}`));
  return pageLabel && !cleanLabel.includes(`(${pageLabel})`)
    ? `${cleanLabel} (${pageLabel})`
    : cleanLabel;
}

function scrubTechnicalCitation(value = "") {
  return String(value || "")
    .replace(/\s*\([^)]*\bFILE-\d{4}\b[^)]*\)/gi, "")
    .replace(/\bFILE-\d{4}(?:\s+p\d+(?:\.b\d+)?)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,.;:()/-]+|[\s,.;:()/-]+$/g, "")
    .trim();
}

function extractCitationPages(value = "") {
  return uniqueValues(
    Array.from(String(value || "").matchAll(/\bFILE-\d{4}\s+p(\d+)(?:\.b\d+)?/gi))
      .map((match) => match[1])
      .filter(Boolean),
  );
}

function uniqueValues(values = []) {
  return [...new Set(values)];
}

function formatPageLabel(pages = []) {
  if (!pages.length) return "";
  if (pages.length === 1) return `page ${pages[0]}`;
  if (pages.length === 2) return `pages ${pages[0]} and ${pages[1]}`;
  return `pages ${pages.slice(0, -1).join(", ")}, and ${pages[pages.length - 1]}`;
}
