import assert from "node:assert/strict";
import test from "node:test";

import {
  answerHasUnsupportedRawCitations,
  buildSourceResolver,
  normalizeSources,
} from "../services/matter-citation-validation.mjs";

test("shared matter citation validation serves Ask and Research without an orchestration dependency", () => {
  const resolver = buildSourceResolver({
    evidence_blocks: [{
      citation: "FILE-10000 p2.b3",
      source_label: "Payment Agreement",
      source_short_label: "Agreement",
      text: "Payment was due on 1 January.",
    }],
    library_artifacts: [],
  });
  const normalized = normalizeSources([
    { raw_citation: "Payment Agreement", source_label: "Payment Agreement", snippet: "Payment was due on 1 January." },
    { raw_citation: "FILE-99999 p1.b1", source_label: "Invented", snippet: "Invented" },
  ], resolver);

  assert.deepEqual(normalized, {
    sources: [{
      raw_citation: "FILE-10000 p2.b3",
      source_label: "Payment Agreement",
      snippet: "Payment was due on 1 January.",
    }],
    unsupportedCount: 1,
  });
  assert.equal(answerHasUnsupportedRawCitations("See FILE-10000 p2.b3.", normalized.sources, resolver), false);
  assert.equal(answerHasUnsupportedRawCitations("See FILE-99999 p1.b1.", normalized.sources, resolver), true);
});
