const PAYMENT_TAGS = new Set(["payment", "receipt", "instalment", "installment", "paid", "debit"]);
const NOTICE_TAGS = new Set(["notice", "demand", "reply", "response", "objection"]);
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "per",
  "the",
  "this",
  "to",
  "under",
  "with",
  "was",
  "were",
  "which",
]);

export function clusterChronologyEntries(entries, { compareEntries } = {}) {
  const compare = compareEntries || defaultCompareEntries;
  const clusters = [];
  for (const entry of entries) {
    const cluster = clusters.find((candidate) => canClusterEntries(candidate, entry));
    if (cluster) {
      cluster.entries.push(entry);
    } else {
      clusters.push({ entries: [entry] });
    }
  }
  return clusters.map((cluster, index) => buildClusterEntry(cluster.entries, index + 1, compare));
}

function canClusterEntries(cluster, entry) {
  if (cluster.entries[0].date_iso !== entry.date_iso) return false;
  return cluster.entries.some((candidate) => areRelatedChronologyEntries(candidate, entry));
}

function areRelatedChronologyEntries(a, b) {
  if (a.citation === b.citation && normalizeEventKey(a.event) === normalizeEventKey(b.event)) return true;
  if (isPaymentEntry(a) && isPaymentEntry(b)) return relatedPaymentEntries(a, b);
  if (relatedNoticeEntries(a, b)) return true;
  if (isNoticeEntry(a) || isNoticeEntry(b)) return false;
  if (relatedCompletionEntries(a, b)) return true;
  const similarity = Math.max(
    textSimilarity(a.event, b.event),
    textSimilarity(`${a.event} ${a.legal_relevance}`, `${b.event} ${b.legal_relevance}`),
  );
  if (similarity >= 0.58) return true;
  if (relatedEventTypes(a, b) && similarity >= 0.38) return true;
  if (sharedIssueTag(a, b) && similarity >= 0.34) return true;
  return false;
}

function buildClusterEntry(clusterEntries, clusterNumber, compareEntries) {
  const clusterType = classifyCluster(clusterEntries);
  const leadEntry = chooseClusterLead(clusterEntries, clusterType, compareEntries);
  const supportingSources = uniqueSupportingSources(clusterEntries);
  const entry = {
    ...leadEntry,
    cluster_id: `LOD-CLUSTER-${String(clusterNumber).padStart(4, "0")}`,
    cluster_type: clusterType,
    supporting_sources: supportingSources,
    supporting_citations: supportingSources.map((source) => source.citation).join("; "),
  };
  if (clusterType === "payment_discrepancy") return paymentDiscrepancyEntry(entry, clusterEntries);
  return entry;
}

function classifyCluster(entries) {
  if (entries.length === 1) return "single_event";
  if (isTrueDuplicateCluster(entries)) return "true_duplicate";
  if (isPaymentCluster(entries) && extractClusterAmounts(entries).length > 1) return "payment_discrepancy";
  if (isSourceRepeatCluster(entries)) return "source_repeat";
  return "corroborated_event";
}

function isTrueDuplicateCluster(entries) {
  const signatures = new Set(entries.map((entry) => `${entry.date_iso}|${normalizeEventKey(entry.event)}|${entry.citation}`));
  return signatures.size === 1;
}

function isSourceRepeatCluster(entries) {
  const citations = new Set(entries.map((entry) => entry.citation));
  const files = new Set(entries.map((entry) => entry.source_file_id || entry.file_id));
  return citations.size === 1 || files.size === 1;
}

function isPaymentCluster(entries) {
  return entries.every(isPaymentEntry);
}

function isPaymentEntry(entry) {
  if (entry.event_type === "payment") return true;
  return (entry.issue_tags || []).some((tag) => PAYMENT_TAGS.has(String(tag).toLowerCase()));
}

function isNoticeEntry(entry) {
  if (["notice", "demand", "reply", "objection"].includes(entry.event_type)) return true;
  return (entry.issue_tags || []).some((tag) => NOTICE_TAGS.has(String(tag).toLowerCase()));
}

function relatedNoticeEntries(a, b) {
  if (!isNoticeEntry(a) || !isNoticeEntry(b)) return false;
  if (noticePosture(a) !== noticePosture(b)) return false;
  if (!/\bnotice|demand|reply|response|objection\b/i.test(`${a.event} ${a.legal_relevance} ${b.event} ${b.legal_relevance}`)) {
    return false;
  }
  return textSimilarity(`${a.event} ${a.legal_relevance}`, `${b.event} ${b.legal_relevance}`) >= 0.24;
}

function noticePosture(entry) {
  const text = `${entry.event} ${entry.legal_relevance} ${(entry.issue_tags || []).join(" ")}`.toLowerCase();
  if (entry.event_type === "reply" || /\b(reply|response|deni(?:ed|al)|acknowledg(?:ed|ement))\b/.test(text)) {
    return "response";
  }
  if (entry.event_type === "objection" || /\bobjection|objected\b/.test(text)) return "objection";
  if (entry.event_type === "demand" || entry.event_type === "notice" || /\b(?:legal|demand)\s+notice|notice\s+(?:issued|sent)|issued\s+a\s+demand\b/.test(text)) {
    return "outbound_notice";
  }
  return "notice";
}

function relatedPaymentEntries(a, b) {
  if (overlappingNumbers(entryAmounts(a), entryAmounts(b))) return true;
  if (overlappingStrings(paymentOrdinals(a), paymentOrdinals(b))) return true;
  if ((hasPaymentDiscrepancySignal(a) || hasPaymentDiscrepancySignal(b)) && sharedIssueTag(a, b)) return true;
  return false;
}

function entryAmounts(entry) {
  return extractRupeeAmounts(`${entry.event} ${entry.legal_relevance}`);
}

function paymentOrdinals(entry) {
  const text = `${entry.event} ${entry.legal_relevance}`.toLowerCase();
  const ordinals = [];
  const pattern = /\b(\d+)(?:st|nd|rd|th)?\s+(?:instalment|installment)|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:instalment|installment)/gi;
  for (const match of text.matchAll(pattern)) {
    ordinals.push(String(match[1] || match[2]).toLowerCase());
  }
  return ordinals;
}

function hasPaymentDiscrepancySignal(entry) {
  return /\b(discrepanc(?:y|ies)|difference|shortfall|contradict(?:ion|ory|ed|s)?|inconsistent)\b/i
    .test(`${entry.event} ${entry.legal_relevance} ${(entry.issue_tags || []).join(" ")}`);
}

function relatedCompletionEntries(a, b) {
  if (a.date_iso !== b.date_iso) return false;
  if (!hasCompletionContext(a) || !hasCompletionContext(b)) return false;
  return overlappingNumbers(completionPercentages(a), completionPercentages(b));
}

function hasCompletionContext(entry) {
  return /\b(complet(?:e|ed|ion)|progress|construction|site|inspection|work\s+progress)\b/i
    .test(`${entry.event} ${entry.legal_relevance} ${(entry.issue_tags || []).join(" ")}`);
}

function completionPercentages(entry) {
  const percentages = [];
  const text = `${entry.event} ${entry.legal_relevance}`;
  const pattern = /\b(\d{1,3})\s*(?:%|per\s*cent\b|percent\b)/gi;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 0 && value <= 100) percentages.push(value);
  }
  return percentages;
}

function overlappingNumbers(a, b) {
  const bSet = new Set(b);
  return a.some((value) => bSet.has(value));
}

function overlappingStrings(a, b) {
  const bSet = new Set(b);
  return a.some((value) => bSet.has(value));
}

function chooseClusterLead(entries, clusterType, compareEntries) {
  const sorted = [...entries].sort((a, b) => sourcePriority(a, clusterType) - sourcePriority(b, clusterType)
    || b.confidence - a.confidence
    || compareEntries(a, b));
  return sorted[0];
}

function sourcePriority(entry, clusterType) {
  const label = `${entry.source_label || ""} ${entry.original_name || ""} ${entry.source_path || ""}`.toLowerCase();
  if (clusterType === "payment_discrepancy" || clusterType === "corroborated_event") {
    if (/\bbank\b|statement|ledger/.test(label)) return 0;
    if (/receipt/.test(label)) return 1;
  }
  if (/agreement|contract/.test(label)) return 0;
  if (/legal notice|demand notice|notice/.test(label)) return 1;
  if (/email/.test(label)) return 2;
  if (/interview/.test(label)) return 4;
  return 3;
}

function paymentDiscrepancyEntry(entry, clusterEntries) {
  const amounts = extractClusterAmounts(clusterEntries);
  const amountText = amounts.map(formatRupeeAmount).join(" vs ");
  return {
    ...entry,
    event_type: "contradiction",
    event: amountText
      ? `Payment discrepancy: same-date sources record inconsistent amounts (${amountText})`
      : "Payment discrepancy: same-date sources record inconsistent amounts",
    legal_relevance: "Flags a payment-record inconsistency for lawyer review because same-date sources record different amounts for the client's payment.",
    issue_tags: uniqueStrings([...entry.issue_tags, "payment", "contradiction"]),
    needs_review: true,
  };
}

function uniqueSupportingSources(entries) {
  const seen = new Set();
  const sources = [];
  for (const entry of entries) {
    if (seen.has(entry.citation)) continue;
    seen.add(entry.citation);
    sources.push({
      citation: entry.citation,
      source_file_id: entry.source_file_id || entry.file_id,
      source_label: entry.source_label || "",
      source_short_label: entry.source_short_label || "",
      source_path: entry.source_path || "",
      original_name: entry.original_name || "",
      event: entry.event,
    });
  }
  return sources;
}

function extractClusterAmounts(entries) {
  const amounts = [];
  const seen = new Set();
  for (const entry of entries) {
    for (const amount of entryAmounts(entry)) {
      if (seen.has(amount)) continue;
      seen.add(amount);
      amounts.push(amount);
    }
  }
  return amounts.sort((a, b) => a - b);
}

function extractRupeeAmounts(text) {
  const amounts = [];
  const pattern = /\b(?:rs\.?|inr)\s*([0-9][0-9,.]*)(?:\s*(lakh|lakhs|crore|crores))?/gi;
  for (const match of text.matchAll(pattern)) {
    if (isDifferenceAmountContext(text, match.index || 0)) continue;
    const amount = parseAmountNumber(match[1], match[2]);
    if (amount !== null) amounts.push(amount);
  }
  return amounts;
}

function isDifferenceAmountContext(text, matchIndex) {
  const context = text.slice(Math.max(0, matchIndex - 32), matchIndex).toLowerCase();
  return /\b(discrepancy|difference|shortfall|gap|delta)\s+(?:of\s+)?$/.test(context);
}

function parseAmountNumber(rawNumber, unit) {
  const normalized = String(rawNumber || "").replace(/,/g, "");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  const normalizedUnit = String(unit || "").toLowerCase();
  if (normalizedUnit.startsWith("lakh")) return Math.round(number * 100000);
  if (normalizedUnit.startsWith("crore")) return Math.round(number * 10000000);
  return Math.round(number);
}

function formatRupeeAmount(amount) {
  return `Rs.${amount.toLocaleString("en-IN")}`;
}

function relatedEventTypes(a, b) {
  if (a.event_type === b.event_type) return true;
  if (isPaymentEntry(a) && isPaymentEntry(b)) return true;
  return sharedIssueTag(a, b);
}

function sharedIssueTag(a, b) {
  const aTags = new Set((a.issue_tags || []).map((tag) => String(tag).toLowerCase()));
  return (b.issue_tags || []).some((tag) => aTags.has(String(tag).toLowerCase()));
}

function normalizeEventKey(value) {
  return tokenize(value).join(" ");
}

function textSimilarity(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size);
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/rs\.?\s*/g, "rs")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token));
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function defaultCompareEntries(a, b) {
  return a.date_iso.localeCompare(b.date_iso)
    || a.file_id.localeCompare(b.file_id)
    || String(a.block_id).localeCompare(String(b.block_id))
    || a.date_text.localeCompare(b.date_text);
}
