import assert from "node:assert/strict";
import test from "node:test";
import { renderConfigurableSkillImprovementPromptHtml } from "../frontend/configurable-skill-run-ui.js";

test("configurable skill improvement prompt explains non-running revision and escapes fields", () => {
  const html = renderConfigurableSkillImprovementPromptHtml({
    slash: "/party_<map>",
    artifactPath: "20_Workshop/Party & Officer Map.md",
  });

  assert.match(html, /Improve this skill/);
  assert.match(html, /non-running revision idea/);
  assert.match(html, /does not modify the active skill yet/);
  assert.match(html, /\/party_&lt;map&gt;/);
  assert.match(html, /20_Workshop\/Party &amp; Officer Map\.md/);
  assert.match(html, /data-configurable-skill-action="cancel"/);
});
