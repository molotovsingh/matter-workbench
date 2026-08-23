# Upload + Extract v2 Experiment

A standalone, repo-local experiment for high-volume matter upload and extraction.

## Hard boundary

- Nothing under this directory is imported by production routes, services, schemas, builds, or deployment units.
- The source runtime database is read-only to the experiment.
- Upload custody, extraction checkpoints, outputs, and reports live under an explicitly supplied experiment root.
- There is no production integration step in this experiment. After the real benchmark, stop and review the evidence.

## Problem under test

The experiment separates three workload shapes:

1. many files: upload request overhead, bounded scheduling, and queue fairness;
2. large files: streaming custody, extraction/OCR time, timeout behavior, and bounded memory;
3. mixed matters: durable checkpoints, restart recovery, provider throttling, and aggregate wall time.

## v2 design

- streamed, per-file HTTP uploads with SHA-256 and size verification;
- idempotent session creation and file PUTs;
- resumable concurrent upload with a bounded client pool;
- commit-time filtering of machine junk and Office lockfiles;
- atomic on-disk session manifests;
- bounded per-document extraction using the existing production extractor implementations;
- per-document extraction checkpoints and atomic text/JSON outputs;
- restart recovery that re-runs only in-flight work, not completed files;
- provider HTTP usage/timing capture without recording document bodies;
- a deliberate stop/resume mode for real-data recovery proof without a second full paid run.

## CLI

```bash
node experiments/upload-extract-v2/cli.mjs help
```

Key commands:

```bash
# Read-only export of a committed runtime upload into an isolated fixture.
node experiments/upload-extract-v2/cli.mjs snapshot \
  --session-id <uuid> --batch-id <uuid> --tenant-id <uuid> --out <fixture-dir>

# Standalone upload server (bind to loopback; use an SSH tunnel for a remote client).
V2_UPLOAD_TOKEN=<token> node experiments/upload-extract-v2/cli.mjs serve \
  --root <experiment-root> --host 127.0.0.1 --port 4299

# Upload/resume the fixture.
V2_UPLOAD_TOKEN=<token> node experiments/upload-extract-v2/cli.mjs upload \
  --fixture <fixture-dir> --base-url http://127.0.0.1:4299 \
  --session-id rashmi-real-v2 --concurrency 4

# Run a bounded real extraction. A first pass can stop cleanly after N files;
# the next invocation resumes the remaining files.
node experiments/upload-extract-v2/cli.mjs extract \
  --root <experiment-root> --session-id rashmi-real-v2 \
  --concurrency 2 --stop-after 20

node experiments/upload-extract-v2/cli.mjs extract \
  --root <experiment-root> --session-id rashmi-real-v2 --concurrency 2

# Capture the existing production run as the read-only v1 baseline and compare.
node experiments/upload-extract-v2/cli.mjs baseline \
  --tenant-id <uuid> --matter-id <uuid> --job-id <uuid> \
  --extraction-log-key '<object-key>' --out <baseline.json>

node experiments/upload-extract-v2/cli.mjs report \
  --root <experiment-root> --session-id rashmi-real-v2 \
  --baseline <baseline.json> --out <report.json>
```

The snapshot and baseline commands read `MWB_RUNTIME_DATABASE_URL` (or `DATABASE_URL`) and never issue a write query.

## Evidence rules

A faster result is accepted only if v2 also proves:

- the same real source payload set was accepted;
- filtered-file behavior is accounted for;
- no source file silently disappears;
- extraction success/unsupported/failure counts are reported;
- page-count and OCR coverage are compared where v1 evidence exists;
- pause/resume does not repeat completed provider work;
- peak RSS and actual provider HTTP usage are recorded;
- all claims distinguish controlled measurements from directional comparisons.
