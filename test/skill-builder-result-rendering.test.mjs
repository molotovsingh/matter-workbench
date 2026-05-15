import assert from "node:assert/strict";
import test from "node:test";
import {
  renderCreatedSkillCommandRailHtml,
  renderSkillReadyHtml,
  renderSkillSampleOutputHtml,
} from "../frontend/skill-builder-result-rendering.js";

test("skill builder result rendering escapes ready skill metadata", () => {
  const html = renderSkillReadyHtml({
    title: "Party <Map>",
    slash: "/party_officer_map",
    status: "active",
    outputArtifact: "20_Workshop/Party & Officer Map.md",
    targetLane: "20_Workshop",
    version: 2,
  });

  assert.match(html, /Skill Ready/);
  assert.match(html, /Party &lt;Map&gt;/);
  assert.match(html, /\/party_officer_map/);
  assert.match(html, /20_Workshop\/Party &amp; Officer Map\.md/);
  assert.match(html, /<dt>Version<\/dt><dd>2<\/dd>/);
});

test("created skill command rail rendering keeps run actions available", () => {
  const html = renderCreatedSkillCommandRailHtml({
    title: "Party and Officer Map",
    slash: "/party_officer_map",
    outputArtifact: "20_Workshop/Party and Officer Map.md",
  });

  assert.match(html, /Skill Ready/);
  assert.match(html, /data-created-skill-action="run"/);
  assert.match(html, /data-created-skill-action="open-skills"/);
  assert.match(html, /data-created-skill-action="start-another"/);
});

test("skill sample output rendering keeps sample non-runnable and escapes markdown body", () => {
  const html = renderSkillSampleOutputHtml({
    version: 1,
    state: "approved_current",
    sample_markdown: "# Sample\n\n<script>bad()</script>",
    matter: {
      matter_name: "Demo Matter",
    },
    ai_run: {
      provider: "openai-direct",
      model: "gpt-5.4",
    },
  }, {
    version: 1,
    approved: true,
    sampleReview: {
      samples: [],
      ledger: [],
    },
  });

  assert.match(html, /Review sample only/);
  assert.match(html, /Sample v1 - approved/);
  assert.match(html, /openai-direct \/ gpt-5\.4/);
  assert.match(html, /Demo Matter/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
});
