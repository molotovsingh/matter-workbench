# Matter Context Reader Contract

This document defines the next safe boundary before Matter Workbench grows from
a deterministic Command rail into matter Q&A or search.

The current beta is intentionally explicit:

```text
status
open library
/extract
/describe_sources
/create_listofdates
```

Those commands create durable artifacts with clear file paths and rerun
guardrails. A future Q&A/search surface is different. It may answer a question
without writing an artifact, but it still needs a disciplined source boundary.
That boundary is the **Matter Context Reader**.

This is a contract note only. It does not add runtime Q&A, search, chat memory,
provider calls, or artifact writes.

## Goal

Build a deterministic local reader that turns the active matter folder into a
bounded, source-backed context packet for future matter Q&A/search.

The reader should answer one question before any model is called:

```text
What matter facts and source handles is the model allowed to see?
```

The reader should not decide what the model says. It should only collect,
validate, bound, and label the source material that a future model call may use.

## Non-Goals

Do not add these in the context-reader slice:

- chat UI;
- broad semantic search;
- copilot Q&A;
- drafting;
- configurable skills;
- automatic provider fallback;
- durable chat memory;
- new matter state files;
- writes to `10_Library`, `20_Workshop`, `30_Drafts`, or `40_Dispatch`.

The first implementation should be a read-only service or helper, not a new
product surface.

## Inputs

The context reader may read only from the active matter folder and should treat
these as first-class inputs.

### `matter.json`

Use for:

- client name;
- matter name;
- opposite party;
- matter type;
- jurisdiction;
- brief description;
- intake list and active matter metadata.

Do not treat `matter.json` as evidence for disputed facts. It is matter
metadata and routing context.

### File registers

Read all intake file registers, not just the initial intake:

```text
00_Inbox/Intake */File Register.csv
```

Use for:

- `file_id`;
- `sha256`;
- `source_path`;
- original/display name;
- category;
- duplicate status;
- source identity checks.

The register is the canonical map from physical documents to `FILE-NNNN`
handles.

### Extraction records

Read extraction records as the primary factual text source:

```text
00_Inbox/Intake */_extracted/FILE-NNNN.json
```

Use for:

- page/block text;
- `FILE-NNNN pX.bY` citations;
- extraction engine metadata;
- OCR warnings/confidence where present;
- page boundaries and block boundaries.

The future model should see extraction-record blocks, not arbitrary raw files.

### `10_Library/Source Index.json`

Use for source labels and source descriptors when the descriptor can be trusted:

- `schema_version` is recognized;
- `file_id` exists in the current file register;
- `sha256` matches the current registered file;
- `source_path` matches the current registered file;
- human labels do not contain `FILE-NNNN` prefixes.

Use source labels as display metadata. Do not replace canonical raw citations.

### Selected `10_Library` Artifacts

Selected stable library artifacts may be included as secondary context:

```text
10_Library/List of Dates.json
10_Library/List of Dates.md
10_Library/Source Index.json
```

Use them for:

- known chronology entries;
- cluster summaries;
- source labels;
- prior source-backed analysis.

Do not treat them as stronger than the underlying cited extraction blocks. If a
future answer relies on a List of Dates row, it should still preserve the row's
raw citations.

## Exclusions

The context reader must not include:

- `.env`;
- API keys or provider secrets;
- local app config containing secrets;
- Git metadata;
- `node_modules`;
- browser caches;
- OS junk such as `.DS_Store` and `Thumbs.db`;
- Office lockfiles such as `~$agreement.docx`;
- raw source files from `Originals`, `Source Files`, or `By Type` unless they
  are represented by extraction records;
- binary files;
- archives;
- logs unless the caller explicitly asks for operational diagnostics;
- full command terminal history;
- previous chat transcripts unless a future product explicitly defines chat
  memory.

Logs are not evidence by default. Use logs only to explain pipeline status,
provider failures, or extraction/OCR health.

## Output

The first runtime slice should produce an in-memory context packet. A suggested
shape:

```json
{
  "schema_version": "matter-context-packet/v1",
  "matter": {
    "folder_name": "Mehta vs Skyline",
    "matter_name": "Mehta vs Skyline",
    "client_name": "Rohan Mehta",
    "opposite_party": "Skyline Developers Pvt Ltd",
    "matter_type": "consumer dispute",
    "jurisdiction": "India"
  },
  "sources": [
    {
      "file_id": "FILE-0001",
      "sha256": "...",
      "source_path": "00_Inbox/Intake 01 - Initial/Originals/notice.pdf",
      "source_label": "Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026",
      "source_short_label": "Legal notice, 20 Apr 2026",
      "document_type": "legal_notice"
    }
  ],
  "evidence_blocks": [
    {
      "citation": "FILE-0001 p1.b2",
      "file_id": "FILE-0001",
      "page": 1,
      "block_id": "b2",
      "text": "bounded extracted text...",
      "source_label": "Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026"
    }
  ],
  "library_artifacts": [
    {
      "path": "10_Library/List of Dates.json",
      "schema_version": "list-of-dates/v1",
      "summary": "33 accepted chronology entries with preserved raw citations"
    }
  ],
  "limits": {
    "max_blocks": 120,
    "max_chars_per_block": 1600,
    "omitted_blocks": 42
  },
  "warnings": []
}
```

The exact fields can change during implementation, but the key contract should
not:

- context is bounded;
- every evidence block has a raw citation;
- source labels are additive display metadata;
- omissions are visible;
- the packet is generated from files, not browser memory.

## Citation Rules

Matter-specific factual answers must cite sources.

Acceptable:

```text
Skyline acknowledged the complaint on 14 March 2024 but demanded payment instead of providing possession details. Source: Skyline reply to legal notice, 14 Mar 2024 (FILE-0007 p1.b3).
```

Not acceptable:

```text
Skyline clearly acted in bad faith.
```

If the context packet does not contain a supporting citation, a future Q&A
answer should say that the answer cannot be verified from the current matter
context.

Readable source labels may be shown before raw citations, but raw citations must
remain present:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026 (FILE-0001 p1.b2)
```

## Chat-Only Versus Artifact Outputs

Future Q&A/search answers are chat-only unless the user explicitly runs an
artifact-producing skill.

Chat-only answers:

- may summarize cited evidence;
- may point to existing artifacts;
- may suggest that the user run `/describe_sources` or `/create_listofdates`;
- must not write to disk;
- must not update `Source Index.json`;
- must not update `List of Dates.*`;
- must not create drafts.

Durable artifact creation stays behind explicit skills and their existing
guardrails.

## Provider And Cost Rules

The context reader itself should not make provider calls. It is deterministic
local plumbing.

Future Q&A/search model calls must make provider use visible. The UI should
show, at minimum:

- provider;
- model;
- whether the answer is chat-only;
- whether any artifact will be written.

Paid rerun guardrails remain mandatory for artifact-producing skills such as
`/describe_sources` and `/create_listofdates`. Q&A must not become a side door
for overwriting source labels, chronologies, drafts, or dispatch materials.

## Command Rail Rule

The Command rail remains deterministic until provider-backed Q&A is explicitly
added. Local context search may use this packet, but it must stay read-only,
bounded, and citation-preserving.

Allowed now:

```text
status
open library
open drafts
/context_preview
/context_search
find payment
/extract
/describe_sources
/create_listofdates
```

Not added by this contract:

```text
what happened in this matter?
draft a notice
summarize all emails
```

Those are future Q&A/search or drafting behaviors and need their own runtime
PRs.

## First Runtime Slice Acceptance Criteria

The first implementation PR should prove only the reader boundary:

- expose a pure function or service that reads the active matter folder;
- include `matter.json`, file registers, extraction records, source labels, and
  selected `10_Library` artifacts;
- exclude secrets, raw files, logs by default, machine junk, and unrelated
  folders;
- preserve `FILE-NNNN pX.bY` citations;
- include source labels only when identity checks pass;
- bound the packet size;
- report omitted counts and warnings;
- run with fake matter fixtures;
- make no network calls;
- write no artifacts.

Do not wire it into a chat UI in the same PR.

## Review Checklist

Reviewers should ask:

- Can every factual text block be traced to a raw citation?
- Are source labels helpful but non-authoritative?
- Are stale source descriptors rejected?
- Are `.env`, keys, logs, and raw files excluded?
- Is the packet small enough to reason about?
- Does the implementation remain separate from model/provider code?
- Would a future Q&A answer be forced to say "not found" when evidence is
  missing?

If the answer to any of these is no, the context reader is not ready for Q&A.
