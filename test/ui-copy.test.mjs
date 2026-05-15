import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app shell uses lawyer-facing first impression labels", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /Matter Actions/);
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
  assert.match(html, /Show technical files/);
  assert.match(html, /find payment receipts, prepare matter, open drafts/);
  assert.match(html, /Paid AI actions ask before running/);
  assert.match(html, /New skill ideas are saved for review/);
  assert.match(html, /No matter selected/);
  assert.match(html, /Pick a matter to begin/);
  assert.match(html, /id="aiCommandCopyReport"[^>]+hidden/);

  assert.doesNotMatch(html, /Slash Skills/);
  assert.doesNotMatch(html, /matter-init\.log/);
  assert.doesNotMatch(html, /legal-workbench \/ matter-init/);
  assert.doesNotMatch(html, /Phase 1/);
  assert.doesNotMatch(html, />V0</);
});
