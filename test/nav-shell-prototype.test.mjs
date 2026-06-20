import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prototypePath = new URL("../prototypes/nav-shell.html", import.meta.url);

test("navigation shell prototype is clearly separated from production UI", async () => {
  const html = await readFile(prototypePath, "utf8");

  assert.match(html, /Navigation shell prototype/);
  assert.match(html, /Visual test only/);
  assert.match(html, /A: recommended black rail/);
  assert.match(html, /B: quiet black anchor/);
  assert.match(html, /C: slim black spine/);
  assert.match(html, /Matter record/);
  assert.match(html, /Matter Home/);
  assert.match(html, /app-global navigation plus the active matter anchor/);
  assert.doesNotMatch(html, /OpenAI|OpenRouter|GPT|API key|billing|quota/i);
});
