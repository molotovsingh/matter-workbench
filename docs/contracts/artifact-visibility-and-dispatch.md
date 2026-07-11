# Artifact Visibility And Dispatch

Status: Current canonical contract

This contract defines how Matter Workbench should classify, show, hide, and
freeze matter artifacts.

The core rule is:

```text
lawyers see work products and review cues
developers can inspect audit machinery when needed
dispatch copies are frozen boundaries
```

Do not make every file in a matter folder look equally lawyer-facing.

## Why This Exists

The matter folder contains mixed material:

- client/source files;
- extraction and indexing records;
- generated source-record artifacts;
- generated legal analysis;
- lawyer-editable drafts;
- dispatch or filing copies;
- run receipts, candidate ledgers, provider metadata, and debug evidence.

Those files are not the same kind of product surface.

If the UI exposes all of them with equal weight, lawyers see implementation
details and may mistake internal audit material for legal work product. If the
UI hides too much, developers cannot diagnose failed or stale matter runs.

This contract keeps both needs explicit.

## Artifact Classes

Use these classes when deciding visibility, naming, and default UI placement.

| Class | Meaning | Default lawyer UI |
| --- | --- | --- |
| `source_original` | Client-provided or imported source file. | Visible as original/source material. |
| `source_control` | File register, extraction log, source index, source metadata. | Visible only as friendly status or source-record summaries by default. Technical files may appear when `Show technical` is enabled. |
| `library_artifact` | Generated source-record work such as Source Index or Case Timeline. | Visible as reviewable generated artifacts, not lawyer-edited documents. |
| `analysis_artifact` | Generated matter analysis, maps, notes, or checklists. | Visible as working analysis, with source limits/warnings. |
| `draft_artifact` | Lawyer-editable draft work product. | Visible in Drafts as material the lawyer may edit or use. |
| `dispatch_artifact` | Sent, filed, exported, or ready-to-send copy. | Visible as a preserved dispatch/filed copy, not as the live editable workspace. |
| `internal_audit` | Candidate ledgers, run receipts, provider metadata, validation results. | Hidden by default; available through technical/audit views. |
| `dev_hidden` | Debug traces, raw prompt/provider traces, transient implementation files. | Hidden from normal lawyer UI. |

These are presentation and product classes. They do not require immediate
folder/schema renames.

## Current Folder Lanes

The current local folder lanes remain stable and the matter folder tree should display these canonical names as-is:

| Folder | Contract meaning |
| --- | --- |
| `00_Inbox` | Source intake and deterministic records. |
| `10_Library` | Generated source-control and source-record artifacts. |
| `20_Workshop` | Generated analysis and working legal understanding. |
| `30_Drafts` | Lawyer-editable draft work product. |
| `40_Dispatch` | Preserved send/file/export boundary. |

Do not replace these folder names in the UX-facing tree with aliases such as `Original Documents`, `Source Record`, `Case Analysis`, `Drafts`, or `Ready to Send`. If the folder tree is visible, it shows path identity. Removing the numeric prefixes or renaming the folders requires a separate storage/path migration contract.

## Default Visibility Rules

Normal lawyer-facing views should prefer:

- matter name and client/opposite-party metadata;
- readable source labels;
- generated source-record artifacts;
- draft and dispatch documents;
- preparation/advisory status;
- clear warnings about uncertainty, stale dependencies, or weak extraction.

Normal lawyer-facing views should not expose by default:

- raw `FILE-NNNN` citations as primary labels;
- hashes, storage paths, extraction IDs, provider traces, prompt traces, or
  model debug payloads;
- candidate ledgers and intermediate model outputs;
- raw run receipts unless the lawyer opens technical/audit details;
- implementation details outside the folder tree where they do not carry custody/path identity.

Developer and technical views may expose internal files when they are needed for
diagnosis. Those views should be explicitly marked or tucked behind an advanced
control such as `Show technical`.

## Generated Library Artifacts

Generated Library artifacts are not lawyer-authored drafts.

Examples:

- `10_Library/Source Index.json`;
- `10_Library/Case Timeline.md`;
- `10_Library/Case Timeline.json`.

The lawyer may review them, rely on them with judgment, and rerun/refresh them.
The app should not treat row-level edits to these generated artifacts as
canonical truth unless a future review workflow explicitly promotes such edits.

If the generated artifact is wrong, the preferred path is:

```text
fix source files / labels / metadata -> regenerate or refresh
```

Lawyer notes may exist as comments or annotations, but comments are not facts
until a later review process promotes them.

## Drafts

`Draft` means material the lawyer may actually edit, use, or turn into a filing,
notice, letter, petition, or other legal work product.

Drafts may be AI-assisted, but they are lawyer-owned after review. The app
should preserve source provenance and generation metadata without making the
draft feel like an internal system trace.

Future copilot amendment flows may surgically revise drafts by instruction, but
they should still preserve version/provenance rather than silently mutating
filed or dispatched work.

## Dispatch Boundary

`40_Dispatch` is a boundary.

Once a document is placed in dispatch, sent, filed, or exported as a dispatch
copy, the app should:

- preserve the exact dispatched/filed copy;
- preserve provenance such as draft version, source chronology version, source
  index/document index snapshot or hash, and timestamp where available;
- stop normal rerun suggestions from targeting that dispatched file;
- require a new working draft for further changes;
- never silently overwrite or "improve" the dispatched material.

Dispatch does not delete provenance. It ends normal editing ownership for that
copy.

## Court-Facing Output

Court-facing and dispatch-facing output must not expose developer names,
including:

- `FILE-NNNN` as visible proof text;
- hashes;
- storage paths;
- extraction IDs;
- provider traces;
- prompt traces;
- raw system citations.

Court-facing output should use lawyer-confirmed labels, annexures, exhibits,
paper-book pages, or clean document titles. Raw source identity should remain
available in internal metadata or audit views.

See [Source Identity And Labels](source-identity-and-labels.md) for the
canonical source-label rule.

## Naming Guidance

For lawyer-visible and versioned work product, prefer names that encode date,
job, audience, and status:

```text
YYYY-MM-DD [HHMM IST] - Legal Job - Audience/Status.ext
```

Examples:

```text
2026-05-16 1430 IST - List of Dates - Internal - Not for Circulation.md
2026-05-16 - SLP List of Dates - Court Filing Copy.pdf
```

This is naming guidance, not a migration command for existing files.

## Non-Goals

- This contract does not rename existing folders.
- This contract does not define a full artifact database schema.
- This contract does not implement court export profiles.
- This contract does not make generated Library rows lawyer-editable.
- This contract does not hide developer/audit evidence from technical views.

## Implementation Pointers

Current code and docs connected to this contract include:

- `shared/workspace-lanes.mjs`;
- `services/workspace-service.mjs`;
- `frontend/workspace-tree.js`;
- `react-ui/src/components/workspace`;
- `create-listofdates-engine.mjs`;
- `services/configurable-skill-run-artifacts.mjs`;
- `docs/contracts/source-identity-and-labels.md`;
- `docs/lawyer-facing-list-of-dates.md`.
