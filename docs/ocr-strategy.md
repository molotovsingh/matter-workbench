# OCR Strategy Note

Matter Workbench has a solid deterministic extraction path for born-digital
documents. PDFs now use a quality-first OCR posture because weak extraction
poisons Source Labels, List of Dates, and downstream drafting.

## Decision

For PDF files, use OCR as the trusted primary source whenever Mistral OCR is
configured. Use PDF.js text-layer extraction as diagnostic/fallback support, not
as the primary legal source text when OCR is available.

Current benchmark evidence from `/Users/aksingh/pdf-extraction-eval` points to this operating posture:

- **Mistral OCR** is the primary PDF OCR provider.
- **Gemini OCR repair** runs when there is any quality doubt and is accepted
  when it is page-complete and non-empty.
- OCR output must be normalized before it becomes an `extraction-record/v1` record. Provider markdown is useful as an intermediate format, but downstream skills need clean block text.
- Page and block citation boundaries remain mandatory. A scanned page still has to produce stable handles like `FILE-0007 p3.b2`.

## Integration Rule

The extractor owns citation shape. OCR providers only provide text, page numbers, confidence, and warnings.

That keeps the important invariant intact:

```text
provider text in, extraction-record/v1 out
```

The provider must not invent `FILE-NNNN` citations, rewrite `source_path`, move files, or mutate canonical intake metadata.

## First Runtime Shape

The runtime shape is intentionally boring:

1. Read the PDF with PDF.js for page count and text-layer diagnostics.
2. If `MISTRAL_API_KEY` is configured, run the OCR chain first.
3. Strip provider markdown into plain text blocks.
4. Preserve source page order.
5. Write normal `extraction-record/v1` records and flat text companions.

The first provider is configured by key presence:

```text
MISTRAL_API_KEY=...
GEMINI_API_KEY=... # optional repair pass
```

Without `MISTRAL_API_KEY`, `/extract` falls back to the deterministic
non-provider behavior and records OCR/layout warnings where appropriate.

## Quality Gates

An OCR pass is useful only if it improves the record while preserving traceability:

- Every output block must belong to exactly one source page.
- Every block id is assigned by Matter Workbench, not the provider.
- Markdown headings, bullets, tables, and fences are normalized into readable text.
- Low confidence pages stay marked `needs_review`.
- Missing confidence is `unknown`, not automatically low confidence.
- Failed OCR may fall back to the text-layer record, but the extraction log and
  advisory must keep the warning visible.

The legal user should never have to care which OCR model ran. They should see better source-backed text and the same citation handles.
