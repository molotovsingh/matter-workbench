export function listOfDatesSummary(result) {
  const counts = result.counts || {};
  return {
    counts,
    entries: Array.isArray(result.entries) ? result.entries : [],
  };
}

export function renderListOfDatesResultHtml(result, escapeHtml) {
  const { counts, entries } = listOfDatesSummary(result);
  const outputPaths = result.outputPaths || {};
  const rows = entries.length
    ? entries.map((entry) => `
      <tr>
        <td><time datetime="${escapeHtml(entry.date_iso || "")}">${escapeHtml(entry.date_iso || "")}</time><br /><span class="muted">${escapeHtml(entry.date_text || "")}</span></td>
        <td>${escapeHtml(entry.event || "")}</td>
        <td><code>${escapeHtml(entry.citation || "")}</code></td>
        <td>${escapeHtml(entry.original_name || entry.source_path || "")}</td>
        <td>${entry.needs_review ? "Review" : "Ready"}</td>
        <td>${Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence).toFixed(2) : ""}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No cited date events were accepted from the AI response.</td></tr>`;

  return `
    <h1>/create_listofdates result</h1>
    <p>
      The chronology was generated from extraction records and each accepted entry is tied back to a source block citation.
    </p>
    <dl class="skill-contract">
      <div>
        <dt>Records read</dt>
        <dd>${counts.recordsRead || 0}</dd>
      </div>
      <div>
        <dt>Source blocks</dt>
        <dd>${counts.blocksSent || 0}</dd>
      </div>
      <div>
        <dt>AI requests</dt>
        <dd>${counts.aiRequests || 0}</dd>
      </div>
      <div>
        <dt>Candidates</dt>
        <dd>${counts.candidateEntries || 0}</dd>
      </div>
      <div>
        <dt>Accepted</dt>
        <dd>${counts.entries || 0}</dd>
      </div>
      <div>
        <dt>Rejected</dt>
        <dd>${counts.rejectedEntries || 0}</dd>
      </div>
    </dl>
    <h2>Outputs</h2>
    <p>
      ${outputPaths.markdown ? `<code>${escapeHtml(outputPaths.markdown)}</code>` : "No review files written."}
      ${outputPaths.csv ? `<br /><code>${escapeHtml(outputPaths.csv)}</code>` : ""}
    </p>
    <h2>Chronology</h2>
    <table class="extract-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Event</th>
          <th>Citation</th>
          <th>Source</th>
          <th>Status</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
