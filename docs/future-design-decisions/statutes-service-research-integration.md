# Statutes Service Integration For Research Mode

Date: 2026-07-02
Status: Source-contract context / upstream record; implementation superseded by [Legal Source Sidecar Service](legal-source-sidecar-service.md)

## Current Status Note

This document originally assumed a statutes provider would be added inside the
Matter Workbench backend. That is no longer the accepted implementation path.
Use [Legal Source Sidecar Service](legal-source-sidecar-service.md) for the
actual implementation contract. Keep this document as:

- context on why statutes belong in Research, not Ask;
- a record of the upstream `statutes` API changes;
- source-normalization guidance for `STATUTE-*` records.

Do **not** implement an in-app `services/statutes-research-provider.mjs` from this
document.

## Decision Summary

Matter Workbench should harness the sibling `statutes` service as a first-class
legal source for **Research** mode through the separate Legal Source Sidecar.

Recommended first slice:

1. Keep ordinary **Ask** matter-record-only.
2. Keep existing **Research** UI and route: `POST /api/matter-copilot/research`.
3. Build a separate Legal Source Sidecar that calls the loopback statutes HTTP
   API, normalizes exact statutory sections into `STATUTE-*` sources, and returns
   them to Workbench.
4. Let Workbench feed the returned legal sources plus matter context to the
   existing Research answer model.
5. Preserve Exa/web search as sidecar fallback/complement for cases, commentary,
   regulator pages, and broader current-law context.

This gives lawyers exact statutory text, quotable citations, and provenance
without creating a new UI surface or weakening the existing matter/source
boundaries.

## Why This Belongs In Research, Not Ask

Matter Workbench currently separates three command modes:

| Mode | Boundary |
| --- | --- |
| Skill | Governed workflows and generated artifacts. |
| Ask | Closed-world Q&A over the prepared matter context only. |
| Research | Matter context plus public/legal sources. |

Statutory text is external legal material, not a fact from the matter record.
Therefore the statutes service should be reachable from **Research** mode first.
Ask may suggest Research, but it must not silently read statutes or browse.

## Current Workbench Surfaces

Relevant current files:

| File | Current role |
| --- | --- |
| `routes/matter-workflow-routes.mjs` | Hosts `POST /api/matter-copilot/research`. Reads the matter context packet and calls `copilotWebResearchService`. |
| `services/copilot-web-research-service.mjs` | Orchestrates Research: validate question, build matter packet, fetch public sources, invoke answer provider, normalize/validate sources. |
| `services/web-research-providers.mjs` | Current Exa adapter and source normalizer. |
| `services/copilot-web-research-answer-providers.mjs` | Research answer prompt/schema and AI-provider invocation. |
| `react-ui/src/api/client.ts` | Frontend `researchMatterQuestion` API call. |
| `react-ui/src/App.tsx` and `react-ui/src/components/command/CommandPanel.tsx` | Research mode UX and `/research` command handling. |
| `test/copilot-web-research-service.test.mjs` | Research service behavior and source-ID validation tests. |
| `test/web-research-providers.test.mjs` | Exa provider/query/source normalization tests. |

The existing Research shape is already almost right. The main missing piece is a
Legal Source Sidecar plus thin Workbench adapter that can return statutory
sections as validated Research sources.

## Statutes API Capabilities To Use

The `statutes` repo exposes a loopback, GET-only HTTP API. The executable tour is:

```bash
python3 /Users/aksingh/statutes/examples/statutes_api_tour.py --spawn
```

Key endpoints:

| Endpoint | Workbench use |
| --- | --- |
| `GET /health` | Startup/readiness check; includes act/section counts, `last_refreshed`, `built_at`, and `corpus_fingerprint`. |
| `GET /v1/search?q=...&limit=...&slug=...&hydrate=1` | Find relevant statutory sections using BM25; `hydrate=1` adds full text plus act provenance in one call. |
| `GET /v1/lookup?citation=...` | Parse lawyer-style citation phrases, resolve act aliases, apply subsection fallback, and return hydrated section matches. |
| `GET /v1/resolve?act=...` | Resolve act names, act numbers, or aliases to corpus slugs. |
| `GET /v1/acts` | Optional inventory / abbreviation mapping support. |
| `GET /v1/acts/:slug` | Act metadata and provenance, including source tier and authenticity anchor. |
| `GET /v1/acts/:slug/sections/:number` | Exact section text plus quotable `citation`. |
| `GET /v1/acts/:slug/crossrefs` | Later enrichment: related sections and inter-act references. |

Important API properties:

- loopback sidecar deployment model;
- optional `Authorization: Bearer $STATUTE_API_TOKEN`;
- stable dotted error codes such as `statutes.not_found`,
  `statutes.unavailable`, `statutes.unauthorized`;
- section records include stable `id`, `slug`, `act`, `act_number`, `section`,
  `heading`, `citation`, `source_url`, and full `text`;
- `search?hydrate=1` now returns full text plus full act provenance inline, so
  Workbench does not need a `search -> section -> act provenance` fan-out;
- `/v1/lookup?citation=...` now handles direct citation phrasing and subsection
  fallback server-side.

## Upstream Changes Shipped In The `statutes` Repo

Commit `55cd324` in `/Users/aksingh/statutes` implements the upstream asks that
make Matter Workbench a thin Research consumer. The statutes repo reports
`103/103` tests passing; this plan independently verified `npm test` and
`python3 examples/statutes_api_tour.py --spawn` successfully after that commit.

Practical deployment note: existing statutes deployments should run `npm run
build:corpus` after updating the real corpus. `npm run build` may build only a
fixture/small local corpus depending on the checkout. Old indexes degrade to
`null` for new metadata fields; a rebuild populates `source_url`, act
provenance, `built_at`, and `corpus_fingerprint`.

### 1. Hydrated section search — shipped

Use:

```http
GET /v1/search?q=...&limit=5&hydrate=1
```

Each hydrated result includes:

```json
{
  "id": "ibc-2016/s60",
  "slug": "ibc-2016",
  "act": "Insolvency and Bankruptcy Code, 2016",
  "act_number": "31 of 2016",
  "section": "60",
  "heading": "Adjudicating Authority for corporate persons",
  "citation": "Section 60, Insolvency and Bankruptcy Code, 2016 (31 of 2016)",
  "text": "full section text...",
  "snippet": "matched snippet...",
  "provenance": {
    "source": { "name": "...", "tier": "...", "url": "..." },
    "authenticity_anchor": { "status": "...", "archive_url": "..." }
  },
  "score": -4.2
}
```

This is the highest-value upstream change. It turns Workbench integration into
one HTTP call plus source normalization. `text=1` is also available as a lighter
text-only variant.

### 2. Direct citation lookup — shipped

Use:

```http
GET /v1/lookup?citation=section%2060(5)%20IBC
```

The response returns zero or more hydrated section matches. It handles:

- `section 60(5) IBC`;
- `IBC section 60`;
- `s. 13 Easements Act`;
- `section 5 of Limitation Act`.

Internally this parses the section + act phrase, resolves the act using aliases,
and returns hydrated matches. Unparseable input returns `200` with `parsed: null`
and guidance to use `/v1/resolve` or `/v1/search`; it is not treated as an API
error.

### 3. Act aliases owned by `statutes` — shipped

The alias table now lives in `src/server/resolve.mjs`. Current aliases include:

- `IBC` -> `Insolvency and Bankruptcy Code, 2016`;
- `CPC` -> `Code of Civil Procedure, 1908`;
- `CrPC` -> `Code of Criminal Procedure, 1973`;
- `IPC` -> `Indian Penal Code, 1860`;
- `BNS` -> `Bharatiya Nyaya Sanhita, 2023`;
- `BNSS` -> `Bharatiya Nagarik Suraksha Sanhita, 2023`;
- `BSA` -> `Bharatiya Sakshya Adhiniyam, 2023`;
- `TPA` -> `Transfer of Property Act, 1882`;
- `NI` -> `Negotiable Instruments Act, 1881`;
- `IT` -> `Information Technology Act, 2000`;
- `SARFAESI`, `RERA`, `POCSO`, `PMLA`, `MSMED`, and `CGST`.

Names whose own words appear in the title, such as Evidence Act or Limitation
Act, should resolve through containment matching rather than a separate alias.

The alias table lives with the corpus/index because it is legal-source metadata,
not matter-workbench product logic. Workbench can pass raw user queries without
maintaining its own statute synonym map. Resolve/lookup responses carry
`alias_expansion`, so an empty match list can still mean “known abbreviation,
act not present in this corpus.” The map is query expansion only, not legal
equivalence.

### 4. Consumer-ready Workbench source projection — deliberately not upstream

The statutes API deliberately stayed product-agnostic. Workbench should map
hydrated statute records into its own Research source contract:

```json
{
  "source_type": "official_statute",
  "title": "Section 60, Insolvency and Bankruptcy Code, 2016",
  "citation": "Section 60, Insolvency and Bankruptcy Code, 2016 (31 of 2016)",
  "url": "...provenance or archive URL...",
  "snippet": "full or truncated statutory text...",
  "metadata": {
    "slug": "ibc-2016",
    "section": "60",
    "act_number": "31 of 2016",
    "last_refreshed": "2026-06-30T04:00:11.000Z"
  }
}
```

Workbench should still assign per-answer IDs like `STATUTE-0001`, while the
statutes service owns the legal/citation/provenance fields.

### 5. Explicit corpus health — shipped

`/health` now includes `built_at` and `corpus_fingerprint`, a sha256 over the
built corpus. Workbench should record the fingerprint in Research metadata or
receipts when a statute source is used.

### 6. Nice-to-have later: related sections

A later `related=1` or crossref bundle could return the direct section plus
cross-referenced sections. This would help Research answer “what other sections
matter?” without Workbench implementing citation graph logic.

## Product Goals

1. Let Research answer questions like:
   - “What IBC sections let NCLT direct the RP to execute a sale deed?”
   - “Read section 60(5) of IBC and apply it to this matter.”
   - “What does the Easements Act say about way of necessity?”
2. Prefer exact statutory text over generic web snippets for statutory claims.
3. Keep statutory sources visibly separate from matter-record facts.
4. Preserve Research caveats: not lawyer-verified, verify authorities before
   relying or filing.
5. Reduce external web dependency when the question is primarily statutory.
6. Allow statutes-only deployments where public web search is disabled or not
   configured.

## Non-Goals For The First Slice

- No new React panel or statute browser.
- No writes to matter artifacts.
- No automatic mutation of skill outputs.
- No promise that statutes are fully current unless the service provenance and
  `last_refreshed` support it.
- No automatic equivalence mapping between old/new Indian codes unless a separate
  verified mapping exists.
- No broad case-law research replacement; Exa/legal-web search remains useful
  for cases and commentary.

## Options Considered

### Option A — Research provider adapter only

Add a `statutes` provider behind the existing Research service. It returns
statutory sections as `public_sources` alongside or instead of Exa sources.

Pros:

- smallest user-facing change;
- reuses existing Research prompt/schema/route/UI;
- preserves Ask vs Research boundary;
- easy to test with injected fake providers.

Cons:

- source shape is generic `public_sources`, so statute-specific display is
  limited in the first slice.

**Recommendation:** choose this first.

### Option B — Composite legal research provider

Run statutes first and Exa second, then merge and rank sources:

1. `STATUTE-*` sources for exact statutory text;
2. `WEB-*` official/court sources;
3. `WEB-*` legal reports;
4. other web sources.

Pros:

- best answer quality for real legal research;
- statutes are grounded, while Exa can still find cases/current context.

Cons:

- slightly more provider orchestration and failure handling.

**Recommendation:** implement as the default shape once Option A works. The
actual code can land directly as a composite provider if kept small.

### Option C — Dedicated “Read Statute” command/UI

Add `/read-statute` or a statute lookup panel.

Pros:

- excellent direct statute-reading experience;
- avoids model synthesis when the lawyer only wants the text.

Cons:

- new UI/API surface;
- does not help ordinary Research answers unless also integrated there.

**Recommendation:** later slice, after Research-provider integration proves the
source quality.

### Option D — Skill-only integration

Use statutes inside a statute-reading skill such as “Statute and Section Reading
Guide”.

Pros:

- could create structured statute-reading artifacts.

Cons:

- skills are artifact-producing and need stricter staleness/provenance rules;
- less useful than making Research better first.

**Recommendation:** later slice.

## Recommended Architecture

The accepted architecture is the sidecar flow:

```text
React Research command
  -> POST /api/matter-copilot/research
  -> copilot-web-research-service
  -> thin Workbench adapter for Legal Source Sidecar
  -> Legal Source Sidecar
       -> statutes service, if enabled/relevant
       -> Exa/web provider, if enabled/configured
  -> Research answer provider
  -> validated answer with matter_sources + public_sources
```

Do not add a Workbench-internal statutes provider. The provider/composite logic
belongs in the separate sidecar described in
[Legal Source Sidecar Service](legal-source-sidecar-service.md).

### Sidecar provider responsibilities

The sidecar, not Workbench, should:

1. Hold the small statutes HTTP client.
2. Convert user questions/search queries into statutes API calls.
3. Prefer `/v1/lookup?citation=...` for direct section citations.
4. Use `/v1/search?q=...&hydrate=1` for discovery questions.
5. Normalize hydrated records into `STATUTE-*` legal-source records.
6. Surface provider failures as structured sidecar warnings/errors.

### Composite provider location

Composite statutes+web behavior belongs in the Legal Source Sidecar. Workbench
should eventually call the sidecar through a thin adapter only.

Composite behavior:

1. Call statutes if enabled and the question looks statute-relevant.
2. Call Exa if configured and either:
   - statutes found no useful sections;
   - the question mentions cases, decisions, latest updates, regulator guidance,
     practice direction, or broad legal options;
   - hybrid mode is explicitly enabled.
3. Merge sources, de-duplicate by source ID and URL/citation, cap total count.
4. Return a single legal-source response:

```js
{
  query: "NCLT IBC section 60 RP sale deed",
  sources: [/* STATUTE-* then WEB-* */],
  warnings: [/* optional provider degradation notes */],
  raw: { statutes: ..., web: ... }
}
```

The current `copilot-web-research-service.mjs` only consumes `research.sources`
and `research.query`; it can be extended to carry provider warnings into the
normalized answer.

## Configuration

The earlier in-app configuration plan is superseded by the sidecar contract.
Use the sidecar env names in
[Legal Source Sidecar Service](legal-source-sidecar-service.md), especially:

```env
LEGAL_SOURCE_STATUTES_ENABLED=1
STATUTES_API_URL=http://127.0.0.1:8787
STATUTE_API_TOKEN=
LEGAL_SOURCE_STATUTES_TIMEOUT_MS=5000
LEGAL_SOURCE_STATUTES_MAX_RESULTS=4
LEGAL_SOURCE_WEB_ENABLED=0
```

When Workbench later integrates with the sidecar, the Workbench-side env should
be limited to enabling Research, selecting the sidecar provider, and configuring
the sidecar URL/token:

```env
COPILOT_WEB_RESEARCH_ENABLED=1
COPILOT_WEB_RESEARCH_PROVIDER=legal_source_sidecar
COPILOT_LEGAL_SOURCE_SERVICE_URL=http://127.0.0.1:8790
COPILOT_LEGAL_SOURCE_SERVICE_TOKEN=
```

Do not require `EXA_API_KEY` for statutes-only Research.

## Source Normalization Contract

Current Research answers validate `public_sources` by source ID. Statutes sources
should use a separate ID namespace:

```js
{
  id: "STATUTE-0001",
  title: "Section 60, Insolvency and Bankruptcy Code, 2016",
  url: "https://...provenance-or-authenticity-anchor...",
  publishedAt: "",
  sourceType: "official_statute",
  snippet: "Exact statutory text, truncated to budget..."
}
```

Normalized response returned to the frontend should remain compatible with the
current `MatterCopilotPublicSource` type:

```json
{
  "id": "STATUTE-0001",
  "title": "Section 60, Insolvency and Bankruptcy Code, 2016",
  "url": "https://...",
  "published_at": "",
  "source_type": "official_statute",
  "snippet": "..."
}
```

Source IDs are stable within one Research answer, not globally stable. The
quotable statutory identity is the statutes API `citation`, not the generated
`STATUTE-0001` ID.

Mapping from a hydrated statutes record should be:

| Workbench source field | Statutes field |
| --- | --- |
| `id` | generated per answer: `STATUTE-0001`, `STATUTE-0002`, ... |
| `title` | `citation` if present, else `Section ${section}, ${act}` |
| `url` | `source_url`, else `provenance.authenticity_anchor.archive_url`, else empty |
| `publishedAt` / `published_at` | empty for now, unless a future statutes field exposes publication/update date |
| `sourceType` / `source_type` | `official_statute` |
| `snippet` | full `text` truncated to Workbench budget; include `heading` prefix if helpful |

Keep extra statute metadata internally on the normalized source while composing
the answer payload if useful: `citation`, `slug`, `section`, `requested_section`,
`act_number`, `corpus_fingerprint`, and provenance summary. Do not expose
unsupported fields to the frontend unless the TypeScript type is widened.

### Required source-ID validation update

`services/copilot-web-research-service.mjs` currently detects cited public source
IDs in prose with a `WEB-0001`-style pattern. Update that helper so a model that
mentions `STATUTE-0001` in `answer_markdown` is validated the same way as
`WEB-0001`.

Suggested acceptable pattern:

```js
/\b(?:WEB|STATUTE)-\d{4}\b/gi
```

Keep the allow-list rule: only IDs actually supplied by the provider may survive
in the final answer.

## Statutes Provider Query Strategy

### First-slice deterministic strategy

Given the normalized Research question and the existing `queries` array from
`buildCopilotWebSearchQueries`:

1. Build 1-3 statute search strings from the question and deterministic legal
   terms.
2. Do **not** maintain a Workbench statute abbreviation map; the statutes service
   owns aliases.
3. If the question appears to contain a direct section citation, call
   `/v1/lookup?citation=...` first.
4. Call `/v1/search?q=...&hydrate=1` for discovery queries.
5. De-duplicate hydrated records by statutes `id`/`citation` and cap to the
   configured source budget.

The alias map remains query expansion only, not legal equivalence or a current-law
assertion.

### Direct citation extraction

For questions matching patterns such as:

```text
section 60(5) of the IBC
IBC section 60
section 13 Indian Easements Act
```

The provider should call:

```http
GET /v1/lookup?citation=...
```

If lookup returns no matches, fall back to `/v1/search?q=...&hydrate=1`. Workbench
should not duplicate the citation parser, alias map, or subsection fallback that
now live in the statutes service.

## Failure And Fallback Policy

| Scenario | Behavior |
| --- | --- |
| Statutes disabled | Use Exa if configured. |
| Statutes base URL unreachable | If Exa configured, continue with Exa and add warning. If no other provider, return `copilot_research.provider_error` or `provider_not_configured` depending on setup. |
| `/health` returns 503 / `statutes.unavailable` | Treat as provider unavailable; tell operator to build the statutes index. |
| `statutes.unauthorized` | Return/record configuration error: token missing or wrong. |
| Statutes lookup/search returns no hits | Continue with Exa if available; otherwise return existing `copilot_research.no_results`. |
| Hydrated result lacks text/provenance because the index was not rebuilt | Use the available source fields, warn that the statutes index should be rebuilt, and continue if enough text exists. |
| Exa fails but statutes has sources | Continue with statutes and warn. |
| Both providers fail | Return the clearest `copilot_research.*` error. |

Warnings should be safe for the user/operator and should not include sensitive
matter text beyond the user's own question.

## Prompt Changes

Update `COPILOT_WEB_RESEARCH_SYSTEM_PROMPT` or the Research user payload guidance
in `services/copilot-web-research-answer-providers.mjs`.

Add rules:

- Treat `STATUTE-*` sources as supplied statutory text.
- Quote or paraphrase statutory text only from supplied `STATUTE-*` snippets.
- Cite the statute citation from the source title/snippet; do not invent section
  numbers, provisos, explanations, amendments, or commencement status.
- Prefer `official_statute` sources for statutory propositions over generic web
  pages.
- If statutes and web sources conflict or currency is uncertain, say what must be
  verified.
- Do not treat the statutes service as proof of matter facts.

The existing ending caveat should remain:

```text
_Verify authorities before relying or filing._
```

## API Shape Impact

No new external Workbench API is required for the first slice.

Existing route stays:

```http
POST /api/matter-copilot/research
```

Existing response shape stays:

```json
{
  "schema_version": "matter-copilot-research-answer/v1",
  "answer_status": "answered",
  "answer_markdown": "Research answer from public sources...",
  "matter_sources": [],
  "public_sources": [
    {
      "id": "STATUTE-0001",
      "title": "Section 60, Insolvency and Bankruptcy Code, 2016",
      "url": "...",
      "source_type": "official_statute",
      "snippet": "..."
    }
  ],
  "warnings": [],
  "research": {
    "provider": "hybrid",
    "query": "NCLT IBC section 60 RP sale deed",
    "result_count": 4,
    "statutes": {
      "base_url": "http://127.0.0.1:8787",
      "corpus_fingerprint": "corpus-sha256:...",
      "built_at": "2026-07-02T05:18:42.460Z"
    }
  }
}
```

Later, if statute browsing becomes a direct product feature, add a separate route
such as:

```http
GET /api/legal-sources/statutes/search?q=...
GET /api/legal-sources/statutes/acts/:slug/sections/:section
```

But do not add those routes for the first Research integration.

## Frontend Impact

First slice: no UI change required.

The Research answer already renders public sources. It can show `STATUTE-0001`
with a title like:

```text
Section 60, Insolvency and Bankruptcy Code, 2016
```

Optional later polish:

- display a `Statute` badge for `source_type: official_statute`;
- group sources as `Statutes`, `Cases / web`, and `Matter record`;
- add a direct “Open statutory text” expansion under a source;
- add a dedicated statute lookup command or panel.

## Privacy And Deployment Notes

The statutes API and the Legal Source Sidecar are both loopback services.
Workbench should call the Legal Source Sidecar from the backend only, not from
the browser. The Legal Source Sidecar then calls the statutes service.

Benefits:

- no public exposure of either sidecar service;
- optional bearer token between Workbench and the Legal Source Sidecar;
- optional bearer token between the Legal Source Sidecar and statutes;
- statutes-only mode can answer statutory questions without sending the search
  query to Exa;
- matter context still only goes to the answer model under existing Research
  rules.

Caution:

- if hybrid mode calls Exa, the public search query may contain user-entered
  matter details, as Research mode already allows. Keep Research explicit.

## Implementation Plan

The implementation plan now lives in
[Legal Source Sidecar Service](legal-source-sidecar-service.md). Do not implement
Phases inside the main Workbench app from older revisions of this document.

For this statutes-specific context, the only required preflight is to verify the
upstream statutes contract:

```bash
cd /Users/aksingh/statutes
npm test
python3 examples/statutes_api_tour.py --spawn
```

Before deployment, ensure the target statutes service has rebuilt its index:

```bash
cd /path/to/statutes
npm run build:corpus   # use npm run build only when you intentionally want the tiny fixture corpus
node bin/statutes.mjs serve
```

Then inspect `GET /health`. Do not proceed if the act/section counts indicate a
fixture corpus when the Workbench integration expects the larger local corpus.

The Workbench-side implementation, when requested later, should be limited to a
thin adapter that calls the Legal Source Sidecar and passes returned `STATUTE-*`
/ `WEB-*` sources into the existing Research answer path.

## Acceptance Criteria

For the Legal Source Sidecar V1, use the definition of done in
[Legal Source Sidecar Service](legal-source-sidecar-service.md).

For the later Workbench adapter slice, acceptance is:

1. With the Legal Source Sidecar configured, Research can answer a statute-heavy
   question using at least one returned `STATUTE-*` source.
2. Research still works with the existing Exa-only configuration.
3. Research can run statutes-only without `EXA_API_KEY` if an answer provider and
   sidecar are configured.
4. Ask mode remains matter-record-only.
5. All generated statutory claims in the answer are backed by supplied
   `STATUTE-*` sources or explicitly marked as needing verification.
6. Unsupported statute source IDs are dropped just like unsupported web source
   IDs.
7. Sidecar/statutes outages do not crash the Workbench server; they produce a
   clear Research error or fallback warning.
8. No matter artifacts are created or mutated.

## Open Questions

1. Should `official_statute` become a formal source type in frontend labels, or
   should statutes use existing `official` for maximum compatibility?
2. Should Workbench cache `/health` briefly to avoid one health call per Research
   request, or record corpus metadata only when already available?
3. Should statutes-only mode be the default for legal Research in private
   deployments, with Exa opt-in only when the lawyer asks for cases/current law?
4. Should direct statute reading later become a separate command distinct from
   Research synthesis?

## Later Slices

- Dedicated statute lookup UI / command.
- Cross-reference enrichment using `/v1/acts/:slug/crossrefs`.
- Statute-aware custom/native skills, especially a governed Statute and Section
  Reading Guide.
- Operator health surface showing statutes sidecar readiness and corpus refresh
  timestamp.
- Persistent legal-source receipt fields in Copilot interaction receipts, if
  Research receipts need to distinguish `STATUTE-*` from `WEB-*` sources.
