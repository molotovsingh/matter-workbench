# Extraction Contracts

Versioned, provider-neutral contracts between Matter Workbench and the clean-sheet Document Intake & Extraction Service.

## Boundary rules

- Matter Workbench may eventually depend on this package, but not on service internals, provider adapters, workers, or processing tables.
- The V4 service must not import production routes, the legacy extraction engine, runtime-DB processing services, or React code.
- Every provider model used in controlled or production work must be pinned. Mutable `latest`, `current`, and `auto` aliases are rejected.
- Every page in a published result has an explicit `accepted` or `review_required` outcome.
- Contract schema versions change only through additive compatible evolution or an explicit new major version.

This package currently has no production caller. Its isolation is enforced by `test/document-intake-extraction-v4-isolation.test.mjs`.
