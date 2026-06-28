# Case Analysis Posture Diagnosis Implementation Plan

Date: 2026-06-28
Status: Implementation plan draft — review before coding

## Purpose

This plan turns the accepted SME direction into an implementation path for Matter Workbench.

It covers two related but separable moves:

1. Rename the current neutral List of Dates surface to **Case Timeline** at the presentation layer.
2. Add an automatic **Filing and Procedural Posture Diagnosis** artifact that runs last, after Case Timeline and Matter Story, and is treated as provisional until the lawyer confirms or corrects it.

This plan does **not** yet implement an advocacy MW List of Dates. The goal is to crack the diagnosis layer first.

Related source notes:

- [Legal Practice SME Q&A Ledger](legal-practice-sme-qna-ledger.md)
- [Case Analysis, Procedural Posture Diagnosis, and MW List of Dates](case-analysis-posture-diagnosis-and-lod.md)
- [Chronology / List of Dates](native-skill-chronology-list-of-dates.md)
- [Matter Story Lifecycle](matter-story-lifecycle.md)

## Worktree / Branch

Do this in a sibling worktree, not directly in the deployed `main` checkout:

```text
/Users/aksingh/matter-workbench-posture-diagnosis
branch: feature/case-analysis-posture-diagnosis
```

Start from current `origin/main`:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git worktree add ../matter-workbench-posture-diagnosis -b feature/case-analysis-posture-diagnosis origin/main
```

Do not deploy until the first coherent slice is complete, reviewed, merged, and release-gated.

## Product Goal

The matter preparation sequence should eventually feel like:

```text
Set up matter
Extract documents
Label sources
Build Case Timeline
Write Matter Story
Diagnose filing/procedural posture
Check advisory
```

The diagnosis should answer, with uncertainty clearly marked:

- What court/forum appears relevant?
- What is the current procedural posture?
- What filings/remedies are possible?
- What filing/remedy appears most imminent or central?
- What legal objective should downstream drafting serve?
- What governing statute/rules/framework appear material?
- What adverse, missing, or uncertain facts need lawyer attention?
- What should the lawyer confirm before relying on the diagnosis?

## Non-Goals For This Slice

Do not implement yet:

- final advocacy MW List of Dates;
- court-specific filing templates;
- lawyer-edited pleading drafts;
- in-app rich editor for Case Analysis;
- migration of existing file paths away from `10_Library/List of Dates.*`;
- deletion or rewriting of existing List of Dates artifacts;
- public/self-serve legal advice wording;
- one-click legal approval.

## Naming And Artifact Model

### Case Timeline Rename

First slice is **presentation-only rename**.

Keep internal stable names for now:

```text
/create_listofdates
10_Library/List of Dates.md
10_Library/List of Dates.json
10_Library/List of Dates.csv
```

Display these as:

```text
Case Timeline
```

Rationale: avoid migration risk while aligning the product language.

### Filing and Procedural Posture Diagnosis Artifact

Preferred first-slice path:

```text
20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md
20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json
20_Workshop/Case Analysis/Case Analysis Q&A.md
```

Why under `20_Workshop`:

- existing MW-authored analytical artifacts already live in `20_Workshop`;
- Matter Story currently lives at `20_Workshop/The Story.md`;
- this avoids introducing a new top-level lane before the workspace/navigation contract is reviewed;
- the visible folder is still `Case Analysis`.

Later product design may promote `Case Analysis` to a first-class top-level lane if the UI needs it.

## Preparation Order

Current order includes:

```text
/matter-init
/extract
/describe_sources
/create_listofdates
/the_story
```

New conceptual order:

```text
/matter-init
/extract
/describe_sources
/create_listofdates      # displayed as Build Case Timeline
/the_story               # Matter Story
/posture_diagnosis       # new internal/native operation, naming TBD
```

The diagnosis must run **last**, after Case Timeline and Matter Story are current.

If a new document is added:

1. extraction/source labels may become stale;
2. Case Timeline may become stale;
3. Matter Story may become stale;
4. Filing and Procedural Posture Diagnosis becomes stale;
5. automatic preparation refreshes them in order.

## Staleness Rules

The diagnosis is current only if:

- diagnosis markdown exists;
- diagnosis JSON sidecar exists or can be reconstructed safely;
- Case Timeline exists and is current;
- Matter Story exists and is current;
- diagnosis mtime/hash is at least as fresh as the Case Timeline and Story inputs;
- no newer source/input makes upstream artifacts stale.

Staleness labels:

```text
missing              -> no diagnosis exists yet
blocked              -> Case Timeline or Matter Story missing/stale
stale                -> upstream timeline/story changed after diagnosis
current_unconfirmed  -> diagnosis current but lawyer has not confirmed/corrected
current_confirmed    -> lawyer confirmed current working posture
current_corrected    -> lawyer corrected posture; diagnosis/Q&A reflects correction
needs_reconfirmation -> upstream changed after confirmation
```

For first implementation, UI can simplify labels to:

- Not started
- Waiting on Case Timeline / Story
- Needs refresh
- Ready for lawyer confirmation
- Confirmed working posture
- Correction recorded

## Diagnosis Output Shape

### Markdown Sections

`Filing and Procedural Posture Diagnosis.md` should be lawyer-readable and clearly provisional.

Suggested structure:

```markdown
# Filing and Procedural Posture Diagnosis

Author: MW
Status: Provisional — lawyer confirmation required
Based on: Case Timeline ..., Matter Story ..., Source Index ...
Generated: ...

## Short Diagnosis

...

## Court / Forum

- MW inference:
- Confidence:
- Why:
- Lawyer to confirm:

## Procedural Posture

- MW inference:
- Current stage:
- Important pending or imminent step:
- Lawyer to confirm:

## Possible Filings / Remedies

| Priority | Filing / remedy | Why it may be available | Key facts | Caveats |
| --- | --- | --- | --- | --- |

## Recommended Working Path

...

## Governing Statute / Rules / Framework

...

## Facts Central To The Posture

...

## Adverse Or Difficult Facts To Handle

...

## Missing Information / Documents

...

## Lawyer To Confirm Before Downstream Drafting

- [ ] Court/forum
- [ ] Procedural stage
- [ ] Priority filing/remedy
- [ ] Main relief/objective
- [ ] Governing statute/rules
- [ ] Limitation/deadline concerns
- [ ] Adverse facts treatment

## Internal Source Handles

...
```

### JSON Sidecar

`Filing and Procedural Posture Diagnosis.json` should carry structured state for later UI and downstream skills.

Draft shape:

```json
{
  "schema_version": "procedural-posture-diagnosis/v1",
  "author": "MW",
  "status": "mw_inferred",
  "generated_at": "",
  "matter": {
    "name": "",
    "client_side": "",
    "client_side_confidence": "low|medium|high|unknown"
  },
  "based_on": {
    "case_timeline_path": "10_Library/List of Dates.md",
    "case_timeline_updated_at": "",
    "matter_story_path": "20_Workshop/The Story.md",
    "matter_story_updated_at": "",
    "source_index_path": "10_Library/Source Index.json"
  },
  "court_forum": {
    "value": "",
    "confidence": "low|medium|high|unknown",
    "reason": "",
    "lawyer_confirmed": false
  },
  "procedural_posture": {
    "value": "",
    "confidence": "low|medium|high|unknown",
    "reason": "",
    "lawyer_confirmed": false
  },
  "possible_filings": [
    {
      "priority": "primary|secondary|parked|not_advised_yet|unknown",
      "filing_or_remedy": "",
      "reason": "",
      "key_facts": [],
      "caveats": []
    }
  ],
  "recommended_working_path": {
    "filing_or_remedy": "",
    "reason": "",
    "lawyer_confirmed": false
  },
  "governing_law": [],
  "adverse_or_difficult_facts": [],
  "missing_information": [],
  "lawyer_to_confirm": [],
  "confirmation": {
    "state": "unconfirmed|confirmed|corrected|not_sure|needs_reconfirmation",
    "confirmed_at": "",
    "reason_or_correction": "",
    "actor": "lawyer|operator|unknown"
  }
}
```

## Lawyer Confirmation Gate

The diagnosis should be generated automatically, but downstream use should be guarded.

First-slice UI can mirror the archive-confirmation pattern:

```text
Confirm procedural posture

MW has inferred the court, current stage, possible filings, and likely next step.
Confirm this as the working posture before using it for MW List of Dates or drafting.
```

Actions:

1. **Confirm as working posture**
2. **Disagree / correct**
3. **Not sure yet**

Rules:

- Confirm means: "confirmed as current working posture for analysis".
- It does **not** mean final legal approval or court-ready correctness.
- Disagree/correct requires a reason or correction.
- Not sure may require a note if downstream drafting is attempted.
- The confirmation should append to the Q&A ledger and update the diagnosis sidecar status.

Suggested Q&A append:

```markdown
### 2026-06-28 20:15 — Procedural posture confirmation

**MW inferred:** ...

**Lawyer response:** Confirmed / corrected / not sure.

**Reason or correction:** ...

**Effect on analysis:** ...
```

If upstream Case Timeline or Matter Story changes after confirmation, mark the diagnosis as:

```text
needs_reconfirmation
```

Do not silently carry old confirmation forward as current legal posture.

## Backend Implementation Touch Points

Likely files / areas:

- `services/prepare-matter-service.mjs`
  - add diagnosis stage after `/the_story`;
  - block until Case Timeline and Matter Story are current;
  - add current/stale/missing logic.

- `services/matter-status-service.mjs`
  - include diagnosis in matter status / overview if needed.

- `react-ui/src/lib/autoPreparationRunner.ts`
  - add progress step after story;
  - display Case Timeline wording for existing chronology step.

- `services/matter-story-service.mjs`
  - presentation copy changes from List of Dates to Case Timeline where appropriate;
  - no behavior change unless diagnosis needs story status helpers.

- New service, likely:
  - `services/procedural-posture-diagnosis-service.mjs`

  Responsibilities:

  - read diagnosis status;
  - build bounded input packet from matter metadata, Case Timeline, Matter Story, Source Index, and matter context;
  - call app-owned provider policy;
  - validate structured output;
  - write markdown and JSON sidecar;
  - append/update Case Analysis Q&A confirmation entries.

- `server.mjs`
  - wire new service.

- `routes/api-routes.mjs` or relevant route group
  - add endpoints for status/run/confirmation.

- Runtime DB storage service
  - ensure diagnosis artifacts persist in runtime DB mode, not only filesystem mode.
  - Do not ship to private beta if runtime DB path cannot read/write the new artifacts.

## Provider / Model Policy

Use app-owned provider policy, not user-selected Copilot policy.

Quality-cracking recommendation:

```text
Proposer:  GPT-5.5-class model
Critic:    o3-class reasoning model
Finalizer: GPT-5.5-class model, revising after critique
```

This mirrors legal chamber workflow:

```text
junior note -> senior critique -> revised final note
```

The critic should not replace the diagnosis. It should challenge unsupported leaps, overconfidence, missing procedural paths, adverse-fact gaps, and insufficient lawyer-confirmation items. The finalizer then accepts/rejects critique signals and produces the final provisional diagnosis.

For production wiring, likely first choice:

```text
AI_TASKS.SOURCE_BACKED_ANALYSIS
```

or a new task if needed later:

```text
AI_TASKS.PROCEDURAL_POSTURE_DIAGNOSIS
```

Given this is core legal intelligence, a dedicated model-policy task is likely desirable before release, but the prototype can reuse `SOURCE_BACKED_ANALYSIS` with model overrides.

Provider prompt must compose the legal workbench policy prompt and enforce:

- provisional status;
- no final legal advice claim;
- no court-ready claim;
- no unsupported facts;
- source handles for audit;
- uncertainty and lawyer-confirmation section;
- adverse facts must be handled, not suppressed.

## Frontend Implementation Touch Points

### Presentation rename

Change visible neutral chronology labels to **Case Timeline** where it is clearly the current neutral artifact.

Likely areas:

- `react-ui/src/lib/autoPreparationRunner.ts`
- `react-ui/src/lib/nativeCommands.ts`
- `react-ui/src/views/workflows/ListOfDatesResult.tsx`
- `react-ui/src/components/layout/MainContent.tsx`
- `react-ui/src/lib/presentationLabels.ts`
- `react-ui/src/views/MatterOverview.tsx`
- `react-ui/src/views/HomeLanding.tsx`
- `react-ui/src/views/SkillsPage.tsx`
- `react-ui/src/views/workflows/PrepareMatterResult.tsx`

Keep command aliases such as `list of dates` readable for now. Do not break existing user muscle memory.

### Diagnosis UI

First UI location:

- Matter Home / Matter Overview, near Matter Story and preparation status; or
- a new `Case Analysis` card/section under the Matter Home.

First-slice card should show:

- diagnosis state;
- last generated time;
- based-on Case Timeline and Matter Story;
- top inferred court/forum;
- top inferred procedural posture;
- recommended working path;
- lawyer-to-confirm count;
- confirmation actions.

Avoid a large editor initially. Use a confirmation panel similar to archive confirmation.

## API Sketch

Names are draft.

```http
GET /api/procedural-posture-diagnosis?matter=...
POST /api/procedural-posture-diagnosis
POST /api/procedural-posture-diagnosis/confirmation
```

Request examples:

```json
{
  "matterName": "...",
  "overwrite": true
}
```

```json
{
  "matterName": "...",
  "decision": "confirmed|corrected|not_sure",
  "reasonOrCorrection": "...",
  "idempotencyKey": "..."
}
```

Response should include stable status codes for:

- missing matter;
- missing Case Timeline;
- missing Matter Story;
- provider unavailable;
- invalid model output;
- runtime DB persistence unavailable;
- confirmation requires reason/correction.

## Test Plan

### Unit / service tests

- Diagnosis service refuses to run without Case Timeline and Matter Story.
- Diagnosis service writes markdown and JSON sidecar.
- Diagnosis service marks status stale when Case Timeline or Story is newer.
- Diagnosis service marks `needs_reconfirmation` when upstream changes after confirmation.
- Provider output validation fails closed on malformed JSON.
- Prompt includes legal policy, provisional wording, lawyer-confirmation requirement, and adverse-fact handling.
- Confirmation requires reason for `corrected` / `not_sure` where appropriate.
- Confirmation appends to Case Analysis Q&A without deleting earlier entries.

### Preparation tests

- Prepare plan orders diagnosis after story.
- Diagnosis stage is blocked until Case Timeline and Story are current.
- Diagnosis stage runs last in automatic preparation.
- New documents can make diagnosis stale through upstream stages.

### UI tests

- Neutral chronology appears as Case Timeline in key surfaces.
- Existing `/create_listofdates` command remains accepted.
- Matter Home shows diagnosis state and confirmation actions.
- Disagree/correct requires a reason/correction.
- Confirmation copy says working posture, not final legal approval.

### Runtime DB tests

- Runtime DB mode can persist diagnosis markdown and JSON sidecar.
- Runtime DB workspace exposes diagnosis artifact under `20_Workshop/Case Analysis/`.
- Runtime DB preparation plan can read diagnosis status without local matter folder.
- Runtime DB confirmation writes status and Q&A artifact safely.

### Regression tests

- Existing List of Dates generation still writes old internal paths.
- Matter Story still refreshes correctly from Case Timeline/List-of-Dates artifact.
- Source removal / active source suppression still makes downstream artifacts stale.
- Release-position tests unaffected.

## Rollout Plan

### Slice 0 — loop prototype / quality spike

- Use the isolated prototype script:

  ```bash
  node prototypes/posture-diagnosis-loop.mjs --dry-run
  node prototypes/posture-diagnosis-loop.mjs --provider openai-direct --proposer-model gpt-5.5 --critic-model o3 --finalizer-model gpt-5.5
  ```

- Feed it a small matter packet containing matter metadata, Case Timeline excerpt, Matter Story, and Source Index summary.
- Inspect proposer draft, critic signal, and final diagnosis before building app behavior.
- Decide whether the loop shape is good enough to wire into the product.

### Slice 1 — planning / review

- Review this plan.
- Resolve open decisions below.
- Create worktree and branch.

### Slice 2 — presentation rename only

- Change visible neutral chronology language to Case Timeline.
- Keep paths/commands unchanged.
- Add/update tests.
- No deployment unless explicitly desired.

### Slice 3 — diagnosis service and artifact

- Add filesystem + runtime DB artifact support.
- Add service and route.
- Add markdown + JSON output.
- Add provider validation and prompt.
- Add tests.

### Slice 4 — preparation integration

- Add diagnosis as last preparation stage.
- Add auto-preparation progress step.
- Add stale/current/blocking logic.
- Add tests.

### Slice 5 — confirmation gate

- Add Matter Home diagnosis card.
- Add confirm/correct/not-sure panel.
- Persist confirmation to JSON sidecar and Case Analysis Q&A.
- Add tests.

### Slice 6 — review and release decision

- Run focused and full tests.
- Manual UI smoke locally.
- Decide whether to merge and release.
- If released, cut a new beta release with docs/evidence.

## Validation Gates Before Merge

Minimum before merge to `main`:

```bash
npm test --silent
npm run ui:typecheck --silent
npm run ui:build --silent
git diff --check
```

Additional runtime DB / browser checks if diagnosis is enabled in private beta:

```bash
npm run db:runtime:browser-accept
npm run private-beta:ui-hardening-pass -- --base-url <local or beta URL>
```

Before any deploy:

- commit must be on clean pushed `main`;
- deploy exact commit;
- service check must pass;
- UI hardening must pass;
- ops pack should be recorded.

## Review Questions In Plain English

These are the decisions that actually need owner review before coding.

### 1. Where should Case Analysis live in the matter folder?

Option A — safer first slice:

```text
20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md
```

Option B — bigger product statement:

```text
Case Analysis/Filing and Procedural Posture Diagnosis.md
```

Why it matters: Option A fits the current folder system. Option B is cleaner conceptually but creates a new top-level lane and more UI/storage implications.

Recommended default: **Option A for now**. Make it visible as “Case Analysis” in the UI, but keep it technically under `20_Workshop` until the lane model is reviewed.

### 2. Should the user manually run posture diagnosis, or should preparation run it automatically?

Option A: automatic final step after Case Timeline and Matter Story.

Option B: user clicks a separate command/button, such as “Diagnose posture”.

Why it matters: Automatic makes every prepared matter more useful. Manual gives more control and avoids extra AI cost.

Recommended default: **automatic**, because you said this diagnosis is foundational and should precede MW LoD/drafting.

### 3. Do we need a visible slash command now?

Option A: no public command yet; it runs inside preparation.

Option B: add a command like `/diagnose_posture` for operators/power users.

Why it matters: Commands create user expectations. If we are still learning the output shape, hiding it behind preparation may be cleaner.

Recommended default: **internal-only first**, with the UI showing the generated artifact/status.

### 4. What should happen if the lawyer has not confirmed the diagnosis?

Option A: downstream MW LoD/drafting is blocked until confirmation.

Option B: downstream work can proceed, but with a clear warning that posture is unconfirmed.

Why it matters: Blocking is safer; warnings are more flexible during beta.

Recommended default: **block future MW LoD/drafting unless the lawyer confirms or explicitly chooses “proceed unconfirmed” with a reason**. For this first slice, there may be no downstream blocker because MW LoD is not implemented yet.

### 5. What should “Not sure yet” mean?

Option A: treat it as a stop sign for downstream drafting.

Option B: allow work to continue with a warning.

Why it matters: “Not sure” is common in real litigation, but it should not quietly become approval.

Recommended default: **not sure = unconfirmed**. It should not authorize downstream drafting unless the lawyer/operator deliberately proceeds with a reason.

### 6. How should confirmation be saved?

Option A: save it in the diagnosis status file and also append it to Case Analysis Q&A.

Option B: only append to Q&A and derive status from the Q&A later.

Why it matters: Option A is easier for the app to display. Option B is more audit-pure but harder to query.

Recommended default: **both**. JSON sidecar for app state; Q&A entry for human/audit trail.

### 7. Should the neutral chronology be called “Case Timeline” everywhere?

Option A: display simply as **Case Timeline**.

Option B: sometimes say **Neutral Case Timeline** for clarity.

Why it matters: “Neutral” explains the philosophy but may make the UI heavier.

Recommended default: **Case Timeline** in UI. Use “neutral, source-backed Case Timeline” only in help text/docs.

### 8. How broad should the rename be in the first slice?

Option A: app UI only.

Option B: app UI plus docs/release/runbook language.

Option C: also rename files/commands internally.

Why it matters: Internal rename is migration-heavy and risky.

Recommended default: **app UI first, docs selectively where needed, no internal path/command rename**.

### 9. Should posture diagnosis get its own model-routing task now?

Option A: reuse existing source-backed analysis route.

Option B: add a dedicated `procedural_posture_diagnosis` model task.

Why it matters: Dedicated route is cleaner for observability/cost later; reused route is simpler now.

Recommended default: **prototype using source-backed analysis with model overrides; add a dedicated task before product release if the loop is adopted**.

### 10. Should the production diagnosis use a proposer → critic → finalizer loop?

Option A: single model call produces the diagnosis.

Option B: proposer drafts, critic challenges, finalizer revises.

Why it matters: Single call is cheaper and simpler. The loop is more expensive but better matches legal reasoning and should reduce overconfident or one-sided posture diagnosis.

Recommended default: **test the loop first in the prototype; if quality is visibly better, wire the loop for this core diagnosis task**.

## Default Plan If Owner Agrees

Unless review changes the above:

- Use `20_Workshop/Case Analysis/` for the first artifact location.
- Keep `/create_listofdates` and existing `10_Library/List of Dates.*` paths unchanged internally.
- Display current neutral chronology as **Case Timeline**.
- Run diagnosis automatically as the final preparation step after Case Timeline and Matter Story.
- Keep diagnosis provisional until lawyer confirmation/correction.
- Confirmation gate has three choices: confirm, disagree/correct, not sure.
- Disagree/correct requires a reason.
- Not sure remains unconfirmed and should not silently authorize downstream drafting.
- Persist confirmation both in JSON sidecar and `Case Analysis Q&A.md`.
- Require reconfirmation when upstream Case Timeline or Matter Story changes.
- Test proposer → critic → finalizer in the prototype before product wiring.
- For production, prefer GPT-5.5-class proposer/finalizer and o3-class critic if available.
- Prototype with `SOURCE_BACKED_ANALYSIS` model overrides; add a dedicated model-policy task before release if adopted.
