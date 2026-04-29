const SCHEMA_BLOCK_TYPES = new Set(["heading", "paragraph", "list_item", "table_row", "caption", "footnote"]);

export function normalizeOcrProviderResult(providerResult, { pageCount }) {
  if (!providerResult || !Array.isArray(providerResult.pages)) {
    throw new Error("OCR provider returned an invalid payload: expected pages[]");
  }

  const byPage = new Map();
  for (const page of providerResult.pages) {
    const pageNumber = Number(page?.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`OCR provider returned invalid page number: ${page?.page}`);
    }
    if (byPage.has(pageNumber)) throw new Error(`OCR provider returned duplicate page ${pageNumber}`);
    byPage.set(pageNumber, page);
  }

  const pages = [];
  const warnings = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const providerPage = byPage.get(pageNumber);
    if (!providerPage) {
      pages.push(emptyOcrPage(pageNumber, true));
      warnings.push(`page ${pageNumber}: OCR provider returned no text`);
      continue;
    }

    const blocks = normalizeProviderBlocks(providerPage, pageNumber);
    const confidence = normalizeConfidence(providerPage.confidence ?? providerPage.confidence_avg);
    const pageWarnings = Array.isArray(providerPage.warnings) ? providerPage.warnings.filter(Boolean).map(String) : [];
    for (const warning of pageWarnings) warnings.push(`page ${pageNumber}: ${warning}`);
    if (!blocks.length) warnings.push(`page ${pageNumber}: OCR provider returned no usable blocks`);

    pages.push({
      page: pageNumber,
      ocr_required: true,
      confidence_avg: confidence,
      needs_review: Boolean(providerPage.needs_review) || confidence < 0.75 || !blocks.length,
      blocks,
    });
  }

  if (pages.every((page) => page.blocks.length === 0)) {
    throw new Error("OCR provider returned no usable text");
  }

  return {
    engine: typeof providerResult.engine === "string" && providerResult.engine.trim()
      ? providerResult.engine.trim()
      : "ocr-provider@unknown",
    pages,
    warnings,
    flatText: pages.map((page) => page.blocks.map((block) => block.text).join("\n\n")).join("\n\n"),
  };
}

function normalizeProviderBlocks(providerPage, pageNumber) {
  if (Array.isArray(providerPage.blocks)) {
    return providerPage.blocks
      .map((block, index) => normalizeBlock(block, pageNumber, index + 1))
      .filter(Boolean);
  }

  const raw = providerPage.markdown ?? providerPage.text ?? "";
  return markdownToBlocks(String(raw), pageNumber);
}

function normalizeBlock(block, pageNumber, ordinal) {
  if (!block || typeof block !== "object") return null;
  const text = normalizeMarkdownText(String(block.text ?? block.markdown ?? ""));
  if (!text) return null;
  const type = SCHEMA_BLOCK_TYPES.has(block.type) ? block.type : inferBlockTypeFromText(text);
  const normalized = {
    id: `p${pageNumber}.b${ordinal}`,
    type,
    text,
  };
  if (Array.isArray(block.bbox) && block.bbox.length === 4 && block.bbox.every(Number.isFinite)) {
    normalized.bbox = block.bbox;
  }
  return normalized;
}

export function markdownToBlocks(markdown, pageNumber) {
  const blocks = [];
  let pending = [];
  let pendingType = "paragraph";

  for (const rawLine of stripFencedCodeMarkers(markdown).split(/\r?\n/)) {
    const classified = classifyMarkdownLine(rawLine);
    if (!classified.text) {
      flushPending();
      continue;
    }
    if (pending.length && classified.type !== pendingType) flushPending();
    pendingType = classified.type;
    pending.push(classified.text);
  }
  flushPending();
  return blocks;

  function flushPending() {
    const text = normalizeMarkdownText(pending.join(" "));
    if (text) {
      blocks.push({
        id: `p${pageNumber}.b${blocks.length + 1}`,
        type: pendingType,
        text,
      });
    }
    pending = [];
    pendingType = "paragraph";
  }
}

function classifyMarkdownLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { type: "paragraph", text: "" };
  const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (heading) return { type: "heading", text: heading[1] };
  const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
  if (bullet) return { type: "list_item", text: bullet[1] };
  const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
  if (numbered) return { type: "list_item", text: numbered[1] };
  if (/^\|.+\|$/.test(trimmed)) return { type: "table_row", text: trimmed.replace(/^\||\|$/g, "").replace(/\|/g, " ") };
  return { type: "paragraph", text: trimmed };
}

function normalizeMarkdownText(text) {
  return stripFencedCodeMarkers(text)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function stripFencedCodeMarkers(text) {
  return String(text).replace(/^```[a-zA-Z0-9_-]*\s*$/gm, "");
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0.0;
  if (confidence < 0) return 0.0;
  if (confidence > 1) return 1.0;
  return Math.round(confidence * 100) / 100;
}

function inferBlockTypeFromText(text) {
  const wordCount = text.trim().split(/\s+/).length;
  const letters = text.match(/[A-Za-z]/g) || [];
  const upper = letters.filter((char) => char >= "A" && char <= "Z").length;
  if (wordCount <= 8 && letters.length && upper / letters.length > 0.7) return "heading";
  return "paragraph";
}

function emptyOcrPage(pageNumber, needsReview) {
  return {
    page: pageNumber,
    ocr_required: true,
    confidence_avg: 0.0,
    needs_review: needsReview,
    blocks: [],
  };
}
