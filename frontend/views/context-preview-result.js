import { redactSensitiveText } from "../secret-redaction.js";

export function contextPreviewSummary(result = {}) {
  return {
    counts: result.counts || {},
    generatedAt: result.generated_at || "",
    libraryArtifacts: Array.isArray(result.library_artifacts) ? result.library_artifacts : [],
    limits: result.limits || {},
    matter: result.matter || {},
    sourceIndexPresent: Boolean(result.source_index_present),
    topSources: Array.isArray(result.top_sources) ? result.top_sources : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export function renderContextPreviewResultHtml(result, escapeHtml) {
  const {
    counts,
    generatedAt,
    libraryArtifacts,
    limits,
    matter,
    sourceIndexPresent,
    topSources,
    warnings,
  } = contextPreviewSummary(result);

  const sourceRows = topSources.length
    ? topSources.map((source) => `
      <tr>
        <td><code>${escapeHtml(source.file_id || "")}</code></td>
        <td>${escapeHtml(source.source_short_label || source.source_label || "Unlabelled source")}</td>
        <td>${escapeHtml(source.document_type || "")}</td>
        <td>${Array.isArray(source.sample_citations) && source.sample_citations.length
          ? source.sample_citations.map((citation) => `<code>${escapeHtml(citation)}</code>`).join(" ")
          : '<span class="muted">No sampled citation</span>'}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="4">No sources are available in the context packet.</td></tr>';

  const artifactRows = libraryArtifacts.length
    ? libraryArtifacts.map((artifact) => `
      <tr>
        <td><code>${escapeHtml(artifact.path || "")}</code></td>
        <td>${escapeHtml(artifact.kind || "")}</td>
        <td>${escapeHtml(artifact.summary || "")}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="3">No selected library artifacts found.</td></tr>';

  const warningList = warnings.length
    ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : '<p class="muted">No context warnings.</p>';

  return `
    <h1>Context Preview</h1>
    <p>This is a read-only preview of the evidence boundary future Q&amp;A/search would use. It does not call an AI provider and does not show raw source text.</p>
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
        <dt>Sources</dt>
        <dd>${counts.sources || 0}</dd>
      </div>
      <div>
        <dt>Evidence blocks</dt>
        <dd>${counts.evidence_blocks_included || 0} included${counts.evidence_blocks_omitted ? `, ${counts.evidence_blocks_omitted} omitted` : ""}</dd>
      </div>
      <div>
        <dt>Library artifacts</dt>
        <dd>${counts.library_artifacts || 0}</dd>
      </div>
      <div>
        <dt>Source Labels</dt>
        <dd>${sourceIndexPresent ? "Present" : "Missing"}</dd>
      </div>
      <div>
        <dt>Block cap</dt>
        <dd>${limits.max_blocks ?? ""}</dd>
      </div>
      <div>
        <dt>Generated</dt>
        <dd>${escapeHtml(generatedAt || "Not reported")}</dd>
      </div>
    </dl>
    <div class="form-actions">
      <button type="button" class="run-skill-button" id="copyContextReportButton">Copy Context Report</button>
    </div>
    <h2>Warnings</h2>
    ${warningList}
    <h2>Top Sources</h2>
    <div class="table-scroll">
      <table class="extract-table context-preview-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Source Label</th>
            <th>Type</th>
            <th>Sample Citations</th>
          </tr>
        </thead>
        <tbody>${sourceRows}</tbody>
      </table>
    </div>
    <h2>Library Artifacts</h2>
    <div class="table-scroll">
      <table class="extract-table context-preview-artifacts-table">
        <thead>
          <tr>
            <th>Path</th>
            <th>Kind</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>${artifactRows}</tbody>
      </table>
    </div>
  `;
}

export function formatContextReport(result = {}) {
  const {
    counts,
    generatedAt,
    libraryArtifacts,
    limits,
    matter,
    sourceIndexPresent,
    topSources,
    warnings,
  } = contextPreviewSummary(result);

  const lines = [
    "# Matter Context Report",
    "",
    `- Matter: ${redactSensitiveText(matter.matter_name || matter.folder_name || "Unknown matter")}`,
    `- Matter folder: ${redactSensitiveText(matter.folder_name || "Unknown")}`,
    `- Generated: ${redactSensitiveText(generatedAt || "Not reported")}`,
    `- Sources: ${counts.sources || 0}`,
    `- Evidence blocks: ${counts.evidence_blocks_included || 0} included, ${counts.evidence_blocks_omitted || 0} omitted`,
    `- Source Labels: ${sourceIndexPresent ? "present" : "missing"}`,
    `- Block cap: ${limits.max_blocks ?? ""}`,
    `- Library artifacts: ${counts.library_artifacts || 0}`,
  ];

  if (warnings.length) {
    lines.push("", "## Warnings", "");
    for (const warning of warnings) lines.push(`- ${redactSensitiveText(warning)}`);
  }

  if (topSources.length) {
    lines.push("", "## Top Sources", "");
    for (const source of topSources.slice(0, 12)) {
      const label = source.source_short_label || source.source_label || "Unlabelled source";
      const citations = Array.isArray(source.sample_citations) && source.sample_citations.length
        ? ` (${source.sample_citations.join(", ")})`
        : "";
      lines.push(`- ${redactSensitiveText(source.file_id)}: ${redactSensitiveText(label)}${redactSensitiveText(citations)}`);
    }
  }

  if (libraryArtifacts.length) {
    lines.push("", "## Library Artifacts", "");
    for (const artifact of libraryArtifacts) {
      lines.push(`- ${redactSensitiveText(artifact.path)}: ${redactSensitiveText(artifact.summary || artifact.kind || "")}`);
    }
  }

  return lines.join("\n");
}
