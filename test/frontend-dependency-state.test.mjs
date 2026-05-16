import assert from "node:assert/strict";
import test from "node:test";
import { LIST_OF_DATES_DEPENDENCY_STATES } from "../frontend/listofdates-dependency-state.js";

test("frontend List of Dates dependency states match API contract strings", () => {
  assert.equal(LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED, "label_refresh_needed");
  assert.equal(LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED, "chronology_review_needed");
  assert.equal(LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED, "chronology_regeneration_needed");
});
