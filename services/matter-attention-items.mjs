const SEVERITY_ORDER = new Map([
  ["blocker", 0],
  ["warning", 1],
  ["info", 2],
]);

export function normalizeAttentionItem(item = {}) {
  return {
    id: stableAttentionItemId(item),
    severity: item.severity || "warning",
    category: item.category || "matter",
    code: item.code || "attention",
    title: item.title || "Developer attention needed",
    detail: item.detail || "",
    action: item.action || "",
    evidence: Array.isArray(item.evidence) ? item.evidence : [],
    occurredAt: item.occurredAt || "",
  };
}

export function sortAttentionItems(items = []) {
  return [...items].sort((a, b) => {
    const severity = (SEVERITY_ORDER.get(a.severity) ?? 9) - (SEVERITY_ORDER.get(b.severity) ?? 9);
    if (severity) return severity;
    const timeA = Date.parse(a.occurredAt || "") || 0;
    const timeB = Date.parse(b.occurredAt || "") || 0;
    if (timeA !== timeB) return timeB - timeA;
    return a.id.localeCompare(b.id);
  });
}

export function summarizeAttentionItems(items = []) {
  const counts = { blocker: 0, warning: 0, info: 0 };
  for (const item of items) {
    if (Object.hasOwn(counts, item.severity)) counts[item.severity] += 1;
  }
  return {
    total: items.length,
    ...counts,
    state: counts.blocker ? "blocked" : counts.warning ? "attention_needed" : "clear",
  };
}

function stableAttentionItemId(item) {
  return [
    item.category || "matter",
    item.code || "attention",
    item.title || "",
    item.occurredAt || "",
  ].join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "attention";
}
