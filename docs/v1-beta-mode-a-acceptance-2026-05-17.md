# V1 Beta Mode A Acceptance - 2026-05-17

Mode A means testing the beta path from a clean matter state: keep `matter.json` and the real source files, move generated/imported artifacts to backup, then import/prepare/extract/label/generate again.

This pass was run because old artifacts can hide first-run bugs that beta users will hit.

## Backup And Reset

Reset manifest:

```text
/Users/aksingh/matter-workbench-backups/v1-beta-mode-a-20260517T022831Z/reset-manifest.json
```

Backup root:

```text
/Users/aksingh/matter-workbench-backups/v1-beta-mode-a-20260517T022831Z
```

The reset covered six real matters and excluded dummy matters. Source files were copied into the backup with hashes before matter folders were reduced to clean metadata state.

## Initial Acceptance Results

Generated reports:

```text
/Users/aksingh/matter-workbench-backups/v1-beta-mode-a-20260517T022831Z/acceptance-report.json
/Users/aksingh/matter-workbench-backups/v1-beta-mode-a-20260517T022831Z/acceptance-report-remaining.json
```

Initial result:

| Matter | Initial Result | Main Finding |
|---|---:|---|
| Atlas Constuction vs Diptishree | Passed | Runtime path worked; 6 source labels need review. |
| Ayesha Vs Japan Airlines | Failed | Source Labels timed out in one large provider request; List of Dates still generated. |
| Bharat Nagpal Vs Gionee India | Passed | Runtime path worked; 7 source labels need review. |
| Kamran vs NCT | Passed | Runtime path worked; duplicate/skipped-file warnings correctly surfaced. |
| Mehta vs Skyline | Failed | Source Labels failed on a model-copied `sha256` mismatch for `FILE-0006`; later steps lost active matter context in the harness run. |
| Techbeliever Vs GST | Failed | Source Labels timed out; chronology took longer than Node fetch's default 300-second header timeout. |

## Fixes Made

1. Source identity is now backend-owned during Source Labels validation.

The model may still echo `sha256` and `source_path`, but the persisted `Source Index.json` now takes those fields from the extraction packet. The model is responsible for labels, classification, parties, dates, confidence, warnings, and evidence citations, not source identity.

This fixed the Mehta `sha256 mismatch for FILE-0006` failure.

2. Source Labels now batch large matters.

Default batch size is 8 source packets per provider call, configurable through:

```text
SOURCE_DESCRIPTOR_BATCH_SIZE
```

This fixed the Ayesha and Techbeliever source-label timeout class.

3. The Mode A acceptance harness no longer uses Node fetch for long JSON API calls.

Multipart upload still uses fetch, but JSON GET/POST calls now use `http.request` / `https.request` with explicit harness timeouts. This avoids Undici's default headers timeout on long native skill runs.

## Targeted Rerun Results After Fixes

Without re-uploading files or creating new intakes, the failed backend steps were rerun from the current clean-slate matter state.

| Matter | Source Index | List of Dates | Notes |
|---|---:|---:|---|
| Atlas Constuction vs Diptishree | 9 sources | 50 entries | Initial pass already succeeded. |
| Ayesha Vs Japan Airlines | 18 sources, 3 batches | 45 entries | Source-label timeout fixed. |
| Bharat Nagpal Vs Gionee India | 14 sources | 74 entries | Initial pass already succeeded. |
| Kamran vs NCT | 8 sources | 12 entries | Initial pass already succeeded. |
| Mehta vs Skyline | 10 sources, 2 batches | 26 entries | Model-copied identity mismatch fixed. |
| Techbeliever Vs GST | 14 sources, 2 batches | 227 entries | Source Labels fixed; chronology is long-running but artifacts are produced. |

## Final Clean Acceptance Run

After the targeted recovery, a fresh Mode A reset was run again from source files and matter metadata.

Final reset manifest:

```text
/Users/aksingh/matter-workbench-backups/v1-beta-mode-a-20260517T101038Z/reset-manifest.json
```

Final acceptance report:

```text
/Users/aksingh/matter-workbench-backups/v1-beta-mode-a-20260517T101038Z/acceptance-report-final.json
```

Final result:

```text
6/6 passed, 0 failed
```

| Matter | Result | Source Labels | List of Dates | Developer Attention |
|---|---:|---:|---:|---:|
| Atlas Constuction vs Diptishree | Passed | 9 sources | 52 entries | 1 item |
| Ayesha Vs Japan Airlines | Passed | 18 sources | 49 entries | 5 items |
| Bharat Nagpal Vs Gionee India | Passed | 14 sources | 87 entries | 3 items |
| Kamran vs NCT | Passed | 8 sources | 10 entries | 4 items |
| Mehta vs Skyline | Passed | 10 sources | 28 entries | 3 items |
| Techbeliever Vs GST | Passed | 14 sources | 217 entries | 3 items |

Additional hardening added before this final run:

- Source Labels retries transient provider failures per batch before failing the whole matter.
- OpenRouter Source Labels failures now preserve upstream/provider error detail instead of collapsing to a generic provider error.

## Current Matter Attention State

All six real matters now have both:

```text
10_Library/Source Index.json
10_Library/List of Dates.json
```

Remaining attention items are warnings, not blockers:

- source labels marked `needs_review`;
- unsupported/skipped files to review for materiality;
- old custom-skill warnings from prior runs;
- older command failure log entries in some matters.

These are useful beta diagnostics. They do not mean the Mode A runtime path is broken.

The only blocker in the full problem-only attention report is still an out-of-scope dummy matter, not one of the six real Mode A matters.

## Verification

Targeted regression:

```sh
node --test test/source-descriptors-engine.test.mjs
```

Result:

```text
21/21 passed
```

Full suite:

```sh
npm test --silent
```

Result:

```text
463/463 passed
```

## Residual App Risk

The largest matter, Techbeliever, showed that List of Dates can run longer than the default Node fetch header timeout used by test scripts. The harness has been hardened and the final clean Mode A run passed, but the product still needs clearer long-running progress semantics for very large native skills.

The next technical focus should not be more broad UI. It should be reliability around long native-skill calls: progress reporting, long-call timeout policy, and whether very large chronology jobs should be split further or run as background jobs with receipts.
