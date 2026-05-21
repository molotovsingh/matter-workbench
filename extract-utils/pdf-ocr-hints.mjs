export function buildPdfTextLayerQualityHints({
  pages = [],
  fileWarnings = [],
  multiColumnPageCount = 0,
  ocrRequiredPageCount = 0,
} = {}) {
  const reasons = [];
  if (ocrRequiredPageCount > 0) {
    reasons.push(`${ocrRequiredPageCount} page(s) had no reliable embedded text layer`);
  }
  if (multiColumnPageCount > 0) {
    reasons.push(`${multiColumnPageCount} page(s) had layout/read-order risk in embedded text`);
  }
  const chars = pages.reduce((sum, page) => (
    sum + page.blocks.reduce((pageSum, block) => pageSum + String(block.text || "").length, 0)
  ), 0);
  const reviewPages = pages.filter((page) => page.needs_review === true).length;
  if (reviewPages > 0) reasons.push(`${reviewPages} page(s) were marked needs_review by text-layer diagnostics`);
  if (pages.length > 0 && chars < pages.length * 200) reasons.push("embedded text layer looked thin");
  if (fileWarnings.length) reasons.push(...fileWarnings);
  return {
    needsRepair: reasons.length > 0,
    reasons: [...new Set(reasons)],
  };
}
