import test from "node:test";
import assert from "node:assert/strict";
import { createBuiltinSkillDispatch } from "../frontend/skill-dispatch.js";

test("builtin skill dispatch maps slash commands to injected runners", () => {
  const runners = {
    runMatterInit: () => "matter",
    runPrepareMatter: () => "prepare",
    runExtract: () => "extract",
    runDescribeSources: () => "sources",
    runContextPreview: () => "preview",
    runContextSearch: () => "search",
    runCreateListOfDates: () => "dates",
    runDoctor: () => "doctor",
  };
  const dispatch = createBuiltinSkillDispatch(runners);
  assert.equal(dispatch["/matter-init"](), "matter");
  assert.equal(dispatch["/prepare_matter"](), "prepare");
  assert.equal(dispatch["/extract"](), "extract");
  assert.equal(dispatch["/describe_sources"](), "sources");
  assert.equal(dispatch["/context_preview"](), "preview");
  assert.equal(dispatch["/context_search"](), "search");
  assert.equal(dispatch["/create_case_timeline"](), "dates");
  assert.equal(dispatch["/doctor"](), "doctor");
});
