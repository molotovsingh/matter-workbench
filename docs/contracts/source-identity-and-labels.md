# Source Identity And Labels

Status: Current canonical contract

This contract defines the split between internal source identity and
lawyer-facing source labels.

The rule is simple:

```text
raw source identity proves what was read
lawyer-facing labels explain what it is
```

Do not collapse those two ideas.

## Why This Exists

Matter Workbench reads messy legal files and turns them into source-backed
artifacts. The app needs stable machine handles so every generated event,
answer, or draft can be traced back to the exact source block. Lawyers also need
readable labels so they are not forced to reason in `FILE-0001` codes.

Both are necessary.

Internal identity without labels is hard for lawyers to review.
Labels without internal identity are not proof.

## Canonical Internal Identity

The canonical internal source identity is owned by deterministic backend code,
not by an AI model.

Core fields include:

- `file_id`, such as `FILE-0001`;
- `sha256` / content hash;
- `source_path`;
- extraction record path;
- block citation, such as `FILE-0001 p3.b7`;
- extraction/schema version metadata.

These fields are audit handles. They must remain stable enough for source-backed
reasoning, validation, and bug diagnosis.

Provider/model output must not invent or rewrite these values.

## Canonical Citation Handle

The canonical citation handle is:

```text
FILE-NNNN pX.bY
```

That handle is internal and audit-grade. It points to a specific extracted block
inside a specific source file.

Source-backed artifacts should preserve raw citations in structured metadata
even when rendered lawyer-facing text uses readable labels.

## Lawyer-Facing Labels

Lawyer-facing labels are presentation handles.

Good examples:

- `Agreement dated 16 December 2008`;
- `Email from Sharma to Mehta dated 20 April 2026`;
- `District Forum Order dated 27 February 2017`;
- `Notice of Revocation of Power of Attorney dated 21 April 2018`.

Labels may be suggested by a model, derived from filenames, derived from
document text, or confirmed/overridden by a lawyer.

Labels help the lawyer understand the source. They do not prove the source
content. The proof remains the raw citation and extraction record.

## Label Governance Fields

Source labels should support this minimum shape where available:

```text
suggested_label
confirmed_label
label_status: suggested | confirmed | overridden | needs_review
confirmed_by
confirmed_at
label_source: model | filename | document_text | lawyer_override
label_reason
source_id
content_hash
```

A label change is not the same as a document change.

If only a label changes, downstream rendered artifacts may need a cheap refresh.
If source content, hash, document type, date, category, or quality changes,
downstream legal artifacts may need review or regeneration.

## Visibility Rules

Normal lawyer-facing and court-facing output should not expose:

- `FILE-NNNN` as the primary source label;
- hashes;
- storage paths;
- extraction IDs;
- provider traces;
- raw system citations;
- prompt or model internals.

Developer/audit views may expose internal source identity when needed for
diagnosis.

Court-facing or dispatch-facing output must prefer clean document labels,
annexures, exhibits, paper-book pages, or lawyer-confirmed labels.

## Validation Rules

Source labels are valid only when they remain tied to current internal source
identity.

Downstream code should ignore or warn on a label when:

- the label contains a raw `FILE-NNNN` identifier;
- the label's `sha256` / `content_hash` does not match the current source;
- the label's `source_path` does not match the current register;
- the label cites a file id not present in current registers;
- the label is too generic to help review;
- the label claims a date/type/party that the source does not support.

If label validation fails, the system should fall back to raw citation behavior
rather than inventing a nicer source.

## Relationship To List Of Dates

List of Dates entries should be proved by raw citations and rendered with
readable labels where available.

The label does not prove the event. The event is proved by the cited extracted
block.

If Source Index changes only in lawyer-facing labels, List of Dates can use a
label refresh path. If source content or material source metadata changes, the
chronology may need review or regeneration.

## Relationship To Copilot

Matter Copilot may render readable source labels in answers, but it should keep
answers tied to validated source citations internally.

Copilot should not treat a nice label as enough proof for a factual claim.

## Relationship To Drafts And Dispatch

Drafts may use readable source labels for lawyer review.

Dispatch/court-facing copies should not expose developer identifiers unless a
lawyer deliberately chooses an internal audit view.

After dispatch, source identity remains preserved for provenance, but the app
should not silently rewrite a dispatched copy because labels changed.

## Non-Goals

- This contract does not define the full Source Index schema.
- This contract does not define court export formats.
- This contract does not authorize changing existing folder or file names.
- This contract does not make lawyer label confirmation mandatory in V1.

## Implementation Pointers

Current code surfaces connected to this contract include:

- `shared/source-labels.mjs`;
- `source-descriptors-engine.mjs`;
- `services/matter-context-sources.mjs`;
- `services/listofdates-dependency-state.mjs`;
- `create-listofdates-engine.mjs`;
- `docs/source-descriptors.md`;
- `docs/extraction-record.v1.md`.
