# Future Design Decision: Native Skill Library Strategy

Date: 2026-05-16
Status: Working product note

## Why This Exists

Matter Workbench now has two skill classes:

- built-in skills, shipped with the app and tested as product primitives;
- configurable/custom skills, created from user ideas, sample review, and model-backed authoring.

Custom skills are powerful, but they should not become the default answer to
every lawyer request. They cost more to create, govern, validate, explain, and
run. If every recurring legal need becomes a custom skill, the product turns
into a prompt factory instead of a legal workbench.

The better product direction is a strong native skill library: a small set of
high-value, reusable legal workflows that cover the work most lawyers need in
most matters.

Native skills should make the lawyer think:

```text
Before I ask AI to draft anything, the app has already organized the file like
a competent legal team would.
```

## Product Principle

Native skills should cover repeated legal work. Custom skills should cover
rare, firm-specific, or experimental work.

Use this test:

```text
If a competent junior would do this in most serious matters, it probably
belongs in the native library.
```

Examples:

- indexing documents;
- making a chronology;
- separating procedural history from factual history;
- identifying parties, claims, defences, admissions, and denials;
- finding contradictions and missing evidence;
- preparing a counsel note;
- building a source-backed filing pack.

Those are not exotic user preferences. They are common legal work.

## The Lawyer's Mental Ladder

A lawyer does not experience a matter as "run model on documents." The lawyer
climbs a practical ladder:

1. What papers do we have?
2. What happened?
3. What happened in court or before the authority?
4. Who are the actors?
5. What is each side saying?
6. What does each side want?
7. What supports each important assertion?
8. What conflicts, gaps, or risks are visible?
9. What should I ask the client for?
10. What can I safely use for drafting, conference, or filing?

The native library should map to that ladder. If the app misses a rung, users
will ask for custom skills to patch the feeling of confusion.

One prerequisite sits just before this ladder:
[Matter Metadata and Client Interview](matter-metadata-client-interview.md).
The Add New Matter flow already captures structured matter basics and a
free-text brief description. It should be extended to capture clearer stage and
role context. Later, after documents are in place, a metadata review should
correct typos, truncated names, wrong roles, and stage assumptions before
native skills rely on them.

## Important Distinction: Chronology Is Not One Thing

The current `/create_listofdates` skill is central, but "List of Dates" carries
more than one legal meaning.

There is a case-preparation chronology:

```text
What happened, according to the record, and where is each event supported?
```

There is also a filing chronology, used in SLPs, writ petitions, appeals, and
other formal papers:

```text
How should the material chronology be arranged so the court understands the
client's case theory quickly and fairly?
```

That second form is not dishonest. It is advocacy. But it must stay inside
professional boundaries:

- do not suppress material adverse events;
- do not invent legal conclusions;
- do not hide contradictions;
- do not turn uncertain sources into certainty;
- do not make the model decide what a lawyer must decide;
- do keep the order, selection, emphasis, and relevance client-aware.

The product wording should therefore avoid "bias the court" as an internal
goal. The safer and more lawyerly product language is:

```text
persuasive but complete court-facing chronology
```

or:

```text
client-oriented chronology with candour guardrails
```

This is a strong reason to keep List of Dates native. It is too important to
leave as one-off custom prompting.

## Native Skill Ranking

This ranking is based on legal frequency, reuse value, downstream leverage,
cost reduction, and whether the output becomes a building block for later work.

| Rank | Native Skill Family | Lawyer Question | Primary Output | Why Native |
|---:|---|---|---|---|
| 1 | Document Index / Source Inventory | What papers do we have? | File register with source labels, dates, types, parties, duplicates, extraction/OCR status | Every matter starts here. Without this, later analysis has weak footing. |
| 2 | Chronology / List of Dates | What happened, and how should those events be used? | Preparation chronology plus filing-ready modes such as SLP/writ chronology | The backbone of litigation, notices, conferences, appeals, SLPs, and writs. |
| 3 | Procedural History | What happened in the case process? | Filing/hearing/order/application timeline | Procedural posture is different from facts and is essential for court work. |
| 4 | Parties / Entities / Relationship Map | Who is who? | Party and entity map with roles, aliases, relationships, signatory status | Many legal mistakes begin with actor confusion. |
| 5 | Claims, Defences, Admissions, Denials Matrix | What is the actual fight? | Matrix of pleaded positions and disputed/admitted facts | Converts a pile of papers into the legal contest. |
| 6 | Relief / Prayer / Demand Tracker | What does each side want? | Relief/prayer/demand table by document and party | Distinct from facts and issues; very important in writs, suits, notices, appeals. |
| 7 | Evidence Support Matrix | What supports each important assertion? | Assertion-to-source table with strength and citation | Prevents hallucinated confidence and helps drafting become cheaper. |
| 8 | Contradictions / Inconsistencies Finder | What does not add up? | Conflicting dates, amounts, versions, names, and positions | This is senior-lawyer value, not cosmetic summary. |
| 9 | Missing Evidence / Gap List | What is absent? | Missing documents, missing periods, unsupported claims, weak proof points | Turns passive summarization into case management. |
| 10 | Client Document Request List | What should we ask the client for? | Actionable request list with reason and priority | Converts analysis into work the lawyer can actually delegate. |
| 11 | Matter Brief / Counsel Note | What is the case, in working form? | Source-backed brief: facts, posture, issues, evidence, risks, gaps, next steps | High-value synthesis once the foundations exist. |
| 12 | Drafting Pack Builder | What reusable material can feed pleadings/submissions/notices? | Source-backed drafting blocks, not final unsupervised drafts | Reduces expensive open-ended drafting calls. |

## MECE Logic

The skill library should not be a random menu. Each skill should own a distinct
part of the legal work.

| Layer | Native Skill Family | Owns | Should Not Own |
|---|---|---|---|
| Papers | Document Index / Source Inventory | What materials exist and how reliable the extraction is | Legal conclusions |
| Facts and Filing Chronology | Chronology / List of Dates | Real-world dated events plus filing-ready chronology modes | Suppression, invention, or unsupported rhetoric |
| Procedure | Procedural History | Case/process events before court, tribunal, authority, arbitrator | Underlying factual merits except where tied to filings/orders |
| Actors | Parties / Entities Map | People, companies, roles, relationships, aliases | Claims analysis |
| Positions | Claims / Defences / Admissions / Denials | What each side says and disputes | Evidence strength scoring |
| Relief | Relief / Prayer / Demand Tracker | Requested remedies, prayers, demands, interim relief | Whether relief will succeed |
| Support | Evidence Support Matrix | Which source supports which assertion | Final legal opinion |
| Risk | Contradictions and Gaps | Conflicts, missing material, unsupported assertions | Client-facing drafting tone |
| Action | Client Document Request List | What to ask the client/opponent/team for next | Rewriting the case theory |
| Synthesis | Matter Brief / Counsel Note | Working case map for lawyer review | Replacing lawyer judgment |
| Draft Prep | Drafting Pack Builder | Reusable source-backed blocks | Final filing without review |

This prevents the app from creating overlapping skills that all do a vague
"summarize matter" job.

## Why This Reduces Custom Skill Demand

Most custom skill requests are likely to be disguised versions of these needs:

```text
Make me a skill to understand the file.
Make me a skill to find important dates.
Make me a skill to prepare an SLP chronology.
Make me a skill to identify missing documents.
Make me a skill to summarize pleadings.
Make me a skill to make a counsel note.
Make me a skill to make a drafting base.
```

If native skills already answer those requests with parameters and profiles,
the user does not need a new skill. They need the right native skill in the
right mode.

The product should therefore prefer:

```text
native skill + profile + options
```

over:

```text
new custom skill for every variation
```

Example:

```text
List of Dates
  - preparation chronology
  - court-facing chronology
  - client conference chronology
  - limitation-focused chronology
```

Those can be modes or filters within one native skill family. They should not
be four unrelated custom skills.

## Cost Design

Native skills reduce cost only if they reuse work.

The product should avoid making every skill reread every document from scratch.
Instead:

1. deterministic intake creates the file map;
2. extraction creates reusable text records;
3. source labeling creates readable source identities;
4. chronology, issues, evidence, gaps, and briefs reuse those artifacts;
5. later drafting packs consume the structured outputs instead of rerunning
   broad document analysis.

Cost-saving native skills should follow this shape:

```text
deterministic prework -> bounded source-backed model call -> durable artifact
-> later reuse
```

For high-value but expensive skills, split broad extraction from judgment:

```text
cheap/broad pass: collect candidate facts, claims, dates, gaps
stronger/judgment pass: organize, de-duplicate, explain legal relevance
```

This matches the existing List of Dates direction: a broad candidate pass and
a stronger polishing/judgment pass can be cheaper and more reliable than one
large premium call.

## Native Skill Selection Test

A proposed native skill should pass most of these tests:

- It appears in many matters, not one unusual matter.
- It has a clear lawyer question.
- It produces a durable artifact, not just chat text.
- It can be source-backed.
- It has a bounded input contract.
- It has a reviewable output shape.
- It can be tested on golden matters.
- It reduces later AI calls or reruns.
- It reduces likely custom skill demand.
- It can be explained to a lawyer without backend vocabulary.

If it fails these tests, it may belong in custom skills, future design notes,
or manual lawyer judgment.

## Guardrails for Court-Facing Native Skills

Court-facing skills need stricter rules than internal analysis skills.

For List of Dates, SLP chronology, writ chronology, appeal synopsis, or filing
packs:

1. Preserve source citations internally.
2. Preserve both internal source identity and lawyer-facing document labels.
3. Never expose developer file names, raw `FILE-...` citations, hashes, storage
   paths, or extraction IDs in court-facing exports.
4. Preserve material adverse facts.
5. Use attribution for disputed facts.
6. Do not state legal conclusions unless a cited source states them or a
   separate approved legal-analysis layer supports them.
7. Allow client-oriented emphasis, ordering, grouping, and relevance.
8. Mark uncertainty instead of smoothing it away.
9. Keep a review flag when the model is unsure.
10. Make the lawyer approve before anything moves from `Workshop` to `Drafts`
   or `Dispatch`.

The product should make it easy to be persuasive. It must not make it easy to
be careless.

## Lane Ownership Rule

The repo's matter flow already separates generated knowledge from editable
drafting work:

```text
00_Inbox -> 10_Library -> 20_Workshop -> 30_Drafts -> 40_Dispatch
```

For the first two native skills, the product rule should be strict:

- Skill 1 source inventory outputs belong in `10_Library`.
- Skill 2 chronology/List of Dates outputs belong in `10_Library`.
- These outputs are generated source-backed artifacts, not in-app lawyer-edited
  work product.
- If they are wrong or stale, the app should fix upstream inputs and regenerate,
  not ask the lawyer to manually maintain rows.
- Lawyer editing belongs in `30_Drafts` or in the lawyer's own drafting tool.
- `40_Dispatch` is the send/file-ready handoff lane. After dispatch, the app
  should not behave as if it still owns the legal work product.

This keeps the native skill library clean: source-backed generated artifacts
feed drafting, but the lawyer remains responsible for the final pleading or
filing document.

## Artifact Visibility And Naming

SME concern: lawyers should not be exposed to too many generated drafts,
candidate files, model scratch outputs, or quality-assessment artifacts.

This should be a first-class product rule. A skill may create several internal
files to stay safe and testable, but the default lawyer workspace should show
only the outputs that help the lawyer act.

Recommended visibility classes:

| Visibility | Meaning | Default UI |
| --- | --- | --- |
| `primary` | The main lawyer-useful output of a skill | Shown |
| `supporting` | A useful companion note, gap list, or follow-up list | Shown, but below primary outputs |
| `internal_audit` | Candidate ledgers, source snapshots, quality checks, run metadata | Hidden behind "show technical details" or audit view |
| `dev_hidden` | prompts, provider payloads, raw model responses, eval traces | Hidden from lawyer UI |
| `court_facing` | Material intended for filing, sending, or sharing | Shown only after explicit lawyer-controlled promotion |

Naming rules:

- Do not call internal assessments "drafts."
- Do not put QA/support artifacts in `30_Drafts`.
- Use `Drafts` only for documents or communications the lawyer may actually
  edit for use.
- Use legal job names, not generation mechanics.
- Include a date, and where useful a timestamp, in lawyer-visible versioned
  filenames.
- Use status/audience labels such as `Internal - Not for Circulation`,
  `Working Draft`, `Lawyer Review`, `Court Filing Copy`, or `Ready to Send`.
- Keep one obvious primary output per skill run.
- Put candidate ledgers, model responses, extraction diagnostics, and quality
  checks behind an audit/technical view.
- Older generated versions should collapse under history, not clutter the main
  workspace.

Stable app contracts and lawyer-facing filenames can coexist. The app may keep a
stable pointer such as `10_Library/List of Dates.json` for downstream skills and
staleness checks, while the visible/export/history label includes date, time,
status, and audience.

Suggested pattern:

```text
YYYY-MM-DD [HHMM IST] - Legal Job - Audience/Status.ext
```

Examples:

```text
2026-05-16 1430 IST - List of Dates - Internal - Not for Circulation.md
2026-05-16 1430 IST - Source Labels - Internal Audit.json
2026-05-16 - Writ Petition - Working Draft.docx
2026-05-16 - Writ Petition - Court Filing Copy.pdf
```

Use `Not for Circulation` only for internal or lawyer-review material. Do not
carry that label into court-facing or dispatch-ready documents. Filename labels
help humans, but they are not a substitute for access control, visibility flags,
or promotion rules.

Examples:

| Purpose | Good visible label | Bad label |
| --- | --- | --- |
| Chronology | `2026-05-16 1430 IST - List of Dates - Internal - Not for Circulation` | `AI Draft Chronology v3` |
| Source labels | `2026-05-16 1430 IST - Source Labels - Internal` | `Descriptor Output` |
| Internal candidate rows | hidden `Candidate Ledger` | visible `Draft List of Dates Candidates` |
| QA result | hidden or secondary `Run Quality Check` | `Quality Draft` |
| Pleading draft | `2026-05-16 - Writ Petition - Working Draft` | `Generated Output 4` |
| Filing copy | `2026-05-16 - Writ Petition - Court Filing Copy` | `Final AI Draft` |

Suggested metadata for every generated output:

```json
{
  "display_label": "",
  "lane": "10_Library | 20_Workshop | 30_Drafts | 40_Dispatch",
  "visibility": "primary | supporting | internal_audit | dev_hidden | court_facing",
  "audience": "lawyer | internal | developer | court | client",
  "court_safe": false,
  "contains_internal_citations": true,
  "generated_by_skill": "",
  "generated_at": "",
  "status_label": "",
  "source_snapshot": "",
  "supersedes": ""
}
```

This prevents the Matter Explorer from turning into a dump of every intermediate
AI artifact. The lawyer should see a clean case file, with auditability
available on demand.

## Suggested Build Order

Do not start with final drafting. Start with matter understanding.

### Phase 1: Case Control

1. Document Index / Source Inventory
2. Factual Chronology / List of Dates
3. Procedural History
4. Parties / Entities / Relationship Map

This gives the lawyer control over the file.

### Phase 2: Case Theory

5. Claims, Defences, Admissions, Denials Matrix
6. Relief / Prayer / Demand Tracker
7. Evidence Support Matrix

This gives the lawyer a structured view of the fight.

### Phase 3: Risk and Action

8. Contradictions / Inconsistencies Finder
9. Missing Evidence / Gap List
10. Client Document Request List

This turns the workbench into an active reviewer.

### Phase 4: Synthesis and Filing Preparation

11. Matter Brief / Counsel Note
12. Court-facing mode inside List of Dates
13. Drafting Pack Builder

This is where the app begins to support formal filings and drafting, but only
after the foundations are source-backed.

## Native Skill Candidate Matrix

Use this matrix to decide what deserves native product treatment. The goal is
not to add many menu items. The goal is to create a library where each skill
has a real job, reuses prior artifacts, and prevents unnecessary custom skill
creation.

| Rank | Skill Family | Inputs | Output Artifact | Deterministic Part | Model-Heavy Part | Cost Risk | Custom Demand Replaced | Status |
|---:|---|---|---|---|---|---|---|---|
| 1 | [Document Index / Source Inventory](native-skill-document-index-source-inventory.md) | intake files, `matter.json`, extraction status | `File Register.csv`, source inventory view | file hashing, type detection, duplicate detection, folder mapping | document type/name/date inference if needed | Low | "organize my brief", "tell me what documents I have" | SME requirement captured; should become discovery and reading-order workflow |
| 2 | [Chronology / List of Dates](native-skill-chronology-list-of-dates.md) | extraction records, source labels, matter metadata | `List of Dates.json/.md/.csv`, filing chronology views | citation parsing, date validation, completeness checks, artifact rendering | event selection, legal relevance, client-oriented filing framing | High | "find important dates", "make chronology", "make SLP list of dates", "make writ chronology" | SME requirement capture started; existing native skill should mature into skill family with court-facing mode |
| 3 | Procedural History | pleadings, orders, filings, notices, case metadata | `Procedural History.md/json` | classify filing/order/hearing dates | summarize procedural posture and sequence | Medium | "summarize case history", "make procedural chart" | Should be native and separate from factual chronology |
| 4 | Parties / Entities / Relationship Map | intake metadata, extraction records, source labels | `Parties and Entities.md/json` | normalize names, aliases, roles from metadata | infer relationships and document roles with citations | Medium | "who is who", "map parties" | Good early native candidate |
| 5 | Claims / Defences / Admissions / Denials Matrix | pleadings, notices, replies, orders | `Issues and Positions Matrix.md/json` | table rendering, party grouping | extract positions, admissions, denials, disputes | High | "summarize pleadings", "find defence points" | High value after source labeling improves |
| 6 | Relief / Prayer / Demand Tracker | pleadings, petitions, notices, applications | `Relief Tracker.md/json` | party/document grouping | extract prayers, interim relief, demands, concessions | Medium | "what is being asked", "summarize prayers" | High-value native for court matters |
| 7 | Evidence Support Matrix | chronology, positions matrix, extraction records | `Evidence Support Matrix.md/json` | assertion IDs, citation validation, source linking | judge support strength and gaps | High | "support each point with documents" | Needs strong guardrails before UI exposure |
| 8 | Contradictions / Inconsistencies Finder | chronology, source inventory, positions, extraction records | `Contradictions.md/json` | compare dates, amounts, names, duplicate facts | explain why conflict matters | Medium-High | "find inconsistencies", "check opponent contradictions" | Strong native reviewer skill |
| 9 | Missing Evidence / Gap List | source inventory, chronology, positions, evidence matrix | `Evidence Gaps.md/json` | detect absent expected artifacts from templates | infer practical missing proof from case theory | Medium | "what is missing", "what documents are needed" | Native because it drives lawyer action |
| 10 | Client Document Request List | gap list, parties, chronology, positions | `Client Requests.md` | request grouping and priority labels | write client-readable reasons carefully | Low-Medium | "draft client request email/list" | Should consume gap list, not reread all docs |
| 11 | Matter Brief / Counsel Note | all prior native artifacts | `Counsel Note.md` | assemble sections, cite sources, show flags | synthesize facts, issues, risks, next actions | High | "make case brief", "make counsel note" | Should wait until prior artifacts are reliable |
| 12 | Drafting Pack Builder | chronology, issues, relief, evidence, gaps | `Drafting Pack.md` | reusable block assembly, citation retention | draft neutral/source-backed building blocks | High | "prepare drafting base", "make skeleton for filing" | Later phase; should not precede understanding skills |

## High-Value Threshold

A native skill is genuinely high value only if it changes the lawyer's next
action.

Weak native skill:

```text
Here is a summary of the file.
```

Strong native skill:

```text
Here is the chronology you can review for a writ petition. These events help
your case, these adverse events must still be disclosed, these points need
source review, and these missing documents should be requested before drafting.
```

The second skill earns its cost because it gives the lawyer a decision surface.
It does not merely produce prose.

Use these high-value checks:

- Does this skill make the lawyer faster at a real task?
- Does it reduce uncertainty about the file?
- Does it produce something reviewable and reusable?
- Does it reduce a later expensive model call?
- Does it prevent a risky custom prompt?
- Does it expose weaknesses rather than only beautify the case?
- Would a senior lawyer trust a junior more if this artifact existed before
  drafting started?

## Immediate Product Decision Needed

The next decision is whether List of Dates should become a skill family rather
than a single output:

```text
/create_listofdates
  preparation chronology
  court-facing chronology
  limitation chronology
  procedural chronology handoff
```

The court-facing mode is especially important for SLPs and writs because the
chronology is not merely informational. It is part of advocacy. The native
design should acknowledge that reality while enforcing candour.

This document now includes the first native skill matrix. If this direction is
accepted, the next concrete artifact should be an implementation planning table
with these columns:

- skill name;
- lawyer question;
- input artifacts;
- output artifact;
- source-backed fields;
- deterministic parts;
- model-heavy parts;
- cost risk;
- custom-skill demand replaced;
- implementation status.
