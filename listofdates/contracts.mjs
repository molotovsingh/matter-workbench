import {
  CASE_TIMELINE_PERSPECTIVE,
  EVENT_TYPES,
} from "./providers.mjs";

export const CSV_HEADERS = [
  "date_iso",
  "date_text",
  "event",
  "event_type",
  "legal_relevance",
  "issue_tags",
  "perspective",
  "cluster_id",
  "cluster_type",
  "supporting_citations",
  "citation",
  "source_file_id",
  "source_id",
  "content_hash",
  "source_label",
  "source_short_label",
  "file_id",
  "source_path",
  "page",
  "block_id",
  "needs_review",
  "confidence",
];

export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "date_iso",
          "date_text",
          "event",
          "event_type",
          "legal_relevance",
          "issue_tags",
          "perspective",
          "citation",
          "needs_review",
          "confidence",
        ],
        properties: {
          date_iso: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          },
          date_text: {
            type: "string",
          },
          event: {
            type: "string",
          },
          event_type: {
            type: "string",
            enum: EVENT_TYPES,
          },
          legal_relevance: {
            type: "string",
          },
          issue_tags: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 64,
            },
          },
          perspective: {
            type: "string",
            enum: [CASE_TIMELINE_PERSPECTIVE],
          },
          citation: {
            type: "string",
            pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$",
          },
          needs_review: {
            type: "boolean",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
};

export const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "date_iso",
          "date_text",
          "event_candidate",
          "legal_materiality",
          "citation",
          "source_excerpt",
          "candidate_type",
          "party_posture",
          "same_fact_hint",
          "date_uncertainty",
          "ocr_suspicion",
          "needs_review",
          "confidence",
        ],
        properties: {
          date_iso: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          },
          date_text: {
            type: "string",
          },
          event_candidate: {
            type: "string",
          },
          legal_materiality: {
            type: "string",
          },
          citation: {
            type: "string",
            pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$",
          },
          source_excerpt: {
            type: "string",
          },
          candidate_type: {
            type: "string",
            enum: [
              "agreement",
              "payment",
              "notice",
              "pleading",
              "order",
              "filing",
              "inspection",
              "correspondence",
              "other",
            ],
          },
          party_posture: {
            type: "string",
            enum: ["helps_client", "hurts_client", "neutral", "unclear"],
          },
          same_fact_hint: {
            type: "string",
          },
          date_uncertainty: {
            type: "string",
          },
          ocr_suspicion: {
            type: "string",
          },
          needs_review: {
            type: "boolean",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
};
