# Spreadsheet Understanding

Date: 2026-05-21
Status: Parked future feature

## Problem

Matter Workbench can ingest spreadsheets today, but it mostly treats them as
flattened text.

For simple sheets, that is useful. Rows like:

```text
Date | Event | Amount
```

can enter Source Labels, List of Dates, and Copilot context.

But a lawyer usually does not learn from a spreadsheet by reading each row as
plain text. The useful legal meaning may be:

- what the sheet is tracking;
- which columns matter legally;
- whether totals, payments, invoices, or due dates match;
- which rows show default, delay, possession, demand, receipt, or compliance;
- whether formulas, merged cells, hidden rows, formatting, or visual grouping
  change the meaning.

The current extractor does not understand those things. It preserves access to
the data, but it does not yet turn spreadsheet structure into a lawyer-facing
source understanding.

## Current Behavior

Current V1 behavior should stay as-is for now:

- `.csv` and `.xlsx` are classified as `Spreadsheets`.
- `.xls` is registered but skipped during extraction because legacy binary Excel
  is not supported.
- each sheet becomes a page in the extraction record;
- each row becomes a `table_row` block;
- cells are joined with ` | `;
- spreadsheet pages are marked `needs_review` because table flattening can lose
  layout and meaning.

This is acceptable as an ingestion baseline, not as the final product answer.

## Future Direction

Add a dedicated spreadsheet-understanding pass only after the current extraction
and preparation path is stable.

The future pass should produce a structured interpretation, not just OCR text:

- sheet purpose;
- table boundaries;
- header detection;
- legally important columns;
- key dates, amounts, parties, invoice numbers, payment references, and status
  fields;
- formulas/totals if legally relevant;
- hidden rows/columns or unusual workbook features;
- layout-risk warnings;
- important row excerpts with stable citations back to source rows/sheets.

The output should feed Source Labels, List of Dates, Evidence Gaps,
Contradictions, and Copilot. It should not be presented as a lawyer-edited draft.

## Screenshot / Vision Fallback

Spreadsheet screenshots are not the primary strategy.

Primary extraction should remain structured cell parsing because spreadsheets
already contain machine-readable rows, dates, formulas, and sheet names.

Screenshots or rendered sheet previews may be useful as a second pass when:

- meaning depends on visual grouping;
- merged cells or formatting carry legal meaning;
- the sheet is print-layout style;
- images are embedded inside the workbook;
- structured parsing produces confusing or obviously thin output.

The system should store structured cell extraction as the canonical source and
use screenshot/vision output only as repair/advisory context.

## Non-Goals For Now

- Do not change the current `.csv` / `.xlsx` extraction path.
- Do not add screenshot rendering today.
- Do not add a new native skill today.
- Do not route every spreadsheet through vision/OCR.
- Do not treat spreadsheet understanding as a substitute for lawyer review.

## Revisit Trigger

Revisit this when beta testing shows that spreadsheets are common and legally
material, especially in matters involving:

- payments;
- invoices;
- delay ledgers;
- possession or allotment tables;
- bank/account summaries;
- document indexes supplied as spreadsheets;
- claim computation sheets.

The first implementation slice should be a read-only spreadsheet summary and
risk analysis, not a drafting feature.
