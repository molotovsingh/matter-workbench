# Future Design Decision: Native Skill Implementation Contract

Date: 2026-05-16
Status: Implementation contract draft

## Why This Exists

The native skill direction is now clear enough to become an implementation
contract.

The app should not archive its working native spine. The existing sequence is
coherent:

```text
/matter-init -> /extract -> /describe_sources -> /create_listofdates
```

The cleanup is product-facing: stop presenting setup, search, maintenance, and
legal work-product skills as if they are the same kind of thing.

The provider-backed parts of this spine should also inherit the shared
[Legal Workbench Policy Prompt](legal-workbench-policy-prompt.md). That prompt
contract keeps legal-output rules stable across OpenAI direct, OpenRouter, and
future models.

## Current Native Spine

| Slash command | Keep? | Product treatment |
| --- | --- | --- |
| `/matter-init` | Yes | Setup plumbing behind Add New Matter / import documents |
| `/extract` | Yes | Document-reading plumbing; not a lawyer-facing legal skill |
| `/describe_sources` | Yes | Product surface becomes `Source Labels / Document Index` |
| `/create_listofdates` | Yes | First hero native legal skill: `Create List of Dates` |
| `/prepare_matter` | Yes | Readiness/orchestration panel, not a legal work-product skill |
| `/context_preview` | Yes | Internal/audit utility |
| `/context_search` | Yes | Matter search utility |
| `/doctor` | Yes | Maintenance/admin utility |

Slash commands, routes, engines, and disk contracts can remain stable while the
UI presents the right lawyer-facing categories.

## Skill 1 Promise

Use this promise:

```text
Organize documents and prepare the source record for List of Dates.
```

Do not describe Skill 1 as building the first chronology. That blurs the
boundary with Skill 2.

Skill 1 owns:

- source inventory;
- document labels;
- document type and date hints;
- bad-copy flags;
- missing-document flags;
- stable source identity;
- chronology readiness.

Skill 1 does not own:

- the actual List of Dates;
- final event selection;
- legal chronology reasoning;
- filing chronology modes;
- downstream drafting.

## Skill 2 Promise

Use this promise:

```text
Create List of Dates.
```

This is the first lawyer-visible native skill because it answers the central
lawyer question:

```text
What happened, when, and where can I check it?
```

Skill 2 consumes Skill 1's current source record. It should preserve raw
citations internally, render lawyer-readable source labels by default, and make
limitations/follow-up visible without polluting the main chronology narrative.

## Source Labels vs Document Index

Do not collapse these terms.

`Source Labels` is the lawyer-friendly visible layer:

- confirmed document titles;
- suggested labels;
- short labels;
- annexure or exhibit labels;
- paper-book references.

`Document Index` is the broader contract underneath:

- stable source identity;
- content hash;
- original/internal file names;
- document type;
- document date;
- quality flags;
- duplicates;
- missing-document follow-up;
- extraction/OCR state;
- source readiness.

The UI may show `Source Labels`, but the implementation should model the
broader `Document Index`.

## Source Label Versioning

Lawyer-confirmed source labels should be minimally versioned.

Minimum fields:

```json
{
  "source_id": "",
  "content_hash": "",
  "suggested_label": "",
  "confirmed_label": "",
  "label_status": "suggested | confirmed | overridden | needs_review",
  "label_source": "model | filename | document_text | lawyer_override",
  "label_reason": "",
  "label_revision": 1,
  "confirmed_by": "",
  "confirmed_at": ""
}
```

Important distinction:

- `source_id` identifies the source record inside the matter.
- `content_hash` changes when the underlying document changes.

This is what lets the app separate a harmless label update from a material
document replacement.

## Staleness Taxonomy

Do not use one broad `stale` bucket for everything.

Use three dependency states:

```text
label_refresh_needed
chronology_review_needed
chronology_regeneration_needed
```

### `label_refresh_needed`

Use when only lawyer-facing source labels changed.

Expected action:

```text
Refresh rendered labels.
```

No AI regeneration should be required.

### `chronology_review_needed`

Use when source metadata changed in a way that may affect interpretation but
does not obviously require full regeneration.

Examples:

- document type changed;
- document category changed;
- quality flag changed;
- matter stage or client role changed;
- source label confidence changed;
- a source moved from `needs_review` to cleaner but the underlying content hash
  appears unchanged.

Expected action:

```text
Warn the lawyer, prefer review/regeneration, but allow proceed anyway.
```

### `chronology_regeneration_needed`

Use when the underlying source set or content changed materially.

Examples:

- new documents added;
- document removed;
- better copy replaced a bad copy;
- OCR or extraction changed source text;
- `content_hash` changed;
- document date changed;
- material source content changed;
- an essential missing document was supplied.

Expected action:

```text
Regenerate List of Dates before drafting, or proceed with a strong warning.
```

Default action should be regenerate/review, not proceed.

## Visibility Rules

Default lawyer-visible outputs should not expose:

- `FILE-0001` style IDs;
- hashes;
- storage paths;
- extraction IDs;
- provider traces;
- prompt traces;
- candidate ledgers;
- raw model responses.

Internal audit and technical views may preserve those details. Court-facing and
dispatch-facing outputs must not expose them.

## Dispatch Boundary

`40_Dispatch` is a boundary, not another editable workspace.

When a document becomes a dispatch copy, preserve:

- final dispatched/filed document;
- source chronology version;
- Source Index / Document Index snapshot or hash;
- draft version used;
- generated/export timestamp.

After dispatch:

- show as `Sent`, `Filed`, or `Dispatch Copy`;
- stop normal rerun suggestions on that dispatched file;
- require a new working draft for further changes;
- do not silently overwrite or improve dispatched material.

## First Foundation Slice

The safest implementation order is:

1. Keep slash commands and routes stable.
2. Reclassify built-in skills by product surface.
3. Rename `/describe_sources` presentation to `Source Labels / Document Index`.
4. Add source-label version fields without breaking existing `Source Index.json`
   readers.
5. Add dependency-state vocabulary for label refresh vs chronology review vs
   chronology regeneration.
6. Only then harden List of Dates rendering and audit visibility.

This lays a better foundation without rewriting the chronology engine before
the source-record contract is strong enough.
