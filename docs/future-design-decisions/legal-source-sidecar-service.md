# Legal Source Sidecar Service

Date: 2026-07-02
Status: Implementation contract draft

## One-Line Decision

Build a **separate loopback sidecar service** for legal-source retrieval. Do not
put the statutes/web-source retrieval provider inside the main Matter Workbench
app.

```text
Matter Workbench
  -> Legal Source Sidecar
       -> statutes service
       -> optional web search provider such as Exa
```

Matter Workbench remains the product/UI and answer-synthesis owner. The sidecar
only retrieves and normalizes external legal sources.

## Who This Document Is For

This is written for a junior developer implementing the first version. Follow the
steps in order. If something is unclear, stop and ask before adding behavior that
is not in this document.

## Read These First

1. `docs/future-design-decisions/statutes-service-research-integration.md`
   - Read only for context on the statutes API and `STATUTE-*` source mapping.
   - Do **not** follow its older suggestion to add a provider inside
     `services/` in the main Workbench app.
2. `/Users/aksingh/statutes/docs/API.md`
   - Canonical statutes HTTP API contract.
3. `/Users/aksingh/statutes/examples/statutes_api_tour.py`
   - Runnable tour and reference client.
4. `docs/future-design-decisions/copilot-web-research-mode.md`
   - Workbench Research mode rules: Ask stays matter-only; Research uses public
     sources and caveats.

## Core Boundaries

### What stays in Matter Workbench

Matter Workbench owns:

- the React Research UI and `/research` command;
- matter selection and matter context packet construction;
- Ask vs Research boundary;
- AI answer synthesis using matter facts + returned legal sources;
- source-ID validation in final Research answers;
- Copilot interaction receipts;
- user-facing warnings and display.

### What moves to the sidecar

The Legal Source Sidecar owns:

- calling the `statutes` service;
- optional web search calls;
- source retrieval timeouts and fallback;
- source ranking, de-duplication, and capping;
- normalizing external legal sources into one source list;
- returning `STATUTE-*` and `WEB-*` source IDs for one response.

### What stays in the `statutes` repo

The `statutes` service owns:

- the statute corpus/index;
- exact statutory text;
- act aliases;
- citation parsing through `/v1/lookup`;
- subsection fallback;
- provenance and corpus fingerprinting.

## Strict Non-Goals For V1

Do **not** implement these in the sidecar V1:

- no React UI;
- no matter file access;
- no matter context packet ingestion;
- no answer model calls;
- no database;
- no durable chat memory;
- no matter artifact writes;
- no direct dependency/import from Matter Workbench code;
- no public internet exposure of the sidecar port;
- no statute equivalence mapping such as IPC -> BNS;
- no legal advice generation.

The sidecar returns source material only. It does not answer the legal question.

## Recommended Repository Shape

Create this as a sibling repo or sibling folder, not inside the main Workbench
app. Suggested local path:

```text
/Users/aksingh/legal-source-service
```

Suggested files:

```text
legal-source-service/
  package.json
  README.md
  docs/API.md
  examples/legal_source_tour.mjs
  src/config.mjs
  src/server.mjs
  src/errors.mjs
  src/http-client.mjs
  src/source-normalization.mjs
  src/providers/statutes-provider.mjs
  src/providers/web-provider.mjs
  src/providers/composite-provider.mjs
  test/config.test.mjs
  test/statutes-provider.test.mjs
  test/source-normalization.test.mjs
  test/server.test.mjs
  test/composite-provider.test.mjs
```

Use Node 22+ and global `fetch`. Keep dependencies minimal. If adding a
dependency, ask first.

## Deployment Shape

All services bind loopback only:

```text
127.0.0.1:8787  statutes service
127.0.0.1:8790  legal-source sidecar
127.0.0.1:4173  Matter Workbench, example only
```

Example startup:

```bash
# terminal 1
cd /Users/aksingh/statutes
npm run build:corpus   # use npm run build only when you intentionally want the tiny fixture corpus
node bin/statutes.mjs serve --host 127.0.0.1 --port 8787

# terminal 2
cd /Users/aksingh/legal-source-service
LEGAL_SOURCE_STATUTES_ENABLED=1 \
STATUTES_API_URL=http://127.0.0.1:8787 \
node src/server.mjs
```

After starting statutes, always check `GET /health`. Do not continue if the act
and section counts show the fixture corpus when you expected the larger local
corpus.

## Environment Variables

### Sidecar env

```env
LEGAL_SOURCE_HOST=127.0.0.1
LEGAL_SOURCE_PORT=8790
LEGAL_SOURCE_API_TOKEN=

LEGAL_SOURCE_DEFAULT_MODE=auto
LEGAL_SOURCE_MAX_RESULTS=6
LEGAL_SOURCE_TIMEOUT_MS=8000
LEGAL_SOURCE_MAX_SOURCE_CHARS=12000

LEGAL_SOURCE_STATUTES_ENABLED=1
STATUTES_API_URL=http://127.0.0.1:8787
STATUTE_API_TOKEN=
LEGAL_SOURCE_STATUTES_TIMEOUT_MS=5000
LEGAL_SOURCE_STATUTES_MAX_RESULTS=4

LEGAL_SOURCE_WEB_ENABLED=0
LEGAL_SOURCE_WEB_PROVIDER=exa
EXA_API_KEY=
LEGAL_SOURCE_WEB_TIMEOUT_MS=15000
LEGAL_SOURCE_WEB_MAX_RESULTS=4
```

Rules:

- Default host must be `127.0.0.1`.
- `/health` may be open.
- `/v1/*` should require `Authorization: Bearer <LEGAL_SOURCE_API_TOKEN>` if
  `LEGAL_SOURCE_API_TOKEN` is set.
- `STATUTE_API_TOKEN` is for sidecar -> statutes auth.
- `LEGAL_SOURCE_API_TOKEN` is for Workbench -> sidecar auth.

### Later Workbench env

When Workbench integration starts, likely env:

```env
COPILOT_WEB_RESEARCH_ENABLED=1
COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar
COPILOT_LEGAL_SOURCE_SERVICE_URL=http://127.0.0.1:8790
COPILOT_LEGAL_SOURCE_SERVICE_TOKEN=
```

Do not implement the Workbench adapter as part of the sidecar first PR unless
explicitly asked.

## Sidecar HTTP API

### `GET /health`

Returns sidecar readiness and provider status. This endpoint should not require
a token.

Response example:

```json
{
  "schema_version": "legal-source-health/v1",
  "ok": true,
  "service": "legal-source-service",
  "providers": {
    "statutes": {
      "enabled": true,
      "ok": true,
      "base_url": "http://127.0.0.1:8787",
      "built_at": "2026-07-02T05:18:42.460Z",
      "corpus_fingerprint": "corpus-sha256:8742a18c...",
      "last_refreshed": "2026-06-30T04:00:11.000Z"
    },
    "web": {
      "enabled": false,
      "ok": null,
      "provider": "exa"
    }
  },
  "warnings": []
}
```

If statutes is enabled but unreachable, return `200` with `ok: false` and a
warning. Health should not crash because a provider is down.

### `POST /v1/legal-sources/search`

Main retrieval endpoint.

Request:

```json
{
  "schema_version": "legal-source-search-request/v1",
  "question": "what IBC sections let NCLT direct the RP to execute a sale deed?",
  "mode": "auto",
  "limit": 6
}
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `question` | yes | User's Research question or statute lookup phrase. |
| `mode` | no | `auto`, `statutes`, `web`, or `hybrid`. Default: env `LEGAL_SOURCE_DEFAULT_MODE`, then `auto`. |
| `limit` | no | Total sources to return. Clamp to 1-12. |

Do not accept matter context or source files in this request.

Response:

```json
{
  "schema_version": "legal-source-search-response/v1",
  "query": "what IBC sections let NCLT direct the RP to execute a sale deed?",
  "mode": "auto",
  "sources": [
    {
      "id": "STATUTE-0001",
      "source_type": "official_statute",
      "title": "Section 60, Insolvency and Bankruptcy Code, 2016 (31 of 2016)",
      "citation": "Section 60, Insolvency and Bankruptcy Code, 2016 (31 of 2016)",
      "url": "https://www.indiacode.nic.in/...",
      "snippet": "Full or truncated statutory text...",
      "metadata": {
        "provider": "statutes",
        "slug": "a2016-31",
        "section": "60",
        "requested_section": "60(5)",
        "act": "Insolvency and Bankruptcy Code, 2016",
        "act_number": "31 of 2016",
        "corpus_fingerprint": "corpus-sha256:8742a18c...",
        "built_at": "2026-07-02T05:18:42.460Z"
      }
    }
  ],
  "warnings": [],
  "provider_runs": [
    {
      "provider": "statutes",
      "status": "ok",
      "query": "what IBC sections let NCLT direct the RP to execute a sale deed?",
      "result_count": 1,
      "elapsed_ms": 21
    }
  ]
}
```

Use `200` even if no sources are found:

```json
{
  "schema_version": "legal-source-search-response/v1",
  "query": "...",
  "mode": "auto",
  "sources": [],
  "warnings": ["No legal sources found."],
  "provider_runs": []
}
```

Workbench can translate empty `sources` to its existing
`copilot_research.no_results` behavior.

## Error Contract

Errors use JSON bodies:

```json
{
  "error": "Question is required.",
  "code": "legal_source.invalid_request"
}
```

Codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `legal_source.invalid_request` | 400 | Bad JSON, missing/blank question, invalid mode, invalid limit. |
| `legal_source.unauthorized` | 401 | Token configured but missing/wrong. |
| `legal_source.method_not_allowed` | 405 | Non-supported method. |
| `legal_source.not_found` | 404 | Unknown route. |
| `legal_source.provider_not_configured` | 503 | No enabled source provider. |
| `legal_source.provider_timeout` | 504 | All useful providers timed out and no partial sources exist. |
| `legal_source.provider_error` | 503 | Provider failure with no partial result. |
| `legal_source.internal` | 500 | Unexpected bug. |

If one provider fails but another returns sources, return `200` with `warnings`.
Do not fail the whole request if there are useful sources.

## Source ID Rules

Assign IDs after final merge/ranking:

| Source kind | ID format |
| --- | --- |
| Statute | `STATUTE-0001`, `STATUTE-0002`, ... |
| Web | `WEB-0001`, `WEB-0002`, ... |

IDs are stable only within a single response.

Do not reuse provider raw IDs as public IDs. Keep raw IDs in `metadata` if useful.

## Source Type Vocabulary

Use these `source_type` values:

| `source_type` | Meaning |
| --- | --- |
| `official_statute` | Statutory text from the statutes service. |
| `official` | Government/regulator source that is not a statute section. |
| `court` | Court/tribunal website or order source. |
| `legal_report` | Legal reporting site. |
| `other` | Everything else. |

## Statutes Provider Implementation

File:

```text
src/providers/statutes-provider.mjs
```

Export:

```js
export function createStatutesProvider({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 5000,
  maxResults = 4,
  maxSourceChars = 12000,
} = {})
```

Provider return shape:

```js
{
  sources: [/* normalized but not finally ID-numbered yet */],
  warnings: [],
  providerRun: {
    provider: "statutes",
    status: "ok",
    query,
    result_count: 3,
    elapsed_ms: 12,
    corpus_fingerprint: "corpus-sha256:..."
  }
}
```

### Statutes provider algorithm

For a given `question`:

1. Normalize whitespace and clamp question length, e.g. 1200 chars.
2. Read statutes health with `GET /health` using a short timeout.
   - Capture `built_at`, `corpus_fingerprint`, and `last_refreshed`.
   - If health is 503, return no sources plus warning: statutes index missing.
3. If the question appears to include a section citation, call:

```http
GET /v1/lookup?citation=<encoded question>
```

   Citation detector can be simple:

```js
/\b(?:section|sec\.?|s\.?)\s*\d/i
```

   Also detect reversed phrasing:

```js
/\b[A-Z]{2,}\s+(?:section|sec\.?|s\.?)\s*\d/i
```

4. If lookup returns matches, normalize them.
5. Always consider search unless mode is an exact direct-read mode added later:

```http
GET /v1/search?q=<encoded question>&limit=<n>&hydrate=1
```

6. Normalize search results.
7. De-duplicate by:

```text
statute:<slug>:<section>
```

   If `requested_section` exists, keep it in metadata but do not let it create a
   duplicate source for the same served section.
8. Rank:
   - lookup matches first;
   - hydrated search hits next by API order;
   - records with `text` before records without text.
9. Return up to `maxResults`.

### Mapping statutes records to sidecar sources

Input from statutes `/v1/search?hydrate=1` or `/v1/lookup`:

```json
{
  "id": "easements-act-1882/s13",
  "slug": "easements-act-1882",
  "act": "Indian Easements Act, 1882",
  "act_number": "5 of 1882",
  "section": "13",
  "requested_section": "13(a)",
  "heading": "Easements of necessity and quasi easements.",
  "citation": "Section 13, Indian Easements Act, 1882 (5 of 1882)",
  "source_url": "https://www.indiacode.nic.in/...",
  "text": "...",
  "provenance": {}
}
```

Sidecar source before final ID numbering:

```js
{
  sourceKind: "statute",
  source_type: "official_statute",
  title: record.citation || `Section ${record.section}, ${record.act}`,
  citation: record.citation || "",
  url: record.source_url || record.provenance?.authenticity_anchor?.archive_url || "",
  snippet: truncate(record.text || record.snippet || "", maxSourceChars),
  dedupeKey: `statute:${record.slug}:${record.section}`,
  metadata: {
    provider: "statutes",
    slug: record.slug,
    section: record.section,
    requested_section: record.requested_section || "",
    act: record.act,
    act_number: record.act_number || "",
    heading: record.heading || "",
    corpus_fingerprint: health.corpus_fingerprint || "",
    built_at: health.built_at || "",
    provenance: summarizeProvenance(record.provenance)
  }
}
```

Do not put the full provenance JSON into `metadata` if it makes responses huge.
Keep a compact summary unless asked otherwise.

## Optional Web Provider

File:

```text
src/providers/web-provider.mjs
```

V1 may leave this disabled. If implemented, keep it similar to Workbench's current
Exa provider:

- POST to Exa search endpoint;
- request highlights/snippets, not full pages by default;
- classify source type as `official`, `court`, `legal_report`, or `other`;
- never send matter context, only the question/search query;
- return normalized sources with `sourceKind: "web"`.

Do not call any answer model from this provider.

## Composite Provider

File:

```text
src/providers/composite-provider.mjs
```

Inputs:

```js
{
  question,
  mode,       // auto | statutes | web | hybrid
  limit,
}
```

Behavior:

| Mode | Behavior |
| --- | --- |
| `statutes` | Call statutes only. |
| `web` | Call web only. |
| `hybrid` | Call statutes and web; merge. |
| `auto` | Call statutes for statute-looking questions; call web if statutes returns no sources or if question asks for cases/current law. |

A simple V1 `auto` rule is acceptable:

```js
const statuteLikely = /\b(section|sec\.?|s\.?|act|code|rule|provision|limitation|cpc|ibc|crpc|ipc|bns|bnss|rera|sarfaesi|pmla|pocso|cgst)\b/i.test(question);
const webLikely = /\b(case|judgment|latest|recent|court held|precedent|notification|circular|regulation|news)\b/i.test(question);
```

- If `statuteLikely`, call statutes.
- If `webLikely`, call web too.
- If neither, call statutes first if enabled, then web only if statutes returns no
  sources and web is enabled.

Final ranking:

1. `official_statute`
2. `official`
3. `court`
4. `legal_report`
5. `other`

Then preserve provider order within each group.

## HTTP Client Helper

File:

```text
src/http-client.mjs
```

Implement one helper for GET/POST with timeout:

```js
export async function fetchJsonWithTimeout({
  fetchImpl = fetch,
  url,
  method = "GET",
  headers = {},
  body,
  timeoutMs,
})
```

Requirements:

- use `AbortController`;
- parse JSON safely;
- on abort throw an error with code `legal_source.provider_timeout`;
- do not leak bearer tokens in error messages;
- include response status and provider error code when available.

## Server Implementation

File:

```text
src/server.mjs
```

Use `node:http` unless there is a specific reason to add a framework.

Routes:

```text
GET  /health
POST /v1/legal-sources/search
```

Server requirements:

- reject non-GET/POST as `method_not_allowed`;
- reject unknown routes as `legal_source.not_found`;
- parse JSON body with a size cap, e.g. 64KB;
- token-gate `/v1/*` if `LEGAL_SOURCE_API_TOKEN` is set;
- never print tokens to logs;
- bind to `127.0.0.1` by default.

## Logging Rules

Do not log full questions by default. They may contain matter facts.

Allowed logs:

```text
[legal-source] search mode=auto sources=3 warnings=1 elapsed_ms=43 question_chars=118
[legal-source] statutes status=ok result_count=2 elapsed_ms=18 corpus=corpus-sha256:8742a18c...
```

If you need a request identifier, generate a random ID. Do not hash or store the
full question unless explicitly asked.

## Workbench Adapter Later

This is not part of the sidecar V1 unless explicitly assigned, but the future
Workbench adapter should be thin:

```text
services/legal-source-sidecar-provider.mjs
```

Responsibilities:

1. POST `{ question, mode, limit }` to the sidecar.
2. Convert sidecar `sources` to the current Workbench `publicSources` shape.
3. Preserve source IDs exactly (`STATUTE-0001`, `WEB-0001`).
4. Pass sidecar warnings into Research answer warnings.
5. Update Workbench source-ID validation to allow:

```js
/\b(?:WEB|STATUTE)-\d{4}\b/gi
```

Do not move matter packet building or answer synthesis into the sidecar.

## Test Plan

### Unit tests

`test/config.test.mjs`

- defaults bind to `127.0.0.1`;
- max result and timeout env vars clamp safely;
- statutes can be enabled without web;
- no provider configured is detectable.

`test/source-normalization.test.mjs`

- statute record maps to `official_statute`;
- citation becomes title;
- `source_url` wins over archive URL;
- text is truncated to budget;
- dedupe key ignores `requested_section`;
- final ID assignment produces `STATUTE-0001` and `WEB-0001` namespaces.

`test/statutes-provider.test.mjs`

Use fake `fetchImpl`; do not start real statutes service.

- sends bearer token to statutes when configured;
- calls `/health`;
- calls `/v1/lookup` for section-looking question;
- calls `/v1/search?q=...&hydrate=1`;
- maps lookup matches and search results;
- handles `parsed: null` lookup response by falling back to search;
- maps statutes 503 to warning/no sources;
- maps timeout to provider timeout;
- old-index null provenance does not crash.

`test/composite-provider.test.mjs`

- `statutes` mode calls only statutes;
- `web` mode calls only web;
- `hybrid` merges and ranks;
- `auto` calls statutes for section/code questions;
- partial provider failure returns sources plus warning.

`test/server.test.mjs`

- `GET /health` returns provider status;
- `POST /v1/legal-sources/search` validates blank question;
- token gates `/v1/*` but not `/health`;
- valid search returns normalized sources;
- no sources returns `200` with empty `sources`;
- all-provider failure returns stable error.

### Manual smoke

With statutes running:

```bash
curl -s http://127.0.0.1:8790/health | jq
```

```bash
curl -s \
  -X POST http://127.0.0.1:8790/v1/legal-sources/search \
  -H 'content-type: application/json' \
  -d '{"question":"section 69A Indian Partnership Act","mode":"statutes","limit":3}' | jq
```

Expected:

- at least one `STATUTE-0001` source;
- `source_type: official_statute`;
- title/citation for Section 69A;
- metadata includes corpus fingerprint when statutes health provided it.

## Definition Of Done

V1 is done when:

1. The sidecar lives outside the Matter Workbench app.
2. `GET /health` works with statutes enabled.
3. `POST /v1/legal-sources/search` returns `STATUTE-*` sources for a known
   statutes query.
4. The sidecar uses `/v1/lookup` and `/v1/search?hydrate=1`; it does not implement
   its own statute alias map or citation parser beyond deciding whether to try
   lookup.
5. No matter context or files are accepted by the sidecar API.
6. Tokens are not logged.
7. Unit tests cover provider, normalization, composite behavior, and HTTP routes.
8. A manual smoke against `/Users/aksingh/statutes` passes.

## Common Mistakes To Avoid

- Do not put this service in `matter-workbench/services/`.
- Do not import Workbench helper modules.
- Do not send matter context to the sidecar.
- Do not have the sidecar call the answer model.
- Do not duplicate the statutes alias map in the sidecar.
- Do not parse statute citations beyond deciding whether to try `/v1/lookup`.
- Do not expose the service on `0.0.0.0` by default.
- Do not make Exa required for statutes-only mode.
- Do not fail a request just because web search failed if statutes returned useful
  sources.

## Later Slices

Only after V1 is stable:

- Workbench adapter for `COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar`.
- Optional source grouping in Workbench UI: Statutes / Web / Matter record.
- Optional direct statute read command in Workbench.
- Optional sidecar `/v1/legal-sources/lookup` endpoint if direct lookup needs a
  different request/response than search.
- Optional caching of statutes `/health` for 30-60 seconds.
- Optional related sections using statutes crossrefs.
- Optional provider-run receipts if Workbench wants durable legal-source
  provenance beyond current Copilot receipts.
