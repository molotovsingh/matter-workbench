import { redactSensitiveText } from "../secret-redaction.js";

export function contextSearchSummary(result = {}) {
  return {
    counts: result.counts || {},
    generatedAt: result.generated_at || "",
    limits: result.limits || {},
    matter: result.matter || {},
    query: result.query || "",
    results: Array.isArray(result.results) ? result.results : [],
    searchedAt: result.searched_at || "",
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export function renderContextSearchResultHtml(result, escapeHtml) {
  const {
    counts,
    generatedAt,
    limits,
    matter,
    query,
    results,
    searchedAt,
    warnings,
  } = contextSearchSummary(result);

  const rows = results.length
    ? results.map((match) => `
      <tr>
        <td>${escapeHtml(match.source_short_label || match.source_label || "Unlabelled source")}</td>
        <td><code>${escapeHtml(match.citation || "")}</code></td>
        <td>${escapeHtml(match.document_type || "")}</td>
        <td>${escapeHtml(match.snippet || "")}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="4">No context matches found.</td></tr>';

  const warningList = warnings.length
    ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : '<p class="muted">No context warnings.</p>';

  return `
    <h1>Context Search</h1>
    <p>Searches the bounded matter context packet only. It does not read raw files, call an AI provider, or write artifacts.</p>
    <dl class="skill-contract">
      <div>
        <dt>Matter</dt>
        <dd>${escapeHtml(matter.matter_name || matter.folder_name || "Unknown matter")}</dd>
      </div>
      <div>
        <dt>Matter folder</dt>
        <dd><code>${escapeHtml(matter.folder_name || "")}</code></dd>
      </div>
      <div>
        <dt>Query</dt>
        <dd><code>${escapeHtml(query || "")}</code></dd>
      </div>
      <div>
        <dt>Matches</dt>
        <dd>${counts.matches || 0}${counts.omitted_matches ? ` shown, ${counts.omitted_matches} omitted by limit` : ""}</dd>
      </div>
      <div>
        <dt>Sources</dt>
        <dd>${counts.sources || 0}</dd>
      </div>
      <div>
        <dt>Blocks searched</dt>
        <dd>${counts.searched_blocks || 0}</dd>
      </div>
      <div>
        <dt>Result cap</dt>
        <dd>${limits.max_results ?? ""}</dd>
      </div>
      <div>
        <dt>Searched</dt>
        <dd>${escapeHtml(searchedAt || generatedAt || "Not reported")}</dd>
      </div>
    </dl>
    <div class="form-actions">
      <button type="button" class="run-skill-button" id="copyContextSearchReportButton">Copy Search Report</button>
    </div>
    <h2>Matches</h2>
    <div class="table-scroll">
      <table class="extract-table context-search-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Citation</th>
            <th>Type</th>
            <th>Snippet</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <h2>Warnings</h2>
    ${warningList}
  `;
}

export function formatContextSearchReport(result = {}) {
  const {
    counts,
    matter,
    query,
    results,
    searchedAt,
    warnings,
  } = contextSearchSummary(result);

  const lines = [
    "# Matter Context Search Report",
    "",
    `- Matter: ${redactSensitiveText(matter.matter_name || matter.folder_name || "Unknown matter")}`,
    `- Matter folder: ${redactSensitiveText(matter.folder_name || "Unknown")}`,
    `- Searched: ${redactSensitiveText(searchedAt || "Not reported")}`,
    `- Query: \`${redactSensitiveText(query || "")}\``,
    `- Matches: ${counts.matches || 0}`,
    `- Sources: ${counts.sources || 0}`,
    `- Evidence blocks searched: ${counts.searched_blocks || 0}`,
    `- Omitted matches: ${counts.omitted_matches || 0}`,
    "- Provider calls: none",
    "- Durable writes: none",
  ];

  if (warnings.length) {
    lines.push("", "## Warnings", "");
    for (const warning of warnings) lines.push(`- ${redactSensitiveText(warning)}`);
  }

  if (results.length) {
    lines.push("", "## Matches", "");
    for (const match of results.slice(0, 25)) {
      const label = match.source_short_label || match.source_label || "Unlabelled source";
      lines.push(`- ${redactSensitiveText(label)} (${redactSensitiveText(match.citation || "no citation")})`);
      if (match.snippet) lines.push(`  - Snippet: ${redactSensitiveText(match.snippet)}`);
    }
  }

  return lines.join("\n");
}
