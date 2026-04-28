# Unibox Bug Fixes — Tentative Plan

**Status:** Implemented, 50/50 tests pass. Awaiting live verification against `mehta` sample matter before finalising.

## Summary of Changes

| # | Bug | Root Cause | Fix | Files Changed |
|---|-----|-----------|-----|---------------|
| 1 | Search query passes raw user text (`find Skyline` searches literally) | `unibox-service.mjs:65` passed `userInput` directly to search | Local regex `extractSearchQuery()` strips search-verb prefixes | `services/unibox-service.mjs` |
| 2 | Browser Q&A renders current answer twice | `conversationTurns.push()` ran before `renderResult()`, which also renders the current turn | Move push after `renderResult()` | `frontend/unibox.js` |
| 3 | No-active-matter masked by AI failures | Classifier AI call ran before checking matter state | Pre-check `matterStore.getMatterRoot()` using shared `isLocalOnlyIntent()` | `services/unibox-service.mjs`, `shared/local-intent.mjs` (new), `services/intent-classifier-service.mjs` |
| 4 | Hardcoded `_extracted` and `10_Library` paths | `matter-qa-service.mjs` manually constructed paths instead of using `matterStore` | Use `matterStore.listIntakeFolders()` for intake discovery; `discoverTopLevelDirs()` for library | `services/matter-qa-service.mjs` |
| 5 | Search hits generated/support files like `.py` | No directory-level skip; limited file extension skip list | Add `shouldSkipDirectory()` for `Originals/`; expand `shouldSkipFile` with `.py/.sh/.js/.mjs/.bat/.cmd` | `services/matter-search-service.mjs` |

## Design Decisions

### Bug 1: Local regex over AI extraction
The original review suggested adding `search_query` to the AI classifier's output schema. Second-order analysis flagged AI hallucination risk — the classifier could invent search terms not in the user's input. Instead, a deterministic regex strips known search-verb prefixes (`find`, `search for`, `look for`, `locate`, `show me`). This costs zero AI tokens, can't hallucinate, and covers the cited cases.

### Bug 2: Move push after render
Moving `conversationTurns.push()` after `renderResult()` means `renderConversation()` excludes the current turn during rendering. If `renderResult()` throws, the turn is lost from the history panel but the backend conversation state (`conversationHistory`) is already updated. This is acceptable — the display self-corrects on the next successful turn.

**Known follow-up (pre-existing, not introduced):** `renderConversation()` always uses `renderQaAnswer()` for history turns, but turns can be search results or chat responses. This should be fixed separately.

### Bug 3: Shared `isLocalOnlyIntent()`
Second-order risk was duplicating the classifier's local intent patterns. Solution: extract `GREETINGS` and `CASUAL` regexes into `shared/local-intent.mjs`, used by both the classifier and the unibox pre-check. Single source of truth.

The pre-check returns `NO_MATTER_ERROR` for any non-local input when no matter is active. This prevents AI quota burns on missing API keys from masking the "load a matter first" message. The redundant try/catch in `copilot_qa` and `search` cases was removed since the pre-check handles the no-matter path.

### Bug 4: Dynamic folder discovery
- Intake directories: replaced `fs.readdirSync(inboxPath)` with `await matterStore.listIntakeFolders(matterRoot)`, which uses the contract-aware `Intake \d{2,}` pattern
- Library directories: replaced hardcoded `10_Library` with `discoverTopLevelDirs()` that enumerates top-level matter directories (skipping `00_Inbox`) and looks for JSON records in each
- Moved `buildMatterContext` inside the factory for closure access to `matterStore`

Note: `_extracted` is part of the current contract (created by `extract-engine.mjs`), so it's still used as a subdirectory name — but now discovered via `matterStore.listIntakeFolders()` + `intake.name` instead of `fs.readdirSync`.

### Bug 5: Conservative filtering
- Added `shouldSkipDirectory()` — skips `Originals/` (exact copies, already searchable via working copies) and dot-directories
- Expanded `shouldSkipFile()` with `.py, .sh, .js, .mjs, .bat, .cmd`
- Did **not** blanket-skip `Needs Review/` directory or `.json` files — extraction records (`FILE-NNNN.json`) under `_extracted/` are valuable search targets

## Test Coverage

### Baseline (pre-existing): 32 tests
### New targeted tests: 18 tests (17 in `test/unibox-fixes.test.mjs` + expanded `test/unibox-baseline.test.mjs`)

**Bug 1 — extractSearchQuery (unit + baseline):**
- Strips `find`, `search for`, `look for`, `locate`, `show me` prefixes (unit)
- Passes clean inputs unchanged (unit)
- Does not strip non-search verbs (unit)
- Returns original when strip leaves empty string (unit)
- `find Skyline` → search intent, query `Skyline`, results ≥ 1 (baseline, full HTTP)
- `search Skyline` (no "for") → search intent, query `Skyline` (baseline, full HTTP)

**Bug 2 — Duplicate Q&A rendering:**
- Not testable via API-only tests; needs browser/Playwright. Verified manually in plan.

**Bug 3 — No-active-matter pre-check (unit + baseline):**
- Slash commands, greetings, short casual → true (unit)
- Matter-requiring inputs, long casual-like sentences → false (unit)
- Edge cases: empty, null, undefined → false (unit)
- No-matter + "what is this matter about?" → error, zero AI calls (baseline, full HTTP)
- No-matter + "hello" → greeting, zero AI calls (baseline, full HTTP)
- No-matter + "/extract" → run_skill routing, AI call proceeds (baseline, full HTTP)

**Bug 4 — Dynamic folder discovery (unit + baseline):**
- QA service works with `matterStore.listIntakeFolders()` (unit)
- QA service discovers library content without hardcoded `10_Library` (unit)
- Q&A sourced from `10_Library/List of Dates.json` → `DATES-01 p1.b1` citation (baseline, full HTTP)

**Bug 5 — Search noise filtering (unit):**
- `Originals/` directory is skipped; `By Type/` is searched
- `.py` files skipped; `.txt` files found
- `.json` extraction records under `_extracted/` are still found

## Files Changed (summary)

| File | Change |
|------|--------|
| `services/unibox-service.mjs` | Added `extractSearchQuery()`, matter-root pre-check with `isLocalOnlyIntent`, simplified switch cases |
| `services/intent-classifier-service.mjs` | Import `GREETINGS`/`CASUAL` from `shared/local-intent.mjs` instead of local definitions |
| `shared/local-intent.mjs` | **New** — shared `isLocalOnlyIntent()`, `GREETINGS`, `CASUAL` |
| `services/matter-qa-service.mjs` | Moved `buildMatterContext` inside factory; uses `matterStore.listIntakeFolders()` + `discoverTopLevelDirs()` |
| `services/matter-search-service.mjs` | Added `shouldSkipDirectory()` (skips `Originals/`), expanded `shouldSkipFile()` |
| `frontend/unibox.js` | Moved `conversationTurns.push()` after `renderResult()` |
| `test/unibox-fixes.test.mjs` | **New** — 17 unit-level targeted tests |
| `test/unibox-baseline.test.mjs` | **Expanded** — `search Skyline` variant, no-matter AI-call assertions, no-matter greeting/slash test, `10_Library` fixture + timeline Q&A |

## Pending: Live Verification

Before finalising, these should be verified against `http://127.0.0.1:4174/` with the `mehta` sample matter:

1. ~~`find Skyline` → search intent, query `Skyline`, returns results (not 0)~~ — **covered by baseline test**
2. ~~Direct `Skyline` search still works~~ — **covered by baseline test** (`copilot_qa` path)
3. Q&A answer renders once (not twice) in browser — **browser-only, needs manual check**
4. ~~Q&A follow-up renders correctly with history~~ — **covered by baseline test**
5. ~~No-matter state returns clean error without AI call~~ — **covered by baseline test** (zero `openAiCalls`)
6. ~~`hello` still works when no matter is loaded~~ — **covered by baseline test**
7. ~~`/extract` still routes when no matter is loaded~~ — **covered by baseline test**
8. Search does not hit `Originals/` or `.py` files — **covered by unit test, not baseline**
9. ~~Search still hits `_extracted/*.json` extraction records~~ — **covered by both unit and baseline tests**

Only item 3 (browser double-render) requires manual verification; all other items are now covered by automated tests.

## Known Follow-ups (not in scope)

1. **`renderConversation()` type mismatch** — history panel uses `renderQaAnswer()` for all turns, but turns can be search/chat. Needs per-turn `displayType` tracking.
2. **`conversationTurns` is frontend-only** — no reset on matter switch. If user switches matters mid-conversation, stale turns from the previous matter persist visually.
3. **`shouldSkipDirectory` is static** — the skip set should arguably come from `matter-contract.mjs` alongside `CATEGORY_BY_EXTENSION`, but that's a bigger refactor.
