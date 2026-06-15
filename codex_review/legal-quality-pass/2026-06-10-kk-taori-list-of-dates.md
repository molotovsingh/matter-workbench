# Legal Quality Pass: KK Taori vs Roma Builders - List of Dates

Date: 2026-06-10
Artifact reviewed: `/Users/aksingh/matters-matter-workbench/KK Taori vs Roma Builders/10_Library/List of Dates.json` and `.md`
Generated at: 2026-05-25T10:23:23.808Z
Engine: `create-listofdates-v1-ai`
Model route: `openrouter / openai/gpt-4.1`

## Verdict

Useful as an internal working chronology, but not ready as a lawyer-facing or filing-ready List of Dates without review.

The artifact is materially useful because it is source-backed, complete enough to show the transaction arc, and includes later property-tax / maintenance / procedural events. The main problem is legal curation: it is too expansive, marks every row as client-favourable, and contains a few identity or inference risks that could mislead a lawyer if used uncritically.

## What Is Strong

- 107 chronology rows were generated from 12 labelled source documents.
- Every checked row has a source label and citation; no broken `FILE-NNNN` source mapping was found.
- No missing date rows were found.
- Source Index reports 12 sources and 0 source-label rows needing review.
- The chronology captures the main dispute path:
  - initial quotation / allotment;
  - payment schedule and major payments;
  - delayed possession communications;
  - interest / compensation dispute;
  - registration and stamp-duty demands;
  - occupation-certificate / completion notices;
  - property-tax and maintenance demands;
  - 2026 calculation-sheet procedural update.

## Findings

### P1 - Flat / party identity drift needs lawyer review before reliance

Some rows appear to mention flats or entities that may not be the subject flat or may be OCR/source-specific context rather than the client’s actual unit.

Examples:

- Row 1: says `Roha Builders Pvt Ltd` and `Flat No. 1402`, while the matter is against Roma Builders and appears centered on Flat No. 1202.
- Rows 5-6: refer to `Basilius flat 1201`.
- Row 33: refers to possession of `flat 1401`, while the row relevance is framed as if it supports the client’s delayed-possession case generally.

These may be legitimate related-flat references, but the chronology should not treat them as the client’s main flat unless confirmed.

Recommended action: add a lawyer-review flag when an event’s flat number or named builder differs from matter metadata or the dominant source identity.

### P1 - Row 53 appears to overstate interest terms beyond the shown excerpt

Row 53 states that interest accrued till 31 August 2014 would be compounded at 10% per month until final payment. The row’s source excerpt shown in the JSON only says:

> There has never been any agreement on payment of interest on delayed possession whatsoever.

That excerpt supports denial of delayed-possession interest. It does not, by itself, support the full compounded-interest formulation in the event text.

Recommended action: review row 53 against the underlying scan/email before relying on the `10% per month` language.

### P1 - Perspective classification is not legally reliable

All 107 rows are marked `client_favourable`.

That cannot be right as a legal classification. The chronology includes respondent demands, builder denials, property-tax claims, maintenance bills, and procedural service by Roma Builders. Some rows may be neutral, mixed, or adverse to the client.

Recommended action: do not use `perspective` for lawyer-facing analysis until it is recalibrated. For now, treat it as non-authoritative metadata.

### P2 - The chronology is too verbose for lawyer use

107 rows from 12 documents is good for audit, but too dense for a clean case chronology.

The artifact includes many payment receipts, tax payments, maintenance bills, and repeated demands. These are useful, but should likely be separated into:

- Core dispute chronology;
- Payment ledger;
- Property tax / maintenance ledger;
- Procedural chronology.

Recommended action: preserve this as a verbose audit chronology, then generate a condensed lawyer chronology from it.

### P2 - Duplicate or near-duplicate event found

Rows 34 and 35 both summarize the same 21 July 2014 email from Krishnakumar Taori to Prakash Shah about delayed possession and limiting interest to 31 August 2014.

Recommended action: merge duplicate date/source/event clusters where they come from repeated email blocks or repeated pages.

### P2 - 2026 procedural rows are useful, but should be separated

Rows 106 and 107 concern the Commission order requiring calculation sheets and advance service of those sheets.

They are important, especially for current case handling, but they are procedural-current-status rows. They should not be visually mixed with merits/payment chronology without sectioning.

Recommended action: split `procedural history / current directions` from the older transaction chronology.

### P3 - Source labels are suggested, not confirmed

Source Index shows `label_status: suggested` for sampled sources. `needs_review` is false, but that is not the same as lawyer-confirmed labels.

Recommended action: before generating court-facing chronology, confirm source labels for the core sources.

## Legal-Use Guidance

Use this artifact today for:

- internal matter orientation;
- finding important source documents;
- identifying payment / delay / registration / tax themes;
- drafting questions for client or counsel review.

Do not use it directly for:

- filing-ready List of Dates;
- final legal submissions;
- limitation analysis;
- precise amount computation;
- deciding whether the client or builder is in default.

## Suggested Product Improvements

1. Add a legal-quality QA layer after List of Dates generation.
2. Flag identity drift: different flat number, different builder name, different complainant/respondent.
3. Flag all-one-side perspective results.
4. Split verbose chronology into sections:
   - core dispute;
   - payment ledger;
   - property tax / maintenance;
   - procedural history.
5. Add duplicate-event clustering for same date + same source + similar event text.
6. Make "lawyer-facing condensed chronology" a separate output from "audit chronology".

## Bottom Line

The List of Dates is powerful and materially useful, but it is still an audit-grade generated chronology. Its source discipline is good; its legal judgment layer needs review and tightening.

For this matter, the highest-risk items are the flat-number drift, the unsupported-looking interest formulation in row 53, and the fact that every row is marked client-favourable.
