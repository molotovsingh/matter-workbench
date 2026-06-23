import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const feedbackPanelPath = new URL("../react-ui/src/components/command/PrivateBetaFeedbackPanel.tsx", import.meta.url);
const activityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React command panel exposes child-simple private beta feedback intake", async () => {
  const commandPanelSource = await readFile(commandPanelPath, "utf8");
  const source = await readFile(feedbackPanelPath, "utf8");

  assert.match(commandPanelSource, /PrivateBetaFeedbackPanel/);
  assert.match(source, /Have a problem\? Tell us what happened/);
  assert.match(source, /Something did not work/);
  assert.match(source, /I got confused/);
  assert.match(source, /I want a new feature/);
  assert.match(source, /Optional: pick the closest type/);
  assert.match(source, /What happened\? One sentence is enough/);
  assert.match(source, /What were you trying to do\? Optional/);
  assert.doesNotMatch(source, /<textarea[^>]+required/);
  assert.doesNotMatch(source, /Saved\. You can keep working\./);
  assert.match(source, /setFeedbackOpen\(false\);/);
  assert.match(source, /buildPrivateBetaFeedbackDraft/);
  assert.match(source, /disabled=\{!canSubmitFeedback\}/);
  assert.doesNotMatch(source, /severity|priority|reproduction steps/i);
});

test("React command panel keeps feedback after the source-backed answer note", async () => {
  const source = await readFile(commandPanelPath, "utf8");
  const sourceBackedNoteIndex = source.indexOf('Ask uses the matter record. Research uses public sources when enabled.');
  const feedbackEntryIndex = source.indexOf('<PrivateBetaFeedbackPanel');

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
  assert.match(typesSource, /'feature_request'/);
});

test("Activity page renders operator-facing feedback review and export controls", async () => {
  const source = await readFile(activityPagePath, "utf8");

  assert.match(source, /getPrivateBetaFeedback/);
  assert.match(source, /canSeeOperatorSurface\(state\.authEnabled, state\.authUser\)/);
  assert.match(source, /Beta Feedback/);
  assert.match(source, /New tester feedback/);
  assert.match(source, /activity-feedback-alert/);
  assert.match(source, /FeedbackCard/);
  assert.match(source, /formatFeedbackSender/);
  assert.match(source, /formatFeedbackSyncStatus/);
  assert.match(source, /Retry sync/);
  assert.match(source, /Copy packet/);
  assert.match(source, /classification/);
  assert.match(source, /visibleFeedback/);
});
