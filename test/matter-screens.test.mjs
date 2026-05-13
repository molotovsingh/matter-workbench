import assert from "node:assert/strict";
import test from "node:test";
import { createMatterScreens } from "../frontend/matter-screens.js";

test("matter list search filters matters without changing switch behavior markup", () => {
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
    assert.equal(elements.mattersSearchMeta.textContent, "3 matters");
    assert.match(elements.mattersList.innerHTML, /Ayesha Vs Japan Airlines/);
    assert.match(elements.mattersList.innerHTML, /Mehta vs Skyline/);
    assert.match(elements.mattersList.innerHTML, /data-matter-name="Mehta vs Skyline"/);
    assert.match(elements.mattersList.innerHTML, /class="matters-entry active"/);

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
