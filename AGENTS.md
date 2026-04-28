# AGENTS.md

## Commands
- `npm start` — Start app (runs `node server.mjs`)
- `npm test` — Run all tests (Node.js built-in `node --test`, files in `/test`)
- `npm run matter-init:dry-run` — Dry run matter initialization
- `npm run matter-init` — Apply matter initialization
- `npm run extract:dry-run` — Dry run content extraction
- `npm run extract` — Apply content extraction
- `npm run create-listofdates:dry-run` — Dry run list of dates generation
- `npm run create-listofdates` — Apply list of dates generation

## Architecture
- Backend entry: `server.mjs`, API routes: `routes/api-routes.mjs`
- Unibox Q&A supports conversation history via `services/matter-qa-service.mjs` (max 10 turns, in-memory)
- AI: OpenAI Responses API via `shared/responses-client.mjs`, model config in `shared/model-policy.mjs`
- Skills: `skills/`, registry at `skills/registry.json`
- Frontend: Static files served by backend, root `index.html`, code in `frontend/`
- ES modules ("type": "module" in package.json)

## Quirks
- No lint/typecheck scripts defined
- Tests use Node.js built-in `node --test` (no external test framework)
- Slash-skill paradigm: skills invoked via slash commands, not free-form chat
