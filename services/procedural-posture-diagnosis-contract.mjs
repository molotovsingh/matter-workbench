export const POSTURE_DIAGNOSIS_CONFIDENCE_VALUES = ["low", "medium", "high", "unknown"];
export const POSTURE_DIAGNOSIS_PRIORITY_VALUES = ["primary", "secondary", "parked", "not_advised_yet", "unknown"];
export const POSTURE_DIAGNOSIS_DISPOSITION_VALUES = ["accepted", "rejected", "partly_accepted"];

export function diagnosisSchema(name) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "status",
      "short_diagnosis",
      "court_forum",
      "procedural_posture",
      "simple_case_view",
      "possible_filings",
      "recommended_working_path",
      "legal_routes",
      "recommended_route",
      "next_best_actions",
      "governing_law",
      "central_facts",
      "adverse_or_difficult_facts",
      "missing_information",
      "lawyer_to_confirm",
      "internal_source_handles",
    ],
    properties: {
      schema_version: { type: "string", enum: [`${name}/v1`] },
      status: { type: "string", enum: ["provisional_mw_inferred"] },
      short_diagnosis: { type: "string" },
      simple_case_view: { type: "string" },
      court_forum: postureFieldSchema(),
      procedural_posture: postureFieldSchema(),
      possible_filings: { type: "array", items: filingSchema() },
      recommended_working_path: filingSchema(),
      legal_routes: { type: "array", items: legalRouteSchema() },
      recommended_route: recommendedRouteSchema(),
      next_best_actions: { type: "array", items: { type: "string" } },
      governing_law: { type: "array", items: sourcedTextSchema() },
      central_facts: { type: "array", items: sourcedTextSchema() },
      adverse_or_difficult_facts: { type: "array", items: sourcedTextSchema() },
      missing_information: { type: "array", items: { type: "string" } },
      lawyer_to_confirm: { type: "array", items: { type: "string" } },
      internal_source_handles: { type: "array", items: { type: "string" } },
    },
  };
}

export function finalDiagnosisSchema() {
  const base = diagnosisSchema("posture_diagnosis_final");
  return {
    ...base,
    required: [...base.required, "critique_handling"],
    properties: {
      ...base.properties,
      critique_handling: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["critique_signal", "disposition", "reason"],
          properties: {
            critique_signal: { type: "string" },
            disposition: { type: "string", enum: POSTURE_DIAGNOSIS_DISPOSITION_VALUES },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

function postureFieldSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence", "why", "source_refs", "lawyer_to_confirm"],
    properties: {
      value: { type: "string" },
      confidence: { type: "string", enum: POSTURE_DIAGNOSIS_CONFIDENCE_VALUES },
      why: { type: "string" },
      source_refs: { type: "array", items: { type: "string" } },
      lawyer_to_confirm: { type: "string" },
    },
  };
}

function legalRouteSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "route_number",
      "route_title",
      "route_summary",
      "when_to_use",
      "why_this_route",
      "court_or_forum",
      "statutory_references",
      "what_to_confirm",
      "priority",
    ],
    properties: {
      route_number: { type: "integer" },
      route_title: { type: "string" },
      route_summary: { type: "string" },
      when_to_use: { type: "string" },
      why_this_route: { type: "string" },
      court_or_forum: { type: "string" },
      statutory_references: { type: "array", items: { type: "string" } },
      what_to_confirm: { type: "array", items: { type: "string" } },
      priority: { type: "string", enum: POSTURE_DIAGNOSIS_PRIORITY_VALUES },
    },
  };
}

function recommendedRouteSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["route_number", "route_title", "recommendation", "reason", "next_step"],
    properties: {
      route_number: { type: "integer" },
      route_title: { type: "string" },
      recommendation: { type: "string" },
      reason: { type: "string" },
      next_step: { type: "string" },
    },
  };
}

function filingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["priority", "filing_or_remedy", "reason", "key_facts", "caveats", "source_refs"],
    properties: {
      priority: { type: "string", enum: POSTURE_DIAGNOSIS_PRIORITY_VALUES },
      filing_or_remedy: { type: "string" },
      reason: { type: "string" },
      key_facts: { type: "array", items: { type: "string" } },
      caveats: { type: "array", items: { type: "string" } },
      source_refs: { type: "array", items: { type: "string" } },
    },
  };
}

function sourcedTextSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text", "source_refs"],
    properties: {
      text: { type: "string" },
      source_refs: { type: "array", items: { type: "string" } },
    },
  };
}

export function renderProceduralPostureDiagnosisMarkdown(diagnosis = {}) {
  const generated = diagnosis.generated_at || "";
  const legalRoutes = normalizeLegalRoutes(diagnosis.legal_routes);
  const recommendedRoute = normalizeRecommendedRoute(diagnosis.recommended_route);
  return [
    "# Filing and Procedural Posture Diagnosis",
    "",
    "Status: Provisional — lawyer confirmation required",
    "Author: MW (Matter Workbench)",
    "Based on: current Case Timeline, Matter Story, and Source Index for this matter.",
    generated ? `Generated: ${generated}` : "",
    "",
    "## Simple case view",
    "",
    diagnosis.simple_case_view || diagnosis.short_diagnosis || "No diagnosis text returned.",
    "",
    "## Current procedural position",
    "",
    renderCurrentPositionParagraph(diagnosis),
    "",
    "## Legal routes available from current record",
    "",
    ...(legalRoutes.length ? renderLegalRoutesMarkdown(legalRoutes) : renderLegacyFilingsAsRoutes(diagnosis.possible_filings)),
    "",
    "## Recommended route",
    "",
    renderRecommendedRouteParagraph({ recommendedRoute, fallback: diagnosis.recommended_working_path }),
    "",
    "## Next best actions",
    "",
    ...numberedStrings(diagnosis.next_best_actions),
    "",
    "## Information the lawyer must confirm",
    "",
    ...bulletStrings(diagnosis.lawyer_to_confirm, "- [ ]"),
    "",
    "## Governing statute / rules / framework",
    "",
    ...bulletSourced(diagnosis.governing_law),
    "",
    "## Facts central to the posture",
    "",
    ...bulletSourced(diagnosis.central_facts),
    "",
    "## Adverse or difficult facts to handle",
    "",
    ...bulletSourced(diagnosis.adverse_or_difficult_facts),
    "",
    "## Missing information / documents",
    "",
    ...bulletStrings(diagnosis.missing_information),
  ].filter((line) => line !== null && line !== undefined).join("\n").trimEnd();
}

function renderCurrentPositionParagraph(diagnosis = {}) {
  const court = diagnosis.court_forum || {};
  const posture = diagnosis.procedural_posture || {};
  const parts = [];
  if (court.value) {
    parts.push(`The likely court or forum is ${court.value}. Confidence is ${court.confidence || "unknown"}.`);
  }
  if (court.reason || court.why) {
    parts.push(`This is based on: ${court.reason || court.why}.`);
  }
  if (posture.value) {
    parts.push(`The current procedural position appears to be ${posture.value}. Confidence is ${posture.confidence || "unknown"}.`);
  }
  if (posture.reason || posture.why) {
    parts.push(`Reason: ${posture.reason || posture.why}.`);
  }
  return parts.join(" ") || "The current procedural position is not clear from the supplied record.";
}

function renderLegalRoutesMarkdown(routes = []) {
  return routes.flatMap((route) => [
    `### Route ${route.route_number}: ${route.route_title || "To be confirmed"}`,
    "",
    route.route_summary || "This route needs lawyer review before use.",
    "",
    `Use this route when ${sentenceFragment(route.when_to_use)}.`,
    "",
    `The current record supports or weakens this route because ${sentenceFragment(route.why_this_route)}.`,
    "",
    `The likely court/forum is ${route.court_or_forum || "to be confirmed by the lawyer"}.`,
    "",
    `Statutory references to check: ${inlineList(route.statutory_references) || "to be confirmed before filing"}.`,
    "",
    `Before taking this route, confirm: ${inlineList(route.what_to_confirm) || "the latest court status and missing documents"}.`,
    "",
  ]);
}

function renderLegacyFilingsAsRoutes(items) {
  const filings = normalizeFilings(items);
  if (!filings.length) {
    return ["No clear legal route is supported by the current record. The lawyer should first confirm the live case stage and missing papers."];
  }
  return filings.flatMap((item, index) => [
    `### Route ${index + 1}: ${item.filing_or_remedy || "To be confirmed"}`,
    "",
    item.reason || "This possible route needs lawyer confirmation before use.",
    "",
    `Before taking this route, confirm: ${inlineList([...item.key_facts, ...item.caveats]) || "the latest case status"}.`,
    "",
  ]);
}

function renderRecommendedRouteParagraph({ recommendedRoute = {}, fallback = {} } = {}) {
  if (recommendedRoute.route_title || recommendedRoute.recommendation || recommendedRoute.reason) {
    const label = recommendedRoute.route_number ? `Route ${recommendedRoute.route_number}: ${recommendedRoute.route_title || "recommended route"}` : (recommendedRoute.route_title || "Recommended route");
    return `${label}. ${recommendedRoute.recommendation || "This is the safest working route on the current record."} ${recommendedRoute.reason ? `Reason: ${recommendedRoute.reason}` : ""} ${recommendedRoute.next_step ? `Next step: ${recommendedRoute.next_step}` : ""}`.trim();
  }
  return `**${fallback?.filing_or_remedy || "Unknown"}** — ${fallback?.reason || "Lawyer confirmation required before relying on this path."}`;
}

function inlineList(items) {
  return normalizeStringArray(items).join("; ");
}

function sentenceFragment(value) {
  const text = String(value || "").trim();
  return text ? text.replace(/[.。]+$/, "") : "the lawyer confirms the required facts";
}

function numberedStrings(items) {
  const values = normalizeStringArray(items);
  return values.length ? values.map((item, index) => `${index + 1}. ${item}`) : ["1. Confirm the latest court status, custody/bail position, complete record, and next hearing before choosing a filing route."];
}

export function normalizePostureField(field = {}) {
  return {
    value: String(field.value || "").trim(),
    confidence: POSTURE_DIAGNOSIS_CONFIDENCE_VALUES.includes(field.confidence) ? field.confidence : "unknown",
    reason: String(field.reason || field.why || "").trim(),
    source_refs: normalizeStringArray(field.source_refs),
    lawyer_to_confirm: String(field.lawyer_to_confirm || "").trim(),
    lawyer_confirmed: false,
  };
}

export function normalizeFilings(items) {
  return Array.isArray(items) ? items.map(normalizeFiling).filter((item) => item.filing_or_remedy || item.reason) : [];
}

export function normalizeFiling(item = {}) {
  return {
    priority: POSTURE_DIAGNOSIS_PRIORITY_VALUES.includes(item.priority) ? item.priority : "unknown",
    filing_or_remedy: String(item.filing_or_remedy || "").trim(),
    reason: String(item.reason || "").trim(),
    key_facts: normalizeStringArray(item.key_facts),
    caveats: normalizeStringArray(item.caveats),
    source_refs: normalizeStringArray(item.source_refs),
  };
}

export function normalizeLegalRoutes(items) {
  return Array.isArray(items)
    ? items.map((item, index) => ({
      route_number: normalizeRouteNumber(item?.route_number, index + 1),
      route_title: String(item?.route_title || "").trim(),
      route_summary: String(item?.route_summary || "").trim(),
      when_to_use: String(item?.when_to_use || "").trim(),
      why_this_route: String(item?.why_this_route || "").trim(),
      court_or_forum: String(item?.court_or_forum || "").trim(),
      statutory_references: normalizeStringArray(item?.statutory_references),
      what_to_confirm: normalizeStringArray(item?.what_to_confirm),
      priority: POSTURE_DIAGNOSIS_PRIORITY_VALUES.includes(item?.priority) ? item.priority : "unknown",
    })).filter((item) => item.route_title || item.route_summary || item.why_this_route)
    : [];
}

export function normalizeRecommendedRoute(item = {}) {
  if (!item || typeof item !== "object") {
    return {
      route_number: 0,
      route_title: "",
      recommendation: "",
      reason: "",
      next_step: "",
    };
  }
  return {
    route_number: normalizeRouteNumber(item.route_number, 0),
    route_title: String(item.route_title || "").trim(),
    recommendation: String(item.recommendation || "").trim(),
    reason: String(item.reason || "").trim(),
    next_step: String(item.next_step || "").trim(),
  };
}

function normalizeRouteNumber(value, fallback) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizeSourcedTextList(items) {
  return Array.isArray(items) ? items.map((item) => ({
    text: String(item?.text || "").trim(),
    source_refs: normalizeStringArray(item?.source_refs),
  })).filter((item) => item.text) : [];
}

export function normalizeStringArray(items) {
  return Array.isArray(items)
    ? items.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
}

function bulletSourced(items) {
  const normalized = normalizeSourcedTextList(items);
  return normalized.length ? normalized.map((item) => `- ${item.text}`) : ["- To be confirmed." ];
}

function bulletStrings(items, marker = "-") {
  const normalized = normalizeStringArray(items);
  return normalized.length ? normalized.map((item) => `${marker} ${item}`) : [`${marker} To be confirmed.`];
}
