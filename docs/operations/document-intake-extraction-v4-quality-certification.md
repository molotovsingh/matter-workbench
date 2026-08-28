# V4 Human Quality Certification

Status: **pending expanded human adjudication and threshold approval**.

The frozen Mistral→Gemini output is a non-inferiority reference only. It is not human truth. `services/document-intake-extraction/readiness/quality-certification.mjs` accepts only a final human-verified manifest summary and candidate measurements against that truth.

## Minimum human set

- at least 15 primary/repair disagreement pages, dual-adjudicated;
- at least 10 native-text pages;
- at least 10 difficult archival/transitional pages; and
- opaque sample IDs and source-page SHA-256 values so every arm runs the identical pages.

The certification summary contains counts and metrics, not filenames or document text. Restricted adjudication materials remain in the read-only PDFEval workspace.

## Hard gates before scoring

1. every required class minimum is met;
2. every sample is final and human verified;
3. every arm covers exactly the golden samples;
4. no page is omitted or incomplete;
5. every legal-critical field is retained; and
6. micro-aggregated WER and CER meet independently approved thresholds.

An arm failing any hard gate receives no composite score. Only eligible arms use 70% quality / 30% speed ranking. Models and adapters must be pinned; aliases such as `latest` are rejected.

## Current evidence and gap

PDFEval Gold30 showed strong results (Mistral OCR 4.1: 0.95% WER, 0.36% CER, 54/54 fields; direct Gemini 3.7 default thinking: 0.05% WER), but only one verified excerpt exercised repair. V3 also showed Mistral document-local ranges as the speed leader and Gemini 3.7 LOW as a fast repair tier. This is not enough to establish repair equivalence or final route policy.

Next evidence must expand the manifest, approve final WER/CER thresholds, then re-run Mistral OCR 4.1, Gemini 2.5/3.7, OvisOCR2, Textract, Google Document AI, Azure Document Intelligence, and any local/GPU candidate on the same samples. Keep `V4-QUALITY-001` pending until independent review accepts the manifest, thresholds, legal-field results, and selected route.
