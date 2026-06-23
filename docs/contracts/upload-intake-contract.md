# Upload Intake Contract

Status: Current canonical contract

This contract defines how Matter Workbench plans source-file uploads before any
filesystem or runtime DB write occurs.

The rule is simple:

```text
same submitted matter + files + browser paths -> same intake plan
```

Filesystem storage and runtime DB storage may persist the plan differently, but
they must not disagree about matter identity, upload path validation, duplicate
handling, or add-files intake numbering semantics.

## Why This Exists

Matter upload is the first custody boundary. It is also where local filesystem
mode and runtime DB mode are most likely to drift.

Upload planning therefore must be deterministic, side-effect free, and shared.
Storage-specific code may allocate DB IDs, write files, or materialize folders
after planning, but it must not fork the product contract.

## Planner Boundary

`services/intake/` is the internal intake boundary for source candidates and
browser-upload adapter behavior.

`shared/upload-intake-planner.mjs` still owns the canonical deterministic upload
planning rules used by that boundary.

The planner must remain pure:

- no database reads or writes;
- no filesystem reads or writes;
- no provider calls;
- no matter artifact mutation;
- no dependence on the active matter store;
- deterministic output for deterministic input and `now`.

Allowed inputs are plain values: submitted matter name, metadata, uploaded file
array shape, browser-relative paths, intake label, allocation numbers, received
date, and `now` where a date fallback is needed.

The current browser upload path enters the boundary through
`services/intake/browser-upload-adapter.mjs`. Future source adapters must produce
the same candidate/batch shape before they ask storage-specific code to persist
bytes or allocate source numbers.

Each intake batch also carries a read-only sizing report from
`services/intake/intake-sizing-report.mjs`. The report classifies the candidate
set by file count, total size, largest file, and broad file-type mix, then
recommends one preparation mode:

- `immediate`;
- `batched`;
- `background`;
- `needs_review_before_processing`.

This report is advisory. It must not perform I/O, call providers, allocate file
numbers, write custody rows, or silently change preparation behavior. Its first
job is observability: help the app and operator distinguish a small upload from
a medium, large, or risky intake before later scheduler work consumes the same
signal.

Storage-specific adapters may add:

- runtime DB matter IDs, intake row IDs, upload session IDs, and import batch
  IDs;
- filesystem destination roots;
- existing-matter collision checks;
- prior hash indexes and post-write duplicate reports;
- write queues, locks, and materialization.

## Matter Identity

A submitted matter caption is lawyer-facing input. A storage name is a safe
folder/object identity derived from that caption.

Canonical behavior:

- blank or invalid captions fail with `upload.invalid_matter_name`;
- lawyer captions such as `State/Rajesh Mehra` are accepted;
- unsafe path separators and filesystem-hostile characters are normalized into a
  safe storage name;
- matter metadata keeps the legal caption where appropriate;
- collision checks use the storage collision key, not raw caption text.

New-matter upload planning returns both:

- the derived `storageName` / folder name;
- normalized matter metadata suitable for `matter.json` or runtime DB matter
  metadata.

## Uploaded Files And Relative Paths

Every uploaded file must have exactly one browser-relative path.

Canonical behavior:

- zero files fail with stable code `upload.no_files_attached`;
- a non-array `paths` value or a paths/file-count mismatch fails with HTTP 400;
- relative paths are normalized by `shared/upload-path-policy.mjs`;
- duplicate relative paths are rejected before storage writes;
- duplicate checks are case-insensitive and separator-normalized;
- unsafe paths are rejected before storage writes.

Rejected unsafe paths include paths that attempt to escape the destination root,
absolute paths, hidden/system paths where policy forbids them, and other values
that cannot be safely resolved under an intake source-files directory.

## New Matter Intake

Creating a matter always plans an initial intake equivalent to:

```text
00_Inbox/Intake 01 - Initial/Source Files
```

The planner validates upload inputs and normalizes matter identity/metadata.
Filesystem mode then writes the files and runs matter initialization. Runtime DB
mode creates custody rows and DB-backed payload records using the same planned
relative paths and metadata.

## Add-Files Intake

Adding files to an existing matter plans a numbered intake from storage-specific
allocation inputs:

- `intakeNumber`;
- `fileIdStart`;
- `label`;
- `receivedDate` or a `now` fallback.

Canonical output includes:

- `intakeId`, such as `INTAKE-03`;
- `intakeDirName`, such as `Intake 03 - 2026-06-15 Follow Up`;
- `intakeDir`, such as `00_Inbox/Intake 03 - 2026-06-15 Follow Up`;
- normalized upload relative paths;
- normalized positive `fileIdStart`.

Filesystem mode may compute allocation from existing registers under a matter
write queue. Runtime DB mode may reserve allocation under a DB row lock. After
allocation, both modes must consume the same shared add-files planner.

## Error Semantics

Upload-intake errors should remain stable enough for UI handling and beta bug
triage.

Current stable examples:

| Condition | Status | Code |
| --- | ---: | --- |
| Missing source files | 400 | `upload.no_files_attached` |
| Invalid/blank matter name | 400 | `upload.invalid_matter_name` |
| Duplicate upload paths | 400 | `upload.duplicate_paths` |
| Matter name collision | 409 | storage collision message |
| Missing runtime DB allocation IDs | 500 | runtime allocation failure |

Do not replace these with generic provider, filesystem, or database failures.

## Parity Requirement

Any future change to upload planning must prove parity between shared planning
and runtime DB planning for at least:

- new matter identity and metadata;
- upload relative path normalization;
- duplicate/unsafe path failures;
- add-files intake numbering and directory naming;
- add-files file ID start allocation shape.

`test/upload-intake-planner-parity.test.mjs` is the contract guard for this
boundary. Add cases there before introducing storage-mode-specific behavior.

## Non-Goals

This contract does not introduce:

- balances, credit enforcement, or billing;
- model/provider calls;
- archive extraction policy;
- deep document type classification beyond broad sizing-report buckets;
- post-write duplicate-of-prior reporting;
- broad runtime DB/storage rewrite.

Those concerns belong to later stages after the upload-intake plan is accepted
and persisted safely.
