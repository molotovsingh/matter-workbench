# Statutes-Powered Research Build Plan

Date: 2026-07-03
Status: Implementation contract draft / junior-dev build plan

## One-Line Goal

Make Matter Workbench Research use exact statutory sources from the in-house
`statutes` service, while still using Exa/web search for discovery, cases,
commentary, official pages, and broader current-law context.

This is **not** a replacement for the in-house statutes/MCP layer. Exa helps us
find leads. The in-house statutes service gives us exact statute text,
quotable citations, provenance, and corpus metadata.

## Read These First, In This Order

1. `docs/future-design-decisions/copilot-web-research-mode.md`
   - Learn the product boundary: Ask is matter-only; Research may use public
     legal sources.
2. `docs/future-design-decisions/legal-source-sidecar-service.md`
   - This is the sidecar contract. It says retrieval belongs outside the main
     Workbench app.
3. `docs/future-design-decisions/statutes-service-research-integration.md`
   - This explains the statutes API and `STATUTE-*` source mapping.
4. `/Users/aksingh/statutes/docs/API.md`
   - The statutes HTTP API contract.
5. Current Workbench code:
   - `services/copilot-web-research-service.mjs`
   - `services/web-research-providers.mjs`
   - `services/copilot-web-research-answer-providers.mjs`
   - `routes/matter-workflow-routes.mjs`
   - `react-ui/src/lib/matterCopilotAnswer.ts`
   - `react-ui/src/components/command/CommandPanel.tsx`

Do not start coding until you have read all five.

## Product Boundary

Matter Workbench has three command modes:

| Mode | What it may use | What it must not do |
| --- | --- | --- |
| Skill | Governed workflows and artifact writers. | Run ad hoc web/statute lookups unless a skill contract says so. |
| Ask | Current matter record only. | Silently browse, search statutes, or use public law sources. |
| Research | Current matter record plus public/legal sources. | Write artifacts or pretend public research is lawyer-verified. |

Statutes belong in **Research**, not Ask.

Ask may say: “This may need public legal research.” It must not silently invoke
statutes, Exa, MCP tools, or the sidecar.

## Architecture We Are Building Toward

```text
React Research command / /research
  -> POST /api/matter-copilot/research
  -> services/copilot-web-research-service.mjs
  -> provider selected by COPILOT_WEB_RESEARCH_PROVIDER
       current: exa
       new: legal_source_sidecar
  -> Legal Source Sidecar
       -> statutes HTTP service for exact statutory text
       -> Exa/web search for public discovery, cases, commentary, official pages
  -> MW Research answer provider
  -> validated answer with matter_sources + public_sources
```

Workbench remains the product and answer owner. The sidecar is only a source
retriever/normalizer.

## The Correct Mental Model

### Exa is discovery

Use Exa/web search for:

- recent cases and legal reporting;
- official pages or PDFs not already in our corpus;
- regulator/government pages;
- commentary and broader legal context;
- query expansion and lead generation.

Do **not** treat Exa snippets as authoritative statutory text.

### Statutes is exact law text

Use the in-house statutes service for:

- exact section text;
- `citation` strings;
- act aliases and citation lookup;
- subsection fallback;
- provenance and corpus fingerprints;
- currency/status metadata when available.

### MW native AI is the second pass

Matter Workbench’s Research answer provider is the legal synthesis pass. It must:

- use matter context only for matter facts;
- use `STATUTE-*` and `WEB-*` sources only for public/legal sources;
- prefer `official_statute` sources for statutory propositions;
- cite only IDs supplied by the provider;
- drop invented or unsupported source IDs;
- preserve the caveat: `_Verify authorities before relying or filing._`

Do not build a sidecar that answers legal questions. The sidecar returns sources.

## Source ID Contract

The sidecar returns answer-local source IDs:

| Source kind | ID format |
| --- | --- |
| Statute | `STATUTE-0001`, `STATUTE-0002`, ... |
| Web | `WEB-0001`, `WEB-0002`, ... |

Workbench must preserve these IDs exactly.

Example source returned to Workbench:

```json
{
  "id": "STATUTE-0001",
  "title": "Section 60, Insolvency and Bankruptcy Code, 2016 (31 of 2016)",
  "url": "https://www.indiacode.nic.in/handle/123456789/2154",
  "published_at": "",
  "source_type": "official_statute",
  "snippet": "(5) Notwithstanding anything to the contrary contained in any other law..."
}
```

The `STATUTE-0001` ID is not globally stable. It is stable only inside one
Research answer. The durable legal identity is the statute `citation` plus
slug/section/corpus metadata from the sidecar/statutes service.

## Fresh Caution Review Before Coding

After re-reading the current Research implementation, keep these cautions in
mind. They are easy to miss.

1. **Provider warnings are currently discarded unless you wire them through.**
   The existing Research service reads `research.sources` and `research.query`.
   A sidecar adapter that returns `warnings` must also update the service so safe
   provider warnings appear in the final Research answer.
2. **Workbench must still cap source text.** The sidecar should truncate snippets,
   but the Workbench adapter must defensively cap `snippet` using
   `config.maxResultChars`. Never let a bad sidecar response send huge statutory
   text into the answer model.
3. **Source IDs should be canonical uppercase.** Accept only
   `/^(?:WEB|STATUTE)-\d{4}$/`. Drop or warn on malformed IDs instead of passing
   them to the answer model.
4. **Do not make `/api/config` depend on a live sidecar health call.** Config can
   say Research is enabled when the URL and answer provider are configured. A
   down sidecar should fail the Research request clearly, not slow every app-load
   config request.
5. **A Research question may contain matter facts.** The sidecar must not log full
   questions. If sidecar web/Exa mode is enabled, the query may leave the VM;
   keep Research explicit and prefer statutes-only sidecar mode until web-query
   policy is intentionally enabled.
6. **Auth/config failures should fail closed.** Sidecar `401` or
   `legal_source.unauthorized` should become
   `copilot_research.provider_not_configured`, not a generic no-results answer.

## What To Build First

Build this in two independent slices so Workbench can move while `statutes` keeps
improving.

### Slice A — Legal Source Sidecar V1

Build outside Matter Workbench, as a sibling repo/folder:

```text
/Users/aksingh/legal-source-service
```

Follow `docs/future-design-decisions/legal-source-sidecar-service.md`.

Minimum V1 behavior:

1. `GET /health` reports sidecar health and statutes provider status.
2. `POST /v1/legal-sources/search` accepts:

```json
{
  "schema_version": "legal-source-search-request/v1",
  "question": "section 69A Indian Partnership Act",
  "mode": "auto",
  "limit": 6
}
```

3. It calls statutes:
   - `/health`
   - `/v1/lookup?citation=...` for citation-looking questions
   - `/v1/search?q=...&hydrate=1` for discovery
4. It returns normalized `STATUTE-*` sources.
5. It may call Exa/web if configured, but Exa must not be required for
   statutes-only mode.
6. It never receives matter context or matter files.
7. It never calls an answer model.

### Slice B — Workbench Legal Source Adapter

Build in Matter Workbench after or alongside Slice A, using fake HTTP tests until
the real sidecar is stable.

New file:

```text
services/legal-source-sidecar-provider.mjs
```

This file should export:

```js
export function createLegalSourceSidecarProvider({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 8000,
  maxResults = 6,
  maxResultChars = 9000,
} = {})
```

The returned function must match the existing Research provider shape:

```js
async function provider({ question, query, queries, config }) {
  return {
    query: "...",
    sources: [/* Workbench public-source shape */],
    warnings: [],
    raw: {}
  };
}
```

It should call:

```http
POST ${baseUrl}/v1/legal-sources/search
```

with body:

```json
{
  "schema_version": "legal-source-search-request/v1",
  "question": "...",
  "mode": "auto",
  "limit": 6
}
```

Use `config.maxResults || maxResults` for the real limit. For V1, keep `mode` as
`auto`; when the sidecar starts with `LEGAL_SOURCE_WEB_ENABLED=0`, that is
statutes-only in practice.

If `token` is set, send:

```http
Authorization: Bearer <token>
```

Never log the token.

## Exact Workbench Code Changes

### 1. Add the sidecar provider file

Create:

```text
services/legal-source-sidecar-provider.mjs
```

Responsibilities:

- normalize `baseUrl`;
- reject missing base URL with `copilot_research.provider_not_configured`;
- POST JSON to `/v1/legal-sources/search`;
- enforce timeout with `AbortController`;
- parse JSON safely;
- map sidecar errors carefully:
  - timeout / HTTP 504 / `legal_source.provider_timeout` ->
    `copilot_research.provider_timeout`;
  - HTTP 401 / `legal_source.unauthorized` ->
    `copilot_research.provider_not_configured`;
  - `legal_source.provider_not_configured` ->
    `copilot_research.provider_not_configured`;
  - other sidecar failures -> `copilot_research.provider_error`;
- normalize and cap `sources` in the shape Research already uses;
- return safe sidecar `warnings` so the Research service can include them in the
  final response.

Source normalization rule:

```js
const id = String(source.id || "").trim().toUpperCase();
if (!/^(?:WEB|STATUTE)-\d{4}$/.test(id)) {
  // Drop malformed IDs and add a warning. Do not pass them to the model.
}

{
  id,
  title: source.title || source.citation || "Untitled legal source",
  url: source.url || "",
  publishedAt: source.published_at || source.publishedAt || "",
  sourceType: source.source_type || source.sourceType || "other",
  snippet: truncate(source.snippet || "", config.maxResultChars || maxResultChars),
}
```

Preserve valid `STATUTE-*` and `WEB-*` IDs exactly after uppercase
canonicalization.

### 2. Extend Research config

File:

```text
services/copilot-web-research-service.mjs
```

Change `readCopilotWebResearchConfig` so it recognizes:

```env
COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar
COPILOT_LEGAL_SOURCE_SERVICE_URL=http://127.0.0.1:8790
COPILOT_LEGAL_SOURCE_SERVICE_TOKEN=
```

For provider `legal_source_sidecar`:

- `providerConfigured` is true when URL is non-empty;
- no `EXA_API_KEY` is required;
- keep existing `COPILOT_WEB_RESEARCH_MAX_RESULTS`, timeout, and max chars;
- unknown provider names must remain fail-closed (`providerConfigured: false` and
  no default provider function).

### 3. Select the provider

File:

```text
services/copilot-web-research-service.mjs
```

Update `createDefaultWebResearchProvider`:

```js
if (config.provider === "exa") return createExaWebResearchProvider(...);
if (config.provider === "legal_source_sidecar") return createLegalSourceSidecarProvider(...);
return null;
```

### 4. Validate `STATUTE-*` source IDs

File:

```text
services/copilot-web-research-service.mjs
```

Current source-ID extraction is WEB-only. Change it to:

```js
/\b(?:WEB|STATUTE)-\d{4}\b/gi
```

Keep the allow-list rule: only IDs that were actually supplied by the provider
may survive in the final answer.

### 5. Thread sidecar warnings through the Research response

File:

```text
services/copilot-web-research-service.mjs
```

The current service ignores provider warnings. Update it so:

1. `answerResearchQuestionFromPacket` reads `research.warnings` from the sidecar
   adapter result.
2. `normalizeResearchAnswer` accepts `providerWarnings`.
3. Final `warnings` includes:
   - source-validation warnings;
   - safe provider/sidecar warnings;
   - model-returned warnings.

Do not include raw provider traces, tokens, full questions, stack traces, or full
statute provenance JSON in warnings.

### 6. Update Research prompt rules

File:

```text
services/copilot-web-research-answer-providers.mjs
```

Add rules to both the system prompt and `strict_rules` payload:

- Treat `STATUTE-*` / `official_statute` sources as supplied statutory text.
- Prefer `official_statute` sources for statutory propositions.
- Quote or paraphrase statute text only from supplied statute snippets.
- Do not invent sections, provisos, explanations, commencement dates,
  amendments, or currentness.
- If statute sources and web sources conflict, say what must be verified.
- Do not treat statutes as matter facts.

Keep:

```text
_Verify authorities before relying or filing._
```

### 7. Update `.env.example`

Add near the Research block:

```env
# Alternative Research provider: Legal Source Sidecar.
# To use it, set COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar.
# It does not require EXA_API_KEY for statutes-only mode.
COPILOT_LEGAL_SOURCE_SERVICE_URL=http://127.0.0.1:8790
COPILOT_LEGAL_SOURCE_SERVICE_TOKEN=
```

Do not remove the current Exa settings. Exa-only Research must keep working.

## Tests To Add

### `test/legal-source-sidecar-provider.test.mjs`

Use fake `fetchImpl`; do not start a real sidecar.

Test cases:

1. Missing `baseUrl` throws `copilot_research.provider_not_configured`.
2. Sends POST to `/v1/legal-sources/search`.
3. Sends bearer token when configured.
4. Maps `STATUTE-*` source into Workbench source shape.
5. Preserves `WEB-*` IDs returned by sidecar.
6. Canonicalizes lowercase IDs to uppercase or drops malformed IDs with a warning.
7. Caps overlong snippets to `maxResultChars`.
8. Timeout throws `copilot_research.provider_timeout`.
9. Sidecar `401` / unauthorized body maps to
   `copilot_research.provider_not_configured` without leaking token.
10. Other sidecar error bodies map to `copilot_research.provider_error` without
    leaking token.
11. Empty sources returns `{ sources: [] }`; let
    `copilot-web-research-service.mjs` decide whether that is `no_results`.

### `test/copilot-web-research-service.test.mjs`

Add tests:

1. `legal_source_sidecar` config is enabled without `EXA_API_KEY` when URL and
   answer provider exist.
2. `STATUTE-0001` referenced in `answer_markdown` is accepted if supplied.
3. `STATUTE-9999` is dropped if not supplied.
4. Provider warnings from the sidecar are included in final `warnings`.
5. Existing `WEB-*` behavior still works.
6. Exa-only config still works.
7. Unknown provider names remain disabled/fail-closed.

### `test/copilot-web-research-answer-providers.test.mjs`

Add tests that inspect prompt/payload text for statute rules:

- `official_statute` appears in the rules;
- `STATUTE-*` sources are treated as public sources;
- prompt says not to invent sections/provisos/currentness.

### `test/copilot-web-research-api.test.mjs`

Add an end-to-end fake-provider API test:

- configure `COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar`;
- inject fake provider or fake fetch;
- return `STATUTE-0001`;
- assert `/api/matter-copilot/research` returns that source.

### React tests

No mandatory UI change for V1.

Add a small rendering regression only if convenient:

- `formatMatterCopilotResearchAnswer` displays `STATUTE-0001 — Section ...` in
  public sources.

## Manual Smoke Plan

### 1. Start statutes

```bash
cd /Users/aksingh/statutes
npm test
npm run build:corpus   # if you want the local corpus, not only the fixture DB
node bin/statutes.mjs serve --host 127.0.0.1 --port 8787
```

Check:

```bash
curl -s http://127.0.0.1:8787/health | jq
```

Do not proceed if `/health` reports only the fixture when you expected the
corpus. This means you built the wrong `STATUTE_ACTS_DIR`.

### 2. Start Legal Source Sidecar

```bash
cd /Users/aksingh/legal-source-service
LEGAL_SOURCE_STATUTES_ENABLED=1 \
STATUTES_API_URL=http://127.0.0.1:8787 \
LEGAL_SOURCE_WEB_ENABLED=0 \
node src/server.mjs
```

Check:

```bash
curl -s http://127.0.0.1:8790/health | jq
```

Search:

```bash
curl -s \
  -X POST http://127.0.0.1:8790/v1/legal-sources/search \
  -H 'content-type: application/json' \
  -d '{"question":"section 69A Indian Partnership Act","mode":"statutes","limit":3}' | jq
```

Expected:

- at least one `STATUTE-0001` source;
- `source_type` is `official_statute`;
- title/citation mentions Section 69A;
- snippet contains statutory text.

### 3. Start Matter Workbench

```bash
cd /Users/aksingh/matter-workbench
COPILOT_WEB_RESEARCH_ENABLED=1 \
COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar \
COPILOT_LEGAL_SOURCE_SERVICE_URL=http://127.0.0.1:8790 \
node server.mjs
```

Then ask in Research mode:

```text
/research section 69A Indian Partnership Act
```

Expected:

- answer begins with `Research answer from public sources`;
- public sources include `STATUTE-0001`;
- answer ends with the verification caveat;
- no matter artifacts are created.

## Common Mistakes To Avoid

- Do not call statutes directly from the browser.
- Do not call statutes directly from ordinary Ask.
- Do not build a `services/statutes-research-provider.mjs` inside Workbench.
- Do not send matter context or matter files to the Legal Source Sidecar.
- Do not have the sidecar call OpenAI/OpenRouter or write answers.
- Do not make `EXA_API_KEY` mandatory for statutes-only Research.
- Do not trust Exa snippets as exact statute text.
- Do not log full Research questions in the sidecar; questions may contain matter
  facts.
- Do not enable sidecar web/Exa mode without accepting that the public search
  query may leave the VM.
- Do not let a sidecar response send unlimited statute text into the answer
  model; cap snippets in Workbench too.
- Do not let the model cite `STATUTE-9999` or any source ID not supplied.
- Do not claim current law is confirmed. Use the caveat.
- Do not write any matter artifact from Research.

## Definition Of Done For The First Workbench Slice

The Workbench adapter slice is done when:

1. Existing Exa-only Research still passes tests.
2. `COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar` works without
   `EXA_API_KEY`.
3. Research can accept and validate `STATUTE-*` source IDs.
4. A fake sidecar test proves Workbench preserves valid uppercase `STATUTE-*`
   IDs and rejects malformed IDs.
5. A fake answer that cites unsupported `STATUTE-*` IDs gets those IDs dropped
   with a warning.
6. Safe sidecar warnings are visible in final Research `warnings`.
7. Research prompt/payload tells the model how to use statute sources safely.
8. `/api/config` exposes Research as enabled only when the sidecar provider and
   answer provider are configured, without blocking on a sidecar health call.
9. No React UI change is required for V1.
10. No matter artifact is created or mutated.

## Later, Not Now

Park these until the first slice works:

- source grouping in the UI: `Statutes`, `Web`, `Matter record`;
- dedicated statute lookup command;
- direct statute viewer panel;
- persistent legal-source provider-run receipts;
- statutes cross-reference expansion;
- using MCP directly inside Workbench runtime.

MCP remains useful for agents and local exploration. Workbench runtime should use
the loopback HTTP sidecar path for this first integration.
