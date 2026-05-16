import assert from "node:assert/strict";
import test from "node:test";
import { createStatusController, formatCompactActivityLine } from "../frontend/status.js";
import { createActivityLogStore, latestActivityLines } from "../frontend/activity-log-store.js";

test("status controller mirrors terminal lines into compact command activity", () => {
  const terminalOutput = { textContent: "", scrollTop: 0, scrollHeight: 100 };
  const statusBarRight = { innerHTML: "" };
  const activityStrip = { hidden: true, innerHTML: "" };
  const activityLogStore = createActivityLogStore({ timestamp: () => "18:57:34" });
  const { setStatus } = createStatusController({
    terminalOutput,
    statusBarRight,
    aiCommandActivityStrip: activityStrip,
    activityLogStore,
  });

  setStatus({
    bar: "Checking",
    terminal: "[skill-builder] checking overlap before skill creation",
  });

  assert.equal(statusBarRight.innerHTML, "<span>Checking</span>");
  assert.equal(activityLogStore.getText(), "18:57:34 [skill-builder] checking overlap before skill creation");
  assert.match(terminalOutput.textContent, /\[skill-builder\] checking overlap before skill creation/);
  assert.equal(activityStrip.hidden, false);
  assert.match(activityStrip.innerHTML, /Recent activity/);
  assert.match(activityStrip.innerHTML, /<time>\d{2}:\d{2}<\/time>/);
  assert.match(activityStrip.innerHTML, /checking overlap before skill creation/);
  assert.doesNotMatch(activityStrip.innerHTML, /\[skill-builder\]/);
});

test("status controller keeps the compact strip to the last three entries", () => {
  const terminalOutput = { textContent: "", scrollTop: 0, scrollHeight: 100 };
  const activityStrip = { hidden: true, innerHTML: "" };
  const { setStatus } = createStatusController({
    terminalOutput,
    statusBarRight: { innerHTML: "" },
    aiCommandActivityStrip: activityStrip,
    activityLogStore: createActivityLogStore({ timestamp: () => "18:57:34" }),
  });

  setStatus({ terminal: ["[one] first", "[two] second", "[three] third", "[four] fourth"] });

  assert.doesNotMatch(activityStrip.innerHTML, /first/);
  assert.match(activityStrip.innerHTML, /second/);
  assert.match(activityStrip.innerHTML, /third/);
  assert.match(activityStrip.innerHTML, /fourth/);
});

test("formatCompactActivityLine strips technical prefixes and preserves concise time", () => {
  assert.deepEqual(formatCompactActivityLine("18:57:34 [ai-command] new skill -> matter status"), {
    time: "18:57",
    message: "new skill → matter status",
  });
});

test("activity log store provides bounded newest-first lines without reading DOM", () => {
  const store = createActivityLogStore({
    lineCap: 3,
    timestamp: () => "18:57:34",
  });

  store.append(["[one] first", "[two] second"]);
  store.append("[three] third");
  store.append("[four] fourth");

  assert.deepEqual(store.getLines(), [
    "18:57:34 [two] second",
    "18:57:34 [three] third",
    "18:57:34 [four] fourth",
  ]);
  assert.deepEqual(store.getLines({ limit: 2, newestFirst: true }), [
    "18:57:34 [four] fourth",
    "18:57:34 [three] third",
  ]);
  assert.deepEqual(latestActivityLines(store.getLines(), { limit: 2 }), [
    "18:57:34 [four] fourth",
    "18:57:34 [three] third",
  ]);
});
