import assert from "node:assert/strict";
import test from "node:test";
import { CASE_TIMELINE_DEPENDENCY_STATES } from "../shared/case-timeline-dependency-states.mjs";
import { LIST_OF_DATES_DEPENDENCY_STATES } from "../shared/listofdates-dependency-states.mjs";

test("frontend Case Timeline dependency states match API contract strings", () => {
  assert.equal(CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED, "label_refresh_needed");
  assert.equal(CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED, "chronology_review_needed");
  assert.equal(CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED, "chronology_regeneration_needed");
  assert.equal(LIST_OF_DATES_DEPENDENCY_STATES, CASE_TIMELINE_DEPENDENCY_STATES);
});
