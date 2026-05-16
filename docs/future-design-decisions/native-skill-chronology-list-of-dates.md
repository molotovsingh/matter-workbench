# Native Skill Requirement: Chronology / List of Dates

Date: 2026-05-16
Status: SME requirement capture started

## Related Notes

This note should be read with:

- [Native Skill Library Strategy](native-skill-library-strategy.md)
- [Document Index / Source Inventory](native-skill-document-index-source-inventory.md)
- [Matter Metadata and Client Interview](matter-metadata-client-interview.md)
- [Lawyer-Facing List of Dates](../lawyer-facing-list-of-dates.md)
- [Two-Pass `/create_listofdates` Runtime Contract](../create-listofdates-two-pass-contract.md)

## Why This Skill Exists

Chronology / List of Dates is the central native skill family.

For a lawyer, a List of Dates is not just a date table. It is the first
source-grounded story of the matter. It helps the lawyer understand what
happened, where each event is grounded, what limitations remain, and what the
client must still provide.

It also becomes a bridge into formal work: writ petitions, SLPs, appeals,
suits, notices, conferences, and counsel notes.

This is too important to leave to custom prompts.

## Core SME Principles Already Captured

From the SME discussion so far:

1. The first pass should be comprehensive and verbose.
2. It should follow chronological time order.
3. It should not put a challenged order first merely because the order is
   important.
4. It should be source-grounded row by row.
5. It should be non-opinionated except for recording client role/posture, such
   as client as plaintiff, appellant, petitioner, complainant, etc.
6. It should include real-world events that matter to the task and objective.
7. Client interview verbal material is useful context, but should not pollute
   the List of Dates unless it exists as a usable document or record.
8. Bad-copy, missing-document, and uncertainty issues should not leak into the
   main chronology narrative. They may appear as review metadata or in a
   limitations/follow-up section.
9. If new documents arrive, the List of Dates should be generated again and try
   to remove earlier limitations where possible.
10. Whether to proceed despite unresolved limitations is a lawyer's call.
11. Stage awareness should affect focus and role labels, but not justify
    suppression of material events.
12. Event text should be as verbose as needed in the first pass. Do not impose
    an artificial cap before seeing real outputs.
13. A court-facing List of Dates, such as an SLP List of Dates, can be a cleaner
    export of the richer base chronology. It need not expose every internal
    metadata column.
14. Different High Courts may have slightly different filing templates, but that
    is not a core problem for this skill. Template variance belongs to export
    profiles, not to the underlying chronology logic.
15. Court-facing outputs must never expose developer file names, raw `FILE-...`
    citations, hashes, storage paths, or extraction IDs. Those remain internal
    audit metadata only.

## Skill Family, Not One Output

Chronology should be a native skill family with modes.

The base skill should produce:

```text
comprehensive first-pass source-linked List of Dates
```

Later modes may include:

- preparation chronology;
- court-facing chronology;
- SLP chronology;
- writ chronology;
- appeal chronology;
- limitation-focused chronology;
- client conference chronology.

These should be modes or profiles of one native chronology family, not separate
custom skills.

## Court Template Variance

SME note: each High Court may have a slightly different template or local
formatting convention.

This nuance should not fragment the native chronology skill.

The stable skill responsibility is to produce chronology primitives:

- date;
- event narrative;
- actor or source posture;
- materiality or relevance;
- source grounding;
- procedural/factual tagging;
- export-friendly citation metadata.

Court-specific templates should sit downstream as export profiles. For example,
Delhi High Court writ mode, Bombay High Court writ mode, or Jharkhand High Court
writ mode may vary in formatting, heading style, spacing, index placement, or
annexure references. Those differences should shape the final document export,
not the core chronology extraction and reasoning.

Product rule:

```text
one source-grounded chronology model -> many court-specific export profiles
```

This keeps the native skill reusable and avoids multiplying custom skills for
every court template.

## SLP Exemplar: SLP-ATIBIR.pdf

The exemplar SLP supplied by the SME is a useful court-facing reference.

Observed product signals:

- The paper book has formal front matter: index, synopsis and List of Dates,
  impugned judgment/order, annexures, interlocutory applications, vakalatnama,
  filing memo, and related filing material.
- The filed List of Dates uses a conventional court-facing table. It does not
  show separate app-style columns for `Materiality / Relevance` or raw source
  citation.
- The chronology still follows time. The impugned High Court judgment is placed
  at its own date, not pulled to the top merely because it is the order under
  challenge.
- The same List of Dates includes factual background, policy events,
  administrative decisions, writ proceedings, affidavits or pleadings where
  relevant, and the impugned judgment/order.
- The event language ties facts to actors and procedural posture: petitioner
  State, respondent, High Court, Commercial Taxes Department, High-Powered
  Committee, and similar source actors.
- Annexure references are embedded in the court-facing event narrative. The
  filed output uses `ANNEXURE P/...` style references and paper-book structure,
  not internal raw extraction citations.
- The filed List of Dates does not expose OCR problems, missing-document notes,
  or client-interview verbals inside the main chronology.

Product conclusion:

The native skill should first build a richer base chronology with visible
materiality, source links, and structured provenance. SLP mode can then export a
cleaner court-facing version that folds relevance into the event narrative and
uses annexure or paper-book references for formal filing.

Recommended SLP export metadata:

```json
{
  "annexure_label": "",
  "paperbook_page": "",
  "internal_source_citation": "",
  "export_source_label": "",
  "slp_role_label": "petitioner | respondent | high_court | authority | third_party | uncertain"
}
```

The exported SLP table may therefore be narrower than the base app table, while
the app keeps the richer row record available for review, regeneration, and
later drafting skills.

## Base Output

The base List of Dates should be a lawyer-readable chronology that can be used
for later analysis, pleadings, and filing preparation. It is a base document,
not the final legal analysis itself.

The chronology should include real-world events that matter to the present task
and objective. In an appeal or challenge matter, unfiled but real documents may
still matter because they may later be filed or used to explain the record. By
contrast, purely verbal client interview statements are transient. They should
guide the lawyer's understanding and metadata review, but should not become
chronology rows unless there is a document or record that can ground them.

Each row should answer:

```text
When did it happen?
What happened?
Who does the record say did or said it?
Why might this matter for the current task or procedural posture?
Where is it supported?
```

Suggested row shape:

```text
Date | Event | Actor / Posture | Materiality / Relevance | Source
```

The final fields may change, but the row must preserve:

- date;
- event;
- source citation;
- readable source label where available;
- internal source identity, such as source ID, file name, hash, path, or raw
  extraction citation;
- client role/posture where relevant;
- task-aware materiality or practical relevance.
- source speaker posture: client-side, opponent-side, court/authority,
  neutral third party, expert, bank/official record, or uncertain.

Bad-copy, missing-document, and limitation details can exist in review metadata,
hover details, JSON fields, or an end section. They should not clutter the main
base chronology that later analysis and pleadings will build on.

## Source Label Rule

SME decision: internal file names and lawyer-facing document labels must travel
together.

A chronology row should never have only an opaque system citation, and it should
never have only a pretty label with no machine-traceable source behind it. The
row needs both:

```text
lawyer-facing source label + internal source identity
```

Examples:

```text
Lawyer label: Impugned Judgment dated 12.09.2023
Internal identity: FILE-0008 p.12 block 4 / source_id=...
```

```text
Lawyer label: Annexure P-3, Notification dated 07.03.2019
Internal identity: uploaded file name, source hash, extraction citation, page
range
```

The lawyer-facing label should be what appears in the visible chronology and
court-facing exports. The internal identity should remain available for source
clicking, audit, regeneration, deduplication, and drafting handoff.

Court-facing safety rule:

```text
never show internal dev names or raw extraction citations to the court
```

For SLPs, writs, appeals, or filing PDFs, visible source references should be
converted to annexure labels, exhibit labels, paper-book page references, or
confirmed document titles. Internal references such as `FILE-0008 p.12 block 4`,
hashes, storage paths, extraction IDs, or opaque upload names must stay hidden
in metadata.

Suggested row-level source fields:

```json
{
  "source_id": "",
  "internal_file_name": "",
  "original_upload_name": "",
  "lawyer_document_label": "",
  "source_citation": "",
  "source_hash": "",
  "source_page_or_block": "",
  "annexure_or_exhibit_label": "",
  "export_source_label": ""
}
```

This is especially important because later court modes may replace app
citations with annexure, exhibit, or paper-book references. That transformation
is safe only if the lawyer label and internal source identity are already tied
together.

## Materiality / Relevance Placement

SME decision: the lawyer-facing first-pass chronology should show a visible
`Materiality / Relevance` column.

Relevance is important because it is driven by:

- stage of the matter;
- current objective;
- likely destination of the work, such as suit, writ, SLP, appeal, reply,
  conference, or settlement.

The visible table should therefore include:

```text
Date | Event | Actor / Posture | Materiality / Relevance | Source
```

The structured record should also preserve relevance metadata so later modes can
filter and reshape the chronology:

```json
{
  "current_stage": "",
  "current_objective": "",
  "relevance_to_objective": "",
  "stage_tags": [],
  "needs_lawyer_review": false
}
```

This gives the lawyer visible reasoning while preserving machine-readable
support for later SLP, writ, appeal, limitation, or conference modes.

## Source Speaker And Party Posture

SME decision: row formulations should be tied to the interested party or
third-party entity behind the source.

The chronology must not treat all source statements as equal. A client statement,
opponent denial, court finding, bank record, and third-party inspection report
carry different legal weight.

Each row should identify, explicitly or structurally:

- who is speaking or recording the fact;
- whether the speaker is client-side, opponent-side, court/authority, neutral
  third party, expert, bank/official record, or uncertain;
- whether the statement is an allegation, denial, admission, finding, direction,
  record, observation, or transaction record.

Recommended structured fields:

```json
{
  "source_speaker": "",
  "source_speaker_posture": "client_side | opponent_side | court_authority | neutral_third_party | expert | bank_or_official_record | uncertain",
  "statement_type": "allegation | denial | admission | finding | direction | record | observation | transaction_record | uncertain"
}
```

Examples:

- `Agreement records...` where the source is a signed agreement.
- `Client states...` where the source is a client interview note.
- `Respondent denies...` where the source is a reply notice or written
  statement.
- `Court held...` where the source is a finding in an order or judgment.
- `Court recorded the respondent's submission...` where the source is an order
  recording a party submission, not deciding it.
- `Bank statement shows...` where the source is a bank or official financial
  record.
- `Inspection report notes...` where the source is a third-party or expert
  observation.

This prevents the chronology from laundering allegations into facts. It also
helps later petition-drafting skills decide what can be asserted directly, what
must be attributed, and what remains disputed.

## Factual And Procedural Events

SME decision: factual events and procedural events should live in the same
chronological table.

Do not split the first-pass List of Dates into separate factual and procedural
timelines. The lawyer should be able to read one time spine:

```text
agreement -> payment -> notice -> suit filed -> interim order -> reply -> judgment -> appeal
```

The distinction should live in the row metadata or a compact visible tag, not in
separate tables.

Recommended structured field:

```json
{
  "event_stream": "factual | procedural | mixed | uncertain"
}
```

This preserves one chronology while still allowing later filters, such as
"show only procedural history" or "show only factual merits events."

## Chronological Spine Rule

The first pass must follow the spine of time.

Correct:

```text
2018 agreement -> 2020 payment -> 2022 notice -> 2024 order -> 2025 appeal
```

Incorrect:

```text
2024 challenged order -> then earlier facts grouped underneath
```

The challenged order can be marked as important, but it should stay at its
actual date.

Stage awareness should affect focus, not chronology order. For example, if the
matter is likely to become a writ, SLP, or appeal, the chronology should be more
attentive to order dates, limitation, procedural steps, and events that explain
why the challenged outcome is vulnerable. But the skill must still include
material adverse events. Suppression can be fatal to a matter.

## Inclusion Rule

Include real-world events that are material to the task and objective.

Always consider including:

- transaction or relationship-starting events;
- agreements and amendments;
- payments, defaults, performance, possession, delivery, or completion events;
- notices, replies, demands, objections, acknowledgments, and admissions;
- pleadings, applications, affidavits, and filings;
- hearings, orders, judgments, awards, and challenged findings;
- inspection reports, expert reports, official records, and correspondence;
- limitation-triggering events;
- events that explain delay, maintainability, jurisdiction, or procedural
  posture;
- unfiled but real documents, especially in appeal/challenge matters where the
  lawyer may decide whether they can be filed or relied on.

This does not mean every dated phrase belongs in the List of Dates. It means
the skill should not miss events that a lawyer may need to decide the case
theory, pleading strategy, appeal strategy, limitation, or client follow-up.

## Verbosity Rule

SME decision: first-pass event text should be as verbose as needed.

Do not artificially cap event text at one sentence or a fixed length during
requirement design. The first pass should preserve enough factual context for a
lawyer to understand the event without reopening the source for every row.

Later product modes may prune or tighten the chronology:

- court-facing chronology;
- SLP chronology;
- writ chronology;
- limitation chronology;
- conference summary.

But the base first-pass chronology should err on preserving material detail.
Pruning should be based on observed output quality, not an upfront arbitrary
limit.

## Exclusion Rule

Usually exclude from the main List of Dates:

- purely verbal client interview statements with no usable document or record;
- internal app notes about missing documents or bad copies;
- OCR diagnostics;
- file upload dates unless the upload itself is legally relevant;
- dates from precedents or case-law extracts unless the precedent date is part
  of this matter's procedural history;
- duplicate mentions that add no new source, contradiction, admission, denial,
  or legal context;
- generic document creation/scanning dates that do not matter to the dispute.

Client interview content can still influence:

- metadata review;
- follow-up questions;
- what the lawyer checks against the documents;
- later client conference notes.

It should not become a source-grounded chronology row merely because the client
said it.

## Relationship To Two-Pass Runtime

The existing two-pass contract has a useful runtime idea:

```text
verbose candidate ledger -> lawyer-facing chronology
```

That shape fits the SME requirement.

Pass 1 should be generous and comprehensive. Pass 2 should organize, de-duplicate,
ground, and present the chronology without losing material events.

The final lawyer-facing chronology should not expose candidate noise, but it
should preserve traceability to source records.

Visibility rule for this skill:

- `List of Dates` is the primary visible output.
- `Limitations and Follow-up With Client` is part of the visible output, but
  clearly separated as lawyer working material.
- candidate ledgers, rejected rows, prompt traces, model responses, validation
  checks, and extraction diagnostics are internal audit artifacts.
- internal audit artifacts should not be shown as separate lawyer-facing
  "drafts" in the default workspace.
- court-facing exports should show only the clean filing version, with internal
  audit material hidden.

Naming rule for this skill:

- keep stable machine-readable paths for downstream skills, such as
  `10_Library/List of Dates.json`;
- show lawyer-visible/history/export names with date or timestamp;
- include `Internal - Not for Circulation` on generated Library review outputs;
- remove `Not for Circulation` from any promoted court-facing or dispatch-ready
  export.

Example visible names:

```text
2026-05-16 1430 IST - List of Dates - Internal - Not for Circulation.md
2026-05-16 1430 IST - List of Dates - Internal - Not for Circulation.pdf
2026-05-16 - SLP List of Dates - Court Filing Copy.pdf
```

## Generated Artifact, Not Lawyer-Edited Document

SME decision: Skill 1 and Skill 2 outputs should not become in-app documents
that lawyers edit row by row.

The chronology is a generated `10_Library` artifact. It can be triggered by a
human or by product rules. If it is wrong, incomplete, or stale, the right
product action is to fix the upstream input, source labels, metadata, or source
inventory, and then rerun or regenerate the skill.

Do not create a workflow where the lawyer edits the generated List of Dates as
the canonical source of truth. That would make later regeneration, provenance,
and staleness detection messy.

The lawyer's editing surface is downstream:

```text
10_Library generated chronology -> 30_Drafts petition/draft -> lawyer edits
```

The app may produce drafting material, but the lawyer can edit the draft
petition or filing document in the draft workflow or outside the app. The
Library chronology remains generated source-backed matter knowledge, not the
lawyer's manually maintained pleading.

## Canonical Handoff To Drafting Skills

SME instinct accepted: this is cleaner, more reusable, and more cost-efficient.

Skill 2 should produce the canonical chronology artifact for the matter. Later
drafting skills should read the current generated chronology first instead of
rediscovering the same dates from the full document set.

The handoff should include two layers:

```text
1. lawyer-visible List of Dates
2. structured chronology record behind each row
```

The structured record should let drafting skills reuse:

- date;
- event narrative;
- source document, lawyer-facing source label, and internal source citation;
- actor or source posture;
- materiality or relevance;
- factual/procedural tag;
- annexure or paper-book reference where available;
- uncertainty or limitation flags.

Product rule:

```text
drafting skills consume the current generated chronology unless it is stale or
the lawyer chooses to regenerate before drafting
```

This reduces token cost because drafting skills do not need to read the whole
matter record for every petition, synopsis, grounds, facts section, or counsel
note. It also reduces inconsistency risk between List of Dates, synopsis,
facts, grounds, and prayers.

Drafting skills may still open source documents for a cited event, especially
where wording is important. But they should not silently invent new chronology
rows or contradict the generated chronology. If a drafting skill notices a
missing date, conflict, or unstated material event, it should raise a chronology
gap and suggest regeneration or source/metadata review.

## Staleness And Regeneration

Skill 2 depends on the source inventory from Skill 1.

The chronology should record the source inventory snapshot or document set it
was generated from. If Skill 1 later changes source rows, the app should decide
what kind of change occurred before spending money on AI regeneration.

Use three dependency states:

```text
label_refresh_needed
chronology_review_needed
chronology_regeneration_needed
```

Use `label_refresh_needed` when only lawyer-facing source labels changed. The
correct action is to refresh the rendered `Source` column or export labels. No
AI rerun should be required.

Use `chronology_review_needed` when source metadata changed in a way that may
affect interpretation, but the underlying source content appears unchanged.
Examples:

- document type changed;
- document category changed;
- quality flag changed;
- matter stage, client role, or current objective changed;
- a source moved from `needs_review` to cleaner but the content hash stayed the
  same.

Use `chronology_regeneration_needed` when the underlying source set or content
changed materially. Examples:

- new documents were added;
- documents were removed;
- better copies replaced bad copies;
- OCR or source extraction changed source text;
- `content_hash` changed;
- document date changed;
- a source previously marked missing has now been supplied.

Before drafting, the warning should be strong:

```text
New or changed documents may affect the List of Dates. Regenerate before
drafting, or proceed with stale chronology.
```

Default action should be regenerate/review, not proceed. But do not hard-block
the lawyer; time pressure may require proceeding knowingly.

This is not mixing Skill 1 and Skill 2. It is the correct dependency:

```text
Skill 1 updates the source inventory.
Skill 2 turns the current inventory into the canonical chronology.
Drafting skills consume the current chronology unless staleness is detected.
```

## Guardrail Starting Point

The existing lawyer-facing List of Dates note already establishes important
guardrails:

- preserve raw `FILE-NNNN pX.bY` citations internally, not in court-facing
  exports;
- use readable source labels where available;
- do not invent facts;
- do not suppress adverse material events;
- use attribution for disputed facts;
- do not state legal conclusions unless the cited source supports them;
- do not collapse same-day events when they carry different legal meaning;
- mark uncertainty instead of hiding it.
- do not use "comprehensive" as an excuse to include transient verbal material
  or internal document-defect notes in the main chronology.

These remain accepted as the starting contract unless the SME changes them.

## Limitations And Follow-Up

The base chronology should not leak every defect into the main row text.

SME decision: keep a clean chronology and place unresolved issues in a separate
section at the end of the same generated List of Dates output:

```text
Limitations and Follow-up With Client
```

That section should list:

- documents that need better copies;
- documents mentioned but not supplied;
- uncertain dates that cannot be safely placed;
- client interview claims that need documentary support;
- potential suppression risks if an adverse event is ignored;
- whether a new document batch should trigger regeneration.

The lawyer decides whether to proceed despite these limitations.

This section is lawyer-facing working material. It should be visually and
semantically separate from the main chronology so it does not get mistaken for
court-facing List of Dates language. In later court-export modes, the app may
exclude this section by default or require explicit lawyer confirmation before
including it.

## Product Questions For SME

We now need to define the lawyer-grade output more precisely.

1. In a comprehensive first-pass List of Dates, what events must always be
   included? Answered: real-world events material to the current task and
   objective.
2. What events should usually be excluded even if they have dates?
   Partly answered: pure verbal client interview material, internal document
   defects, OCR diagnostics, and irrelevant file/upload dates should not pollute
   the main chronology.
3. Should each row have a separate `Legal Relevance` column, or should
   relevance be folded into a longer event narrative? Answered: show a visible
   `Materiality / Relevance` column and also store structured metadata.
4. How should the row describe disputed facts: `Client states`, `Respondent
   denies`, `Record shows`, etc.? Partly answered: formulation must be tied to
   the source speaker and whether the speaker is client-side, opponent-side,
   court/authority, neutral third party, expert, bank/official record, or
   uncertain.
5. For court-facing modes, what changes from the base chronology besides tone
   and relevance? Partly answered from the SLP exemplar: court-facing SLP mode
   may use a narrower table, fold relevance into event drafting, replace raw
   app citations with annexure or paper-book references, and keep richer source
   metadata internally. High Court template differences should be handled as
   downstream export profiles rather than separate native skills.
6. Should the List of Dates include procedural events and factual events in the
   same timeline, or should it mark them with type tags and later allow
   filtering? Answered: same table, same chronology, with row metadata/tags.
7. How verbose is too verbose for the first pass? Answered: no artificial cap;
   event text should be as verbose as needed, with pruning based on real output
   review later.
8. What should the "Limitations and Follow-up With Client" section look like?
   Answered: it should sit at the end of the same generated output, clearly
   separated as lawyer-facing working material.
9. Should drafting skills be forced to use Skill 2's chronology as source of
   truth? Answered: yes, by default, but as a generated Library artifact rather
   than a lawyer-edited document. Drafting skills should consume the current
   chronology artifact and only trigger source review or regeneration when the
   chronology is stale, incomplete, or the lawyer chooses to rerun before
   drafting.
10. Should developer file names and lawyer-facing document labels be kept
    together? Answered: yes. Source rows and chronology rows should preserve
    both a readable lawyer label and a stable internal source identity.
11. Can court-facing outputs show dev names or raw `FILE-...` citations?
    Answered: no. Court-facing exports must show only lawyer/court-recognizable
    source labels, while internal dev identifiers remain hidden metadata.
12. Should lawyers edit Skill 1 or Skill 2 outputs in the app? Answered: no.
    These are generated Library artifacts. Lawyers edit downstream drafts, not
    the canonical source inventory or chronology rows.
