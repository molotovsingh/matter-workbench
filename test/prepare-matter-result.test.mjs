import assert from "node:assert/strict";
import test from "node:test";
import {
  renderPrepareMatterHtml,
  renderPreparePaidConfirmationHtml,
} from "../frontend/views/prepare-matter-result.js";

test("prepare matter result uses lawyer-facing status labels", () => {
  const html = renderPrepareMatterHtml({
    matter: { name: "Ayesha Vs Japan Airlines" },
    nextStep: { stage: "describe_sources", message: "Label sources before creating downstream work products." },
    metadata: { complete: true, missing: [] },
    stages: [
      {
        id: "matter-init",
        slash: "/matter-init",
        label: "Set up matter",
        state: "current",
        action: "skip_current",
        artifacts: ["matter.json"],
      },
      {
        id: "describe_sources",
        slash: "/describe_sources",
        label: "Label sources",
        state: "stale",
        action: "confirm_paid_run",
        artifacts: [],
      },
      {
        id: "extract",
        slash: "/extract",
        label: "Extract documents",
        state: "failed",
        artifacts: [],
      },
    ],
  });

  assert.match(html, /Prepare matter/);
  assert.match(html, /Preparation steps/);
  assert.match(html, /Already done/);
  assert.match(html, /Needs approval/);
  assert.match(html, /Needs attention/);
  assert.match(html, /No saved output found/);
  assert.match(html, /Set Up Matter/);
  assert.match(html, /Label Sources/);
  assert.doesNotMatch(html, /\/describe_sources/);
  assert.doesNotMatch(html, /Current - skipped/);
  assert.doesNotMatch(html, />Stale</);
  assert.doesNotMatch(html, /Needs rerun/);
  assert.doesNotMatch(html, /No artifact found/);
});

test("prepare matter paid confirmation uses friendly status wording", () => {
  const html = renderPreparePaidConfirmationHtml({
    label: "Label sources",
    slash: "/describe_sources",
    state: "missing",
    action: "confirm_paid_run",
    rerunAdvice: {
      artifactPath: "10_Library/Source Index.json",
      provider: "openai-direct",
      model: "gpt-5.4",
    },
  });

  assert.match(html, /Status:<\/strong> Needs approval/);
  assert.match(html, /Saved record:<\/strong> Source Labels record/);
  assert.match(html, /Provider \/ model:<\/strong> openai-direct \/ gpt-5\.4/);
  assert.doesNotMatch(html, /State:<\/strong>/);
  assert.doesNotMatch(html, /Stage:<\/strong>/);
});
