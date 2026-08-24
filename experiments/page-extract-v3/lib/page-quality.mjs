import { normalizeReferenceText } from "./util.mjs";

export function evaluatePrimaryPage({ providerPage, nativeText = "" } = {}) {
  const text = normalizeReferenceText(providerPage?.markdown ?? providerPage?.text ?? "");
  const native = normalizeReferenceText(nativeText);
  const warnings = Array.isArray(providerPage?.warnings) ? providerPage.warnings.filter(Boolean).map(String) : [];
  const confidenceValue = providerPage?.confidence ?? providerPage?.confidence_avg;
  const confidence = confidenceValue === undefined || confidenceValue === null || confidenceValue === ""
    ? null
    : Number(confidenceValue);
  const reasons = [];
  if (!providerPage) reasons.push("primary_page_missing");
  if (!text) reasons.push("primary_text_empty");
  if (warnings.length) reasons.push("primary_provider_warning");
  if (Number.isFinite(confidence) && confidence < 0.75) reasons.push("primary_low_confidence");
  if (hasInvalidUnicode(text)) reasons.push("primary_invalid_unicode");
  if (hasSuspiciousOcrToken(text)) reasons.push("primary_suspicious_token");

  const nativeCritical = criticalTokens(native);
  const primaryCritical = new Set(criticalTokens(text));
  const missingNativeCritical = nativeCritical.filter((token) => !primaryCritical.has(token));
  if (missingNativeCritical.length) reasons.push("primary_lost_native_critical_token");
  const nativeCharacters = native.replace(/\s/g, "").length;
  const primaryCharacters = text.replace(/\s/g, "").length;
  if (nativeCharacters >= 120 && primaryCharacters < nativeCharacters * 0.5) reasons.push("primary_text_coverage_drop");

  return {
    needsRepair: reasons.length > 0,
    reasons,
    diagnostics: {
      primaryCharacters,
      nativeCharacters,
      warningCount: warnings.length,
      confidenceKnown: Number.isFinite(confidence),
      confidence: Number.isFinite(confidence) ? confidence : null,
      nativeCriticalTokenCount: nativeCritical.length,
      missingNativeCriticalTokenCount: missingNativeCritical.length,
    },
  };
}

export function evaluateRepairPage({ providerPage } = {}) {
  const text = normalizeReferenceText(providerPage?.markdown ?? providerPage?.text ?? "");
  const warnings = Array.isArray(providerPage?.warnings) ? providerPage.warnings.filter(Boolean) : [];
  const reasons = [];
  if (!providerPage) reasons.push("repair_page_missing");
  if (!text) reasons.push("repair_text_empty");
  if (hasInvalidUnicode(text)) reasons.push("repair_invalid_unicode");
  return {
    usable: reasons.length === 0,
    reasons,
    diagnostics: { characters: text.replace(/\s/g, "").length, warningCount: warnings.length },
  };
}

export function criticalTokens(text) {
  const patterns = [
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
    /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g,
    /(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d+)?/gi,
    /\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b/g,
    /\b(?:section|article|clause|rule|order)\s+[\w()./-]+/gi,
  ];
  const values = [];
  for (const pattern of patterns) values.push(...(String(text || "").match(pattern) || []));
  return [...new Set(values.map((value) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()))].sort();
}

function hasInvalidUnicode(text) {
  for (const character of String(text || "")) {
    const code = character.codePointAt(0);
    if (code === 0xFFFD) return true;
    if ((code >= 0xE000 && code <= 0xF8FF) || (code >= 0xF0000 && code <= 0xFFFFD) || (code >= 0x100000 && code <= 0x10FFFD)) return true;
  }
  return false;
}

function hasSuspiciousOcrToken(text) {
  return [
    /[$₹]\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/,
    /\b(?:l|I|\|)\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
  ].some((pattern) => pattern.test(String(text || "")));
}
