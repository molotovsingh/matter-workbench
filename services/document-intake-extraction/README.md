# Document Intake & Extraction Service (V4)

Clean-sheet, isolated service implementation. It is not imported by Matter Workbench, mounted on production routes, included in production builds, or copied by the private-beta deploy.

The first vertical slice uses filesystem adapters to prove contracts, immutable custody, server hashing, tenant-scoped single-flight deduplication, durable page work, fencing, provider evidence, validation, complete assembly, and ready-event semantics. Filesystem control state is single-process reference infrastructure only; production requires owned PostgreSQL transactions and S3-compatible object storage.

See:

- `docs/architecture/document-intake-extraction-v4.md`
- `docs/acceptance/document-intake-extraction-v4.matrix.json`
- `packages/extraction-contracts/`
- `workers/document-processing/`

Run isolated evidence:

```bash
node --test test/document-intake-extraction-v4*.test.mjs
```
