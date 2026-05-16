# Future Design Decision: Lawyer-Facing Terminology Contract

Date: 2026-05-13
Status: Parked for later product decision

## Why This Exists

Matter Workbench is becoming more capable, but capability creates a naming
problem. Engineers naturally speak in terms like:

- artifacts;
- packets;
- records;
- runners;
- routers;
- extraction blocks;
- source descriptors;
- skill registries;
- schemas;
- lifecycle states.

Lawyers do not think that way when doing legal work. They think in terms like:

- case papers;
- evidence;
- chronology;
- source labels;
- issue notes;
- drafts;
- client updates;
- review notes;
- filing bundles;
- counsel questions.

The app should keep its backend contracts boring and precise, but the surface
should speak like a legal workbench.

This note parks a future product decision:

```text
Create a terminology contract that maps backend objects to lawyer-readable UI
language consistently across the app.
```

The goal is not cosmetic renaming. The goal is to make every UI label,
Command rail phrase, skill card, report, and generated artifact feel connected
to the way a lawyer understands the work.

## Product Principle

Use stable backend names for machines. Use lawyer-facing names for humans.

Do not casually rename folders, JSON fields, schemas, skill ids, or API routes.
Instead, add a deliberate presentation layer:

```text
canonical contract -> presentation label -> user explanation
```

Example:

```text
10_Library
  -> Analysis Library
  -> Reviewed outputs and source-backed matter knowledge
```

This keeps the filesystem/API stable while the UI becomes easier to understand.

## Current Naming Tension

The app already has some good humanized terms:

- `10_Library` displayed as `Analysis Library`;
- workspace lanes like `Workshop`, `Drafts`, and `Dispatch`;
- `List of Dates` instead of raw chronology JSON;
- `Source Index` as the durable source-label artifact;
- `Not runnable yet` for saved skill ideas;
- `Copy Review Packet` for supervisor/coder handoff.

But there are still rough edges:

- `router/check` leaks into reports and mental models;
- `artifact` appears where `output`, `work product`, or `file` would be clearer;
- `skill idea`, `design brief`, `readiness`, and `review packet` need plain
  explanations;
- backend status names like `ready_for_review` and `incomplete` need UI labels;
- `provider-backed`, `source-backed`, and `paid` need consistent language;
- matter context packets are useful internally, but users need `Matter Context`
  or `Context Preview`;
- `extraction records` may be correct internally, but the lawyer may need
  `readable text records`, `evidence blocks`, or `document text`.

## Layered Terminology Model

### Layer 1: Canonical Backend Contract

These names are for code, schemas, tests, routes, and disk contracts.

Examples:

- `00_Inbox`
- `10_Library`
- `20_Workshop`
- `30_Drafts`
- `40_Dispatch`
- `Source Index.json`
- `List of Dates.json`
- `matter-context-packet/v1`
- `skill-ideas.json`
- `ready_for_review`
- `/create_listofdates`

Rules:

- keep stable;
- version when contract changes;
- do not optimize for prettiness;
- document meaning clearly.

### Layer 2: UI Presentation Label

These names are for visible app labels.

Examples:

- `Inbox`
- `Analysis Library`
- `Workshop`
- `Drafts`
- `Dispatch`
- `Source Labels`
- `List of Dates`
- `Matter Context`
- `Saved Skill Ideas`
- `Ready for review`

Rules:

- concise;
- lawyer-readable;
- consistent across sidebar, Command rail, Skills tab, reports, and settings;
- no internal status codes.

### Layer 3: Plain-Language Explanation

These one-line explanations teach the user what the thing does.

Examples:

```text
Analysis Library
Reviewed outputs and source-backed matter knowledge.

Workshop
Working analysis, issue notes, risk reviews, and internal legal thinking.

Drafts
Documents and communications that may later be edited for use.

Dispatch
Material intended for sending, filing, or sharing after lawyer review.
```

Rules:

- explain the legal purpose, not implementation;
- avoid jargon;
- make risk and finality clear.

## Proposed Terminology Map

| Canonical term | Lawyer-facing term | Explanation |
| --- | --- | --- |
| `00_Inbox` | Inbox | Original intake batches and working copies before analysis. |
| `10_Library` | Analysis Library | Reviewed source-backed outputs and matter knowledge. |
| `20_Workshop` | Workshop | Internal analysis, risk reviews, issue notes, and working views. |
| `30_Drafts` | Drafts | Draft communications or legal work product for lawyer editing. |
| `40_Dispatch` | Dispatch | Send-ready or file-ready material after lawyer approval. |
| `Source Index.json` | Source Labels | Human-readable labels for evidence sources. |
| `List of Dates.md` | List of Dates | Lawyer-readable chronology with citations. |
| extraction record | Text Record | Extracted readable text with source citations. |
| evidence block | Cited Passage | A small source-backed passage with a raw citation. |
| matter context packet | Matter Context | Bounded matter summary used for local search or future Q&A. |
| skill idea | Skill Idea | A proposed reusable workflow, not runnable yet. |
| design brief | Skill Brief | What the future skill should read, produce, and preserve. |
| readiness checklist | Review Checklist | Whether the idea is clear enough for human review. |
| review packet | Review Packet | Copyable brief for supervisor or coder review. |
| provider-backed | Uses paid AI | May call a configured AI provider. |
| deterministic/local | Local only | Runs without a paid AI provider. |
| router/check | Skill Fit Check | Checks whether an idea is new or overlaps existing work. |
| artifact | Output | A file or result produced by the app. |
| source-backed | Cited to source records | Uses evidence citations, not unsupported assertions. |

This table is provisional. The future implementation should keep the mapping
centralized rather than scattering labels across files.

## Terms To Avoid In User-Facing Copy

Avoid exposing these unless the user is in a developer/debug view:

- router;
- MECE;
- slot;
- schema;
- packet, unless in `Review Packet`;
- activation;
- validation lifecycle;
- provider payload;
- JSONL;
- artifact when `output` or `file` is clearer;
- registry;
- runner key;
- canonical id;
- prompt generation.

Acceptable in advanced/debug contexts:

- provider/model;
- raw citation;
- schema version;
- route;
- artifact path;
- runner key.

## Skill Terminology

Skills need especially careful language because they cross product, legal, and
engineering boundaries.

### Current Safe User Terms

- Skill Idea
- Not runnable yet
- What I understood
- Question 1
- Ready for sample
- Generate sample from this matter
- Copy Review Packet
- Ready for review
- Open in Skills

### Better Future Terms

| Internal idea | User-facing term |
| --- | --- |
| configurable skill | Custom Skill |
| draft revision | Test Version |
| active skill | In Use |
| paused skill | Paused |
| restore revision | Restore as Test Version |
| validate | Check against expected result |
| activation | Use this version |
| skill authoring | Design Skill |

The app should not make lawyers think in deployment language. It should make
them think in review, test, and use language.

## Backend/API Shape For Future Work

Future APIs can return both canonical and display fields.

Example:

```json
{
  "canonical": {
    "lane": "20_Workshop",
    "status": "ready_for_review",
    "artifactPath": "20_Workshop/Weakness Review.md"
  },
  "display": {
    "laneLabel": "Workshop",
    "statusLabel": "Ready for review",
    "artifactLabel": "Weakness Review",
    "artifactDescription": "Internal lawyer risk review from the client perspective."
  }
}
```

This avoids duplicating label logic in every frontend component.

If implemented in code later, prefer a small shared presentation module such as:

```text
shared/terminology-contract.mjs
```

or a service-specific helper such as:

```text
services/presentation-labels.mjs
```

The exact placement should follow the repo's existing module shape at the time
of implementation.

## Generated Artifact Language

Generated outputs should also use lawyer-friendly language.

Examples:

- `Weakness Review.md`, not `Risk Artifact.md`;
- `Limitation Review.md`, not `Limitation Packet.md`;
- `Client Update Email.md`, not `Communication Draft Artifact.md`;
- `Evidence Gaps.md`, not `Missing Evidence Analysis Output.md`;
- `Pleadings Summary.md`, not `Pleading Summary Result.md`.

Rules:

- name the legal job;
- keep filenames stable and readable;
- include a date, and use a timestamp when multiple generated versions may
  exist on the same date;
- include the audience/status when it changes how the file may be used;
- avoid pretending a draft is final;
- preserve raw citations where required;
- place outputs in the lane that matches the lawyer's mental model.

Recommended filename pattern:

```text
YYYY-MM-DD [HHMM IST] - Legal Job - Audience/Status.ext
```

Examples:

- `2026-05-16 1430 IST - List of Dates - Internal - Not for Circulation.md`
- `2026-05-16 1430 IST - Client Follow-up List - Internal.md`
- `2026-05-16 - Writ Petition - Working Draft.docx`
- `2026-05-16 - Writ Petition - Lawyer Review.docx`
- `2026-05-16 - Writ Petition - Court Filing Copy.pdf`

The app may still keep stable internal contract paths for automation, such as
`10_Library/List of Dates.json`. The lawyer-facing display name or versioned
history entry can be longer and more descriptive.

Use `Not for Circulation` for internal assessments, lawyer-review files, and
workshop material that should not be sent onward. Do not use it for court-facing
or dispatch-ready files.

## Artifact Visibility Language

Not every generated file should be visible to lawyers by default.

The visible workspace should show clean lawyer-useful outputs. Internal support
files should exist for safety, evaluation, and audit, but they should not make
the Matter Explorer look like a pile of half-drafts.

Recommended display rule:

```text
one clear primary output -> optional supporting outputs -> technical/audit files
hidden by default
```

Use these naming distinctions:

| Artifact type | Visible naming | Default visibility |
| --- | --- | --- |
| Main skill output | Legal job name, e.g. `List of Dates` | Visible |
| Supporting lawyer note | Job name, e.g. `Client Follow-up List` | Visible below primary |
| Internal candidate set | `Candidate Ledger` | Hidden/audit |
| QA check | `Run Quality Check` | Hidden or secondary |
| Raw model/provider output | Provider/debug name only | Hidden/developer |
| Editable legal document | `Working Draft` | Visible in `Drafts` |
| Filing/sending copy | `Filing Copy` or `Ready to Send` | Visible in `Dispatch` |

Avoid:

- `Draft` for internal assessments;
- `Final` for anything not lawyer-approved for dispatch;
- `AI Draft 1`, `AI Draft 2`, etc. in the main workspace;
- provider/model names in lawyer-facing filenames;
- file names that expose technical stages such as `pass_1`, `pass_2`, `raw`,
  `candidate`, or `validation` unless the user opens an audit/debug view.

This distinction matters because lawyers read file names as legal status. A file
called `Draft` will be treated as something to edit or rely on. Internal
assessment files should not carry that signal.

## Command Rail Language

The Command rail should feel like a clerk or junior associate, not a debugger.

Prefer:

```text
I understood this as a future skill idea.
This is not runnable yet.
Copy this for review before anyone builds it.
```

Avoid:

```text
Router decision: adjacent_skill
MECE violation: false
Schema accepted.
Activation pending.
```

Debug/report copy can still include internal terms when useful, but the visible
interaction should stay lawyer-readable.

## Matter-Level Language

Matter overview should distinguish:

- what is present;
- what is current;
- what may cost money to rerun;
- what is local-only;
- what is a draft;
- what is internal analysis;
- what is send-ready.

This can be done without adding new capabilities. It is a presentation contract.

## Acceptance Criteria For A Future Implementation Slice

A first implementation should be narrow and testable.

Suggested first slice:

- create a central terminology map for lanes, statuses, common artifacts, and
  skill idea states;
- update Skills tab and Command rail to use it;
- keep backend canonical values unchanged;
- add tests proving canonical values remain stable while display labels are
  lawyer-readable.

Example test expectations:

```text
ready_for_review -> Ready for review
20_Workshop -> Workshop
provider-backed -> Uses paid AI
matter-context-packet/v1 -> Matter Context
```

## Non-Goals

This parked decision does not authorize:

- renaming on-disk lane folders;
- changing API route names;
- changing JSON schema fields;
- migrating matter folders;
- hiding raw citations;
- removing developer/debug metadata from reports;
- changing skill behavior;
- changing provider routing;
- broad UI redesign.

This is a presentation and terminology discipline, not a storage migration.

## When To Revisit

Revisit this when at least two are true:

- users misunderstand `artifact`, `router`, `packet`, or `readiness`;
- review packets feel too technical;
- Skills tab grows beyond read-only governance;
- custom/configurable skills become real;
- Copilot Q&A is added;
- cost estimation reaches the UI;
- generated artifacts need more consistent legal names.

## Near-Term Recommendation

Do not start with a broad rename.

Start by centralizing display labels for the things users already see:

- lanes;
- skill idea statuses;
- paid/local posture;
- known artifacts;
- Command rail result states.

Keep the machine contract stable. Make the surface speak lawyer.
