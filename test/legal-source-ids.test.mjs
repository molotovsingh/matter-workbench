import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLegalSourceIds,
  isLegalSourceId,
  isStatuteSourceId,
  normalizeLegalSourceId,
} from "../shared/legal-source-ids.mjs";

test("legal source IDs normalize WEB and STATUTE namespaces only", () => {
  assert.equal(normalizeLegalSourceId(" statute-0001 "), "STATUTE-0001");
  assert.equal(normalizeLegalSourceId("web-0042"), "WEB-0042");
  assert.equal(normalizeLegalSourceId("FILE-0001"), "");
  assert.equal(normalizeLegalSourceId("STATUTE-1"), "");
  assert.equal(isLegalSourceId("WEB-9999"), true);
  assert.equal(isLegalSourceId("WEB-10000"), false);
});

test("legal source ID extraction is case-insensitive and de-duplicated in order", () => {
  assert.deepEqual(
    extractLegalSourceIds("See web-0002, STATUTE-0001, WEB-0002, FILE-0001 and statute-9999."),
    ["WEB-0002", "STATUTE-0001", "STATUTE-9999"],
  );
});

test("legal source IDs classify statute IDs", () => {
  assert.equal(isStatuteSourceId("STATUTE-0001"), true);
  assert.equal(isStatuteSourceId("statute-0001"), true);
  assert.equal(isStatuteSourceId("WEB-0001"), false);
  assert.equal(isStatuteSourceId("STATUTE-001"), false);
});
