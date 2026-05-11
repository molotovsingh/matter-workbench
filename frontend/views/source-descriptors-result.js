export function sourceDescriptorsSummary(result) {
  const counts = result.counts || {};
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const warningsCount = sources.reduce((total, source) => (
    total + (Array.isArray(source.warnings) ? source.warnings.length : 0)
  ), 0);
  const needsReviewCount = sources.filter((source) => source.needs_review).length;
  return {
    aiRun: result.aiRun || {},
    counts,
    needsReviewCount,
    outputPaths: result.outputPaths || {},
    sources,
    warningsCount,
  };
}

export function renderSourceDescriptorsResultHtml(result, escapeHtml) {
  const {
    aiRun,
    counts,
    needsReviewCount,
    outputPaths,
    sources,
    warningsCount,
  } = sourceDescriptorsSummary(result);
  const provider = aiRun.provider || "unknown";
  const model = aiRun.returnedModel || aiRun.model || "";
  const providerDetail = aiRun.returnedProvider ? ` via ${aiRun.returnedProvider}` : "";
  const sourceRows = sources.length
    ? sources.slice(0, 12).map((source) => `
      <tr>
        <td><code>${escapeHtml(source.file_id || "")}</code></td>
        <td>${escapeHtml(source.short_label || source.display_label || "")}</td>
        <td>${escapeHtml(source.document_type || "")}</td>
        <td>${source.needs_review ? "Yes" : "No"}</td>
        <td>${Array.isArray(source.warnings) ? source.warnings.length : 0}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">No source descriptors were written.</td></tr>`;
  const moreSources = sources.length > 12
    ? `<p class="muted">Showing 12 of ${sources.length} source descriptors.</p>`
    : "";

  return `
    <h1>/describe_sources result</h1>
    <p>
      Source descriptors were generated from extraction records and written as a source index for downstream chronology labels.
    </p>
    <dl class="skill-contract">
      <div>
        <dt>Records read</dt>
        <dd>${counts.recordsRead || 0}</dd>
      </div>
      <div>
        <dt>Sources described</dt>
        <dd>${counts.descriptors || sources.length || 0}</dd>
      </div>
      <div>
        <dt>Provider</dt>
        <dd>${escapeHtml(provider)}${providerDetail ? `<br /><span class="muted">${escapeHtml(providerDetail)}</span>` : ""}</dd>
      </div>
      <div>
        <dt>Model</dt>
        <dd>${model ? `<code>${escapeHtml(model)}</code>` : '<span class="muted">Not reported</span>'}</dd>
      </div>
      <div>
        <dt>Warnings</dt>
        <dd>${warningsCount}</dd>
      </div>
      <div>
        <dt>Needs review</dt>
        <dd>${needsReviewCount}</dd>
      </div>
    </dl>
    <h2>Output</h2>
    <p>${outputPaths.json ? `<code>${escapeHtml(outputPaths.json)}</code>` : "No Source Index written."}</p>
    <h2>Sources</h2>
    ${moreSources}
    <div class="table-scroll">
      <table class="extract-table source-descriptors-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Label</th>
            <th>Type</th>
            <th>Review</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>${sourceRows}</tbody>
      </table>
    </div>
  `;
}
