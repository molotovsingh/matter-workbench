import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const clipboardPath = new URL("../react-ui/src/lib/clipboard.ts", import.meta.url);

async function importClipboardModule() {
  const source = await readFile(clipboardPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function replaceGlobal(name, value) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (prior) Object.defineProperty(globalThis, name, prior);
    else delete globalThis[name];
  };
}

test("React clipboard helper prefers Clipboard API and falls back safely", async () => {
  const { writeClipboardText } = await importClipboardModule();
  const writes = [];
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: { writeText: async (value) => { writes.push(value); } },
  });
  const restoreDocument = replaceGlobal("document", undefined);
  try {
    await writeClipboardText("copy me");
    assert.deepEqual(writes, ["copy me"]);
  } finally {
    restoreDocument();
    restoreNavigator();
  }

  const events = [];
  const textarea = {
    value: "",
    style: {},
    setAttribute(name, value) { events.push(["attribute", name, value]); },
    select() { events.push(["select"]); },
    remove() { events.push(["remove"]); },
  };
  const restoreRejectedNavigator = replaceGlobal("navigator", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  const restoreFallbackDocument = replaceGlobal("document", {
    createElement: () => textarea,
    body: {
      appendChild: () => events.push(["append"]),
    },
    execCommand: (command) => {
      events.push(["command", command]);
      return true;
    },
  });
  try {
    await writeClipboardText("fallback");
    assert.equal(textarea.value, "fallback");
    assert.deepEqual(events.slice(-4), [["append"], ["select"], ["command", "copy"], ["remove"]]);
  } finally {
    restoreFallbackDocument();
    restoreRejectedNavigator();
  }
});

test("React clipboard helper fails clearly when no browser copy surface exists", async () => {
  const { writeClipboardText } = await importClipboardModule();
  const restoreNavigator = replaceGlobal("navigator", undefined);
  const restoreDocument = replaceGlobal("document", undefined);
  try {
    await assert.rejects(() => writeClipboardText("copy"), /clipboard is unavailable/i);
  } finally {
    restoreDocument();
    restoreNavigator();
  }
});
