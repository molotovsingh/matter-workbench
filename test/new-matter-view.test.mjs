import assert from "node:assert/strict";
import test from "node:test";
import { renderNewMatterForm } from "../frontend/views/new-matter.js";

test("new matter form groups intake fields and keeps existing control ids", () => {
  const previousDocument = globalThis.document;
  const nodes = createNewMatterNodes();
  globalThis.document = {
    getElementById: (id) => nodes[id] || null,
  };
  try {
    const calls = [];
    const elements = {
      breadcrumbs: { textContent: "" },
      editorContent: { innerHTML: "" },
    };

    renderNewMatterForm({
      elements,
      setActivityActive: (view) => calls.push(["active", view]),
      setStatus: (status) => calls.push(["status", status]),
      getActiveMatter: () => ({}),
      renderBlankLanding: () => calls.push(["landing"]),
      renderSkillOverview: () => calls.push(["overview"]),
      switchToMatter: (name) => calls.push(["switch", name]),
    });

    assert.equal(elements.breadcrumbs.textContent, "Home > New Matter");
    assert.match(elements.editorContent.innerHTML, /<h1>New Matter<\/h1>/);
    assert.match(elements.editorContent.innerHTML, /Parties/);
    assert.match(elements.editorContent.innerHTML, /Matter details/);
    assert.match(elements.editorContent.innerHTML, /Initial files/);
    assert.match(
      elements.editorContent.innerHTML,
      /Include the dispute, key dates, forum, and what outcome the client wants\./,
    );
    assert.match(
      elements.editorContent.innerHTML,
      /These files will be classified and indexed when the matter is prepared\./,
    );
    assert.match(elements.editorContent.innerHTML, /id="nmName"/);
    assert.match(elements.editorContent.innerHTML, /id="nmClient"/);
    assert.match(elements.editorContent.innerHTML, /id="nmOpposite"/);
    assert.match(elements.editorContent.innerHTML, /id="nmType"/);
    assert.match(elements.editorContent.innerHTML, /id="nmJurisdiction"/);
    assert.match(elements.editorContent.innerHTML, /id="nmBrief"/);
    assert.match(elements.editorContent.innerHTML, /id="nmDropZone"/);
    assert.match(elements.editorContent.innerHTML, /id="nmSubmit"/);
    assert.deepEqual(calls[0], ["active", "explorer"]);
    assert.equal(calls[1][0], "status");
    assert.match(calls[1][1].card, /attach initial files or a folder/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

function createNewMatterNodes() {
  const ids = [
    "nmDropZone",
    "nmFilesInput",
    "nmFolderInput",
    "nmFileList",
    "nmError",
    "nmSubmit",
    "nmOverlap",
    "nmPickFiles",
    "nmPickFolder",
    "nmCancel",
    "newMatterForm",
  ];
  return Object.fromEntries(ids.map((id) => [id, createNode(id)]));
}

function createNode(id) {
  return {
    id,
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    handlers: {},
    classList: {
      add() {},
      remove() {},
    },
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    click() {
      this.handlers.click?.();
    },
    focus() {},
    select() {},
  };
}
