import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const activityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React command panel exposes child-simple private beta feedback intake", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /Have a problem\? Tell us what happened/);
  assert.match(source, /Something did not work/);
  assert.match(source, /I got confused/);
  assert.match(source, /I want this to do something/);
  assert.match(source, /What were you trying to do/);
  assert.match(source, /What happened instead/);
  assert.match(source, /Saved\. You can keep working\./);
  assert.doesNotMatch(source, /severity|priority|reproduction steps/i);
});

test("React command panel keeps feedback after the source-backed answer note", async () => {
  const source = await readFile(commandPanelPath, "utf8");
  const sourceBackedNoteIndex = source.indexOf('Source-backed answers are one question at a time');
  const feedbackEntryIndex = source.indexOf('className="beta-feedback-entry"');

  assert.notEqual(sourceBackedNoteIndex, -1);
  assert.notEqual(feedbackEntryIndex, -1);
  assert.ok(sourceBackedNoteIndex < feedbackEntryIndex);
});

test("React feedback API client and types expose the beta feedback contract", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const typesSource = await readFile(typesPath, "utf8");

  assert.match(apiSource, /getPrivateBetaFeedback/);
  assert.match(apiSource, /submitPrivateBetaFeedback/);
  assert.match(apiSource, /syncPrivateBetaFeedback/);
  assert.match(apiSource, /\/api\/private-beta\/feedback/);
  assert.match(apiSource, /\/api\/private-beta\/feedback\/sync/);
  assert.match(typesSource, /export interface PrivateBetaFeedback/);
  assert.match(typesSource, /export interface PrivateBetaFeedbackRequest/);
  assert.match(typesSource, /export interface PrivateBetaFeedbackSync/);
  assert.match(typesSource, /export interface PrivateBetaFeedbackSyncResult/);
  assert.match(typesSource, /choice: 'did_not_work' \\| 'confused' \\| 'want_something'/);
});

test("Activity page renders operator-facing feedback review and export controls", async () => {
  const source = await readFile(activityPagePath, "utf8");

  assert.match(source, /getPrivateBetaFeedback/);
  assert.match(source, /Beta Feedback/);
  assert.match(source, /New tester feedback/);
  assert.match(source, /activity-feedback-alert/);
  assert.match(source, /FeedbackCard/);
  assert.match(source, /formatFeedbackSyncStatus/);
  assert.match(source, /Retry sync/);
  assert.match(source, /Copy packet/);
  assert.match(source, /classification/);
  assert.match(source, /visibleFeedback/);
});
