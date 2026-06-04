import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMatterContext } from "../services/configurable-skill-context.mjs";

test("configurable skill context compacts library artifacts instead of passing full chronology payloads", () => {
  const longMarkdown = [
    "# List of Dates",
    "",
    "This verbose chronology text should not be sent wholesale to custom skill runs.",
    "x".repeat(12_000),
  ].join("\n");
  const entries = Array.from({ length: 60 }, (_, index) => ({
    date_iso: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
    date_text: `May ${index + 1}, 2026`,
    event: `Event ${index + 1} ` + "e".repeat(1_200),
    legal_relevance: `Relevance ${index + 1} ` + "r".repeat(1_000),
    source_excerpt: `Excerpt ${index + 1} ` + "s".repeat(1_000),
    supporting_sources: [
      {
        citation: "FILE-0001 p1.b1",
        source_label: "Long source label",
        source_short_label: "Source 1",
        event: "Nested supporting-source event " + "n".repeat(800),
      },
    ],
    issue_tags: ["limitation", "forum"],
    citation: "FILE-0001 p1.b1",
    source_label: "Source Label",
    source_short_label: "Source 1",
  }));

  const summary = summarizeMatterContext({
    schema_version: "matter-context/v1",
    matter: { matterName: "Techbeliever Vs GST" },
    limits: { omitted_blocks: 5000 },
    sources: [],
    evidence_blocks: [],
    library_artifacts: [
      {
        path: "10_Library/List of Dates.json",
        kind: "list_of_dates",
        summary: "60 accepted chronology entries",
        entry_count: entries.length,
        entries_included: entries.length,
        entries_omitted: 0,
        entries,
        generated_at: "2026-06-04T12:00:00.000Z",
        ai_run: {
          provider: "openrouter",
          model: "openai/gpt-4.1",
          task: "create_listofdates",
          policyPromptVersion: "legal-workbench-policy/v1",
          usage: { input_tokens: 10_000 },
        },
      },
      {
        path: "10_Library/List of Dates.md",
        kind: "list_of_dates_markdown",
        heading: "List of Dates",
        markdown: longMarkdown,
        markdown_truncated: true,
        char_count: longMarkdown.length,
        line_count: 4,
      },
    ],
    warnings: [],
  });

  const listArtifact = summary.library_artifacts.find((artifact) => artifact.kind === "list_of_dates");
  assert.ok(listArtifact, "expected a compact List of Dates artifact");
  assert.equal(listArtifact.entry_count, 60);
  assert.equal(listArtifact.entries_included, 40);
  assert.equal(listArtifact.entries_omitted, 20);
  assert.equal(listArtifact.entries.length, 40);
  assert.equal(listArtifact.entries[0].source_excerpt, undefined);
  assert.equal(listArtifact.entries[0].supporting_sources, undefined);
  assert.ok(listArtifact.entries[0].event.length <= 360);
  assert.ok(listArtifact.entries[0].legal_relevance.length <= 360);
  assert.deepEqual(listArtifact.ai_run, {
    provider: "openrouter",
    model: "openai/gpt-4.1",
    task: "create_listofdates",
    policyPromptVersion: "legal-workbench-policy/v1",
  });

  const markdownArtifact = summary.library_artifacts.find((artifact) => artifact.kind === "list_of_dates_markdown");
  assert.ok(markdownArtifact, "expected markdown artifact metadata");
  assert.equal(markdownArtifact.markdown, undefined);
  assert.equal(markdownArtifact.markdown_available, true);
  assert.equal(markdownArtifact.char_count, longMarkdown.length);
  assert.equal(JSON.stringify(summary).includes(longMarkdown.slice(0, 1000)), false);
  assert.ok(JSON.stringify(summary).length < 45_000);
});
