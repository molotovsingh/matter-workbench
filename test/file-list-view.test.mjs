import assert from "node:assert/strict";
import test from "node:test";
import {
  renderCollectedFileListHtml,
  updateCollectedFileListElement,
} from "../frontend/file-list-view.js";

test("renderCollectedFileListHtml renders count, size, and escaped relative paths", () => {
  const html = renderCollectedFileListHtml([
    { file: new File(["alpha"], "a.txt"), relativePath: "Batch <A>/a.txt" },
    { file: new File(["beta"], "b.txt"), relativePath: "Batch B/b.txt" },
  ]);

  assert.match(html, /2 files ready/);
  assert.match(html, /9 B/);
  assert.match(html, /Batch &lt;A&gt;\/a\.txt/);
  assert.match(html, /Batch B\/b\.txt/);
});

test("updateCollectedFileListElement hides empty lists and renders populated lists", () => {
  const element = { hidden: false, innerHTML: "stale" };

  updateCollectedFileListElement(element, []);
  assert.equal(element.hidden, true);
  assert.equal(element.innerHTML, "");

  updateCollectedFileListElement(element, [
    { file: new File(["alpha"], "a.txt"), relativePath: "a.txt" },
  ]);
  assert.equal(element.hidden, false);
  assert.match(element.innerHTML, /1 file ready/);
  assert.match(element.innerHTML, /a\.txt/);
});
