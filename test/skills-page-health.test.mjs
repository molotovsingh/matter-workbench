import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  formatSkillFactoryHealthReport,
  renderSkillFactoryHealth,
} from "../frontend/views/skills-page-health.js";

test("skills page health renderer shows stored-record language and copy action", () => {
  const html = renderSkillFactoryHealth({
    state: "warning",
    summary: {
      ideas: 2,
      samples: 3,
      configurableSkills: 4,
      activeSkills: 1,
      errors: 0,
      warnings: 1,
    },
    checks: [
      { id: "links", label: "Samples point to existing ideas", state: "ok" },
      { id: "lanes", label: "Output lane issue <bad>", state: "warning" },
    ],
    issues: [
      { severity: "warning", message: "Stale approved sample <x>" },
    ],
  }, escapeHtml);

  assert.match(html, /Skill Factory Health/);
  assert.match(html, /Read-only check of saved ideas, samples, and stored skill records/);
  assert.match(html, /Stored custom skill records/);
  assert.match(html, /Stored active versions/);
  assert.match(html, /Output lane issue &lt;bad&gt;/);
  assert.match(html, /Stale approved sample &lt;x&gt;/);
  assert.match(html, /data-skill-factory-copy-health/);
});

test("skills page health report excludes repair or runtime claims", () => {
  const report = formatSkillFactoryHealthReport({
    state: "ok",
    checkedAt: "2026-05-15T10:00:00.000Z",
    summary: {
      ideas: 1,
      samples: 2,
      configurableSkills: 3,
      activeSkills: 1,
      errors: 0,
      warnings: 0,
    },
    checks: [
      { id: "links", label: "Samples point to existing ideas", state: "ok" },
    ],
    issues: [],
  });

  assert.match(report, /Stored custom skill records: 3/);
  assert.match(report, /Stored active versions: 1/);
  assert.match(report, /This is a read-only health report/);
  assert.doesNotMatch(report, /repair stores, call providers, generate skills, run skills, or write matter artifacts\.\n\n.+generated Markdown/s);
});

test("skills page health report redacts secrets in copied issue text", () => {
  const report = formatSkillFactoryHealthReport({
    state: "warning",
    checks: [
      { id: "links", label: "OPENAI_API_KEY=sk-check-secret", state: "warning" },
    ],
    issues: [
      { severity: "warning", message: "provider rejected Bearer sk-issue-secret" },
    ],
  });

  assert.doesNotMatch(report, /sk-check-secret|sk-issue-secret/);
  assert.match(report, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(report, /Bearer \[redacted-secret\]/);
});
