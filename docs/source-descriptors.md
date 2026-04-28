# Source Descriptors Design Note

This note captures the product reason behind document classification in Matter Workbench.

The goal is not classification for its own sake. The goal is better legal output.

Right now downstream AI work can cite a source precisely:

```text
FILE-0003 p2.b1
```

That is a strong machine citation. It is stable, short, and traceable back to an extraction record. But it is not a good lawyer-facing citation. A list of dates that says "FILE-0003 p2.b1" makes the user do translation work that the system should have done.

The desired output is closer to:

```text
Email from Sharma to Mehta dated 20 April 2026
```

or:

```text
Order of the Delhi High Court dated 3 March 2024
```

The system should preserve the raw citation for auditability, then add a human-readable source descriptor beside it.

## Product Principle

```text
Keep the machine citation.
Add the human label.
Never pretend the label is stronger than the evidence.
```

`FILE-0003 p2.b1` remains the canonical handle. It is the pin in the map. The descriptor is the label on the pin.

This matters because lawyers need both:

- A stable citation handle for traceability, debugging, and future citation-integrity checks.
- A readable label for working documents, chronologies, review screens, and court-facing drafts.

Replacing the handle would make the system prettier but weaker. Adding the descriptor makes it more usable without losing the audit trail.

## Naming Decision

Use **source descriptor** for the per-document label and metadata.

Avoid treating this as only "document classification." Classification is one part of the job, but the useful product output is richer:

- What kind of source is this?
- What should a lawyer call it?
- What is the best source date?
- Who appears to have sent, issued, authored, or signed it?
- How confident is the system?
- Which extracted blocks support that label?

The proposed skill name can be debated later (`/describe_sources`, `/classify_documents`, or something else), but the artifact should be thought of as a **source index**. It is closer to a clerk's source list than a pure ML category table.

## Required Invariants

Any implementation should preserve these rules:

1. `FILE-NNNN pX.bY` remains the canonical citation for storage and source-backed reasoning.
2. A source descriptor is keyed to `file_id` and `sha256`, not just a file name.
3. A descriptor describes the whole source document; a citation points to a specific block inside that source.
4. A readable label must never be treated as proof unless it is backed by cited extraction blocks or deterministic metadata.
5. If the descriptor is missing, stale, or uncertain, downstream skills must still work with the raw citation.
6. The classifier must not move files, rename files, edit extraction records, or change canonical citations.

## Current Implemented Pipeline

Extraction records already provide the hard reference layer:

- `file_id`, such as `FILE-0003`.
- `source_path`, such as `00_Inbox/.../FILE-0003__notice.pdf`.
- block handles, such as `p2.b1`.
- external citations, such as `FILE-0003 p2.b1`.

The list-of-dates engine requires each AI event to cite a supplied block handle. That is the right foundation.

The source descriptor layer now adds a per-source description:

```json
{
  "file_id": "FILE-0003",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "display_label": "Email from Sharma to Mehta dated 20 April 2026",
  "document_type": "email",
  "document_date": "2026-04-20",
  "date_basis": "email_header",
  "confidence": 0.91,
  "needs_review": false
}
```

Once `Source Index.json` exists, a list-of-dates entry carries both the raw citation and the readable label:

```json
{
  "date_iso": "2026-04-20",
  "event": "Notice was issued after inspection.",
  "citation": "FILE-0003 p2.b1",
  "source_file_id": "FILE-0003",
  "source_label": "Email from Sharma to Mehta dated 20 April 2026",
  "source_short_label": "Email from Sharma to Mehta"
}
```

The implementation is deliberately display-only. `citation` remains the audit handle. `source_file_id`, `source_label`, and `source_short_label` are denormalized helper fields copied from `10_Library/Source Index.json` only when the source descriptor matches the current `file_id`, `sha256`, and `source_path`.

If the source index is missing, invalid, stale, or contains a polluted human label such as `FILE-0003: Email from Sharma`, list-of-dates silently falls back to the current citation-based behavior.

## End-to-End Smoke Result

After the source index, OpenRouter source-description wiring, no-file-ID label guard, and list-of-dates enrichment landed, a disposable matter smoke passed through:

```text
/matter-init
/extract
/describe_sources
/create_listofdates
```

The smoke source was a small legal notice text file. `Source Index.json` produced:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026
```

`List of Dates.json` preserved the raw citation and added the readable source fields:

```json
{
  "citation": "FILE-0001 p1.b2",
  "source_file_id": "FILE-0001",
  "source_label": "Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026",
  "source_short_label": "Legal Notice, 20 April 2026"
}
```

`List of Dates.md` rendered the lawyer-facing form:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026 (FILE-0001 p1.b2)
```

That is the target behavior: readable legal label first, canonical audit handle preserved.

## Source Index Artifact

Create a generated artifact:

```text
10_Library/Source Index.json
```

This file describes source documents, not chronology events. It is advisory metadata over existing extraction records.

Top-level shape:

```json
{
  "schema_version": "source-index/v1",
  "engine_version": "source-descriptors-v1-skeleton",
  "generated_at": "2026-04-28T09:30:00.000Z",
  "matter": {
    "matter_name": "Mehta vs Skyline",
    "client_name": "Mehta",
    "opposite_party": "Skyline",
    "matter_type": "Civil",
    "jurisdiction": "India",
    "brief_description": "Chronology and source descriptor example matter"
  },
  "ai_run": {
    "policyVersion": "model-policy/v1-current",
    "task": "source_description",
    "tier": "source_description",
    "provider": "openrouter",
    "model": "meta-llama/llama-3.3-70b-instruct",
    "maxOutputTokens": 1200,
    "fallback": "fail_closed"
  },
  "source_record_count": 1,
  "sources": [
    {
      "file_id": "FILE-0003",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "source_path": "00_Inbox/Intake 01 - Initial/By Type/Emails/FILE-0003__message.eml",
      "display_label": "Email from Sharma to Mehta dated 20 April 2026",
      "short_label": "Email dated 20 April 2026",
      "document_type": "email",
      "document_date": "2026-04-20",
      "date_basis": "email_header",
      "parties": {
        "from": "Sharma",
        "to": ["Mehta"],
        "cc": [],
        "author": "",
        "court": "",
        "judge": "",
        "issuing_party": "",
        "recipient_party": "",
        "deponent": "",
        "signatory": ""
      },
      "confidence": 0.91,
      "needs_review": false,
      "evidence": [
        {
          "citation": "FILE-0003 p1.b1",
          "reason": "Email header identifies sender, recipient, and sent date."
        }
      ],
      "warnings": []
    }
  ]
}
```

The exact `matter` summary can match the existing list-of-dates artifact style. It is included so the artifact remains understandable when copied out of the matter folder.

The `ai_run.provider` and `ai_run.model` values record the provider policy actually used for the source-description run. They are observability metadata, not part of the citation contract.

## Field Notes

### `display_label`

The full human-readable label.

Good examples:

- `Email from Sharma to Mehta dated 20 April 2026`
- `Legal notice dated 8 August 2023`
- `Order of the Delhi High Court dated 3 March 2024`
- `Agreement between Mehta and Skyline dated 1 April 2022`
- `Affidavit of Rahul Sharma verified on 23 April 2026`

Bad examples:

- `Important document`
- `Court paper`
- `FILE-0003`
- `Email`

The label should be useful in a chronology or source list without requiring the user to open the file.

### `short_label`

A compact version for table cells and inline UI.

Examples:

- `Email dated 20 Apr 2026`
- `Delhi High Court order dated 3 Mar 2024`
- `Legal notice dated 8 Aug 2023`
- `Agreement dated 1 Apr 2022`

### `document_type`

Start with a small taxonomy. It can grow, but it should not start vague.

Suggested v1 values:

```text
email
letter
legal_notice
court_order
pleading
application
reply
affidavit
agreement
invoice
receipt
bank_record
government_record
photo
screenshot
whatsapp_chat
unknown
```

The classifier should prefer `unknown` over a confident-sounding guess.

### `document_date`

The best date for describing the document itself, not necessarily every event inside it.

Examples:

- Email sent date.
- Court order date.
- Agreement execution date.
- Notice date.
- Affidavit verification date.

If no reliable date exists, use `null` and set `needs_review: true` if the date is important to the label.

### `date_basis`

Why the system believes the date is the document date.

Suggested v1 values:

```text
email_header
document_heading
signature_block
court_order_date
file_name
body_text
inferred
unknown
```

`file_name` and `inferred` should usually lower confidence.

### `confidence` and `needs_review`

`confidence` should reflect confidence in the descriptor, not confidence in every factual assertion inside the document.

Set `needs_review: true` when:

- the document type is uncertain;
- the source date is missing or only inferred from the filename;
- sender, court, author, or party fields are guessed from weak evidence;
- the extraction record itself has low OCR confidence or warnings;
- the label would be misleading if shown in a chronology without lawyer review.

The system should prefer a plain but honest label over a polished guess.

Examples:

```json
{
  "display_label": "Scanned document, likely affidavit, date unclear",
  "document_type": "affidavit",
  "document_date": null,
  "date_basis": "unknown",
  "confidence": 0.52,
  "needs_review": true
}
```

```json
{
  "display_label": "Legal notice dated 8 August 2023",
  "document_type": "legal_notice",
  "document_date": "2023-08-08",
  "date_basis": "document_heading",
  "confidence": 0.88,
  "needs_review": false
}
```

### `parties`

Keep party fields optional and type-specific. Do not force every document into an email shape.

Useful fields:

- `from`
- `to`
- `cc`
- `author`
- `court`
- `judge`
- `issuing_party`
- `recipient_party`
- `deponent`
- `signatory`

The implementation can store empty strings or omit unknown fields, but the contract should make it clear that uncertainty is allowed.

### `evidence`

Every descriptor should cite the extraction blocks used to create the label.

This keeps source descriptions source-backed. If the model says "Email from Sharma to Mehta dated 20 April 2026", the artifact should show which block or header supported that label.

Evidence should be compact. It is there to explain the label, not to summarize the whole document.

## Document-Level Labels vs Block-Level Citations

This distinction is the core of the design.

`FILE-0003` identifies the source document.

`FILE-0003 p2.b1` identifies a specific block in that document.

The source descriptor attaches to `FILE-0003`. It should not pretend to know why every later chronology event used `p2.b1`. The chronology event still owns its own citation.

That means `/create_listofdates` should not ask the source descriptor to prove the event. It should use the descriptor only to render a better source label for the event's existing citation.

For example:

```json
{
  "date_iso": "2026-04-20",
  "event": "Notice was issued after inspection.",
  "citation": "FILE-0003 p2.b1",
  "source_file_id": "FILE-0003",
  "source_label": "Email from Sharma to Mehta dated 20 April 2026"
}
```

The event is proved by `FILE-0003 p2.b1`. The source label only explains what `FILE-0003` is.

## How List Of Dates Should Use This

`/create_listofdates` continues storing:

```json
{
  "citation": "FILE-0003 p2.b1"
}
```

When a trusted `Source Index.json` exists, it enriches entries:

```json
{
  "citation": "FILE-0003 p2.b1",
  "source_file_id": "FILE-0003",
  "source_label": "Email from Sharma to Mehta dated 20 April 2026",
  "source_short_label": "Email from Sharma to Mehta"
}
```

The event still points to the exact block. The label describes the broader source document.

If no descriptor exists, list-of-dates should fall back gracefully:

```json
{
  "citation": "FILE-0003 p2.b1"
}
```

If the source index is stale because the `sha256` or `source_path` no longer matches the current extraction record, list-of-dates also falls back to the raw citation behavior.

The list-of-dates fields should be treated as denormalized display metadata. The authoritative source descriptor still lives in `Source Index.json`.

## Presentation Language

Keep the internal schema language as `source_*`. It is neutral and describes what the fields are.

For lawyer-facing Markdown, PDF, or UI views, it is acceptable to use presentation labels such as **Exhibit / Source** or **Exhibit**. That is display language only. It should not rename the JSON fields or change the contract.

Good presentation:

```text
Exhibit / Source:
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026 (FILE-0001 p1.b2)
```

Bad presentation:

```text
Exhibit: FILE-0001
```

The first form helps the lawyer read the chronology. The second form throws away the whole point of the descriptor.

## Why This Should Be Separate From `/extract`

`/extract` should stay deterministic. It turns files into text records and stable citations.

Source descriptors are interpretive:

- Is this a legal notice or a letter?
- Which date is the document date?
- Is the sender a lawyer, party, court, or unknown person?
- Is a WhatsApp screenshot a chat record or merely an image?

That is model-shaped work. Keeping it separate avoids polluting the extraction layer with guesses.

The clean architecture is:

```text
/extract
  -> extraction records with FILE-NNNN pX.bY

/classify_documents or /describe_sources
  -> Source Index.json with human-readable descriptors

/create_listofdates
  -> chronology entries with raw citations plus source labels
```

This preserves the repository's existing boundary: deterministic preprocessing first, AI interpretation later, and downstream skills consuming explicit artifacts.

## Classifier Input

The classifier should receive a bounded source packet, not an entire matter and not an unrestricted file dump.

Suggested per-source input:

- `file_id`
- `sha256`
- file register metadata: original name, working copy path, category, size, intake id
- extraction metadata: engine, page count, OCR flags, extraction warnings
- deterministic email metadata when available
- the first useful text blocks
- heading-like blocks
- signature or verification blocks
- date-bearing blocks found by deterministic date scanning

Do not send unrelated documents just to classify one source. Do not ask the classifier to decide legal relevance across the whole matter. That is a later analytical skill.

The source packet should have a size limit. If a source is too large, sample the most label-relevant blocks and mark uncertainty honestly. For example, an agreement can often be labeled from title, party block, execution block, and signature page; the classifier does not need every clause.

This keeps classification cheaper, more private, easier to test, and less likely to invent context from neighboring files.

## Model Fit

This is a good first Llama/OpenRouter task because it is:

- Structured.
- Bounded per document.
- Cheaper than long chronology reasoning.
- Useful even when imperfect, as long as confidence and review flags are honest.
- Easy to verify against source snippets.

The model must not move files, rename folders, or change canonical citations. It only writes advisory metadata.

Proposed model-policy task name:

```text
source_description
```

Alternative:

```text
document_classification
```

`source_description` is the better product name because the output is not just a category. It includes the readable label that downstream legal work needs.

Llama via OpenRouter is wired through provider policy, not hidden inside downstream chronology logic. The source descriptor engine asks for the `source_description` task and passes a structured source packet; the provider layer decides which configured model satisfies that task.

## Remaining Non-Goals

The source descriptor and list-of-dates enrichment stack should still not:

- Change `/extract`.
- Move or rename files.
- Replace raw citations.
- Let readable labels become canonical citations.
- Auto-merge descriptors into old chronology artifacts.

## Implementation Status

Completed slices:

1. Landed this design note.
2. Added `source-index/v1` schema and source descriptor engine skeleton.
3. Added `source_description` model policy and OpenRouter provider wiring.
4. Added source descriptor prompt and validator guardrails, including no `FILE-NNNN` in human labels.
5. Enriched `/create_listofdates` output with `source_file_id`, `source_label`, and `source_short_label` while preserving `citation`.
6. Verified the full chain on a disposable matter.

Next likely slices:

- Run a Gemini or other provider bakeoff against the same synthetic and disposable-matter checks.
- Add UI or export presentation that labels the column **Exhibit / Source** while preserving raw citations.
- Consider a manual refresh command for old chronology artifacts, rather than mutating historical outputs automatically.

## Testing Strategy

Use fixtures that force the model or test provider to make hard distinctions:

- Email with sender, recipient, and sent date.
- Court order with court and order date.
- Legal notice with notice date and sender.
- Agreement with execution date and parties.
- Screenshot or scan with unclear provenance.
- File name containing a misleading date.

The important tests are not "the model sounds smart." The important tests are:

- raw `citation` remains unchanged;
- descriptors cite evidence blocks;
- uncertain labels set `needs_review`;
- invalid or missing source index falls back safely;
- list-of-dates can render readable labels without losing traceability.

## The Mental Model

Think of `FILE-0003 p2.b1` as the exhibit sticker.

Think of `Email from Sharma to Mehta dated 20 April 2026` as the clerk's index card.

The sticker is what proves where the evidence lives. The index card is what makes the file usable in real legal work.

Matter Workbench needs both.
