# Matter Workbench — Skills User-Journey Review · Run 1

> **Run 1 · 2026-06-12 15:56 IST · branch `codex/matter-workbench-checkpoint-2026-05-17` · commit `5e3ffcd`**
> Analysis performed against the working tree at `5d64a13`; verified by diff that none of the 7 commits `5d64a13..5e3ffcd` touch the skills surface (`routes/skill-factory-routes.mjs`, `react-ui/src/views/SkillsPage.tsx`, `CommandPanel`, `configurable-skill-*`), so all citations remain current at `5e3ffcd`.
> Stable entry: `latest.md` · history: `../INDEX.md` · home: `claude_review/`.

A **product/UX journey review**, not an engineering-quality pass. Question under review: *is the user journey of skills too complicated?* Method: reconstructed the journey end-to-end from code (every screen, route, state enum, and ledger), counted its cost, compared against the product docs and the founding contract, and grounded the verdict in the live funnel data in the repo's own ledgers. Returns findings and recommendations, not code changes.

---

## Verdict

**The run journey is fine. The creation journey is too complicated — but in a specific, fixable way.** It is not that the pipeline has too many steps; it is that too many internal concepts are visible to the user, and too many paths dead-end with no way back. The funnel data proves the leak: **21 ideas → 12 stuck `incomplete` → only 8 skills ever created** (57% abandonment, structural rather than motivational).

The yardstick is the repo's own founding contract — `docs/archive/2026-05-13/new-skill-creation-contract.md:33-50` defines the lawyer-facing end-state as **three beats**: *"I described the skill. I approved a sample output. Now I can use the skill,"* and explicitly warns that briefs and readiness gates "are not the lawyer-facing end-state." The implementation has drifted to **~7 visible beats** with **4–5 sequential AI waits** and **~12–14 user-facing concepts**.

**Do not simplify the pipeline itself** — the interview → real-matter sample → approve → validated-create spine is the product's differentiation, and `docs/product-features-and-differentiation.md:210-228` documents it as intentional. Simplify the **surface and the exits**.

---

## The journey as implemented (reference map)

### Personas & entry points

- Two effective roles: lawyer (any non-superuser, or anyone when auth is off) and operator/superuser, gated by `canSeeOperatorSurface()` (`react-ui/src/lib/lawyerMode.ts:25-31`).
- Skills are **not** hidden from lawyers: Skills tab (`SkillsPage.tsx`, ungated), Matter Assistant command rail on every screen (`App.tsx:516-525`), Activity tab for run history. Lawyer mode hides only the `.json` metadata twins of outputs in the tree (`lawyerMode.ts:18-23,44`).
- Creating a skill has exactly **one entry point**: the CommandPanel ("new skill" chip at `CommandPanel.tsx:526-536`, ~12 trigger phrasings in `lib/skillIdeaInput.ts:1-32`, or AI intent routing of free text at `CommandPanel.tsx:383-419`). The Skills tab itself has **no create button** — its empty state points back at the Assistant (`SkillsPage.tsx:344-346`).

### Creation flow (happy path)

1. **Intent gate** — free text triggers `POST /api/skills/check-intent`; the router has 8 decision values (`services/skill-router-service.mjs:11-20`) and may interpose a two-button "Choose how to continue" gate (`CommandPanel.tsx:503-523`).
2. **Interview** — `POST /api/skill-ideas/plan-interview` (AI planner) generates questions; user answers one at a time (`useSkillIdeaSessionMachine.ts:106-171`; static-question fallback in `lib/skillIdeaSession.ts:39-73`).
3. **Save idea** — explicit button → `POST /api/skill-ideas`; answers fold into an 8-field design brief with silent defaults (`shared/skill-idea-design-brief.mjs:3-12,47-56`); persisted `incomplete`.
4. **Generate sample** — disabled until a matter is active (`SkillIdeaSession.tsx:119-127`); `POST /api/skill-ideas/sample-output` generates against the **real active matter** (409 "Pick a test matter" otherwise, `services/skill-sample-output-service.mjs:40-52`); versioned with a `designBriefHash` (`services/skill-samples-service.mjs:26-57`).
5. **Approve → overlap gate → create** — "Looks useful" runs a 3-call chain (`lib/skillIdeaSessionActions.ts:161-195`): approve (409 if brief changed since sampling) → AI overlap check → `create-skill`. Blocking overlap demands a typed justification (`SkillIdeaSession.tsx:164-212`); the server re-checks independently (`routes/skill-factory-routes.mjs:120-124,251-265`).
6. **Creation pipeline** — AI authoring → slash assignment → draft → **AI validation run** against the matter (`services/configurable-skill-creation-pipeline.mjs:24-117`). Failure stores a `<slash>_failed_validation` draft and returns 422 (`:92-107`); success activates and disables the previous version.

### Run & results

- Three run paths, all → `POST /api/configurable-skills/run` (synchronous; AI run awaited inside the HTTP request, `routes/skill-factory-routes.mjs:158-183`): Skills-tab Run button (1 click), command box (gated by an AI intent round-trip even for exact slashes, `App.tsx:403`), autocomplete.
- Existing output → `requires_overwrite` (`configurable-skills-service.mjs:136-143`); the two surfaces handle it differently (button flip vs panel; declining from the rail records a cancelled run, walking away from the button records nothing — `App.tsx:290-355` vs `SkillsPage.tsx:96-116`).
- Output: `<targetLane>/<outputArtifact>.md` + `.json` twin (`services/configurable-skill-run-artifacts.mjs:7-38`), default lane `20_Workshop` (shown to lawyers as "Case Analysis"). Found via tree (auto-refreshed) or Activity → run card → "Open output" (1–2 clicks).

### State enums & artifacts (the concept surface)

- **Idea**: `incomplete → ready_for_review | parked | dismissed` (+2 legacy mappings) + an 8-item readiness checklist (`shared/skill-idea-statuses.mjs`, `shared/skill-idea-design-brief.mjs:58-67`).
- **Sample**: `current / stale / approved_current / approved_stale`, versioned (`skill-samples-service.mjs:213-223`).
- **Skill**: `draft / active / suspended / archived / disabled ("previous version") / deleted` (`configurable-skills-service.mjs:75-80`).
- **Run**: `succeeded / failed / cancelled` + transient `requires_overwrite` + UI receipts `running`, `output_missing`.
- Ledgers: `skill-ideas.json` (21), `skill-samples.json` (15), `configurable-skills.json` (8), `configurable-skill-runs.json` (35), `skills/registry.json` + 8 built-ins, plus the parallel job ledger; Postgres twins of each in runtime-DB mode (`server.mjs:144-188`).
- **17 API endpoints** in `routes/skill-factory-routes.mjs` (registry, intent, 7×idea/sample/brief, health, 5×skill/lifecycle/run).

### Journey cost

| Journey | Cost |
|---|---|
| Create a skill (happy path) | ~5–7 clicks + N typed answers + **4–5 sequential AI waits** (+ possible intent gate, + possible typed overlap justification) |
| Run an existing skill | **1 click** (Skills tab) · type+Enter+1 AI round-trip (command box) |
| Find the output | 1–2 clicks (tree, or Activity → Open output) |
| Concepts to hold | **~12–14** (contract budgeted ~4) |

---

## Findings

```
id: SJ1 | severity: high | verdict: brittle (journey dead end)
issue: Saved ideas are unresumable — the Skills page shows the graveyard but offers no shovel
location: react-ui/src/views/SkillsPage.tsx:562-577 (SkillIdeaRow: title+status, zero actions)
evidence: 12 of 21 ledger ideas stuck `incomplete`; once the CommandPanel session closes there
  is no UI path to resume, sample, park, or dismiss an idea
impact: every interrupted creation silently loses all interview/brief work; the 57% abandonment
  funnel is structural
fix: make idea rows actionable — "Continue" reopens SkillIdeaSession at the correct phase
  (brief exists → offer Generate sample; sample exists → offer review); add park/dismiss buttons
  (statuses and endpoints already exist server-side: POST /api/skill-ideas/:id/status)
```

```
id: SJ2 | severity: high | verdict: brittle (journey dead end)
issue: Failed validation is terminal — the journey's most expensive moment ends in "delete and start over"
location: services/configurable-skill-creation-pipeline.mjs:92-107 (stores `<slash>_failed_validation`
  draft, returns 422); configurable-skills-service.mjs:79 (lifecycle: draft → delete only);
  SkillsPage.tsx:411-419 (UI offers only Delete)
evidence: failure lands after 3 AI calls (authoring + overlap + validation) of accumulated user effort
impact: the most invested users hit the hardest wall; no retry, no revalidate, no edit-and-retry
fix: add a retry/revalidate transition for draft skills (re-run validation, or re-author from the
  same approved sample); surface the validation failure reason on the draft row
```

```
id: SJ3 | severity: medium | verdict: brittle (latency + failure mode on the hot path)
issue: The AI intent router gates deterministic actions
location: react-ui/src/App.tsx:403 (exact custom slash still routed through checkIntent);
  CommandPanel.tsx:383-419 (8-way decision + possible 2-button gate); App.tsx:435 (router
  failure → "Could not check that command")
evidence: running an exact, unambiguous slash costs an AI round-trip and can fail entirely;
  the Skills-tab Run button is the only AI-free path
impact: the most common action (run a known skill) inherits AI latency and an AI failure mode
fix: exact slash match → dispatch directly; reserve checkIntent for free text
```

```
id: SJ4 | severity: medium | verdict: overgrown (concept surface)
issue: Internal state machinery leaks into the lawyer-facing UI, tripling the concept count
location: explicit "Save idea" step (lib/skillIdeaSessionActions.ts:84-90); sample state/version
  labels (skill-samples-service.mjs:213-223); "previous version" + 6-state lifecycle
  (configurable-skills-service.mjs:75-80); readiness checklist (shared/skill-idea-design-brief.mjs:58-67)
evidence: founding contract (docs/archive/2026-05-13/new-skill-creation-contract.md:33-50) names
  three lawyer-visible beats and says the rest must stay invisible; implementation shows ~12-14 concepts
impact: the journey *feels* heavier than its step count because each step introduces vocabulary
fix: fold "Save idea" into "Generate sample" (auto-save the brief); keep idea/sample statuses
  internal; lawyer-visible states collapse to: describing → sample ready → created
```

```
id: SJ5 | severity: medium | verdict: brittle (hidden affordances)
issue: Load-bearing transitions exist only as undiscoverable typed commands
location: lib/skillIdeaSessionCommands.ts:1-8,57-85 ("mark ready", "copy sample v2",
  "copy review packet", "start another idea"); useSkillIdeaSessionMachine.ts:468 (the ONLY
  UI write of `ready_for_review` is the typed phrase "mark ready")
evidence: GET /api/skill-ideas/:id/samples has no other UI caller; 2 ledger ideas sit in
  `ready_for_review` with no reviewer surface anywhere (no doc describes who reviews them)
impact: features exist, ship, and are invisible; the review loop has a status but no reviewer
fix: either give these buttons in SkillIdeaSession, or delete the statuses/commands until a
  review surface exists — a state no UI can reach is debt, not optionality
```

```
id: SJ6 | severity: low | verdict: brittle (false affordance + abort-heavy session)
issue: "Park for later" doesn't park, and matter changes abort the session at 6 separate points
location: useSkillIdeaSessionMachine.ts:484-486 (park clears local overlap-gate state only;
  server idea stays `incomplete`); :119-127,206-214,261-269,291-303,361-368 (six
  "Matter changed... start again" notice paths, each discarding step progress)
impact: the button lies; switching matters mid-creation punishes the user with redone work
fix: park → POST /api/skill-ideas/:id/status {parked}; on matter change, preserve the brief
  and re-anchor the session instead of aborting (only the sample is matter-bound)
```

```
id: SJ7 | severity: low | verdict: brittle (blocking run + inconsistent overwrite)
issue: Skill runs block synchronously with no cancel; overwrite handling diverges by surface
location: routes/skill-factory-routes.mjs:158-183 (AI run awaited in the HTTP request);
  SkillsPage.tsx:360-372 (frozen "Running..." button); App.tsx:290-355 vs SkillsPage.tsx:96-116
  (rail records a cancelled run on decline; tab button records nothing and resets silently
  on matter change)
impact: long runs freeze the UI with no escape; the run ledger undercounts declined overwrites
  from one of the two surfaces
fix: move runs onto the existing async job ledger (jobStatusService already tracks them) with
  polling, like /describe_sources; unify overwrite handling in one shared hook
```

```
id: SJ8 | severity: low | verdict: brittle (persona mismatch)
issue: Lawyers see a problem chip whose only remedy is operator-gated
location: SkillsPage.tsx:310-314 ("Setup needs attention" health chip, shown to everyone);
  ActivityBar.tsx:11 (Settings tab operator-only)
impact: a lawyer is told something is wrong and given no path to act — alarm without agency
fix: gate the chip to operators, or replace the lawyer-facing copy with "tell your operator"
  plus a one-click feedback prefill
```

---

## What the journey does well (keep these)

- **Run-and-find is minimal:** 1 click to run, 1–2 to find output, with the tree auto-refreshing after runs (`SkillsPage.tsx:124-127`).
- **Samples are generated against the real active matter** before any commitment (`skill-sample-output-service.mjs:40-52`) — the user approves evidence, not a promise. This is the differentiator; protect it.
- **Server-side gates are real, not cosmetic:** approve 409s when the brief drifted from the sample (`designBriefHash`); overlap is re-checked server-side on create (`skill-factory-routes.mjs:251-265`); validation runs the authored skill before activation.
- **Docs and code agree** on the intended lifecycle (`docs/product-features-and-differentiation.md:210-228`), and the tester brief already anticipates the sore spots this review confirms (`docs/private-beta-tester-brief.md:43,56,82` — "output exists but gives no way to continue" is a named stop-and-report condition).

## Themes

- **The complexity is in exits, not steps.** Every high-severity finding (SJ1, SJ2) is a missing way *back into* the pipeline, not an extra step *in* it. The steps only feel heavy because abandoning or failing one means starting over.
- **Drift from the founding contract is measurable:** 3 promised beats → ~7 implemented; ~4 budgeted concepts → ~12–14 visible. The contract document itself (archived 2026-05-13) predicted this failure mode and warned against it.
- **Two surfaces, one journey, diverging behavior** (overwrite handling, run recording, create-entry-point) — the repo's chronic twin-drift disease (quality-pass T7) expressed at the UX layer.

## Addendum (2026-06-12 16:01 IST, same commit) — field evidence from live UX testing

After this report was written, the owner ran a live UX test (Claude browser extension, all 8 builtin workflows via the command box, matter "State v Rajesh Mehra"). The tester independently hit the discoverability wall this review predicted (SJ3/SJ5: "features exist, ship, and are invisible") — and the session surfaced two findings the static analysis missed. Each tester claim was re-verified against the code before recording.

**Tester's Bug 1 ("4 of 8 workflows have no slash command") — re-diagnosed: all 8 commands exist; the real bug is that menu labels don't match slash names and nothing bridges them.** The matcher resolves all 8 slashes regardless of panel visibility (`resolveNativeCommand`, `react-ui/src/lib/nativeCommands.ts:122-132`); the "failing" four are `/matter-init`, `/context_preview`, `/context_search`, `/doctor`. The tester guessed `/setup_matter`, `/preview_matter_context`, `/find_in_matter`, `/check_matter_health` from the sidebar labels ("Set up matter", "Preview matter context", "Find in matter", "Check matter health") — every guess reasonable, every guess wrong. Typing the exact slash would have worked.

**Tester's Bugs 2 & 4 (no autocomplete; panel shows 4 of 8) — confirmed, one root cause.** The four invisible builtins are flagged `showInCommandPanel: false` (`nativeCommands.ts:15-94`), and the suggestion list merges only the static four plus *custom* skills (`CommandPanel.tsx:144-160`) — builtins never enter autocomplete.

**Tester's Bug 3 (unknown slash silently becomes a copilot question) — confirmed; it is the complement of SJ3.** Unmatched slash input falls through `resolveNativeCommand` → null → the AI intent router → copilot. No "command not found" path exists for slash-prefixed input. SJ3 recommended exact-match-bypasses-router; the field test establishes the inverse half: no-match should error with suggestions, not silently answer as free text.

Two new findings from the session:

```
id: SJ9 | severity: medium | verdict: brittle (active misroute)
issue: The alias for one command's menu label runs a different command
location: react-ui/src/lib/nativeCommandAliases.ts:5 ("setup matter" → /prepare_matter)
  vs nativeCommands.ts:17-25 (menu item "Set up matter" = /matter-init)
evidence: a user typing the exact name of the menu item they want ("setup matter")
  is routed to /prepare_matter, a different workflow; no aliases exist at all for
  the labels "preview matter context", "find in matter", "check matter health"
impact: the one natural-language bridge between labels and slashes points at the
  wrong target; the other three hidden builtins have no bridge whatsoever
fix: alias each menu label verbatim to its own command; repoint "setup matter"
  to /matter-init
```

```
id: SJ10 | severity: low | verdict: brittle (stale-on-auth suggestion load)
issue: Command suggestions load once on mount and never reload after login
location: react-ui/src/components/command/CommandPanel.tsx:143-167 (loadCommandSuggestions
  called from a mount-only useEffect; 401 pre-login falls back to STATIC_SUGGESTIONS)
evidence: tester's session logged "command suggestions unavailable: Login required";
  after login the catch-path fallback persists — custom-skill autocomplete is silently
  missing for the rest of the session
impact: authenticated beta users lose custom-skill discovery whenever the panel
  mounted before login completed
fix: re-trigger loadCommandSuggestions when auth state (authUser/authEnabled) changes
```

**Disposition:** SJ3/SJ5/SJ9/SJ10 plus the panel-visibility flags were spawned as a self-contained fix task (chip `task_e1f091aa`: surface all builtins in autocomplete, add command-not-found with nearest-match suggestions, fix the alias table, reload suggestions on auth change).

## Recommended order

1. **SJ1** — resumable ideas (highest leverage; pure UI affordance over existing endpoints).
2. **SJ2** — retry on failed validation (rescues the most invested users).
3. **SJ3** — bypass the router for exact slashes (one conditional).
4. **SJ4** — collapse Save-idea into Generate-sample and hide internal statuses.
5. SJ5–SJ8 opportunistically, ideally alongside the quality-pass queue items touching the same files (the sync-run change in SJ7 pairs naturally with quality-pass F21's heartbeat work on the job ledger).

---

> **⏳ Currentness.** Valid for commit `5e3ffcd` at 2026-06-12 15:56 IST, addendum 16:01 IST (analysis at `5d64a13`; diff-verified no skills-surface changes between). Re-run after changes to `routes/skill-factory-routes.mjs`, `SkillsPage.tsx`, `CommandPanel.tsx`, the `SkillIdeaSession` machine, or `configurable-skill-*` services. Funnel counts (21/15/8/35) are ledger snapshots at write time.
