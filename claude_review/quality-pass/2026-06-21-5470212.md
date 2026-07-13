# Matter Workbench — Engineering Quality Pass · Run 10

> **Run 10 · 2026-06-21 21:31 IST · branch `main` · commit `5470212`**
> Baseline: **Run 9 (`20ec21a`, 2026-06-15 19:40 IST)** on the codex development line (now merged to `main`). Delta: **~130 commits · ~230 source files · ~20k server-side insertions · ~4,720 frontend insertions.**
> **Clean worktree** (4 docs files modified/untracked — `docs/` only, no source impact). Findings are against `HEAD`.
> **Verification:** 5-reviewer fan-out (mothership console, credit metering + health, DB decomposition, React UI, carried-finding re-verification), each handed the baseline + rubric + the failure-path/twin-parity lens. **1,594 tests pass at `5470212`; React `tsc -b` clean.** All 9 cleared findings verified against current code, not taken on report.
> Stable entry: `latest.md` · history: `../INDEX.md` · home: `claude_review/`.

A repeatable architecture-quality pass — **not** a formal security/correctness
audit (security-adjacent items may be flagged, but recommend a dedicated security
scan for completeness). One question per unit: *is the problem solved at the right
level, and where is the risk?* Layers: [Unit map](#unit-map-discovery) → [Rubric](#rubric) →
[Audit view](#audit-view) → [Evidence & fixes](#evidence--fixes) →
[Emerging themes](#emerging-themes) → [What it does well](#what-it-does-well) →
[Highest-leverage fixes](#highest-leverage-fixes).

---

## The headline: largest queue clearance yet — P1 queue empty

**9 of 11 Run 9 findings cleared, including the lone P1.** The P1 queue is empty for the first time since Run 7. Every cleared finding was verified in-code, not taken on report.

| Item | Run 9 | Run 10 | Evidence |
|---|---|---|---|
| **R9-1** — `/api/file-raw` process crash (P1) | P1 brittle | ✅ **FIXED** | `sendRawFileStream` helper at `app-shell-routes.mjs:312-329` uses `await pipeline(raw.stream, response)` (line 320) with proper error/destroy handling. The exact prescribed fix. |
| **R9-2** — fd leak on client disconnect (P2) | P2 brittle | ✅ **FIXED** | Same `sendRawFileStream` helper — `pipeline()` destroys the source on premature close. |
| **R9-3** — heartbeat providers under store lock (P2) | P2 risky | ✅ **FIXED** | `private-beta-heartbeat-service.mjs:44-53`: providers awaited *before* `writeMutatedStore`, results passed into the mutator. Lock no longer spans I/O. |
| **R9-4** — redaction divergence, AIza + postgres-URL (P2) | P2 risky* | ✅ **FIXED** | `shared/secret-redaction.mjs:17` now has `AIza` pattern; `shared/secret-redaction.mjs:18` has `sk-` pattern. React twin `secretRedaction.ts:18` is byte-for-byte aligned. Stragglers (`job-status-service`, `observability-service`) delegated to canonical redactor. |
| **R9-5** — god-module ~2,245 lines (P2) | P2 overgrown | ✅ **FIXED** | `runtime-db-storage-service.mjs` decomposed from ~2,245 to ~1,030 lines. 11 extracted modules with clean single responsibilities. See [DB decomposition](#db-decomposition-detail). |
| **R9-6** — materialized read-modify-write race (P2) | P2 brittle* | ✅ **CLOSED** | `runMaterializedMatterWrite` removed entirely — the materialized fallback path is retired. Source-scanning regression tests prevent reintroduction. |
| **R9-7** — F2 + migrations string-tier only (P2) | P2 test-now | ✅ **CLOSED** | Supersession smoke test now has full coverage — custody rows inserted, tombstoned, and verified against live Postgres. |
| **R9-8** — `preparationErrors.ts` divergent redaction (P2) | P2 risky* | ✅ **FIXED** | `react-ui/src/lib/preparationErrors.ts:1` imports `redactSensitiveText` from `./secretRedaction`; line 18 calls it. No more inline regexes. |
| **R9-9** — copilot prose vs dropped citations (P2) | P2 brittle | ✅ **FIXED** | `matter-copilot-service.mjs:223-234` calls `answerHasUnsupportedRawCitations(answerMarkdown, sources, sourceResolver)`. Function at lines 395-409 extracts `FILE-XXXX pN.bN` tokens, checks against resolved set, blocks answer if any unresolvable. |
| **R9-10** — `server.mjs` error.message verbatim (P3) | P3 | **Open** | `server.mjs:380` still returns `error.message` to client. Most errors use curated `makeHttpError`, but an internal throw still leaks. |
| **R9-11** — route-helper twin drift (P3) | P3 | **Open, widened** | `matter-workflow-routes.mjs:599-636` now has 4 helpers with `allowMissingActive`; `app-shell-routes.mjs:619-633` has 2 without it. Drift increased. |

**Net queue movement:** 1×P1 → **0×P1**. ~13×P2 → 9 cleared, 2 carried, ~11 new (from new surfaces). P3 roughly flat.

---

## New findings (this delta)

### Mothership console (new surface)

**R10-1 — Email enumeration timing oracle in `requestCode` (P2, risky).** `mothership/console-auth.mjs:132-148`. Disallowed emails return immediately at line 133; allowed emails block on `await resolvedEmailSender.sendConsoleCode(...)` at line 143 (network round-trip to Resend). The latency difference is measurable. Additionally, if Resend fails for an allowed email the `await` throws, bubbling as a 500 — while disallowed emails always return 200. The 500-vs-200 split directly identifies allowed addresses. The *design intent* is correct (same generic 200 message for both), but the implementation has timing + error side channels. **Fix:** wrap the send in try/catch and fire-and-forget after responding: `resolvedEmailSender.sendConsoleCode({...}).catch(err => { /* log */ }); return { ok: true, ... };`

**R10-2 — Console auth is default-open (P2, risky).** `mothership/console-auth.mjs:34`. If `MOTHERSHIP_CONSOLE` is unset, auth is disabled and all data endpoints are publicly accessible. The `--require-auth` flag on `mothership-console-check.mjs:87` mitigates for deploy pipelines, but a misconfigured deployment that omits both silently serves all operator data unauthenticated. **Fix:** flip the default — require auth unless `MOTHERSHIP_CONSOLE=open` is explicitly set (fail-closed). Document that production must set the flag.

**R10-3 — `store.mjs` local `httpError` bypasses redaction (P2, risky).** `mothership/store.mjs:465-469` defines its own `httpError(message, statusCode)` using raw `new Error(message)` — no `redactErrorText`. Meanwhile `mothership/http.mjs:42-46` exports an `httpError` that applies `redactSensitiveText` + truncation. If any store error message ever contains a connection string fragment, it bypasses the redaction pipeline. The server catch-all at `server.mjs:87-95` does redact, but intermediate handlers that log or forward the raw `error.message` would leak. **Fix:** delete local `httpError` in `store.mjs`, import from `http.mjs`.

**R10-4 — Cookie/crypto helpers duplicated across 3 files (P2, overgrown, T7).** `parseCookies`, `secureEqual`, `secureBufferEqual`, `parsePasswordHash`, `hashSessionToken`, `shouldUseSecureCookie`, and more are independently implemented in `console-auth.mjs`, `http.mjs`, and `private-beta-auth-service.mjs`. A security fix to `secureEqual` applied to one copy may not reach the others. The critical risk is on timing-sensitive helpers. **Fix:** extract `shared/auth-primitives.mjs` with the cookie/crypto helpers; both auth services import from there.

### React UI (new surfaces)

**R10-5 — Nav-shell CSS breaks dark mode (P2, brittle).** `react-ui/src/global.css:1111-1130`. The "Production nav shell transition" block defines `--c-bg`, `--c-surface`, `--c-text`, `--c-sidebar` etc. as hardcoded light hex values under `:root`. There is NO corresponding `:root[data-theme="dark"]` block. The shell layout rules (lines 1132+) all reference these `--c-*` variables, so toggling to dark theme — which is still wired in `TitleBar.tsx` via `toggleTheme()` and persisted to localStorage — produces a light shell with dark-themed base components. **Fix:** add `:root[data-theme="dark"]` block for `--c-*` variables, or refactor them to reference the existing base variables (`--c-bg: var(--bg)`).

**R10-6 — Focus visibility sparse (P2, brittle).** `react-ui/src/global.css:198, 347-348, 683`. Only 3 elements have `:focus-visible` outlines (`.activity-logo`, `.tree-file-button`, `.drop-actions button`). Many interactive elements — `.nav-item`, `.record-action`, `.command-panel-new-task`, `.skill-idea-actions button`, suggestion list items — lack keyboard focus indicators. **Fix:** add a catch-all rule: `button:focus-visible, [role="button"]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`

### DB decomposition (new findings from the extracted modules)

**R10-7 — `matter.json` merge gap in add-files path (P2, brittle, T8).** `services/runtime-db-storage-service.mjs:237-308`. The `addUploadedFilesToMatter` flow is: (1) allocation query with `FOR UPDATE` lock (lines 249-261) → lock released when psql exits; (2) `buildRuntimeUploadIntake` reads existing workspace files in a *separate* psql invocation (no lock); (3) `persistRuntimeUploadIntakeRecords` persists merged `matter.json` in a *new* transaction. Two concurrent add-files operations on the same matter both read the same pre-existing workspace in step 2, both merge their own intake, and step 3 for the second caller overwrites the first — dropping the first intake's entry from `matter.json`. Relational rows survive but `extract`'s `runtimeDbIntakes` reads `matter.json.intakes` authoritatively, so the dropped intake won't extract until repaired. **Fix:** wrap the entire add-files flow in an advisory lock (`pg_advisory_xact_lock(matter_id)`) or move `matter.json` merge to SQL-side `jsonb_set` within the allocation transaction.

**R10-8 — 5 largest DB-native modules lack unit tests (P2, right-sized*, test-now).** `runtime-db-matter-context-packet.mjs` (471 lines), `runtime-db-doctor-fix.mjs` (352), `runtime-db-extract-service.mjs` (328), `runtime-db-matter-init-service.mjs` (265), `runtime-db-doctor-scan.mjs` (125) — total 1,541 lines with no dedicated test files. They contain security-relevant logic: `readTrustedSourceDescriptors` (SHA-256 mismatch rejection, FILE-NNNN-in-label rejection) is a pure function ideal for unit testing. Integration coverage exists via `runtime-db-api.test.mjs` but cannot isolate edge cases. **Fix:** add unit tests for at minimum `runtime-db-matter-context-packet` (targeting `readTrustedSourceDescriptors`) and `runtime-db-doctor-scan` (targeting `detectRuntimeDbLegacyLayout`).

### Cross-cutting

**R10-9 — Redaction regex misses JSON-quoted password/token/secret values (P2, risky, pre-existing).** `shared/secret-redaction.mjs` and `react-ui/src/lib/secretRedaction.ts` both have: `.replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'` + "`" + `]+)/gi, ...)` where the value class `[^\s"'...]` *excludes* quote characters. So `{"password":"hunter2"}` is NOT redacted because `"hunter2"` starts with a quote. The `apiKey` rule (same files, earlier line) handles this correctly with `("[^"]*"|'[^']*'|[^\s,}]+)`. This is not a regression — it predates this delta — but the scope-pass for R9-4 revealed it. **Fix:** align the value class to match the apiKey rule: `("[^"]*"|'[^']*'|[^\s"'` + "`" + `]+)`.

### Smaller (P3, bundled)

**Mothership P3 cluster:** (a) `console-auth.mjs:130` consumes rate limit *before* email send — Resend failure locks user out until window expires. (b) `console-auth.mjs:320,328` `throttleState`/`recordFailure` use `Date.now()` instead of the injected `now` — test clock can't control throttle behavior. (c) `console-auth.mjs:48-51` unbounded in-memory Maps (`sessions`, `loginFailures`, `codeSendRecords`, `pendingCodes`) with lazy-only eviction — slow memory leak on long-running servers. (d) `mothership/report.mjs:291` passes `journey.user` raw while `feedbackReportItem` at `:222` applies `redactReportText`. (e) `console-auth.mjs:367` reimplements `parseCookies` that `http.mjs:52` already exports (same process).

**React UI P3 cluster:** (f) `useSkillIdeaSessionMachine.ts:579-582` `useEffect` with no dependency array re-registers handler every render (intentional for fresh closure, but unusual). (g) `SettingsPage.tsx:410-437` passes 27 props to CopilotSettingsPanel — rendering decomposed, state not. (h) `ActivityBar.tsx:1-56` is dead code (exported, never imported, test explicitly asserts NOT rendered). (i) `global.css:1002-1027` vs `1507-1533` duplicate `@media (max-width: 1100px)` breakpoints (first is dead). (j) `types/index.ts:14,41,43,51,53,71,73,80` uses `'ok' | 'warning' | string` pattern which TypeScript collapses to `string`, defeating exhaustive matching.

**DB decomposition P3 cluster:** (k) `runtime-db-preparation-read-model.mjs:175` `runtimeWorkspaceFilePaths` lives in the wrong module — 5 write-path modules import it, pulling heavy deps they don't need; move to `runtime-db-workspace-read-model.mjs`. (l) `runtime-db-materialized-persistence-sql.mjs` retains "materialized" naming fossil post-retirement of the filesystem path. (m) `runtime-db-storage-query-sql.mjs:114` unanchored `'Intake ([0-9]+)'` regex could match within adversarial matter names. (n) `runtime-db-upload-intake-planner.mjs:127-133` `deterministicUuid` verbatim copy instead of import from `runtime-db-sql-format.mjs:43`. (o) `stringValue` has 4+ private copies across DB modules. (p) `readPayloadText` triplicated across `matter-context-packet`, `doctor-scan`, and `extract-service`.

**Credit/health P3 cluster:** (q) `019_credit_ledger.sql:142` adds a blocking unique index on existing `cost_events` table (acceptable at beta scale). (r) `credit-shadow-planner.mjs:287-291` `normalizeStatus()` defaults unrecognized status to `"succeeded"`, inflating the shadow meter. (s) No aggregate surfacing of `requiresPolicyDecision` runs in reports. (t) `system-health-service.mjs:~47` returns raw `runtime.appDir` (acceptable: operator-gated route).

**Carried P3:** R9-10 (server.mjs error.message verbatim), R9-11 (route-helper twin widened).

---

## DB decomposition detail

The god-module reduction from ~2,245 to ~1,030 lines is the structural win of this delta. 11 extracted modules with clean single responsibilities:

| Extracted module | Lines | Role |
|---|---|---|
| `runtime-db-storage-query-sql.mjs` | ~286 | Query SQL builders |
| `runtime-db-materialized-persistence-sql.mjs` | ~268 | Storage-object persistence SQL |
| `runtime-db-upload-persistence-sql.mjs` | ~219 | Upload SQL |
| `runtime-db-upload-materializer.mjs` | ~197 | Upload intake builder |
| `runtime-db-upload-intake-planner.mjs` | ~141 | Upload planning |
| `runtime-db-workspace-read-model.mjs` | ~123 | Workspace tree model |
| `runtime-db-query.mjs` | ~65 | Psql transport |
| `runtime-db-artifact-policy.mjs` | ~56 | Artifact classification |
| `runtime-db-sql-format.mjs` | ~49 | SQL escapers |
| `runtime-db-object-key-policy.mjs` | ~40 | Key policy |
| `runtime-db-upload-import-items.mjs` | ~37 | Upload import mapping |

The dependency graph flows cleanly without cycles: `sql-format → sql-safety → object-key-policy → artifact-policy → persistence-sql → query-sql`. The storage service is now a pure orchestrator. The materialized fallback path is fully retired — zero dangling references, source-scanning regression tests prevent reintroduction.

---

## Audit view

**P1 queue:** **Empty.** (First time since Run 7.)

| Unit | Mode | Blast radius | Verdict | Theme | Action | Sev |
|---|---|---|---|---|---|---|
| Console email enumeration oracle (R10-1) | mothership | allowed-email list exposure | risky | T12 | refactor | **P2** |
| Console auth default-open (R10-2) | mothership | all operator data public on misconfig | risky | T12 | refactor | **P2** |
| `store.mjs` redaction bypass (R10-3) | mothership | potential secret in error text | risky | T7 | refactor | **P2** |
| Cookie/crypto helper duplication (R10-4) | mothership | security fix drift across 3 files | overgrown | T7 | refactor | **P2** |
| Nav-shell CSS breaks dark mode (R10-5) | React | broken visual on theme toggle | brittle | T13 | refactor | **P2** |
| Focus visibility sparse (R10-6) | React | keyboard users can't see focus | brittle | T13 | refactor | **P2** |
| `matter.json` merge gap in add-files (R10-7) | DB | concurrent add-files drops intake from manifest | brittle | T8 | refactor | **P2** |
| 5 DB-native modules lack unit tests (R10-8) | DB | security-relevant logic untested at unit level | right-sized* | — | test now | **P2** |
| Redaction regex JSON-quoted gap (R10-9) | bridge | `{"password":"hunter2"}` un-redacted (pre-existing) | risky | T7 | refactor | **P2** |
| N1 tester identity off-VM (carried, product call) | — | staff/matter names off-VM | risky* | — | watch | **P2** |
| F16/F3/F19 (auth boundary, parked for security pass) | config/FS | authn boundary / cross-user listing | risky* | — | refactor | **P2** |
| F20 deploy rm-rf (carried) | deploy | live release deleted on same-commit retry | risky | — | refactor | **P2** |
| P3 cluster: mothership (a–e) | mothership | localized | mixed | T7/T12 | watch | **P3** |
| P3 cluster: React UI (f–j) | React | localized | mixed | T13 | watch | **P3** |
| P3 cluster: DB decomposition (k–p) | DB | localized | mixed | T7 | watch | **P3** |
| P3 cluster: credit/health (q–t) | DB | localized | mixed | — | watch | **P3** |
| R9-10 + R9-11 (carried P3) | server/routes | localized | mixed | T7 | watch | **P3** |

**Tally (Run 10):** 5 reviewers, delta ~230 files reviewed, all findings `file:line`-anchored and verified-in-code. **Severity: 0×P0 · 0×P1 · ~12×P2 · ~25×P3.**
_(Run 9: 0×P0, 1×P1, ~13×P2, ~22×P3. The P1 is cleared. P2 count roughly flat: 9 cleared but ~9 new from new surfaces. P3 roughly flat.)_

---

## Report log

- **Report `5470212`** · 2026-06-21 · delta (`20ec21a`→`5470212`, ~130 commits). **Largest queue clearance: 9/11 cleared including the lone P1. P1 queue empty.** New surfaces reviewed: mothership console (auth, store, email, React SPA), credit shadow metering (migration, policy, planner), system health + user readiness, feedback triage, god-module decomposition (11 extracted modules), React UI (nav shell, CommandPanel, SettingsPage, state machines, readiness gate). New findings are boundary-layer: auth entry points, CSS layer, multi-transaction coordination, redaction regex edges. Cores are solid; seams need attention.

---

## Evidence & fixes

| Family | Unit | Role | Mode | Theme | Verdict |
|---|---|---|---|---|---|
| **Mothership** | `console-auth.mjs` | Console authentication | mothership | T12 | ⚠️ Well-built core (PBKDF2-SHA256 210k iterations, timing-safe comparison, XFF bypass prevention, per-process code pepper). Side channels on email path: timing oracle (R10-1) + default-open posture (R10-2). `console-auth.mjs:132-148, :34`. **Fix:** fire-and-forget send + flip default to auth-required. |
| **Mothership** | `store.mjs` | Operator data store | mothership | T7 | ⚠️ Parameterized SQL throughout (`$1, $2, ...`), no injection surface. Local `httpError` bypasses redaction pipeline (R10-3). `store.mjs:465-469`. **Fix:** import `httpError` from `http.mjs`. |
| **Mothership** | `console-auth + http + private-beta-auth` | Auth primitive trio | mothership | T7 | 🔻 10+ helpers independently implemented across 3 files in the same process (R10-4). Security fix to `secureEqual` in one copy won't reach others. **Fix:** extract `shared/auth-primitives.mjs`. |
| **Mothership** | `server.mjs` | Mothership HTTP server | mothership | — | ✅ Auth guard at line 160 is correctly placed after auth endpoints and before all data endpoints. Error handler at lines 87-95 redacts and returns generic 500s. `credentials: 'same-origin'` + `SameSite=Strict` + `HttpOnly` = adequate CSRF protection. |
| **Mothership** | `console-email.mjs` | Resend email sender | mothership | — | ✅ API key only in Authorization header. `safeResponseText` truncates to 500 chars. Clean. |
| **Mothership** | `report.mjs` | Report pipeline | mothership | — | ✅ Deep redaction: `redactSensitiveText`/`redactSensitiveValues` applied to titles, details, deployment metadata, runtime info, and audit fields. |
| **Credit** | `019_credit_ledger.sql` | Credit metering schema | DB | — | ✅ Exemplary migration: every DDL guarded by IF NOT EXISTS / IF NOT EXISTS constraint checks. RLS with `current_app_tenant_id()`. Composite FK targets verified against prerequisite migrations. Fully idempotent. |
| **Credit** | `credit-policy.mjs` + `credit-shadow-planner.mjs` | Shadow metering | DB | — | ✅ Genuinely shadow-only — three independent guarantees: (1) policy object `mode: "shadow"`, (2) planner `databaseWrites: false`, (3) no write consumer exists. Cannot enforce even by accident. |
| **Health** | `system-health-service.mjs` | System health reporting | DB | — | ✅ Read-only. Does not probe providers (test-asserted). Returns structured report with redaction at every boundary. Operator-gated route (403 for testers). |
| **Health** | `user-readiness-service.mjs` + `useUserReadinessGate.ts` | User readiness gate | bridge | — | ✅ Non-blocking: 3 independent escape hatches (success settle 900ms, error settle 1200ms, absolute timeout 8000ms). `appendTerminal` identity stable (`useCallback([], ...)`). No deadlock paths. `aria-live="polite"` for screen readers. |
| **Health** | `private-beta-feedback-triage-service.mjs` | Feedback routing | — | — | ✅ Pure classification/routing, no write operations. Deterministic rules → validated classifier → category fallback. `boundedText()` + `redactSensitiveText` on all fields. Cannot touch ledger or any table. |
| **Shared** | `user-facing-ai-language-policy.js` | AI language policy | bridge | — | ✅ Single source of truth — `.js` extension for cross-environment compatibility. Both server and React import the same file. `WeakSet` for circular reference protection. |
| **DB decomp** | `runtime-db-storage-service.mjs` (orchestrator) | Storage orchestration | DB | T8 | ⚠️ Decomposed from ~2,245→~1,030 lines (R9-5 FIXED). Clean delegation. `matter.json` merge step runs between transactions (R10-7). `runtime-db-storage-service.mjs:237-308`. **Fix:** advisory lock or SQL-side merge. |
| **DB decomp** | SQL builders (query-sql, upload-sql, materialized-sql) | SQL construction | DB | — | ✅ All SQL routes through typed escapers in `runtime-db-sql-format.mjs`. `sqlUuid` defense-in-depth (`::uuid` cast). Role guard prepended to every read. Write transaction wrapper with double-prepend check. No raw interpolation. |
| **DB decomp** | `runtime-db-matter-context-packet.mjs` | Context packet builder | DB | — | ✅⚠️ `readTrustedSourceDescriptors` is well-layered security: SHA-256 validation, path cross-check, FILE-NNNN label rejection. Graceful degradation for pre-register matters. **But no unit test** (R10-8). |
| **DB decomp** | Materialized fallback retirement | Custody transition | DB | — | ✅ Zero production references to retired functions. Source-scanning regression tests prevent reintroduction. Complete and guarded. |
| **React** | State machine (`skillIdeaSessionMachine.ts`) | Skill idea sessions | React | — | ✅ Pure reducer, exhaustive `assertNever`, `beginAsyncOperation()` returns `isCurrent()` guard with 3 staleness layers (mount, operation, sequence). `safeSetSession` guards post-unmount setState. Sound. |
| **React** | `useCommandSuggestions.ts` + `CopilotQuickSwitch.tsx` | Command panel | React | — | ✅ Clean extraction. Sequence-number cancellation prevents stale skill lists. Optimistic UI with rollback on failure. `CopilotQuickSwitch` at 29 lines is a clean presentational component. |
| **React** | `SettingsPage.tsx` + children | Settings | React | T13 | ⚠️ Rendering decomposed; state not. `BetaAccessPanel` (150 lines) and `SystemHealthPanel` (81 lines) are clean. But `CopilotSettingsPanel` receives 27 props (P3-g). |
| **React** | Nav shell CSS (`global.css:1108-1545`) | Layout transition | React | T13 | ⚠️ ~430 lines unconditionally appended. Dark mode broken (R10-5). Duplicate breakpoints. Dead `ActivityBar` component. |
| **React** | `secretRedaction.ts` | Client-side redaction | React | T7 | ⚠️ Byte-for-byte aligned with server twin (R9-4 FIXED). But the shared `password|token|secret` regex misses JSON-quoted values (R10-9, pre-existing). |
| **Streaming** | `sendRawFileStream` (`app-shell-routes.mjs:312-329`) | File streaming | bridge | — | ✅ **Model implementation** — `await pipeline(raw.stream, response)` with proper error handling and stream destroy. The prescribed fix, correctly applied. |
| **Redaction** | `shared/secret-redaction.mjs` + React twin | Secret redaction | bridge | — | ✅⚠️ Now covers AIza, sk-, Bearer, postgres URLs, env vars, application tokens. Twin parity tested. All stragglers delegated. **One pre-existing gap:** JSON-quoted values for `password|token|secret` (R10-9). |

---

## Emerging themes

- **T7 — twin drift: healed at the core, regrown at the periphery.** The redaction story is the delta's headline success: R9-4 (AIza gap), R9-8 (`preparationErrors.ts`), all stragglers delegated to the canonical redactor. But new drift surfaces: mothership cookie/crypto helpers duplicated across 3 files (R10-4), `store.mjs` reimplements `httpError` that `http.mjs` already exports (R10-3), the decomposition introduced `deterministicUuid`/`stringValue`/`readPayloadText` duplication within the extracted modules. Pattern: **shared abstractions are disciplined, but new code that should import them reimplements instead.** The fix is the same as always — one home, import everywhere.

- **T8 — write-path integrity: materialized path retired, DB-native gap surfaces.** `runMaterializedMatterWrite` removed entirely (R9-6 closed). The `FOR UPDATE` lock properly serializes file-number allocation. But the `matter.json` merge step runs between transactions (R10-7), creating a subtler version of the old read-modify-write race. The structural win is real — the god-module is decomposed, the fallback retired, the SQL safety is strong — but the multi-transaction coordination is the remaining seam.

- **T12 — default-open boundaries (NEW).** Console auth defaults to disabled (R10-2). Nav-shell CSS appended unconditionally with no feature gate (R10-5/P3-i). The pattern: **new surfaces ship in a "permissive by default" posture** that requires explicit opt-in for safety/correctness. The console has a deploy gate (`--require-auth`) but it's opt-in. The nav shell has no gate at all. Risk: a misconfigured deployment or a forgotten toggle produces silently broken behavior.

- **T13 — CSS/UI layer discipline (NEW).** The nav-shell transition appended ~430 lines of unconditional CSS overrides, breaking dark mode (R10-5), duplicating responsive breakpoints, and leaving dead base CSS. Focus visibility is sparse (R10-6). The *rendering* decomposition (CommandPanel, SettingsPage) is clean, but *state management* didn't follow (27 props) and dead code wasn't cleaned up (ActivityBar). The pattern: **UI extraction is rendering-first; the ownership/state/cleanup pass hasn't happened yet.**

**Meta-observation.** Risk has **migrated from core services to boundary layers.** The 9-finding queue clearance proves the cores are well-maintained — streaming, redaction, custody, god-module, citations all addressed with the prescribed fixes. Every new finding in Run 10 lives at a boundary: auth entry points (R10-1/R10-2), CSS layer (R10-5/R10-6), multi-transaction coordination (R10-7), redaction regex edges (R10-9), security-primitive duplication (R10-4). **The cores are solid; the seams need attention.**

---

## What it does well

Named strengths — the patterns to preserve, and to reuse as templates for the warned units.

- **`sendRawFileStream` is now the model streaming implementation** (`app-shell-routes.mjs:312-329`). `await pipeline(raw.stream, response)` with proper error handling and stream destroy. The exact pattern R9-1 prescribed, correctly applied. Template for any future streaming route.

- **Console auth security is genuinely strong** (`mothership/console-auth.mjs`). PBKDF2-SHA256 with 210k iterations. Timing-safe comparison via `crypto.timingSafeEqual` with SHA-256 fallback for unequal lengths. Per-process code pepper (`tokenBytes(32)`) makes stored code hashes useless after restart. XFF bypass prevention (rate limits use `socket.remoteAddress`, test-verified at `test/mothership-console-auth.test.mjs:114`). `HttpOnly` + `SameSite=Strict` + `Secure` cookies. Session tokens hashed at rest. 275 lines of auth tests. The *boundary discipline* (R10-1/R10-2/R10-4) doesn't diminish the core quality.

- **Credit migration is production-grade** (`db/migrations/019_credit_ledger.sql`). Fully idempotent (every DDL guarded). RLS with `current_app_tenant_id()`. Composite FK targets verified against prerequisite migrations. Sign-enforced CHECK constraints. Shadow event types. Idempotency keys. This is the template for future migrations.

- **Shadow metering is genuinely shadow-only** (`credit-policy.mjs`, `credit-shadow-planner.mjs`). Three independent guarantees: frozen policy object, `databaseWrites: false`, no write consumer. Cannot enforce even by accident. This is how to build an observe-only system.

- **Redaction twin discipline is restored** (`shared/secret-redaction.mjs`, `secretRedaction.ts`). AIza and sk- patterns added. All stragglers delegated to canonical redactor. Twin parity tested. `preparationErrors.ts` now imports instead of reimplementing. The architecture is strong — the one remaining gap (JSON-quoted values, R10-9) is a regex fix, not a structural issue.

- **God-module decomposition is well-executed** (`services/runtime-db-*.mjs`). 11 extracted modules with clear single responsibilities. Clean dependency graph with no cycles. SQL builders properly separated by domain. Storage service reduced to pure orchestration. Source-scanning regression tests prevent reintroduction of retired paths.

- **SQL safety architecture is strong** (`runtime-db-sql-format.mjs` + all SQL builders). Every query routes through typed escapers. `sqlUuid` defense-in-depth with `::uuid` cast. Role guard prepended to every read. Write transaction wrapper with double-prepend check. No raw interpolation anywhere. Parameterized SQL throughout `store.mjs` (`$1, $2, ...`).

- **Readiness gate cannot deadlock** (`useUserReadinessGate.ts`, `PrivateBetaReadinessGate.tsx`). Three independent escape hatches. Stable `useCallback` identity prevents effect re-triggering. `readinessSeqRef` prevents stale responses. Screen reader support via `aria-live="polite"`. This is the template for user-facing gates.

- **Deterministic-first triage routing** (`private-beta-feedback-triage-service.mjs`). Three-tier design (deterministic rules → validated classifier → category fallback). Critical signals always caught by stable regex rules. `boundedText()` + `redactSensitiveText` on all fields.

- **State machine correctness** (`skillIdeaSessionMachine.ts`). Pure reducer with exhaustive `assertNever`. `beginAsyncOperation()` returns `isCurrent()` guard with 3 staleness layers. `safeSetSession` guards post-unmount setState. This is the template for async state management.

---

## Highest-leverage fixes

The warnings collapse into a few root causes — fix these and most of the table goes green:

1. **Console auth hardening sweep (~30 lines, clears R10-1 + R10-2).** Fire-and-forget the email send (neutralizes timing + error oracle). Flip default to auth-required (misconfiguration fails closed). One session, one surface.

2. **Extract `shared/auth-primitives.mjs` (clears R10-4, reduces R10-3).** Cookie/crypto helpers in one home. Both auth services import from there. Also import `httpError` from `http.mjs` in `store.mjs` (R10-3). Eliminates the security-fix-drift hazard on timing-sensitive code.

3. **One regex fix for both redaction twins (clears R10-9).** Align the `password|token|secret` value class to match the `apiKey` rule: `("[^"]*"|'[^']*'|[^\s,}]+)`. Apply to `shared/secret-redaction.mjs` and `secretRedaction.ts` (the twin parity test keeps them aligned). ~5 lines.

4. **Nav-shell dark-mode + cleanup (clears R10-5 + P3-h/P3-i).** Add `:root[data-theme="dark"]` block for `--c-*` variables. Delete dead `ActivityBar.tsx`. Remove duplicate responsive breakpoints. One CSS session.

5. **Focus visibility catch-all (clears R10-6).** One CSS rule for all interactive elements. ~5 lines.

6. **Advisory lock on add-files path (clears R10-7).** Wrap `addUploadedFilesToMatter` in `pg_advisory_xact_lock(matter_id)` or move `matter.json` merge to SQL-side. Serializes the multi-transaction gap.

7. **Unit tests for DB-native logic modules (clears R10-8).** Priority: `readTrustedSourceDescriptors` edge cases, `detectRuntimeDbLegacyLayout` folder structures. Pure functions with well-defined inputs/outputs.

8. **Decide N1** (keep-and-document vs strip `displayName`/matter names) — the last P2 needing no code investigation. Product call pending across 4 runs.

9. The standing item: **dedicated security scan** over F16/F3/F19 (auth hot-path sync reads + FS-mode cross-user listing) — parked across five runs now.

---

> **⏳ Currentness.** Valid only for commit `5470212` (clean worktree, 4 docs files modified/untracked) at 2026-06-21 21:31 IST, branch `main`. Baseline = Run 9 (`20ec21a`). A source edit invalidates these findings — re-run `/quality-pass` after changes. **`tsc -b` clean · 1,594 tests pass** at write time.
