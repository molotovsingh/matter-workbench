import assert from "node:assert/strict";
import test from "node:test";
import { createMatterScreens } from "../frontend/matter-screens.js";

test("matter list shows only search until a selected matter switch search is typed", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const state = {
      enabled: true,
      active: "Mehta vs Skyline",
      matters: [
        { name: "Ayesha Vs Japan Airlines" },
        { name: "Dummy 20260429T1324 02 - Devi v Patel" },
        { name: "Mehta vs Skyline" },
      ],
    };
    const elements = {
      mattersPicker: { hidden: true },
      mattersList: { innerHTML: "" },
      mattersSearchInput: { value: "" },
      mattersSearchMeta: { textContent: "" },
    };
    const screens = createMatterScreens({
      elements,
      getMattersState: () => state,
    });

    screens.renderMattersList();

    assert.equal(elements.mattersPicker.hidden, false);
    assert.equal(elements.mattersSearchMeta.textContent, "");
    assert.equal(elements.mattersList.innerHTML, "");

    screens.setMatterSearchQuery("airlines");

    assert.equal(elements.mattersSearchInput.value, "airlines");
    assert.equal(elements.mattersSearchMeta.textContent, "1 of 3 matters");
    assert.match(elements.mattersList.innerHTML, /Ayesha Vs Japan Airlines/);
    assert.doesNotMatch(elements.mattersList.innerHTML, /Mehta vs Skyline/);

    screens.setMatterSearchQuery("no such matter");

    assert.equal(elements.mattersSearchMeta.textContent, "0 of 3 matters");
    assert.match(elements.mattersList.innerHTML, /No matters match "no such matter"\./);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("matter list remains open when no matter is selected", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const state = {
      enabled: true,
      active: "",
      matters: [
        { name: "Ayesha Vs Japan Airlines" },
        { name: "Mehta vs Skyline" },
      ],
    };
    const elements = {
      mattersPicker: { hidden: true },
      mattersList: { innerHTML: "" },
      mattersSearchInput: { value: "" },
      mattersSearchMeta: { textContent: "" },
    };
    const screens = createMatterScreens({
      elements,
      getMattersState: () => state,
    });

    screens.renderMattersList();

    assert.equal(elements.mattersPicker.hidden, false);
    assert.equal(elements.mattersSearchMeta.textContent, "2 matters");
    assert.match(elements.mattersList.innerHTML, /Ayesha Vs Japan Airlines/);
    assert.match(elements.mattersList.innerHTML, /Mehta vs Skyline/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
