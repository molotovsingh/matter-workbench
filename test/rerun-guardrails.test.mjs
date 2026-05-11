import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  confirmCurrentArtifactRerun,
  renderRerunConfirmationHtml,
} from "../frontend/rerun-guardrails.js";

test("rerun confirmation renders current artifact details without native confirm", () => {
  const html = renderRerunConfirmationHtml({
    skill: "/create_listofdates",
    state: "current",
    shouldConfirm: true,
    artifactPath: "10_Library/List of Dates.md",
    lastRunAt: "2026-05-11T02:38:05.118Z",
    provider: "OpenAI",
    model: "openai/gpt-4.1",
    message: "Existing artifact is current.\nRun it again anyway?",
  }, escapeHtml, {
    title: "/create_listofdates — Mehta vs Skyline",
    confirmLabel: "Run /create_listofdates anyway",
  });

  assert.match(html, /Confirm rerun|Existing artifact is current/);
  assert.match(html, /10_Library\/List of Dates\.md/);
  assert.match(html, /OpenAI \/ openai\/gpt-4\.1/);
  assert.match(html, /Run \/create_listofdates anyway/);
  assert.match(html, /id="rerunConfirmCancel"/);
  assert.match(html, /id="rerunConfirmRun"/);
  assert.doesNotMatch(html, /window\.confirm/);
});

test("rerun confirmation escapes advice fields", () => {
  const html = renderRerunConfirmationHtml({
    skill: "/describe_sources",
    state: "current",
    shouldConfirm: true,
    artifactPath: "10_Library/<Source Index>.json",
    message: "<script>alert(1)</script>",
  }, escapeHtml);

  assert.match(html, /&lt;Source Index&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("rerun confirmation is fail-safe when advice API is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const buttons = {
    rerunConfirmCancel: fakeButton(),
    rerunConfirmRun: fakeButton(),
  };
  const statusCalls = [];
  const editorContent = { innerHTML: "" };

  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "status API down" }),
  });
  globalThis.document = {
    getElementById: (id) => buttons[id] || null,
  };

  try {
    const promise = confirmCurrentArtifactRerun({
      ctx: {
        elements: {
          breadcrumbs: { textContent: "" },
          editorContent,
        },
        setActivityActive: () => {},
        setStatus: (status) => statusCalls.push(status),
      },
      skill: "/describe_sources",
      escapeHtml,
      title: "/describe_sources — Mehta vs Skyline",
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.match(editorContent.innerHTML, /Could not confirm whether \/describe_sources/);
    assert.equal(statusCalls.at(-1).bar, "Rerun Confirmation");
    buttons.rerunConfirmCancel.click();
    assert.equal(await promise, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});

test("rerun confirmation allows run without UI when artifact is missing or stale", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const editorContent = { innerHTML: "" };

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      skill: "/create_listofdates",
      state: "missing",
      shouldConfirm: false,
    }),
  });
  globalThis.document = {
    getElementById: () => {
      throw new Error("document lookup should not be needed");
    },
  };

  try {
    const result = await confirmCurrentArtifactRerun({
      ctx: {
        elements: {
          breadcrumbs: { textContent: "" },
          editorContent,
        },
        setActivityActive: () => {},
        setStatus: () => {},
      },
      skill: "/create_listofdates",
      escapeHtml,
    });

    assert.equal(result, true);
    assert.equal(editorContent.innerHTML, "");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});

function fakeButton() {
  const listeners = new Map();
  return {
    focusCalled: false,
    focus() {
      this.focusCalled = true;
    },
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    click() {
      listeners.get("click")?.();
    },
  };
}
