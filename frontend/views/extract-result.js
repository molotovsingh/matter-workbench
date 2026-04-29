export function attentionRowsForExtract(result) {
  return (result.fileResults || []).filter((row) => (
    row.status === "failed"
    || row.status === "ocr-required-all"
    || String(row.status || "").startsWith("skipped-")
  ));
}

export function extractSummary(result) {
  const counts = result.counts || {};
  return {
    counts,
    totalSkipped: (counts.skippedDuplicate || 0) + (counts.skippedUnsupported || 0),
  };
}

export function renderExtractResultHtml(result, escapeHtml) {
  const { counts, totalSkipped } = extractSummary(result);
  const perIntake = result.perIntake || [];
  const attentionRows = attentionRowsForExtract(result);

  const intakeRows = perIntake.length
    ? perIntake.map((row) => `
      <tr>
        <td>${escapeHtml(row.intake_id)}</td>
        <td>${row.extracted}</td>
        <td>${row.cached}</td>
        <td>${row.skipped}</td>
        <td>${row.failed}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">No intake rows processed.</td></tr>`;

  const attentionTable = attentionRows.length
    ? `
      <h2>Skipped / review files</h2>
      <table class="extract-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Category</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${attentionRows.map((row) => `
            <tr>
              <td><code>${escapeHtml(row.file_id)}</code><br />${escapeHtml(row.original_name || row.source_path || "")}</td>
              <td>${escapeHtml(row.category || "")}</td>
              <td>${escapeHtml(row.status || "")}</td>
              <td>${escapeHtml(row.notes || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `
      <h2>Skipped / review files</h2>
      <p>No skipped, failed, or OCR-required files in this run.</p>
    `;

  return `
    <h1>/extract result</h1>
    <p>
      Searchable text was generated from working copies in the matter inbox.
      The underlying extraction records are kept as system files for search, citations, and audit checks.
    </p>
    <dl class="skill-contract">
      <div>
        <dt>Total files</dt>
        <dd>${counts.totalFiles || 0}</dd>
      </div>
      <div>
        <dt>Extracted</dt>
        <dd>${counts.extracted || 0}</dd>
      </div>
      <div>
        <dt>Cached</dt>
        <dd>${counts.cached || 0}</dd>
      </div>
      <div>
        <dt>Skipped</dt>
        <dd>${totalSkipped} (${counts.skippedUnsupported || 0} unsupported, ${counts.skippedDuplicate || 0} duplicate)</dd>
      </div>
      <div>
        <dt>OCR required</dt>
        <dd>${counts.ocrRequiredFiles || 0}</dd>
      </div>
      <div>
        <dt>Failed</dt>
        <dd>${counts.failed || 0}</dd>
      </div>
    </dl>
    <h2>Intakes</h2>
    <table class="extract-table">
      <thead>
        <tr>
          <th>Intake</th>
          <th>Extracted</th>
          <th>Cached</th>
          <th>Skipped</th>
          <th>Failed</th>
        </tr>
      </thead>
      <tbody>${intakeRows}</tbody>
    </table>
    ${attentionTable}
  `;
}
