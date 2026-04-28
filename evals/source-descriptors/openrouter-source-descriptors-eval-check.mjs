import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSourceDescriptorRequest,
  parseOpenRouterJsonContent,
  runOpenRouterSourceDescriptorEval,
  syntheticSourceDescriptorFixtures,
  validateSourceDescriptorResponse,
} from "./openrouter-source-descriptors-live.mjs";

test("OpenRouter source descriptor eval request is strict, synthetic, and no-fallback", () => {
  const body = buildSourceDescriptorRequest({
    model: "meta-llama/example-model",
    providerOrder: ["akashml/fp8"],
  });

  assert.equal(body.model, "meta-llama/example-model");
  assert.deepEqual(body.provider.order, ["akashml/fp8"]);
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.provider.allow_fallbacks, false);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[0].content, /Do not include FILE-NNNN identifiers in display_label or short_label/);

  const userPayload = JSON.parse(body.messages[1].content);
  assert.equal(userPayload.contract_summary.schema_version, "source-index/v1");
  assert.equal(userPayload.contract_summary.display_label_should_include_reliable_document_date, true);
  assert.equal(userPayload.contract_summary.raw_citations_remain_canonical, true);
  assert.equal(userPayload.contract_summary.source_text_beats_filename_for_date_basis, true);
  assert.ok(userPayload.sources.every((source) => source.original_name.startsWith("synthetic-")
    || source.original_name === "2021-01-01-important.png"));
});

test("OpenRouter source descriptor eval skips unless explicitly gated", async () => {
  const originalRunFlag = process.env.RUN_OPENROUTER_SOURCE_TEST;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  delete process.env.RUN_OPENROUTER_SOURCE_TEST;
  delete process.env.OPENROUTER_API_KEY;

  try {
    const appDir = await mkdtemp(path.join(os.tmpdir(), "source-descriptor-skip-"));
    let called = false;
    const result = await runOpenRouterSourceDescriptorEval({
      appDir,
      fetchImpl: async () => {
        called = true;
        throw new Error("network should not be called");
      },
    });

    assert.equal(result.skipped, true);
    assert.equal(called, false);
  } finally {
    restoreEnv("RUN_OPENROUTER_SOURCE_TEST", originalRunFlag);
    restoreEnv("OPENROUTER_API_KEY", originalApiKey);
  }
});

test("OpenRouter source descriptor eval loads local env before reading OpenRouter settings", async () => {
  const originalRunFlag = process.env.RUN_OPENROUTER_SOURCE_TEST;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_SOURCE_DESCRIPTION_MODEL;
  const originalProviderOrder = process.env.OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER;
  delete process.env.RUN_OPENROUTER_SOURCE_TEST;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_SOURCE_DESCRIPTION_MODEL;
  delete process.env.OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER;

  try {
    const appDir = await mkdtemp(path.join(os.tmpdir(), "source-descriptor-env-"));
    await writeFile(path.join(appDir, ".env"), [
      "RUN_OPENROUTER_SOURCE_TEST=1",
      "OPENROUTER_API_KEY=sk-openrouter-test",
      "OPENROUTER_SOURCE_DESCRIPTION_MODEL=meta-llama/env-model",
      "OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER=akashml/fp8",
      "",
    ].join("\n"));

    let request;
    const result = await runOpenRouterSourceDescriptorEval({
      appDir,
      fetchImpl: async (url, init) => {
        request = { url, init };
        return {
          ok: true,
          async json() {
            return {
              choices: [{ message: { content: JSON.stringify(validSyntheticResult()) } }],
            };
          },
        };
      },
    });

    assert.equal(result.skipped, false);
    assert.equal(result.model, "meta-llama/env-model");
    const requestBody = JSON.parse(request.init.body);
    assert.equal(requestBody.model, "meta-llama/env-model");
    assert.deepEqual(requestBody.provider.order, ["akashml/fp8"]);
    assert.equal(request.init.headers.authorization, "Bearer sk-openrouter-test");
  } finally {
    restoreEnv("RUN_OPENROUTER_SOURCE_TEST", originalRunFlag);
    restoreEnv("OPENROUTER_API_KEY", originalApiKey);
    restoreEnv("OPENROUTER_SOURCE_DESCRIPTION_MODEL", originalModel);
    restoreEnv("OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER", originalProviderOrder);
  }
});

test("OpenRouter source descriptor eval parses and validates synthetic response", () => {
  const fixtures = syntheticSourceDescriptorFixtures();
  const result = validSyntheticResult(fixtures);

  const payload = {
    choices: [{ message: { content: JSON.stringify(result) } }],
  };

  assert.deepEqual(parseOpenRouterJsonContent(payload), result);
  assert.doesNotThrow(() => validateSourceDescriptorResponse(result, fixtures));
});

test("OpenRouter source descriptor eval rejects incomplete source descriptors", () => {
  const result = validSyntheticResult();
  delete result.sources[0].short_label;

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /Missing required source field short_label/,
  );
});

test("OpenRouter source descriptor eval rejects FILE identifiers in human labels", () => {
  const result = validSyntheticResult();
  result.sources[0].display_label = "FILE-0001: Email from Sharma to Mehta dated 20 April 2026";

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /display_label for FILE-0001 must not include FILE-NNNN identifiers/,
  );
});

test("OpenRouter source descriptor eval rejects FILE identifiers in short labels", () => {
  const result = validSyntheticResult();
  result.sources[0].short_label = "FILE-0001 email";

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /short_label for FILE-0001 must not include FILE-NNNN identifiers/,
  );
});

test("OpenRouter source descriptor eval rejects weak semantic labels", () => {
  const result = validSyntheticResult();
  result.sources[0].date_basis = "file_name";
  result.sources[0].display_label = "Email from Sharma to Mehta";

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /FILE-0001 should use date_basis email_header/,
  );
});

test("OpenRouter source descriptor eval rejects misleading filename dates for unclear scans", () => {
  const result = validSyntheticResult();
  result.sources[2].document_date = "2021-01-01";
  result.sources[2].date_basis = "file_name";
  result.sources[2].display_label = "Blurred scan of affidavit dated 1 January 2021";

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /FILE-0003 should not use the filename date/,
  );
});

test("OpenRouter source descriptor eval rejects impossible ISO dates", () => {
  const result = validSyntheticResult();
  result.sources[0].document_date = "2004-20-20";

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /Invalid document_date for FILE-0001/,
  );
});

test("OpenRouter source descriptor eval rejects literal None party fields", () => {
  const result = validSyntheticResult();
  result.sources[1].parties.author = "None";

  assert.throws(
    () => validateSourceDescriptorResponse(result),
    /parties\.author should be empty instead of None for FILE-0002/,
  );
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function validSyntheticResult(fixtures = syntheticSourceDescriptorFixtures()) {
  return {
    sources: [
      {
        file_id: fixtures[0].file_id,
        sha256: fixtures[0].sha256,
        source_path: fixtures[0].source_path,
        display_label: "Email from Sharma to Mehta dated 20 April 2026",
        short_label: "Email dated 20 Apr 2026",
        document_type: "email",
        document_date: "2026-04-20",
        date_basis: "email_header",
        parties: {
          from: "Sharma",
          to: ["Mehta"],
          cc: [],
          author: "",
          court: "",
          judge: "",
          issuing_party: "",
          recipient_party: "",
          deponent: "",
          signatory: "",
        },
        confidence: 0.93,
        needs_review: false,
        evidence: [{ citation: "FILE-0001 p1.b1", reason: "Email header gives sender, recipient, and date." }],
        warnings: [],
      },
      {
        file_id: fixtures[1].file_id,
        sha256: fixtures[1].sha256,
        source_path: fixtures[1].source_path,
        display_label: "Order of the Delhi High Court dated 3 March 2024",
        short_label: "Delhi High Court order dated 3 Mar 2024",
        document_type: "court_order",
        document_date: "2024-03-03",
        date_basis: "court_order_date",
        parties: {
          from: "",
          to: [],
          cc: [],
          author: "",
          court: "Delhi High Court",
          judge: "",
          issuing_party: "Delhi High Court",
          recipient_party: "",
          deponent: "",
          signatory: "",
        },
        confidence: 0.89,
        needs_review: false,
        evidence: [{ citation: "FILE-0002 p1.b1", reason: "Heading identifies court and order date." }],
        warnings: [],
      },
      {
        file_id: fixtures[2].file_id,
        sha256: fixtures[2].sha256,
        source_path: fixtures[2].source_path,
        display_label: "Scanned document, likely affidavit, date unclear",
        short_label: "Unclear scanned affidavit",
        document_type: "affidavit",
        document_date: null,
        date_basis: "unknown",
        parties: {
          from: "",
          to: [],
          cc: [],
          author: "",
          court: "",
          judge: "",
          issuing_party: "",
          recipient_party: "",
          deponent: "",
          signatory: "",
        },
        confidence: 0.51,
        needs_review: true,
        evidence: [{ citation: "FILE-0003 p1.b1", reason: "OCR text weakly suggests affidavit but date is unclear." }],
        warnings: ["low_ocr_confidence"],
      },
    ],
  };
}
