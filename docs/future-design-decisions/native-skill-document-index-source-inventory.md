# Native Skill Requirement: Document Index / Source Inventory

Date: 2026-05-16
Status: SME requirement capture

## SME Source

This note captures the first SME interview for the first native skill family:
Document Index / Source Inventory.

The lawyer instinct described by the SME is:

```text
Discovery first.
```

When a matter file arrives, the first job is not to draft, argue, or summarize.
The first job is to line up the documents, understand the stage of the matter,
read them in a sensible order against the client interview, and begin building
the List of Dates.

Client interview and matter metadata should not be owned by this skill. They
should be captured during Add New Matter and later corrected through a separate
metadata review flow. See
[Matter Metadata and Client Interview](matter-metadata-client-interview.md).

The first List of Dates pass should be a comprehensive, source-grounded story
of the matter. It should follow the spine of time as events occurred. The app
should not fight chronological order by moving an order, judgment, or challenged
decision to the front merely because it is important.

## Core Insight

The original name "Document Index / Source Inventory" is slightly too static,
but the opposite mistake is to let this skill swallow chronology.

The lawyer-facing surface should be:

```text
Source Labels / Document Index
```

The product promise is:

```text
Organize documents and prepare the source record for List of Dates.
```

It should create the source record that later chronology depends on. It should
not itself decide the actual List of Dates.

The product value is knowing:

- what documents exist;
- what each document should be called in lawyer language;
- which internal source identity each lawyer label points to;
- what type and date each document appears to have;
- which documents are bad copies;
- which documents are missing or duplicated;
- whether the source record is ready for chronology.

The skill should behave like a careful junior arranging and labeling the brief
before the lawyer starts legal analysis.

## Lawyer Workflow

Manual lawyer workflow, as described:

1. Gather the documents shared by the client.
2. Line them up chronologically.
3. Read them against the client interview.
4. Determine the stage of the matter.
5. Use the stage to label the client's role and legal posture.
6. Prepare the source record that will feed a List of Dates.
7. Use the discovered issues to later identify facts in issue, cause of
   action, pleadings, findings, and legal questions.

The important point is sequencing. The first pass should prepare discovery. It
should not pretend to complete legal analysis in one shot.

## Matter Stage Drives Context, Not Chronology Order

The skill must ask for or infer the matter stage, but the stage should not
break time chronology.

The first List of Dates should always follow time as it occurred:

```text
earliest event -> later event -> challenged order -> later appeal/writ/SLP step
```

If the matter is appellate, writ-stage, SLP-stage, or otherwise a challenge to
an order, the challenged order is very important. But it still appears at the
date on which it occurred. It should be flagged as `challenged_order` or
equivalent, not artificially moved to the beginning.

Stage should affect:

- how the client is described, such as client as plaintiff, defendant,
  appellant, petitioner, respondent, complainant, or applicant;
- which events are marked as especially important;
- which limitations and follow-up questions appear at the end;
- which later drafting mode may use the chronology.

Stage should not affect:

- the chronological order of the first pass;
- whether adverse or inconvenient events are included;
- whether unsupported legal conclusions are added.

### Fresh Complaint / Fresh Suit / Original Side Matter

If the matter is a fresh complaint, fresh suit, or original-side matter, the
chronology should usually help the lawyer see:

- the client's narrative against the documents;
- foundational transaction events;
- notices and replies;
- correspondence;
- payment or performance events;
- breach/default/injury/dispute-trigger events;
- documents that may later establish cause of action;
- any existing pleadings or draft pleadings.

The goal is to understand what happened and what facts may become legally
material.

### Appellate / Challenge-Stage Matter

If the matter is appellate, revisional, writ-stage, SLP-stage, or otherwise a
challenge to an order, the chronology should usually help the lawyer see:

- the earlier facts and filings that led to the challenged order;
- the challenged order, judgment, award, or finding at its actual date;
- the forum and procedural stage;
- evidence or documents relied on in the challenged finding;
- procedural history;
- grounds of challenge, if already available;
- limitation/delay materials;
- relevant portions of the lower record.

The goal is not only to know what happened, but to understand what is being
challenged and why.

## Required User Inputs

At the start of this skill, the app should consume or confirm matter metadata
that was captured upstream:

- active matter;
- client side;
- matter type;
- forum/court/authority if known;
- matter stage;
- whether the matter is fresh/original-side or appellate/challenge-stage;
- whether there is a challenged order;
- client interview or short client narrative, if available;
- any known urgent objective, such as filing a writ, SLP, appeal, complaint, or
  suit.

If the user does not know the stage, the skill should mark stage as
`needs_review` rather than guess too confidently.

If this skill detects that metadata is likely wrong or incomplete, it should
surface a metadata review prompt. It should not silently rewrite the matter
metadata by itself.

Examples:

- client name appears truncated but documents show a fuller legal name;
- party names appear misspelled;
- court/forum appears different from the entered jurisdiction;
- documents suggest the matter is appellate/challenge-stage but metadata says
  fresh case;
- the client narrative conflicts with the document chronology.

The SME found "matter-stage choices" too abstract. In the product, ask this in
plain language:

```text
What kind of matter is this right now?
```

Possible choices should be simple, such as:

- fresh case or complaint to prepare;
- existing original-side case;
- challenge to an order, judgment, or award;
- writ or SLP;
- execution or enforcement;
- not sure.

## Document Categories

The SME confirmed that the broad document categories are all relevant because
issues discovered from documents may later determine facts in issue, cause of
action, pleadings, or findings.

Initial categories:

- pleadings;
- petitions;
- written statements/replies/counters;
- applications;
- affidavits;
- orders;
- judgments;
- awards;
- notices;
- replies to notices;
- agreements/contracts;
- receipts;
- invoices;
- bank records;
- payment records;
- correspondence;
- emails;
- letters;
- annexures;
- exhibits;
- authority documents;
- inspection reports;
- expert reports;
- photographs/images;
- handwritten notes;
- client interview notes;
- procedural records;
- lower-court/lower-forum record;
- documents needing review.

This category list should be broad at first. Later product work can collapse or
expand categories based on user testing.

Client interview notes can orient the lawyer and metadata review. Purely verbal
client interview material should not become a List of Dates row unless it exists
as a usable document or record.

## Bad Copy / Needs Review Flags

Bad documents are not a minor inconvenience. They can corrupt analysis.

The skill must flag documents that may require better copies from the client.
This should happen before deeper legal analysis.

Flag a document as `needs_better_copy` or `needs_review` when:

- OCR/text extraction is poor;
- pages appear missing;
- page order appears broken;
- the document is cropped, blurred, skewed, or unreadable;
- the document has no date but appears date-sensitive;
- the document is unsigned where signature matters;
- annexures appear referenced but missing;
- duplicate documents differ in important ways;
- file name and document content appear inconsistent;
- the document type is unclear;
- party names are unclear;
- handwritten content is present and not reliably extracted;
- the document appears to be a later scan of an earlier document and date
  ambiguity matters.

The product should turn these flags into client action:

```text
Ask client for a better copy of Document X because OCR failed / page 3 appears
missing / signature page is unreadable.
```

## Source Identity: Dev Names And Lawyer Labels

SME note: developer file names and lawyer-facing document labels should live
together.

This is a core source-inventory requirement, not a cosmetic naming preference.
The app may need stable internal file names, IDs, paths, hashes, and extraction
citations. The lawyer needs readable labels that look like legal work product.
Those two identities must stay linked at the source-record level.

Recommended source identity fields:

```json
{
  "source_id": "",
  "content_hash": "",
  "internal_file_name": "",
  "original_upload_name": "",
  "suggested_label": "",
  "confirmed_label": "",
  "label_status": "suggested | confirmed | overridden | needs_review",
  "label_source": "model | filename | document_text | lawyer_override",
  "label_reason": "",
  "label_revision": 1,
  "confirmed_by": "",
  "confirmed_at": "",
  "lawyer_document_label": "",
  "short_source_label": "",
  "document_type": "",
  "document_date": "",
  "annexure_or_exhibit_label": "",
  "paperbook_page_range": "",
  "current_storage_path": "",
  "source_quality_flags": []
}
```

The UI can show the lawyer-facing label first and keep the internal name or raw
file reference visible in hover, detail view, JSON, or audit mode.

Court-facing exports must never expose developer names or raw system references
such as `FILE-0001`, extraction IDs, hashes, storage paths, or opaque upload
names. Those belong in internal metadata only. Court-facing source references
should use lawyer-recognizable labels such as annexure labels, exhibit labels,
paper-book page references, or confirmed document titles.

Reasons this matters:

- source-clicking remains reliable even if a file is renamed or relabeled;
- chronology rows can cite human labels without losing machine traceability;
- duplicates and better-copy replacements can be reconciled safely;
- annexure, exhibit, and paper-book labels can be added without overwriting the
  original upload identity;
- drafting skills can use lawyer labels while still opening the correct source;
- court exports can hide internal names while preserving auditability;
- courts are not exposed to developer file names or internal extraction labels;
- stale-chronology checks can compare source IDs and hashes instead of fragile
  display names.

Important distinction:

- changing a lawyer-facing label does not mean the document changed;
- changing the underlying source/content hash means chronology state must be
  reassessed.

Product rule:

```text
every lawyer-facing source label must point back to a stable internal source
identity, and every internal source identity should have a lawyer-readable label
as soon as the app can infer or the lawyer can confirm one
```

## Primary Output

The primary output is the source record, not the chronology.

The lawyer should be able to review:

- document label;
- document type;
- document date or date uncertainty;
- document quality status;
- missing-document follow-up;
- duplicate or better-copy status;
- source link.

The source review loop is:

1. read the suggested source label;
2. click the source document;
3. confirm or rename the label if needed;
4. flag bad copy or missing material;
5. continue to the next document.

Confirmed labels update the source record. They do not mutate chronology rows
directly. Chronology and downstream drafting reuse the confirmed source label
on the next render or regeneration.

## Handoff To Chronology And Drafting

This skill is upstream of the canonical List of Dates.

When the source inventory changes, the app should know whether the current
chronology may be stale. It should not let later drafting skills blindly rely on
an old List of Dates after new papers have arrived.

The clean dependency is:

```text
source inventory -> canonical chronology -> drafting skills
```

That means Skill 1 should preserve enough inventory state for Skill 2 to know
what changed:

- newly added documents;
- newly classified documents;
- better copies replacing bad copies;
- improved OCR or extraction;
- documents whose dates, parties, or categories changed;
- documents previously mentioned as missing but now supplied.

If a source change may affect dates, facts, procedural history, limitation, or
the challenged order, the product should nudge the lawyer to rerun the
chronology or knowingly proceed despite the staleness warning before using
drafting skills.

Use three dependency states:

```text
label_refresh_needed
chronology_review_needed
chronology_regeneration_needed
```

If only a lawyer-facing label changes, refresh the visible rendering. If source
metadata changes in a way that may affect interpretation, warn and review. If
the source set or source content changes, regenerate the List of Dates unless
the lawyer knowingly proceeds under a strong warning.

This keeps the drafting layer cheaper and cleaner. Drafting skills should not
need to rediscover the whole record each time; they should rely on the current
chronology unless the source inventory has changed materially.

## Generated Output, Not Editable Work Product

SME decision: Skill 1 and Skill 2 outputs should not become lawyer-edited
documents inside the app.

The source inventory and chronology are generated `10_Library` artifacts. The
user may trigger them manually, or the app may nudge/rule-trigger them when new
documents or better copies arrive. But the product should avoid direct row-level
editing of these generated artifacts.

If the output is wrong, the correction path should be upstream:

- fix or add source documents;
- improve source labels;
- correct matter metadata;
- regenerate the source inventory or chronology;
- mark older generated artifacts as stale or superseded.

Lawyer editing belongs downstream in draft documents, not in the generated
Library layer.

## Output Artifacts

This native skill family should produce or feed:

- `Document Index` / source inventory;
- source identity map tying internal file names to lawyer-facing labels;
- stage-aware context labels;
- document quality flags;
- source links;
- List of Dates handoff;
- client request candidates for bad/missing documents.

Possible files:

```text
10_Library/Document Index.json
10_Library/Document Index.md
10_Library/Chronological Reading Notes.md
20_Workshop/Client Document Requests.md
```

The exact file names can change later. The product requirement is that the
inventory must be useful to chronology without owning chronology.

Visibility rule:

- the lawyer should see the clean source inventory and source labels;
- bad-copy and missing-document follow-up should be visible because it drives
  client action;
- extraction diagnostics, duplicate-resolution traces, hash comparisons, raw
  OCR failures, and model/source-label attempts should be internal audit
  material by default;
- internal audit material should not appear as extra draft-like files in the
  default lawyer workspace.

Naming rule:

- source inventory outputs may keep stable internal paths for the app;
- lawyer-visible versions should include date or timestamp where that helps
  versioning;
- internal source-review outputs should carry `Internal - Not for Circulation`
  where there is any risk they could be mistaken for shareable work product.

Examples:

```text
2026-05-16 1430 IST - Source Labels - Internal.md
2026-05-16 1430 IST - Document Index - Internal - Not for Circulation.md
2026-05-16 1430 IST - Client Document Follow-up - Internal.md
```

## What This Skill Should Not Do Initially

The SME was clear that trying to do everything in the first shot would be
wrong.

This skill should not initially:

- own the Add New Matter interview;
- silently correct matter metadata;
- decide final facts in issue;
- decide final cause of action;
- draft pleadings;
- draft grounds of appeal or writ grounds;
- decide legal merits;
- assume the court/forum/stage if it is unclear;
- suppress inconvenient documents;
- claim a document proves more than it says;
- become opinionated beyond recording source-backed roles/posture such as
  client as plaintiff or client as appellant;
- complete issue analysis without enough facts, documents, or legal research.

Those later tasks depend on:

- more facts;
- better document copies;
- research;
- the stage of the matter;
- the court/forum;
- whether the matter is original-side, appellate, writ-stage, SLP-stage, or
  another procedural posture.

## Product Requirement

The native skill should be renamed in product language from a flat inventory to
a lawyer-facing source-record workflow:

```text
Source Labels / Document Index
```

The skill promise:

```text
Organize documents and prepare the source record for List of Dates.
```

The existing slash command may remain `/describe_sources` for compatibility.
The user-facing card should not sound like backend inventory, and it should not
claim to build the chronology.

## Acceptance Criteria

A useful first version should:

1. Ask or infer whether the matter is fresh/original-side or
   appellate/challenge-stage.
2. Identify a challenged order when the matter is appeal/writ/SLP oriented.
3. Classify documents into lawyer-readable categories.
4. Keep internal file names, stable source IDs, and lawyer-facing document
   labels together in the source inventory.
5. Store suggested and confirmed labels separately.
6. Preserve the reason for the current label.
7. Distinguish source label replacement from document/content replacement.
8. Flag bad copies and unclear documents before downstream analysis.
9. Attach bad-copy, uncertainty, and limitation notes to relevant documents as
   review metadata.
10. Let the lawyer click from source label to source document and return to the
    same review position.
11. Generate client follow-up candidates for missing or bad documents.
12. Mark chronology dependency as label refresh, review, or regeneration when
    source inventory changes may affect it.
13. Keep legal conclusions out of this source-record layer.
14. Mark uncertainty clearly instead of hiding it.

## Open SME Questions For Next Pass

Before this becomes an implementation contract, ask the SME:

1. What simple matter-stage choices should the app show under "What kind of
   matter is this right now?"
2. What should the app call "facts in issue" for non-lawyer users, if anything?
3. Should the first chronology include events with uncertain dates in the main
   time spine if they can be placed approximately, or should they always sit in
   a separate review section?
