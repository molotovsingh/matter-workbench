# Public Indian Legal Updates Widget

Date: 2026-05-21
Status: Parked future feature; experimental integration only

## Decision

This feature is acceptable only as an **experimental, disabled-by-default, public legal updates widget**.

Do not treat it as a matter workflow, legal research engine, precedent finder, or court-monitoring system. It should not send matter data to Parallel, should not write matter artifacts, and should not imply that the workbench has found authorities relevant to the active matter.

The safest product framing:

> Show a small, optional public legal-news card. Do not change any matter workflow.

## Why This Document Was Revised

The earlier version assumed a Parallel endpoint named:

```text
https://api.parallel.ai/v1/legal/india/judgments
```

Do not implement against that endpoint unless Parallel explicitly confirms it. Current public Parallel documentation exposes generic APIs such as Search, Extract, Tasks, FindAll, Chat, and Monitor. The documented Search API is `POST /v1/search` with an `x-api-key` header, not a legal judgments `GET` endpoint with `Authorization: Bearer`.

Reference docs:

- https://docs.parallel.ai/llms.txt
- https://docs.parallel.ai/api-reference/search/search
- https://docs.parallel.ai/api-reference/tasks/create-task-run

## Product Scope

### In Scope

- Backend route that returns legal updates only when explicitly enabled.
- In-memory TTL cache.
- React card that is hidden when disabled, empty, dismissed, or unavailable.
- Public web/source links only.
- No matter context, no private files, no active matter data sent to Parallel.
- Clear source/date display where available.

### Out of Scope

- No fake or guessed Parallel legal endpoint.
- No database, Redis, SQLite, or durable cache.
- No matter artifacts or workspace writes.
- No skill execution.
- No legal advice language.
- No automatic relevance claim for the active matter.
- No floating panel that covers the command box or workspace.

## Recommended Architecture

```text
Parallel Search API or confirmed legal endpoint
  -> legal updates backend service
  -> /api/legal-updates
  -> React card
  -> Home or Activity surface
```

The service must degrade gracefully:

- Disabled flag off: return `{ enabled: false, highlights: [] }`.
- Missing API key: return `{ enabled: false, highlights: [] }`.
- Provider failure: return a non-crashing response; the UI should either hide the widget or show "Updates unavailable."

## Provider Choice

### Option A - Safe Initial Version

Use the documented Parallel Search API:

```text
POST https://api.parallel.ai/v1/search
Header: x-api-key: <PARALLEL_API_KEY>
```

Suggested search body:

```json
{
  "objective": "Find recent public Indian court judgment updates suitable for a legal updates widget. Prefer official court websites or reputable legal reporting sources. Return source pages, court/date where available, and avoid legal advice.",
  "search_queries": [
    "recent Supreme Court India judgments",
    "recent Indian High Court judgments",
    "Indian court judgment updates"
  ],
  "max_chars_total": 6000,
  "mode": "basic"
}
```

Important: Search results are web results, not a structured judgment feed. The UI copy must not overclaim. Use source URLs and excerpts. Do not fabricate court, date, citation, or case names.

### Option B - Later Version

If Parallel confirms a dedicated Indian judgments endpoint, add a provider adapter for that endpoint. That adapter should live inside the service, keep the same internal `LegalUpdate` shape, and have its own tests.

Do not bundle Option B into the first PR unless the endpoint and response schema are confirmed.

## Files To Create Or Modify

### 1. Backend Service

Create:

```text
services/legal-updates-service.mjs
```

Service requirements:

- Read from `env`.
- Accept `fetchImpl` for tests.
- Prefer accepting `now = () => Date.now()` for deterministic TTL tests.
- Cache successful results in memory only.
- Clamp config values to sane limits.
- Return an empty disabled service when not configured.
- Use `x-api-key` for documented Parallel Search API calls.
- Never send matter name, matter root, file paths, snippets, or active workspace data.

Suggested internal data shape:

```ts
export interface LegalUpdate {
  id: string;
  title: string;
  court: string | null;
  date: string | null;
  summary: string;
  citations: string[];
  url: string | null;
  tags: string[];
  source: 'parallel_search' | 'configured_endpoint';
}
```

For Parallel Search normalization:

- `title`: use result title, fallback to `Untitled legal update`.
- `date`: use `publish_date` only if present.
- `summary`: use joined excerpts, trimmed to a reasonable length.
- `url`: use result URL.
- `citations`: use source URL or citation strings actually returned by the provider.
- `court`: `null` unless the provider result explicitly gives a court.

Do not default court to "Supreme Court of India" when unknown.

### 2. Wire Service Into Server

Modify:

```text
server.mjs
```

Add import:

```js
import { createLegalUpdatesService } from "./services/legal-updates-service.mjs";
```

Instantiate inside `createWorkbenchServer` near the other services:

```js
const legalUpdatesService = createLegalUpdatesService({
  env,
  fetchImpl: options.fetchImpl || fetch,
});
```

Add `legalUpdatesService` to the `services` object passed into `handleApiRequest`.

### 3. API Route

Modify:

```text
routes/app-shell-routes.mjs
```

This repo uses `dispatchRoutes`, `exactRoute`, and `sendJson(response, statusCode, payload)`. Do not paste a raw `if (pathname...)` route and do not use the wrong `sendJson` argument order.

Add `legalUpdatesService` to the services destructuring, then add an exact route:

```js
exactRoute("GET", "/api/legal-updates", async () => {
  if (!legalUpdatesService?.isEnabled()) {
    sendJson(response, 200, { enabled: false, highlights: [] });
    return;
  }

  try {
    const highlights = await legalUpdatesService.fetchHighlights();
    sendJson(response, 200, { enabled: true, highlights });
  } catch (error) {
    sendJson(response, 502, {
      enabled: true,
      error: "Legal updates unavailable.",
      highlights: [],
    });
  }
}),
```

Server logs may keep technical provider details if existing logging patterns support that. The API response should not expose raw provider error text to the lawyer-facing UI.

### 4. React Types

Modify:

```text
react-ui/src/types/index.ts
```

Add one shared type. Do not duplicate `LegalUpdate` in the API client and component.

```ts
export interface LegalUpdate {
  id: string;
  title: string;
  court: string | null;
  date: string | null;
  summary: string;
  citations: string[];
  url: string | null;
  tags: string[];
  source: 'parallel_search' | 'configured_endpoint';
}

export interface LegalUpdatesResponse {
  enabled: boolean;
  highlights: LegalUpdate[];
  error?: string;
}
```

### 5. React API Client

Modify:

```text
react-ui/src/api/client.ts
```

Import `LegalUpdatesResponse` from shared types and add:

```ts
getLegalUpdates: () => getJson<LegalUpdatesResponse>('/api/legal-updates'),
```

### 6. React Widget

Create:

```text
react-ui/src/components/LegalUpdatesBox.tsx
```

Behavior requirements:

- On mount, read `localStorage.getItem('mw_legal_updates_dismissed')` before showing.
- Fetch `/api/legal-updates`.
- Render nothing if disabled, empty, dismissed, or failed.
- Dismiss writes `mw_legal_updates_dismissed`.
- Expand/collapse each update.
- If `date` is missing, omit the date rather than showing today's date.
- If `court` is missing, omit the court rather than guessing.
- Links must use `target="_blank"` and `rel="noopener noreferrer"`.
- UI error should be generic: "Updates unavailable."

Suggested lawyer-facing copy:

- Title: `Legal Updates`
- Small meta text, if needed: `Public sources - verify before relying`
- Link text: `Open source`

Avoid:

- "AI found this precedent"
- "Relevant to this matter"
- "Latest law"
- "Recommended authority"

### 7. Placement

Do not use a global fixed bottom-right panel in the first PR.

Reason: the current React shell uses a two-column `editor-layout` with the command panel on the right. A fixed bottom-right widget can cover the command box, recent activity, action buttons, or workflow results.

Preferred placement:

1. Activity page, as a small optional section below the existing activity content; or
2. Home dashboard, below matter status cards, only when no workflow is actively being shown.

If the coder chooses Home placement, keep the card inside the normal document flow. It should not cover the command panel or file preview.

### 8. Styles

Current React UI imports:

```text
react-ui/src/styles/global.css
```

For the first PR, either:

- Add a small, clearly named section to `global.css`; or
- Add `react-ui/src/styles/legal-updates.css` and import it from `react-ui/src/main.tsx`.

Use existing theme variables:

- `--panel`
- `--subtle-bg`
- `--border`
- `--border-subtle`
- `--text`
- `--muted`
- `--muted-strong`
- `--accent`
- `--error-text`

Do not introduce a separate dark-only palette like `--panel-bg` / `--text-primary` unless the app already uses those names.

Recommended sizing:

- `font-size: var(--font-size-ui)` for body text.
- `font-size: var(--font-size-sm)` for metadata.
- Border radius `5px` or `6px`.
- Max width should follow the containing surface, not a fixed overlay.

## Environment Variables

Update `.env.example`, not the real `.env`.

```text
# Experimental public legal updates widget. Disabled by default.
PARALLEL_LEGAL_UPDATES_ENABLED=0
PARALLEL_API_KEY=
PARALLEL_LEGAL_UPDATES_MAX_ITEMS=5
PARALLEL_LEGAL_UPDATES_CACHE_MINUTES=60

# Optional. Leave empty for documented Parallel Search API.
# Only set this after confirming a dedicated legal endpoint and schema.
PARALLEL_LEGAL_ENDPOINT=
```

Do not commit the real `.env`.

## Testing Requirements

Add focused tests for:

- Disabled when flag is off.
- Disabled when API key is missing.
- Disabled when API key is placeholder.
- Search API request uses `POST /v1/search`.
- Search API request uses `x-api-key`.
- Matter data is not present in the provider request.
- Successful response is normalized without fabricating court/date.
- Cache prevents a second provider call inside TTL.
- Cache expires after TTL.
- Provider failure does not crash the route.
- Dismiss state reads from and writes to localStorage.
- Expand/collapse works.

Run:

```text
npm test
npm run ui:build
```

If the UI placement changes visibly, also run:

```text
npm run ui:smoke
```

## Recommended First PR Scope

Keep the first PR narrow:

- Service with disabled-by-default config.
- `/api/legal-updates` route.
- Shared React types and API client method.
- Small React card on Activity or Home.
- `.env.example` placeholders.
- Tests.

Do not include:

- A guessed legal endpoint.
- A global floating overlay.
- Database or durable cache.
- Matter-aware legal research.
- Skill registry changes.
- AI provider calls beyond the explicitly configured Parallel call.
- Any `.env` changes with a real key.

## Acceptance Criteria

- With defaults, the widget is invisible and no Parallel request fires.
- With enabled mock config, the widget renders public-source updates.
- No active matter data is sent to Parallel.
- No provider error text is displayed directly to lawyers.
- The command panel remains usable at desktop and narrow widths.
- `npm test` passes.
- `npm run ui:build` passes.

## Rollback

Revert only:

- `services/legal-updates-service.mjs`
- the legal updates route in `routes/app-shell-routes.mjs`
- the service wiring in `server.mjs`
- legal update types/client additions in `react-ui/src/types/index.ts` and `react-ui/src/api/client.ts`
- `react-ui/src/components/LegalUpdatesBox.tsx`
- legal update CSS additions
- legal update placement in `HomeLanding`, `ActivityPage`, or whichever surface was selected
- `.env.example` placeholder additions

No matter data or workspace artifacts should need cleanup because this feature must not write them.
