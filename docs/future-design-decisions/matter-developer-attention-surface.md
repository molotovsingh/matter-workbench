# Matter Developer Attention Surface

## Problem

Matter Workbench already writes useful traces: intake registers, extraction logs, Source Index metadata, List of Dates sidecars, rerun advice, command interaction JSONL, and custom-skill run receipts.

The problem is that those traces are scattered. A developer can reconstruct what broke, but only by knowing every artifact and every failure convention. That makes the detection loop too dependent on a lawyer noticing bad behavior.

The product needs a matter-level view of:

- what is broken in this matter;
- what needs developer attention;
- which existing artifact proves it;
- whether the issue blocks the workflow or is only a warning.

## First Implementation Contract

The first slice is read-only.

Endpoint:

```text
GET /api/matter-attention
```

Schema:

```text
matter-attention/v1
```

The endpoint requires an active matter, just like `/api/matter-status`.

Developer tooling may also inspect a named matter without switching the active matter:

```text
GET /api/matter-attention?matter=Atlas%20Constuction%20vs%20Diptishree
```

There is also a read-only command-line report for sweeping the configured matters home:

```sh
npm run matter-attention:report -- --only-problems
```

Useful variants:

```sh
npm run matter-attention:report -- --matter "Ayesha Vs Japan Airlines"
npm run matter-attention:report -- --json
npm run matter-attention:report -- --matters-home /absolute/path/to/matters
```

The CLI uses the same service as the API. It does not switch the active matter and does not write to matter folders.

It does not:

- write new logs;
- run skills;
- call providers;
- mutate matter artifacts;
- decide lawyer-facing workflow policy.

It only aggregates existing evidence into one developer-facing response.

## Attention Categories

Initial categories:

- `intake`
- `extraction`
- `source_labels`
- `chronology`
- `custom_skill`
- `command`

Initial severities:

- `blocker`: the matter lifecycle is structurally broken or a required artifact is unreadable.
- `warning`: the matter can continue, but developer review is prudent.
- `info`: reserved for future non-urgent signals.

## Current Evidence Sources

The first version reads:

- `matter.json`
- `00_Inbox/*/File Register.csv`
- `00_Inbox/*/Extraction Log.csv`
- `10_Library/Source Index.json`
- `10_Library/List of Dates.md`
- `10_Library/List of Dates.json`
- rerun advice from `matter-status-service`
- configurable custom-skill run receipts
- command interaction JSONL

## Examples Of Surfaced Issues

Intake:

- missing or invalid `matter.json`;
- no intake folders;
- missing or unreadable `File Register.csv`;
- working copies referenced by the register are missing;
- files classified as `Needs Review`.

Extraction:

- extraction rows marked `failed`;
- rows marked `ocr-required-all`;
- skipped unsupported files.

Source Labels / Document Index:

- missing Source Index after extraction exists;
- unreadable Source Index;
- missing `sources[]`;
- source labels marked `needs_review`;
- lawyer-visible labels that expose developer identifiers such as `FILE-0001`, hashes, or workspace paths.

Chronology / List of Dates:

- unreadable `List of Dates.json`;
- markdown exists without JSON metadata;
- JSON exists without markdown;
- Source Labels exist but List of Dates is missing;
- stale dependency state from rerun advice.

Custom skills:

- failed custom-skill run receipts;
- custom-skill run warnings.

Commands:

- failed active-matter command interactions.

## Why This Shape

This keeps observability close to the matter lifecycle without creating a second logging system. The app already has trace artifacts. The missing layer was a deliberate reader that says: “for this matter, here is what deserves developer attention.” Command interaction JSONL is owned by `services/command-interaction-log-service.mjs`, including serialized appends and recent-entry reads; the attention service consumes that boundary rather than owning command-log parsing.

That is also why this is not lawyer-facing yet. The wording, severity, and evidence paths are meant for developers. A later UI can choose how much of this to show in Settings, Activity, or an admin/debug panel.
