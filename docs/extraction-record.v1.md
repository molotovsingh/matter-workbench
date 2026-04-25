# Extraction Record — v1

The contract between `/extract` (preprocessor) and every downstream skill (`/create_listofdates`, `/extract_claims`, `/draft_petition`, ...). One JSON record is produced per source file at preprocessing time, written to disk, and cached on the file's SHA-256.

Every fact a skill emits must trace back to a record produced under this schema, by way of a citation handle of the form `FILE-NNNN p3.b7`.

## Why this exists

Skills don't read PDFs. They read **extraction records**. If the contract isn't frozen, every skill reinvents extraction and citations drift across the matter. Locking v1 first lets us build the engine and the skills in parallel without coordination overhead later.

## File-system layout

Records sit alongside `Originals/` and `By Type/` inside each intake batch folder, mirroring the layout `matter-init` already produces:

```
00_Inbox/
  Intake 01 - Initial/
    Source Files/
    Originals/
    By Type/
    _extracted/                 ← records live here
      FILE-0001.json            ← v1 record (validates against extraction-record.v1.schema.json)
      FILE-0001.txt             ← flat text companion (grep-friendly, no structure)
      FILE-0002.json
      ...
    Extraction Log.csv          ← per-file status row (column set defined when /extract ships)
    Intake Log.csv
    File Register.csv
```

Leading underscore on `_extracted/` signals "machine-generated, not for direct lawyer browsing" — same convention used for `.doctor-backups/`.

## The citation handle

The handle `pNN.bNN` is the load-bearing piece of this contract.

**Format**

- `p<page>.b<block>` — both numbers are 1-indexed integers, no leading zeros.
- Examples: `p1.b1`, `p3.b7`, `p47.b212`.
- The page number inside the id MUST match the parent page's `page` field.

**Stability rule**

An extractor MUST produce the same `id` for the same logical block when re-run on identical content (same SHA-256). Block numbering follows reading order: top-to-bottom, then left-to-right of bounding-box centroids, ties broken deterministically. This is what makes `FILE-0042 p3.b7` a permanent reference.

**External citation form**

Skills cite as `FILE-NNNN pX.bY`. Lawyer-facing UIs may render this as "Page 3 ¶7 of FILE-0042 (Notice of Motion.pdf)". The compact form is canonical for storage and machine reasoning; the rendered form is for humans only.

**What breaks the handle**

If the source file content changes (different SHA-256), the record is regenerated under the new content, and the old handles still pointing at the old SHA become stale. `/doctor` will flag stale citations in a later step (out of scope for v1).

## Schema overview

Top-level fields (all required unless marked optional):

| Field | Type | Notes |
|---|---|---|
| `schema_version` | const `"extraction-record/v1"` | Frozen. |
| `file_id` | `^FILE-\d{4,}$` | Same id as `File Register.csv:file_id`. |
| `sha256` | 64 hex chars | Same hash as `File Register.csv:sha256`. Cache key. |
| `source_path` | string | Relative to matter root, POSIX. |
| `engine` | string | Engine fingerprint, e.g. `pdfjs-dist@4.0.0`. |
| `extracted_at` | ISO-8601 with timezone | |
| `language_detected` | `[]` of BCP-47 primary subtags | `[]` if no text. |
| `page_count` | integer ≥ 0 | Non-paginated sources report `1`. |
| `pages` | array of `Page` | |
| `warnings` | array of strings, optional | Free-form notes for `/doctor` and the lawyer. |

`Page`: `{ page, ocr_required, confidence_avg, needs_review, blocks }`.

`Block`: `{ id, type, text, bbox? }` where `type ∈ { heading, paragraph, list_item, table_row, caption, footnote }`.

`additionalProperties: false` at every level — any drift fails validation early.

See `extraction-record.v1.schema.json` for the authoritative definition.

## Worked example 1 — born-digital PDF (no OCR)

A 2-page court order, text layer present. Engine: `pdfjs-dist`. No bounding boxes (text-layer extraction doesn't always give them). Confidence is 1.0 because the bytes are the source.

```json
{
  "schema_version": "extraction-record/v1",
  "file_id": "FILE-0042",
  "sha256": "a3b2c8d4e7f60912a3b2c8d4e7f60912a3b2c8d4e7f60912a3b2c8d4e7f60912",
  "source_path": "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0042__order_dated_26_02_2026.pdf",
  "engine": "pdfjs-dist@4.0.0",
  "extracted_at": "2026-04-25T14:32:18+05:30",
  "language_detected": ["en"],
  "page_count": 2,
  "pages": [
    {
      "page": 1,
      "ocr_required": false,
      "confidence_avg": 1.0,
      "needs_review": false,
      "blocks": [
        { "id": "p1.b1", "type": "heading",   "text": "IN THE HIGH COURT OF DELHI AT NEW DELHI" },
        { "id": "p1.b2", "type": "heading",   "text": "W.P.(C) 1234 of 2026" },
        { "id": "p1.b3", "type": "paragraph", "text": "Ms. Riya Mehta, learned counsel for the petitioner, submits that the impugned order dated 12.02.2026 disregards the directions of this Hon'ble Court contained in its order dated 03.01.2026." }
      ]
    },
    {
      "page": 2,
      "ocr_required": false,
      "confidence_avg": 1.0,
      "needs_review": false,
      "blocks": [
        { "id": "p2.b1", "type": "paragraph", "text": "Heard. The petition is admitted. Notice be issued to the respondents, returnable on 12.05.2026." },
        { "id": "p2.b2", "type": "paragraph", "text": "Sd/-\nJUDGE\n26.02.2026" }
      ]
    }
  ],
  "warnings": []
}
```

A chronology skill citing this would write `FILE-0042 p2.b1` for the order's operative paragraph.

## Worked example 2 — image-based scan (OCR'd, mixed script)

A 1-page scanned Hindi affidavit (`.jpg`). Engine: `paddleocr` configured for English + Hindi. Bounding boxes present. Confidence is moderate (0.86) because the scan has noise. A notary stamp is flagged in `warnings` rather than guessed at.

```json
{
  "schema_version": "extraction-record/v1",
  "file_id": "FILE-0143",
  "sha256": "b8c7d6e5f4030210b8c7d6e5f4030210b8c7d6e5f4030210b8c7d6e5f4030210",
  "source_path": "00_Inbox/Intake 02 - 2026-05-08 client email/By Type/Images/FILE-0143__shapath_patra.jpg",
  "engine": "paddleocr@2.7.0+lang:en,hi",
  "extracted_at": "2026-04-25T14:35:42+05:30",
  "language_detected": ["hi", "en"],
  "page_count": 1,
  "pages": [
    {
      "page": 1,
      "ocr_required": true,
      "confidence_avg": 0.86,
      "needs_review": false,
      "blocks": [
        { "id": "p1.b1", "type": "heading",   "text": "शपथ पत्र",                                                                                                       "bbox": [180, 80, 420, 120] },
        { "id": "p1.b2", "type": "paragraph", "text": "मैं, राहुल शर्मा पुत्र श्री विनोद शर्मा, उम्र 42 वर्ष, निवासी मकान नं. 17, सेक्टर 14, गुड़गांव, हलफ़ उठाकर बयान करता हूँ कि...", "bbox": [60, 160, 540, 320] },
        { "id": "p1.b3", "type": "paragraph", "text": "Verified at New Delhi on this 23rd day of April, 2026.",                                                          "bbox": [60, 360, 540, 400] },
        { "id": "p1.b4", "type": "paragraph", "text": "Sd/-\nDeponent",                                                                                                  "bbox": [380, 440, 540, 500] }
      ]
    }
  ],
  "warnings": ["page 1: notary stamp in lower right (~bbox 380-540, 540-680) not transcribed"]
}
```

The citation handle has the same shape (`p1.b3`) regardless of engine. Whether a record was OCR'd or text-layer-extracted is invisible to the consuming skill — only the `engine`, `confidence_avg`, and `needs_review` flags differ.

## Versioning policy

- **v1 is frozen.** No field renames, no field removals, no enum value removals after this file lands.
- **Additive changes** (new optional field, new enum value appended to the end) ship as `v1.x` revisions to the same schema file. Consumers MUST tolerate unknown optional fields — i.e., parsers should not fail on a future v1.1 record that adds, say, an optional `block.detected_date` field.
- **Breaking changes** ship as a separate `extraction-record.v2.schema.json` with a new `$id`. `/doctor` gains a "v1 records present, re-extraction recommended" check at that point.
- The `engine` field carries a fingerprint precisely so consumers can decide whether to trust v1 records produced by an old engine vs. re-run.

## Deliberately not in v1

A short list to forestall scope creep:

- **No `detected_date` or `detected_currency` block annotations.** Date/currency normalization belongs in a v1.x additive revision once the engine actually produces them. The chronology skill MAY parse `text` itself in the meantime.
- **No LLM-derived fields** (summaries, classifications, embeddings). Preprocessing stays deterministic; LLM use belongs in the skills that need it.
- **No cross-file links.** "This email references this contract" produces its own output artefact, separate from the per-file record.
- **No PII redaction flags.** Per-matter policy applied at outbox time, not at extraction.
- **No structured table cells.** `type: table_row` captures rows as plain text in v1; structured cell extraction is a v2 candidate.

## How `/doctor` will validate (later step)

When the `/extract` skill ships, `/doctor` gains two checks against this contract:

1. **Schema validity** — every `_extracted/FILE-NNNN.json` parses and validates against `extraction-record.v1.schema.json`. Records that fail are flagged for re-extraction.
2. **Coverage** — for each row in `File Register.csv`, a record exists in `_extracted/` and its `sha256` matches. Missing or stale records become a `/doctor` issue with severity `warning`.

A third, citation-integrity check (every `FILE-NNNN pX.bY` referenced by chronologies/claims/drafts resolves to an existing block) becomes possible once those skills exist.

## See also

- `extraction-record.v1.schema.json` — authoritative schema.
- `matter-init-engine.mjs:271-323` — where `FILE-NNNN`, `sha256`, and the per-batch folder layout originate.
- `WORKBENCH_SUMMARY.md` — the broader 5-stage pipeline this preprocessing tier feeds.
