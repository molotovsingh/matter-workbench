# Intake Reliability Pack

Status: beta acceptance and operator evidence

Run:

```bash
npm run intake:reliability-pack
```

Optional:

```bash
npm run intake:reliability-pack -- --out-dir .local/intake-reliability-packs --keep-fixture
```

The pack creates a disposable matter, uploads representative intake files,
runs the real deterministic setup and extraction path, builds the current
Preparation Advisory, and writes:

- `intake-reliability-pack.md`
- `intake-reliability-pack.json`

It does not mutate real matters and it does not call live AI providers. The PDF
fixture uses a fake OCR provider so the test exercises the app's OCR-first path
without spending provider credits.

## What It Checks

The representative set covers:

- PDF with a text layer;
- weak scanned PDF;
- EML email;
- CSV spreadsheet;
- XLSX spreadsheet;
- WhatsApp-style `.txt` export;
- image/screenshot;
- WhatsApp-style `.zip` export;
- Outlook `.msg`.

## Status Language

`supported` means the current app extracts useful source text through the normal
pipeline.

`supported_needs_review` means the app extracts source text, but the result is
not safe to treat as clean without lawyer/operator review. This is expected for
weak OCR and flattened spreadsheets.

`supported_limited` means the file is read as source text, but the app does not
yet understand the file's special structure. WhatsApp text exports fall here:
they are plain text today, not structured chat evidence.

`preserved_only` means the file is kept and may be previewable, but it is not
currently extracted into source-backed context. Images/screenshots, archives,
and Outlook `.msg` are examples.

## Current Product Meaning

The intake pack is deliberately conservative. It does not claim that the app can
understand every legal meaning inside every source. It answers the practical beta
question:

> If a lawyer uploads this kind of file, does Matter Workbench read it, preserve
> it, warn about it, or skip it?

## Runtime DB Compatibility

The pack also records the existing runtime DB evidence boundary. Runtime DB
storage mode is covered by:

- `test/runtime-db-api.test.mjs`
- `test/runtime-db-storage-service.test.mjs`
- `npm run db:runtime:write-smoke`

That is where upload, add-files, extraction, preparation, workspace reads, raw
file reads, and materialized write persistence are proved for DB custody.

## What This Does Not Solve

The pack does not implement:

- spreadsheet intelligence beyond flattened rows;
- WhatsApp chat parsing;
- archive unpacking;
- screenshot OCR or vision;
- `.eml` attachment extraction;
- Outlook `.msg` support.

Those stay as future ingestion slices until beta evidence shows they are common
and material.
