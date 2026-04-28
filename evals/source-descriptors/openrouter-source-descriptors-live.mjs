import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../../shared/local-env.mjs";

const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOCUMENT_TYPES = new Set([
  "email",
  "letter",
  "legal_notice",
  "court_order",
  "pleading",
  "application",
  "reply",
  "affidavit",
  "agreement",
  "invoice",
  "receipt",
  "bank_record",
  "government_record",
  "photo",
  "screenshot",
  "whatsapp_chat",
  "unknown",
]);
const DATE_BASES = new Set([
  "email_header",
  "document_heading",
  "signature_block",
  "court_order_date",
  "file_name",
  "body_text",
  "inferred",
  "unknown",
]);
const SOURCE_REQUIRED_FIELDS = [
  "file_id",
  "sha256",
  "source_path",
  "display_label",
  "short_label",
  "document_type",
  "document_date",
  "date_basis",
  "parties",
  "confidence",
  "needs_review",
  "evidence",
  "warnings",
];
const PARTY_REQUIRED_FIELDS = [
  "from",
  "to",
  "cc",
  "author",
  "court",
  "judge",
  "issuing_party",
  "recipient_party",
  "deponent",
  "signatory",
];

export const SOURCE_DESCRIPTOR_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sources"],
  properties: {
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "file_id",
          "sha256",
          "source_path",
          "display_label",
          "short_label",
          "document_type",
          "document_date",
          "date_basis",
          "parties",
          "confidence",
          "needs_review",
          "evidence",
          "warnings",
        ],
        properties: {
          file_id: { type: "string", pattern: "^FILE-\\d{4,}$" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          source_path: { type: "string" },
          display_label: { type: "string" },
          short_label: { type: "string" },
          document_type: {
            type: "string",
            enum: [
              "email",
              "letter",
              "legal_notice",
              "court_order",
              "pleading",
              "application",
              "reply",
              "affidavit",
              "agreement",
              "invoice",
              "receipt",
              "bank_record",
              "government_record",
              "photo",
              "screenshot",
              "whatsapp_chat",
              "unknown",
            ],
          },
          document_date: {
            anyOf: [
              { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              { type: "null" },
            ],
          },
          date_basis: {
            type: "string",
            enum: [
              "email_header",
              "document_heading",
              "signature_block",
              "court_order_date",
              "file_name",
              "body_text",
              "inferred",
              "unknown",
            ],
          },
          parties: {
            type: "object",
            additionalProperties: false,
            required: [
              "from",
              "to",
              "cc",
              "author",
              "court",
              "judge",
              "issuing_party",
              "recipient_party",
              "deponent",
              "signatory",
            ],
            properties: {
              from: { type: "string" },
              to: { type: "array", items: { type: "string" } },
              cc: { type: "array", items: { type: "string" } },
              author: { type: "string" },
              court: { type: "string" },
              judge: { type: "string" },
              issuing_party: { type: "string" },
              recipient_party: { type: "string" },
              deponent: { type: "string" },
              signatory: { type: "string" },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_review: { type: "boolean" },
          evidence: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["citation", "reason"],
              properties: {
                citation: { type: "string", pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$" },
                reason: { type: "string" },
              },
            },
          },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function syntheticSourceDescriptorFixtures() {
  return [
    {
      file_id: "FILE-0001",
      sha256: "1111111111111111111111111111111111111111111111111111111111111111",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Emails/FILE-0001__synthetic-email.eml",
      original_name: "synthetic-email.eml",
      category: "Emails",
      extraction: {
        engine: "synthetic-extraction/v1",
        page_count: 1,
        warnings: [],
      },
      blocks: [
        {
          citation: "FILE-0001 p1.b1",
          text: "From: Sharma <sharma@example.invalid>\nTo: Mehta <mehta@example.invalid>\nDate: 20 April 2026\nSubject: Inspection notice",
        },
        {
          citation: "FILE-0001 p1.b2",
          text: "Dear Mehta, this is to confirm that inspection notice was issued after the site visit.",
        },
      ],
    },
    {
      file_id: "FILE-0002",
      sha256: "2222222222222222222222222222222222222222222222222222222222222222",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__synthetic-order.pdf",
      original_name: "synthetic-order.pdf",
      category: "PDFs",
      extraction: {
        engine: "synthetic-extraction/v1",
        page_count: 2,
        warnings: [],
      },
      blocks: [
        {
          citation: "FILE-0002 p1.b1",
          text: "IN THE HIGH COURT OF DELHI AT NEW DELHI\nOrder dated 3 March 2024",
        },
        {
          citation: "FILE-0002 p1.b2",
          text: "The petition is listed for directions. No final relief is granted at this stage.",
        },
      ],
    },
    {
      file_id: "FILE-0003",
      sha256: "3333333333333333333333333333333333333333333333333333333333333333",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Images/FILE-0003__synthetic-scan.png",
      original_name: "2021-01-01-important.png",
      category: "Images",
      extraction: {
        engine: "synthetic-extraction/v1",
        page_count: 1,
        warnings: ["low_ocr_confidence"],
      },
      blocks: [
        {
          citation: "FILE-0003 p1.b1",
          text: "Blurred scan. Appears to mention affidavit, but date and deponent are unclear.",
        },
      ],
    },
  ];
}

export function buildSourceDescriptorRequest({ model, sources = syntheticSourceDescriptorFixtures() } = {}) {
  if (!model) throw new Error("OPENROUTER_SOURCE_DESCRIPTION_MODEL is required when running the live eval");

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You create source descriptors for legal matter source documents.",
          "Follow the Source Descriptors contract: keep FILE-NNNN citations canonical, add human-readable document labels, and never overstate weak evidence.",
          "Return JSON only in the requested schema.",
          "Use only the supplied synthetic source packets.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Create source descriptors for these synthetic source packets.",
          contract_summary: {
            artifact: "10_Library/Source Index.json",
            schema_version: "source-index/v1",
            descriptor_key: ["file_id", "sha256"],
            evidence_required: true,
            raw_citations_remain_canonical: true,
            prefer_unknown_over_guess: true,
          },
          sources,
        }),
      },
    ],
    temperature: 0,
    max_tokens: 1200,
    provider: {
      require_parameters: true,
      allow_fallbacks: false,
    },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "source_descriptor_eval",
        strict: true,
        schema: SOURCE_DESCRIPTOR_RESPONSE_SCHEMA,
      },
    },
  };
}

export function parseOpenRouterJsonContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return JSON.parse(content);
  if (content && typeof content === "object") return content;
  throw new Error("OpenRouter response did not include JSON message content");
}

export function validateSourceDescriptorResponse(result, fixtures = syntheticSourceDescriptorFixtures()) {
  if (!result || !Array.isArray(result.sources)) throw new Error("Result must include sources[]");
  const fixtureByFileId = new Map(fixtures.map((fixture) => [fixture.file_id, fixture]));
  if (result.sources.length !== fixtures.length) {
    throw new Error(`Expected ${fixtures.length} source descriptors, got ${result.sources.length}`);
  }

  for (const source of result.sources) {
    assertObject(source, "source descriptor");
    for (const field of SOURCE_REQUIRED_FIELDS) {
      if (!(field in source)) throw new Error(`Missing required source field ${field}`);
    }

    assertString(source.file_id, "file_id");
    assertString(source.sha256, "sha256");
    if (!/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error(`Invalid sha256 for ${source.file_id}`);
    assertString(source.source_path, "source_path");
    assertString(source.display_label, "display_label");
    assertString(source.short_label, "short_label");
    if (!DOCUMENT_TYPES.has(source.document_type)) {
      throw new Error(`Invalid document_type for ${source.file_id}: ${source.document_type}`);
    }
    if (source.document_date !== null
      && (typeof source.document_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.document_date))) {
      throw new Error(`Invalid document_date for ${source.file_id}`);
    }
    if (!DATE_BASES.has(source.date_basis)) throw new Error(`Invalid date_basis for ${source.file_id}: ${source.date_basis}`);
    if (typeof source.confidence !== "number" || !Number.isFinite(source.confidence)
      || source.confidence < 0 || source.confidence > 1) {
      throw new Error(`Invalid confidence for ${source.file_id}`);
    }
    if (typeof source.needs_review !== "boolean") throw new Error(`Invalid needs_review for ${source.file_id}`);
    validateParties(source.parties, source.file_id);
    validateWarnings(source.warnings, source.file_id);

    const fixture = fixtureByFileId.get(source.file_id);
    if (!fixture) throw new Error(`Unexpected file_id: ${source.file_id}`);
    if (source.sha256 !== fixture.sha256) throw new Error(`sha256 mismatch for ${source.file_id}`);
    if (source.source_path !== fixture.source_path) throw new Error(`source_path mismatch for ${source.file_id}`);
    if (!source.display_label || source.display_label === source.file_id) {
      throw new Error(`Missing useful display_label for ${source.file_id}`);
    }
    validateEvidence(source.evidence, source.file_id, fixture);
  }
}

export async function runOpenRouterSourceDescriptorEval({
  apiKey,
  appDir,
  fetchImpl = fetch,
  model,
} = {}) {
  await loadLocalEnv({ appDir: appDir || REPO_ROOT, override: false });

  if (process.env.RUN_OPENROUTER_SOURCE_TEST !== "1") {
    return { skipped: true, reason: "Set RUN_OPENROUTER_SOURCE_TEST=1 to run the live eval." };
  }
  const effectiveApiKey = apiKey || process.env.OPENROUTER_API_KEY;
  const effectiveModel = model || process.env.OPENROUTER_SOURCE_DESCRIPTION_MODEL;

  if (!effectiveApiKey) {
    return { skipped: true, reason: "Set OPENROUTER_API_KEY to run the live eval." };
  }
  if (!effectiveModel) {
    throw new Error("Set OPENROUTER_SOURCE_DESCRIPTION_MODEL to a Llama model id before running the live eval.");
  }

  const fixtures = syntheticSourceDescriptorFixtures();
  const body = buildSourceDescriptorRequest({ model: effectiveModel, sources: fixtures });
  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${effectiveApiKey}`,
      "content-type": "application/json",
      "http-referer": "https://github.com/molotovsingh/matter-workbench",
      "x-title": "Matter Workbench Source Descriptor Eval",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `OpenRouter returned ${response.status}`;
    throw new Error(message);
  }

  const result = parseOpenRouterJsonContent(payload);
  validateSourceDescriptorResponse(result, fixtures);
  return { skipped: false, model: effectiveModel, result };
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

function validateParties(parties, fileId) {
  assertObject(parties, `parties for ${fileId}`);
  const allowed = new Set(PARTY_REQUIRED_FIELDS);
  for (const field of PARTY_REQUIRED_FIELDS) {
    if (!(field in parties)) throw new Error(`Missing parties.${field} for ${fileId}`);
  }
  for (const field of Object.keys(parties)) {
    if (!allowed.has(field)) throw new Error(`Unexpected parties.${field} for ${fileId}`);
  }

  for (const field of PARTY_REQUIRED_FIELDS) {
    if (field === "to" || field === "cc") {
      if (!Array.isArray(parties[field]) || !parties[field].every((value) => typeof value === "string")) {
        throw new Error(`parties.${field} must be an array of strings for ${fileId}`);
      }
    } else if (typeof parties[field] !== "string") {
      throw new Error(`parties.${field} must be a string for ${fileId}`);
    }
  }
}

function validateWarnings(warnings, fileId) {
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === "string")) {
    throw new Error(`warnings must be an array of strings for ${fileId}`);
  }
}

function validateEvidence(evidenceItems, fileId, fixture) {
  if (!Array.isArray(evidenceItems) || !evidenceItems.length) {
    throw new Error(`Missing evidence for ${fileId}`);
  }
  for (const evidence of evidenceItems) {
    assertObject(evidence, `evidence for ${fileId}`);
    assertString(evidence.citation, `evidence.citation for ${fileId}`);
    assertString(evidence.reason, `evidence.reason for ${fileId}`);
    if (!/^FILE-\d{4,} p\d+\.b\d+$/.test(evidence.citation)) {
      throw new Error(`Invalid evidence citation for ${fileId}: ${evidence.citation}`);
    }
    if (!fixture.blocks.some((block) => block.citation === evidence.citation)) {
      throw new Error(`Evidence citation ${evidence.citation} does not belong to ${fileId}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outcome = await runOpenRouterSourceDescriptorEval();
  if (outcome.skipped) {
    console.log(`[openrouter-source-descriptors] skipped: ${outcome.reason}`);
  } else {
    console.log(`[openrouter-source-descriptors] passed with model ${outcome.model}`);
    console.log(JSON.stringify(outcome.result, null, 2));
  }
}
