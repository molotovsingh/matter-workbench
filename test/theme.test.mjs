import assert from "node:assert/strict";
import { test } from "node:test";
import { createThemeController, nextTheme, normalizeTheme } from "../frontend/theme.js";

function createButtonDouble() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    textContent: "",
    title: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get("click")?.();
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

test("normalizeTheme defaults unsafe values to light", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("blue"), "light");
  assert.equal(normalizeTheme(undefined), "light");
});

test("nextTheme flips between dark and light", () => {
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("unexpected"), "dark");
});

test("theme controller defaults to light when no browser-local theme is saved", () => {
  const root = { dataset: {} };
  const button = createButtonDouble();
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("default load should not write storage");
    },
  };

  const controller = createThemeController({ button, root, storage });
  assert.equal(controller.wire(), "light");
  assert.equal(root.dataset.theme, "light");
  assert.equal(button.textContent, "Dark");
  assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("theme controller loads, applies, and persists browser-local theme", () => {
  const root = { dataset: {} };
  const button = createButtonDouble();
  const writes = [];
  const storage = {
    getItem(key) {
      assert.equal(key, "matter-workbench-theme");
      return "dark";
    },
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  const controller = createThemeController({ button, root, storage });
  assert.equal(controller.wire(), "dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(button.textContent, "Light");
  assert.equal(button.getAttribute("aria-pressed"), "false");

  button.click();
  assert.equal(controller.getTheme(), "light");
  assert.equal(root.dataset.theme, "light");
  assert.equal(button.textContent, "Dark");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.deepEqual(writes, [["matter-workbench-theme", "light"]]);
});
