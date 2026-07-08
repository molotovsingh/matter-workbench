import assert from "node:assert/strict";
import test from "node:test";
import {
  createLegalSourceSidecarProvider,
  normalizeLegalSourceResponse,
} from "../services/legal-source-sidecar-provider.mjs";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

test("legal source sidecar provider requires a base URL", async () => {
  const provider = createLegalSourceSidecarProvider({});

  await assert.rejects(
    () => provider({ question: "s. 13 Easements Act" }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "copilot_research.provider_not_configured");
      return true;
    },
  );
});

test("legal source sidecar provider posts the search request and bearer token", async () => {
  const calls = [];
  const provider = createLegalSourceSidecarProvider({
    baseUrl: "http://127.0.0.1:8790/",
    token: "sidecar-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({
        query: "s. 13 Easements Act",
        sources: [{
          id: "STATUTE-0001",
          title: "Section 13, Indian Easements Act, 1882",
          url: "https://www.indiacode.nic.in/handle/123456789/2349",
          source_type: "official_statute",
          snippet: "Where one person transfers immovable property...",
        }],
      });
    },
  });

  const result = await provider({
    question: "s. 13 Easements Act",
    config: { maxResults: 3, maxResultChars: 5000 },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8790/v1/legal-sources/search");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer sidecar-secret");
  assert.equal(calls[0].body.schema_version, "legal-source-search-request/v1");
  assert.equal(calls[0].body.question, "s. 13 Easements Act");
  assert.equal(calls[0].body.mode, "auto");
  assert.equal(calls[0].body.limit, 3);
  assert.deepEqual(result.sources, [{
    id: "STATUTE-0001",
    title: "Section 13, Indian Easements Act, 1882",
    url: "https://www.indiacode.nic.in/handle/123456789/2349",
    publishedAt: "",
    sourceType: "official_statute",
    snippet: "Where one person transfers immovable property...",
  }]);
});

test("legal source sidecar provider preserves safe statute metadata", () => {
  const normalized = normalizeLegalSourceResponse({
    query: "section 69A Indian Partnership Act",
    sources: [{
      id: "STATUTE-0001",
      title: "Section 69A, Indian Partnership Act, 1932",
      source_type: "official_statute",
      snippet: "Repayment of premium on premature dissolution.",
      metadata: {
        provider: "statutes",
        slug: "indian-partnership-act-1932",
        section: "69A",
        act: "Indian Partnership Act, 1932",
        act_number: "9 of 1932",
        heading: "Suits between partners and firms",
        corpus_fingerprint: "corpus-sha256:abc123",
        built_at: "2026-07-08T02:29:12.998Z",
        last_refreshed: "2026-07-03T11:04:34.725Z",
        ignored: "not exported",
        provenance: {
          source: { name: "India Code", tier: "official", url: "https://example.test", retrieved_at: "2026-07-01" },
          authenticity_anchor: { status: "archived", archive_url: "https://archive.example.test" },
        },
      },
    }],
  });

  assert.deepEqual(normalized.sources[0].metadata, {
    provider: "statutes",
    slug: "indian-partnership-act-1932",
    section: "69A",
    act: "Indian Partnership Act, 1932",
    act_number: "9 of 1932",
    heading: "Suits between partners and firms",
    corpus_fingerprint: "corpus-sha256:abc123",
    built_at: "2026-07-08T02:29:12.998Z",
    last_refreshed: "2026-07-03T11:04:34.725Z",
    provenance: {
      source: { name: "India Code", tier: "official", url: "https://example.test", retrieved_at: "2026-07-01" },
      authenticity_anchor: { status: "archived", archive_url: "https://archive.example.test" },
    },
  });
});

test("legal source sidecar provider preserves WEB IDs and normalizes STATUTE IDs", async () => {
  const provider = createLegalSourceSidecarProvider({
    baseUrl: "http://127.0.0.1:8790",
    fetchImpl: async () => jsonResponse({
      query: "IBC",
      sources: [
        { id: "statute-0001", citation: "Section 60, IBC", source_type: "official_statute", snippet: "NCLT jurisdiction." },
        { id: "WEB-0001", title: "IBBI", source_type: "official", snippet: "Official page." },
      ],
    }),
  });

  const result = await provider({ question: "IBC", config: { maxResultChars: 5000 } });

  assert.deepEqual(result.sources.map((source) => source.id), ["STATUTE-0001", "WEB-0001"]);
  assert.equal(result.sources[0].title, "Section 60, IBC");
  assert.equal(result.sources[0].sourceType, "official_statute");
  assert.equal(result.sources[1].sourceType, "official");
});

test("legal source sidecar response drops malformed IDs and caps snippets", () => {
  const normalized = normalizeLegalSourceResponse({
    query: "Easements",
    warnings: ["provider degraded token=super-secret"],
    sources: [
      { id: "BAD-1", title: "Bad", snippet: "bad" },
      { id: "STATUTE-0001", title: "Good", source_type: "official_statute", snippet: "abcdef" },
    ],
  }, { maxResultChars: 4 });

  assert.deepEqual(normalized.sources, [{
    id: "STATUTE-0001",
    title: "Good",
    url: "",
    publishedAt: "",
    sourceType: "official_statute",
    snippet: "abc…",
  }]);
  assert.match(normalized.warnings.join("\n"), /Dropped legal source with malformed source ID/);
  assert.doesNotMatch(normalized.warnings.join("\n"), /super-secret/);
  assert.match(normalized.warnings.join("\n"), /token=\[redacted-secret\]/);
});

test("legal source sidecar provider maps timeout and auth failures", async () => {
  const timeoutProvider = createLegalSourceSidecarProvider({
    baseUrl: "http://127.0.0.1:8790",
    timeoutMs: 1,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  await assert.rejects(
    () => timeoutProvider({ question: "IBC" }),
    (error) => {
      assert.equal(error.statusCode, 504);
      assert.equal(error.code, "copilot_research.provider_timeout");
      return true;
    },
  );

  const authProvider = createLegalSourceSidecarProvider({
    baseUrl: "http://127.0.0.1:8790",
    token: "sidecar-secret",
    fetchImpl: async () => jsonResponse({ code: "legal_source.unauthorized", error: "Bearer sidecar-secret" }, { status: 401 }),
  });
  await assert.rejects(
    () => authProvider({ question: "IBC" }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "copilot_research.provider_not_configured");
      assert.doesNotMatch(String(error.message), /sidecar-secret/);
      return true;
    },
  );
});

test("legal source sidecar provider maps generic provider failures", async () => {
  const provider = createLegalSourceSidecarProvider({
    baseUrl: "http://127.0.0.1:8790",
    token: "sidecar-secret",
    fetchImpl: async () => jsonResponse({ code: "legal_source.provider_error", error: "token=sidecar-secret" }, { status: 503 }),
  });

  await assert.rejects(
    () => provider({ question: "IBC" }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "copilot_research.provider_error");
      assert.doesNotMatch(String(error.message), /sidecar-secret/);
      return true;
    },
  );
});

test("legal source sidecar provider lets empty sources pass through", async () => {
  const provider = createLegalSourceSidecarProvider({
    baseUrl: "http://127.0.0.1:8790",
    fetchImpl: async () => jsonResponse({ query: "unknown", sources: [], warnings: ["No legal sources found."] }),
  });

  const result = await provider({ question: "unknown" });

  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.warnings, ["No legal sources found."]);
});
