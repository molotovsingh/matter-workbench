export function buildBalancedPageBatches(units, {
  maxPages = 16,
  maxBytes = 20 * 1024 * 1024,
  minimumBatches = 1,
} = {}) {
  const values = Array.from(units || []).map(normalizeUnit);
  if (!values.length) return [];
  const pageLimit = Math.max(1, Math.trunc(Number(maxPages) || 16));
  const byteLimit = Math.max(1, Math.trunc(Number(maxBytes) || 20 * 1024 * 1024));
  const totalBytes = values.reduce((sum, unit) => sum + unit.bytes, 0);
  const desiredBatches = Math.min(values.length, Math.max(
    1,
    Math.trunc(Number(minimumBatches) || 1),
    Math.ceil(values.length / pageLimit),
    Math.ceil(totalBytes / byteLimit),
  ));
  const batches = Array.from({ length: desiredBatches }, () => emptyBatch());
  const sorted = values.slice().sort((left, right) => right.weight - left.weight || unitKey(left).localeCompare(unitKey(right)));

  for (const unit of sorted) {
    let candidates = batches.filter((batch) => batch.units.length < pageLimit && batch.bytes + unit.bytes <= byteLimit);
    if (!candidates.length) {
      const batch = emptyBatch();
      batches.push(batch);
      candidates = [batch];
    }
    candidates.sort((left, right) => left.weight - right.weight || left.bytes - right.bytes || left.units.length - right.units.length);
    const target = candidates[0];
    target.units.push(unit);
    target.bytes += unit.bytes;
    target.weight += unit.weight;
  }

  return batches
    .filter((batch) => batch.units.length)
    .map((batch, index) => ({
      index,
      bytes: batch.bytes,
      weight: batch.weight,
      units: batch.units.slice().sort((left, right) => unitKey(left).localeCompare(unitKey(right))),
    }))
    .sort((left, right) => right.weight - left.weight || right.bytes - left.bytes);
}

function normalizeUnit(unit) {
  const bytes = Math.max(1, Number(unit?.bytes) || 1);
  const baseWeight = Math.max(bytes, 256 * 1024);
  const complexity = Math.max(1, Number(unit?.complexity) || 1);
  return { ...unit, bytes, weight: baseWeight * complexity };
}

function emptyBatch() {
  return { units: [], bytes: 0, weight: 0 };
}

function unitKey(unit) {
  return `${String(unit?.documentId || "")}\0${String(Number(unit?.page) || 0).padStart(8, "0")}`;
}
