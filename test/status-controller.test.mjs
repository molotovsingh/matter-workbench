import assert from "node:assert/strict";
import test from "node:test";
import { createStatusController, formatCompactActivityLine } from "../frontend/status.js";

test("status controller mirrors terminal lines into compact command activity", () => {
  const terminalOutput = { textContent: "", scrollTop: 0, scrollHeight: 100 };
  const statusBarRight = { innerHTML: "" };
  const activityStrip = { hidden: true, innerHTML: "" };
  const { setStatus } = createStatusController({
    terminalOutput,
    statusBarRight,
    aiCommandActivityStrip: activityStrip,
  });

  setStatus({
    bar: "Checking",
    terminal: "[skill-builder] checking overlap before skill creation",
  });

  assert.equal(statusBarRight.innerHTML, "<span>Checking</span>");
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
