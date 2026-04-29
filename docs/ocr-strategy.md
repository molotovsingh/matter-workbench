# OCR Strategy Note

Matter Workbench already has a solid deterministic extraction path for born-digital documents. The next OCR work should extend that path instead of replacing it.

## Decision

Use deterministic extraction first. Use OCR only when the source is scanned, text-poor, or otherwise has no usable text layer.

Current benchmark evidence from `/Users/aksingh/pdf-extraction-eval` points to this operating posture:

- **Mistral OCR** is the default candidate for scanned PDFs. It is fast, comparatively cheap, and close enough on quality to justify the first integration path.
- **Gemini Flash** is a fallback candidate for low-confidence, failed, or high-value documents where the first OCR pass is not good enough.
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

The first app integration should be boring on purpose:

1. Try the existing PDF text-layer extractor.
2. If pages are text-poor, allow an OCR provider boundary to supply page text.
3. Strip provider markdown into plain text blocks.
4. Preserve source page order.
5. Write normal `extraction-record/v1` records and flat text companions.

No automatic model fallback should be added in this slice. Fallback can come later after we have confidence metadata, error classes, and a review workflow.

## Quality Gates

An OCR pass is useful only if it improves the record while preserving traceability:

- Every output block must belong to exactly one source page.
- Every block id is assigned by Matter Workbench, not the provider.
- Markdown headings, bullets, tables, and fences are normalized into readable text.
- Low confidence pages stay marked `needs_review`.
- Failed OCR should leave the deterministic `ocr_required` signal in place rather than pretending extraction succeeded.

The legal user should never have to care which OCR model ran. They should see better source-backed text and the same citation handles.
