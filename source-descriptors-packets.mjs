import path from "node:path";

const BLOCK_CHAR_LIMIT = 1200;
const MAX_BLOCKS_PER_SOURCE = 12;

export function buildSourcePackets(records) {
  const packets = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.file_id) continue;
    if (seen.has(record.file_id)) throw new Error(`Duplicate extraction record for ${record.file_id}`);
    seen.add(record.file_id);

    const blocks = collectSourceBlocks(record);
    packets.push({
      file_id: record.file_id,
      sha256: record.sha256 || "",
      source_path: record.source_path || "",
      original_name: path.basename(record.source_path || ""),
      extraction: {
        engine: record.engine || "",
        page_count: record.page_count ?? (Array.isArray(record.pages) ? record.pages.length : 0),
        warnings: Array.isArray(record.warnings) ? record.warnings : [],
      },
      blocks,
    });
  }
  return packets.sort((a, b) => a.file_id.localeCompare(b.file_id));
}

function collectSourceBlocks(record) {
  const blocks = [];
  for (const page of record.pages || []) {
    for (const block of page.blocks || []) {
      if (!block?.id || typeof block.text !== "string" || !block.text.trim()) continue;
      blocks.push({
        citation: `${record.file_id} ${block.id}`,
        page: page.page,
        block_id: block.id,
        block_type: block.type || "",
        confidence: page.confidence_avg ?? 1,
        needs_review: Boolean(page.needs_review),
        text: truncateText(block.text),
      });
    }
  }
  return selectLabelRelevantBlocks(blocks);
}

function selectLabelRelevantBlocks(blocks) {
  const selected = [];
  for (const block of blocks) {
    if (selected.length >= MAX_BLOCKS_PER_SOURCE) break;
    selected.push(block);
  }
  return selected;
}

function truncateText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > BLOCK_CHAR_LIMIT
    ? `${normalized.slice(0, BLOCK_CHAR_LIMIT)} [block truncated for source descriptor input]`
    : normalized;
}
