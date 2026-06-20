import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prototypePath = new URL("../prototypes/nav-shell.html", import.meta.url);

test("navigation shell prototype is clearly separated from production UI", async () => {
  const html = await readFile(prototypePath, "utf8");

  assert.match(html, /Navigation shell prototype/);
  assert.match(html, /Visual test only/);
  assert.match(html, /A: black app anchor/);
  assert.match(html, /B: black global nav/);
  assert.match(html, /C: slim black spine/);
  assert.match(html, /Matter record/);
  assert.match(html, /Matter Home/);
  assert.match(html, /App global/);
  assert.doesNotMatch(html, /OpenAI|OpenRouter|GPT|API key|billing|quota/i);
});
