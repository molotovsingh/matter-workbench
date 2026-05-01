# AGENTS.md

## Commands
- `npm start` — Start app (runs `node server.mjs` on port 4173/4174)
- `npm test` — Run all tests (uses Node.js built-in `node --test`, files in `/test`)
- `node bakeoff-label.mjs <matterRoot>` — Run the post-extraction model evaluation script
- `npm run [matter-init|extract|create-listofdates]:dry-run` — Dry run engines
- `npm run [matter-init|extract|create-listofdates]` — Apply engines

## Architecture
- **Unibox (`services/unibox-service.mjs`)**: Central orchestrator for user input. It pre-checks local intents (via `shared/local-intent.mjs`), calls `intent-classifier-service.mjs`, and routes to Q&A, Search, or the Skill Router.
- **AI API**: The project uses the **OpenAI Responses API** (`/v1/responses`) with strict structured output (`type: "json_schema", strict: true`), wrapped by `shared/responses-client.mjs`. Model selection is in `shared/model-policy.mjs`. *Note: If calling OpenRouter models (e.g. in bakeoff scripts), you must use the standard Chat Completions API instead.*
- **Folder Contract**: `shared/matter-contract.mjs` and `matterStore.listIntakeFolders()` are the sources of truth for finding files. Do not hardcode path strings like `_extracted` or `Intake 01`.
  - `Originals/`: exact copies (skipped during search to avoid noise)
  - `By Type/`: working copies
  - `_extracted/`: JSON extraction records (`FILE-NNNN.json`) per intake
  - `10_Library/`: AI analysis outputs
- **Skills**: Definitions in `skills/registry.json`. Invoked via slash commands. The frontend (`frontend/unibox.js`) auto-executes matched skills if `user_gate_required` is false.
- **Frontend**: Static files served by backend, root `index.html`.

## Quirks & Conventions
- **No external test framework**: Tests use Node.js built-in `node --test`.
- **Integration Tests**: `test/unibox-baseline.test.mjs` and `test/api-smoke.test.mjs` use a deterministic stub for `globalThis.fetch` to mock OpenAI Responses without burning API quota. Follow this pattern for new tests.
- **Precondition checks**: Always check for an active matter (`matterStore.getMatterRoot()`) *before* making expensive AI API calls.
- **No lint/typecheck scripts defined.**
- **ES Modules**: `"type": "module"` in package.json. Use `.mjs` extensions for backend and test files.
