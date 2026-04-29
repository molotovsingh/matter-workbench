# FOR_AKSINGH — Matter Workbench Unibox

## What This Is

A legal workbench where lawyers upload documents, run AI-powered extraction and analysis, and ask questions about their case files. The **unibox** is the single text input at the bottom of the screen — like a command bar meets chat box. You type anything, and the system figures out whether you're searching, asking a question, running a skill, or just saying hello.

## The Architecture (Top-Down)

```
Browser (index.html + frontend/*.js)
  │
  ▼
server.mjs ─── routes/api-routes.mjs
                  │
                  ├── services/unibox-service.mjs      ← THE ORCHESTRATOR
                  │       ├── intent-classifier-service.mjs   (AI: what does the user want?)
                  │       ├── matter-qa-service.mjs          (AI: answer questions about the matter)
                  │       ├── matter-context-service.mjs     (filesystem context for Q&A)
                  │       ├── matter-search-service.mjs      (grep the matter files)
                  │       └── skill-router-service.mjs       (AI: which skill matches?)
                  │
                  ├── services/matter-store.mjs         ← where's the matter on disk?
                  ├── services/workspace-service.mjs    ← tree view, file preview
                  ├── services/config-service.mjs       ← settings persistence
                  ├── services/doctor-service.mjs       ← health checks & migrations
                  │
                  └── engines (matter-init, extract, create-listofdates)
                          │
                          ▼
                  shared/  ← the contract layer
                    matter-contract.mjs   ← folder names, file categories, intake patterns
                    model-policy.mjs      ← which AI model for which task
                    responses-client.mjs  ← thin wrapper over OpenAI Responses API
                    local-intent.mjs      ← shared regex for greeting/casual/slash detection
                    safe-paths.mjs        ← path traversal guards
```

## The Unibox Flow

When you type something into the unibox:

1. **Empty check** — empty input → 400 error
2. **No-matter check** — if no active matter and the input isn't a local-only intent (greeting, slash command, casual remark), return "Load a matter first" immediately. No AI call wasted.
3. **Intent classification** — AI call (OpenAI Responses API with structured output). Returns one of: `copilot_qa`, `search`, `run_skill`, `skill_request`, `greeting`, `casual`
4. **Route by intent:**
   - `greeting` / `casual` → static response, no AI
   - `search` → strip search-verb prefix (`find`, `search for`, `look for`, etc.), then grep the matter files
   - `copilot_qa` → ask `matter-context-service.mjs` for the matter context, then send it to AI with conversation history
   - `run_skill` → skill router AI call to match against the skill registry
   - `skill_request` → same skill router for create/modify intents

## The Five Bugs We Fixed (and Why They Existed)

### Bug 1: "find Skyline" searched for literally "find Skyline"

**The story:** The intent classifier correctly identified `find Skyline` as a `search` intent. But then `unibox-service.mjs` passed the *entire raw input* — including the word "find" — to the search service. The search service grepped for "find Skyline" in every file, found nothing, returned 0 results.

**Why it happened:** The unibox service was a thin pass-through. Nobody thought about the gap between "what the user typed" and "what to search for." The classifier knew the intent, but it didn't extract a clean search term.

**The fix:** A deterministic regex `extractSearchQuery()` strips known search-verb prefixes. We specifically did NOT add a `search_query` field to the AI classifier's output schema, because that would introduce hallucination risk — the AI could invent search terms. A regex can't hallucinate. It costs zero tokens.

**Lesson:** When you have an AI step followed by a deterministic step, the contract between them matters as much as the AI's accuracy. The classifier said "this is a search" but didn't say "search for *what*." The deterministic code assumed the input was already clean. That assumption was the bug.

### Bug 2: Q&A answers rendered twice in the browser

**The story:** Every time you asked a question and got an answer, the answer appeared twice in the chat pane.

**Why it happened:** The frontend code pushed the current turn into `conversationTurns` *before* calling `renderResult()`. Inside `renderResult`, `renderConversation()` iterated `conversationTurns` (which now included the current turn) and rendered it. Then `renderResult` also rendered the current turn separately. Double.

**The fix:** Move `conversationTurns.push()` to *after* `renderResult()`. Now `renderConversation()` only sees previous turns, and `renderResult()` handles the current turn once.

**Lesson:** In UI code, be very conscious of when you mutate state vs. when you read it for rendering. The push-before-render pattern is a classic source of duplication bugs. It's the same category of mistake as mutating an array while iterating over it.

### Bug 3: "No active matter" error was masked by AI failures

**The story:** If you asked "what is this matter about?" with no matter loaded, you'd get a cryptic OpenAI API error instead of the helpful "Load a matter first" message. The reason: the classifier AI call ran *before* the no-matter check, and if the API key was missing or quota was exhausted, the classifier error hid the real problem.

**Why it happened:** The original code had the try/catch around the Q&A and search handlers, catching 400s and checking for no matter *inside the catch*. This is backward — the precondition check should come before the expensive AI call, not after it fails.

**The fix:** Check `matterStore.getMatterRoot()` *before* calling the classifier. If null, only allow local-only intents (greetings, slash commands, casual remarks). Everything else gets the "Load a matter first" error immediately, with zero AI calls.

**Key design decision:** We extracted `isLocalOnlyIntent()` into `shared/local-intent.mjs` so both the unibox service and the intent classifier use the same regex patterns. Without this, the patterns would diverge over time — someone adds a new local pattern to the classifier but forgets to add it to the unibox pre-check, and suddenly a valid input gets blocked with "load a matter first."

**Lesson:** Precondition checks should happen *before* side effects (like API calls). And when two modules need the same heuristic, extract it — don't copy it. Duplicated heuristics are the slowest kind of bug because they diverge silently.

### Bug 4: Hardcoded `_extracted` and `10_Library` folder paths

**The story:** The Q&A service built its matter context by hardcoding paths like `00_Inbox/{intake}/_extracted` and `10_Library`. If the folder naming convention ever changed, the Q&A service would silently return incomplete context — no error, just missing information.

**Why it happened:** The original developer manually constructed paths with `fs.readdirSync` and string concatenation. It worked for the one matter type they tested. The `matterStore` already had `listIntakeFolders()` that uses the contract-aware pattern, but the Q&A service didn't use it.

**The fix:** Use `matterStore.listIntakeFolders(matterRoot)` to discover intake directories dynamically. For library/output directories, enumerate top-level directories (skipping `00_Inbox`) and look for JSON records in each. This way, if someone creates `20_Analysis` or renames intakes, the Q&A path still finds the content. We later pulled that filesystem work into `services/matter-context-service.mjs`, so `matter-qa-service.mjs` can stay focused on the AI answer contract instead of becoming a mixed bag of path walking, record formatting, and OpenAI request code.

**Lesson:** Hardcoded paths are technical debt even when they work. If you have a service that's supposed to discover content, it should discover it — not assume where it lives. The contract layer (`matter-contract.mjs`, `matterStore`) exists precisely to abstract away folder naming. Use it.

### Bug 5: Search hit `.py` and support files

**The story:** Searching for "Skyline" returned results from `generate-docs.py` and `generate_docx.js` — utility scripts that happened to contain the word "Skyline" in a comment or variable name. A lawyer doesn't care about scripts.

**Why it happened:** The search service had a skip list for binary file extensions (`.pdf`, `.docx`, `.png`, etc.) but not for script/code extensions. It also didn't skip any directories — not even `Originals/`, which is just a backup copy of source files (already searchable via the working copies in `By Type/`).

**The fix:** Two changes:
1. `shouldSkipDirectory()` — skip `Originals/` (exact copies, redundant) and dot-directories (`.git/` etc.)
2. Expanded `shouldSkipFile()` to include `.py`, `.sh`, `.js`, `.mjs`, `.bat`, `.cmd`

**The deliberate non-choice:** We did NOT blanket-skip the `Needs Review` directory or `.json` files. The `Needs Review` category contains real matter documents with unrecognized extensions — some of those are legitimately searchable. And `.json` extraction records (`FILE-NNNN.json`) under `_extracted/` contain the actual extracted text that lawyers want to find. Filtering too aggressively would be worse than the noise.

**Lesson:** Filtering is a precision/recall tradeoff. It's tempting to nuke everything that looks like noise, but you have to think about what you're losing. The `.json` case is instructive — some JSON is noise (config files), some is gold (extraction records). The directory they live in determines which.

## The Folder Contract

Matter folders follow a strict layout defined by `matter-init-engine.mjs` and `matter-contract.mjs`:

```
mehta/                           ← matter root
  matter.json                    ← metadata (client, opponent, jurisdiction)
  00_Inbox/
    Intake 01 - Initial/         ← humanized intake name (the contract requires "Intake \d{2,}")
      Source Files/              ← raw uploads
      Originals/                 ← exact copies of source files
      By Type/                   ← classified working copies
        PDFs/
        Text Notes/
        Spreadsheets/
        Word Documents/
        Needs Review/            ← unrecognized file types
      _extracted/                ← AI extraction output (FILE-NNNN.json + FILE-NNNN.txt)
      File Register.csv          ← index of all files with metadata
      Intake Log.csv             ← staging log
      Extraction Log.csv         ← extraction log
  10_Library/                    ← AI-generated analysis outputs
    List of Dates.json
    List of Dates.csv
    List of Dates.md
```

Key points:
- `Originals/` and `By Type/` contain the same files, just organized differently. Originals is the backup; By Type is the working copy.
- `_extracted/` is per-intake. Each intake has its own extraction records.
- `10_Library` contains outputs from skills like `/create_listofdates`.
- The intake directory name pattern `Intake \d{2,}` is the contract identifier — don't hardcode "Intake 01."

The UI now has a separate presentation layer for this tree. That means the filesystem can keep stable machine names like `00_Inbox`, `10_Library`, and `FILE-0001__notice.pdf`, while the app shows lawyer-readable labels like "Inbox," "Analysis Library," and "notice.pdf" with `FILE-0001` as supporting metadata. Machine-only records (`matter.json`, file registers, intake/extraction logs, `_extracted/`, and JSON analysis payloads) stay hidden from normal browsing. They still exist on disk because the engine, citations, search, and doctor checks need them, but a user should not have to mentally parse them during ordinary work.

**Lesson:** A filesystem contract and a product interface are not the same thing. Good engineers keep the disk format boring and stable, then build a display layer that explains intent. Renaming `00_Inbox` on disk would be risky because every engine expects it. Displaying it as "Inbox" is cheap, safe, and much kinder to the human reading the screen.

## The AI Layer

All AI calls go through `shared/responses-client.mjs`, which wraps the OpenAI **Responses API** (not the Chat Completions API). Every call uses structured output (`json_schema` format with `strict: true`), which means the AI is forced to return valid JSON matching a specific schema. This is crucial — no parsing failures, no "sorry I can't do that" free-text responses that break downstream code.

Model selection is centralized in `shared/model-policy.mjs`. Different tasks get different model tiers:
- `MATTER_QA` → the main model, higher token budget
- `SKILL_ROUTER` → lighter model, smaller budget
- `INTENT_CLASSIFIER` → lightest model, smallest budget
- `SOURCE_BACKED_ANALYSIS` → list-of-dates skill, medium budget

Environment variable overrides let you test with cheaper models locally.

## The Skill System

Skills live in `skills/` and are registered in `skills/registry.json`. Each skill has:
- `slash` — the command name (e.g., `/extract`)
- `category`, `purpose`, `inputs`, `outputs` — metadata for the router
- `mode` — execution mode
- `legal_setting_scope` — which jurisdictions/case types it applies to

The skill router (`skill-router-service.mjs`) is MECE-aware — it detects when a new skill request overlaps with an existing skill and requires user approval instead of creating a duplicate. This prevents the skill registry from becoming a pile of near-duplicate commands.

## The Test Strategy

Tests use Node.js built-in `node --test` — no Jest, no Mocha. There are two levels:

1. **Unit/engine tests** (`test/engines.test.mjs`, `test/unibox-fixes.test.mjs`) — test individual functions and services in isolation with mock filesystems. Fast, no network.

2. **Integration/API tests** (`test/unibox-baseline.test.mjs`, `test/api-smoke.test.mjs`) — start the real HTTP server, stub only the OpenAI Responses API via `globalThis.fetch` interception, and make real HTTP requests. This catches wiring bugs that unit tests miss.

The OpenAI stub is key: it intercepts `fetch()` calls to `https://api.openai.com/v1/responses` and returns deterministic responses based on the schema name. This means:
- Tests are deterministic — no AI randomness
- Tests don't burn API quota
- But the rest of the stack (server, routing, matter store, search service) runs for real

## Things That Could Bite You Later

1. **Search reads every file into memory.** The search service does `fs.readFileSync(fullPath, "utf8")` on every non-skipped file. For a matter with hundreds of large text files, this is O(n) memory. It works now because matters are small, but at scale you'd want an index.

2. **The no-matter pre-check relies on `isLocalOnlyIntent()` being a superset of the classifier's local intents.** If someone adds a new local intent to the classifier without updating `local-intent.mjs`, that input will get the "load a matter first" error when no matter is active, even though the classifier would handle it fine. The sharing of patterns mitigates this, but it's not bulletproof — the classifier could learn new patterns from its AI prompt that the regex doesn't cover.

3. **Workspace presentation rules now live in `workspace-service.mjs`.** That is intentionally safer than changing the on-disk folder contract, but the mapping should eventually be centralized near `matter-contract.mjs` so folder names, hidden system artifacts, and display labels do not drift.
