import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app shell uses lawyer-facing first impression labels", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /Matter Actions/);
  assert.match(html, /Workbench/);
  assert.match(html, /title="Matters">Matters/);
  assert.match(html, /title="Skills">Skills/);
  assert.match(html, /title="Activity">Activity/);
  assert.match(html, /title="Settings">Settings/);
  assert.match(html, /matter-actions-section/);
  assert.match(html, /Search matters/);
  assert.match(html, /id="mattersSearchInput"/);
  assert.match(html, /8 actions/);
  assert.match(html, /Set up matter/);
  assert.match(html, /Extract documents/);
  assert.match(html, /Label sources/);
  assert.match(html, /Create list of dates/);
  assert.match(html, /Matter Assistant/);
  assert.match(html, /What do you need\?/);
  assert.match(html, /Ask or run/);
  assert.match(html, /Show technical files/);
  assert.match(html, /Ask about this matter, run a skill, or search documents/);
  assert.match(html, /find payment receipts/);
  assert.match(html, /prepare matter/);
  assert.match(html, /new skill/);
  assert.match(html, /Local workspace/);
  assert.match(html, /Paid AI actions ask before running/);
  assert.match(html, /New skills are tested with a sample before they become runnable/);
  assert.match(html, /No matter selected/);
  assert.match(html, /Pick a matter to begin/);
  assert.match(html, /id="aiCommandCopyReport"[^>]+hidden/);

  assert.doesNotMatch(html, /Slash Skills/);
  assert.doesNotMatch(html, /matter-init\.log/);
  assert.doesNotMatch(html, /legal-workbench \/ matter-init/);
  assert.doesNotMatch(html, /New skill ideas are saved for review/);
  assert.doesNotMatch(html, /Type a command/);
  assert.doesNotMatch(html, />local</);
  assert.doesNotMatch(html, /Phase 1/);
  assert.doesNotMatch(html, />V0</);
  assert.doesNotMatch(html, />EX</);
  assert.doesNotMatch(html, />SK</);
  assert.doesNotMatch(html, />AC</);
  assert.doesNotMatch(html, />SE</);
});
