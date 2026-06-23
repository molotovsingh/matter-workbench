import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCopilotWebSearchQueries,
  createExaWebResearchProvider,
  normalizeExaSearchResults,
} from "../services/web-research-providers.mjs";

test("web research query builder preserves NCLT IBC IRP RP sale-deed terms", () => {
  const queries = buildCopilotWebSearchQueries("what are the NCLT options for the client to get the IRP/RP to execute the sale deed under IBC sections?");

  assert.ok(queries.length >= 2);
  assert.match(queries.join("\n"), /NCLT/);
  assert.match(queries.join("\n"), /IBC/);
  assert.match(queries.join("\n"), /IRP/);
  assert.match(queries.join("\n"), /RP/);
  assert.match(queries.join("\n"), /sale deed/);
});

test("Exa result normalizer assigns stable IDs and orders stronger source types first", () => {
  const sources = normalizeExaSearchResults({
    results: [
      {
        title: "Generic blog",
        url: "https://example.com/post",
        highlights: ["A generic post."],
      },
      {
        title: "NCLT order",
        url: "https://nclt.gov.in/order/example",
        publishedDate: "2026-01-02",
        highlights: ["NCLT directions."],
      },
      {
        title: "IBC statute",
        url: "https://ibbi.gov.in/legal-framework/ibc",
        highlights: ["Section 60 jurisdiction."],
      },
      {
        title: "Legal report",
        url: "https://www.barandbench.com/news/example",
        highlights: ["Reported decision."],
      },
    ],
  });

  assert.deepEqual(sources.map((source) => source.id), ["WEB-0001", "WEB-0002", "WEB-0003", "WEB-0004"]);
  assert.deepEqual(sources.map((source) => source.sourceType), ["official", "court", "legal_report", "other"]);
  assert.equal(sources[0].title, "IBC statute");
  assert.equal(sources[1].publishedAt, "2026-01-02");
});

test("Exa provider sends nested contents request and normalizes returned sources", async () => {
  const calls = [];
  const provider = createExaWebResearchProvider({
    apiKey: "exa-test",
    endpoint: "https://exa.test/search",
    maxResults: 2,
    maxResultChars: 1200,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        results: [
          {
            title: "IBC section 60",
            url: "https://ibbi.gov.in/ibc-section-60",
            highlights: ["Section 60(5) gives NCLT jurisdiction."],
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await provider({ query: "NCLT IBC section 60(5)" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://exa.test/search");
  assert.equal(calls[0].options.headers["x-api-key"], "exa-test");
  assert.equal(calls[0].body.query, "NCLT IBC section 60(5)");
  assert.equal(calls[0].body.numResults, 2);
  assert.deepEqual(Object.keys(calls[0].body.contents), ["highlights"]);
  assert.equal(result.query, "NCLT IBC section 60(5)");
  assert.equal(result.sources[0].id, "WEB-0001");
  assert.equal(result.sources[0].sourceType, "official");
});

test("Exa provider exposes stable timeout and no-results errors", async () => {
  const timeoutProvider = createExaWebResearchProvider({
    apiKey: "exa-test",
    endpoint: "https://exa.test/search",
    timeoutMs: 1,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  await assert.rejects(
    () => timeoutProvider({ query: "NCLT" }),
    (error) => {
      assert.equal(error.statusCode, 504);
      assert.equal(error.code, "copilot_research.provider_timeout");
      return true;
    },
  );

  const noResultsProvider = createExaWebResearchProvider({
    apiKey: "exa-test",
    fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    () => noResultsProvider({ query: "NCLT" }),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "copilot_research.no_results");
      return true;
    },
  );
});
