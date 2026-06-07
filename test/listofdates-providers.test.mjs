import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAiProvider,
  createOpenRouterProvider,
  toOpenRouterCompatibleJsonSchema,
} from "../listofdates/providers.mjs";
import {
  createOpenAiProvider as createOpenAiProviderFromEngine,
  createOpenRouterProvider as createOpenRouterProviderFromEngine,
} from "../create-listofdates-engine.mjs";

test("List of Dates provider factories live in the provider module and remain re-exported by the engine", () => {
  assert.equal(typeof createOpenAiProvider, "function");
  assert.equal(typeof createOpenRouterProvider, "function");
  assert.equal(createOpenAiProviderFromEngine, createOpenAiProvider);
  assert.equal(createOpenRouterProviderFromEngine, createOpenRouterProvider);
});

test("OpenRouter schema compatibility strips unsupported strict-schema keywords without mutating input", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["entries"],
    properties: {
      entries: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["citation", "confidence"],
          properties: {
            citation: {
              type: "string",
              pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
        },
      },
    },
  };

  const compatible = toOpenRouterCompatibleJsonSchema(schema);

  assert.equal(Object.hasOwn(compatible.properties.entries, "minItems"), false);
  assert.equal(Object.hasOwn(compatible.properties.entries, "maxItems"), false);
  assert.equal(Object.hasOwn(compatible.properties.entries.items.properties.citation, "pattern"), false);
  assert.equal(Object.hasOwn(compatible.properties.entries.items.properties.confidence, "minimum"), false);
  assert.equal(Object.hasOwn(compatible.properties.entries.items.properties.confidence, "maximum"), false);
  assert.equal(schema.properties.entries.maxItems, 3);
  assert.equal(schema.properties.entries.items.properties.citation.pattern, "^FILE-\\d{4,} p\\d+\\.b\\d+$");
});
