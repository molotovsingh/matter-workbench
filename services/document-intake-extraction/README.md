# Document Intake & Extraction Service (V4)

Clean-sheet, isolated service implementation. It is not imported by Matter Workbench, mounted on production routes, included in production builds, or copied by the private-beta deploy.

The first vertical slice uses filesystem adapters to prove contracts, immutable custody, server hashing, tenant-scoped single-flight deduplication, durable page work, fencing, provider evidence, validation, complete assembly, and ready-event semantics. Its isolated `/v1` HTTP handler requires injected authentication/matter authorization, never accepts document-byte uploads, and is not mounted by the app.

`postgres/` now owns an independent migration chain for the future durable control plane, including forced tenant RLS, idempotent intake keys, content references, single-flight computation fingerprints, weighted demands, `SKIP LOCKED` claims, lease heartbeats, attempts, complete cost evidence, result versions, and an outbox. It does not modify legacy tables. `adapters/s3-compatible-object-store.mjs` defines direct regional upload authorization and streamed immutable-custody verification without buffering large payloads through Matter Workbench. The filesystem control state remains the vertical-slice runtime until the service is moved onto dedicated PostgreSQL repositories.

See:

- `docs/architecture/document-intake-extraction-v4.md`
- `docs/acceptance/document-intake-extraction-v4.matrix.json`
- `packages/extraction-contracts/`
- `workers/document-processing/`

Run isolated evidence:

```bash
node --test test/document-intake-extraction-v4*.test.mjs
```
