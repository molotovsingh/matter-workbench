import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app shell uses lawyer-facing first impression labels", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /Matter Actions/);
  assert.match(html, /<div class="title-left">Matter Workbench<\/div>/);
  assert.match(html, /Workbench/);
  assert.match(html, /<span class="sidebar-title">Home<\/span>/);
  assert.doesNotMatch(html, /<div class="tree-heading">Matters<\/div>/);
  assert.match(html, /Matter files/);
  assert.match(html, /title="Home"[\s\S]*activity-icon[\s\S]*⌂[\s\S]*activity-label[\s\S]*Home/);
  assert.match(html, /title="Skills"[\s\S]*activity-icon[\s\S]*✦[\s\S]*activity-label[\s\S]*Skills/);
  assert.match(html, /title="Activity"[\s\S]*activity-icon[\s\S]*◔[\s\S]*activity-label[\s\S]*Activity/);
  assert.match(html, /title="Settings"[\s\S]*activity-icon[\s\S]*⚙[\s\S]*activity-label[\s\S]*Settings/);
  assert.match(html, /matter-actions-section/);
  assert.match(html, /Search matters/);
  assert.match(html, /id="mattersSearchInput"/);
  assert.match(html, /id="matterActionsSection"[^>]+hidden/);
  assert.match(html, /id="matterFilesSection"[^>]+hidden/);
  assert.match(html, /id="mattersPicker"[^>]+hidden/);
  assert.match(html, /8 actions/);
  assert.match(html, /Set up matter/);
  assert.match(html, /Extract documents/);
  assert.match(html, /Label sources/);
  assert.match(html, /Create list of dates/);
  assert.match(html, /Matter Assistant/);
  assert.match(html, /What do you need\?/);
  assert.match(html, /Ask or run/);
  assert.match(html, /id="aiCommandSubmit"[^>]+aria-label="Run"[^>]+title="Run"[^>]*>→<\/button>/);
  assert.match(html, /id="aiCommandActivityStrip"/);
  assert.match(html, /Show technical files/);
  assert.match(html, /Ask a general question, create a skill, or pick a matter first/);
  assert.match(html, /new skill/);
  assert.match(html, /find a matter/);
  assert.match(html, /prepare matter/);
  assert.match(html, /Local workspace/);
  assert.match(html, /Paid AI actions ask before running/);
  assert.match(html, /New skills are tested with a sample before they become runnable/);
  assert.match(html, /No matter selected/);
  assert.match(html, /Pick a matter to begin/);
  assert.match(html, /id="aiCommandCopyReport"[^>]+hidden/);

  assert.doesNotMatch(html, /Slash Skills/);
  assert.doesNotMatch(html, /Matter Explorer/);
  assert.doesNotMatch(html, /matter-init\.log/);
  assert.doesNotMatch(html, /legal-workbench \/ matter-init/);
  assert.doesNotMatch(html, /Legal Workbench/);
  assert.doesNotMatch(html, /New skill ideas are saved for review/);
  assert.doesNotMatch(html, /Ask about this matter, run a skill, or search documents/);
  assert.doesNotMatch(html, /find payment receipts/);
  assert.doesNotMatch(html, /Type a command/);
  assert.doesNotMatch(html, />local</);
  assert.doesNotMatch(html, /Phase 1/);
  assert.doesNotMatch(html, />V0</);
  assert.doesNotMatch(html, />EX</);
  assert.doesNotMatch(html, />SK</);
  assert.doesNotMatch(html, />AC</);
  assert.doesNotMatch(html, />SE</);
});

test("shell terminal is hidden outside Activity content", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(css, /\.bottom-panel\s*\{[\s\S]*?display: none;/);
  assert.match(css, /activity-system-log/);
});
