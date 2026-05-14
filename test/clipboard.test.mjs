import assert from "node:assert/strict";
import test from "node:test";
import { writeClipboardText } from "../frontend/clipboard.js";

async function withBrowserGlobals(globals, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  try {
    return await fn();
  } finally {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  }
}

function createDocumentDouble({ execResult = true } = {}) {
  const scratch = {
    value: "",
    style: {},
    attributes: new Map(),
    selected: false,
    removed: false,
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    select() {
      this.selected = true;
    },
    remove() {
      this.removed = true;
    },
  };
  return {
    scratch,
    appended: [],
    execCommands: [],
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      return scratch;
    },
    body: {
      appendChild(node) {
        this.owner.appended.push(node);
      },
      owner: null,
    },
    execCommand(command) {
      this.execCommands.push(command);
      return execResult;
    },
  };
}

test("writeClipboardText uses Clipboard API when available", async () => {
  const writes = [];
  await withBrowserGlobals({
    navigator: {
      clipboard: {
        async writeText(text) {
          writes.push(text);
        },
      },
    },
  }, async () => {
    await writeClipboardText("Draft note");
  });

  assert.deepEqual(writes, ["Draft note"]);
});

test("writeClipboardText falls back to hidden textarea when Clipboard API is denied", async () => {
  const documentDouble = createDocumentDouble();
  documentDouble.body.owner = documentDouble;

  await withBrowserGlobals({
    navigator: {
      clipboard: {
        async writeText() {
          throw new Error("denied");
        },
      },
    },
    document: documentDouble,
  }, async () => {
    await writeClipboardText("Fallback note");
  });

  assert.equal(documentDouble.scratch.value, "Fallback note");
  assert.equal(documentDouble.scratch.attributes.get("readonly"), "");
  assert.equal(documentDouble.scratch.selected, true);
  assert.equal(documentDouble.scratch.removed, true);
  assert.deepEqual(documentDouble.execCommands, ["copy"]);
  assert.equal(documentDouble.appended.length, 1);
});

test("writeClipboardText reports unavailable clipboard without a document fallback", async () => {
  await withBrowserGlobals({ navigator: {} }, async () => {
    await assert.rejects(
      () => writeClipboardText("No browser"),
      /clipboard is unavailable/,
    );
  });
});

test("writeClipboardText removes fallback element when copy is rejected", async () => {
  const documentDouble = createDocumentDouble({ execResult: false });
  documentDouble.body.owner = documentDouble;

  await withBrowserGlobals({ document: documentDouble, navigator: {} }, async () => {
    await assert.rejects(
      () => writeClipboardText("Rejected note"),
      /clipboard copy was rejected/,
    );
  });

  assert.equal(documentDouble.scratch.removed, true);
});
