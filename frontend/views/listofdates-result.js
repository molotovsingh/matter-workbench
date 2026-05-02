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
  const outputActions = renderOutputActions(outputPaths, escapeHtml);
  const rows = entries.length
    ? entries.map((entry) => `
      <tr>
        <td><time datetime="${escapeHtml(entry.date_iso || "")}">${escapeHtml(entry.date_iso || "")}</time><br /><span class="muted">${escapeHtml(entry.date_text || "")}</span></td>
        <td>
          ${escapeHtml(entry.event || "")}
          ${entry.event_type ? `<br /><span class="muted">${escapeHtml(entry.event_type)}</span>` : ""}
        </td>
        <td>${escapeHtml(entry.legal_relevance || "")}</td>
        <td>${renderSourceCell(entry, escapeHtml)}</td>
        <td><span class="cluster-pill">${escapeHtml(clusterLabel(entry.cluster_type))}</span></td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">No cited date events were accepted from the AI response.</td></tr>`;

  return `
    <h1>/create_listofdates result</h1>
    <p>
      Generated from extraction records.
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
        <dt>Filtered blocks</dt>
        <dd>${counts.blocksFiltered || 0}</dd>
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
        <dt>Accepted events</dt>
        <dd>${counts.acceptedEntries ?? counts.entries ?? 0}</dd>
      </div>
      <div>
        <dt>Rendered rows</dt>
        <dd>${counts.entries || 0}</dd>
      </div>
      <div>
        <dt>Clustered events</dt>
        <dd>${counts.clusteredEntries || 0}</dd>
      </div>
      <div>
        <dt>Rejected</dt>
        <dd>${counts.rejectedEntries || 0}</dd>
      </div>
    </dl>
    <h2>Outputs</h2>
    ${outputActions || "<p>No shareable files written.</p>"}
    <h2>Chronology</h2>
    <div class="table-scroll">
      <table class="extract-table listofdates-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Event</th>
            <th>Legal Relevance</th>
            <th>Source</th>
            <th>Cluster</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function listOfDatesRawFileUrl(filePath) {
  return `/api/file-raw?path=${encodeURIComponent(String(filePath || ""))}`;
}

function renderOutputActions(outputPaths, escapeHtml) {
  const markdownPath = outputPaths.markdown || "";
  const csvPath = outputPaths.csv || "";
  if (!markdownPath && !csvPath) return "";
  return `
    <div class="form-actions listofdates-output-actions">
      ${markdownPath ? `<button type="button" class="run-skill-button" id="copyListOfDatesMarkdown" data-path="${escapeHtml(markdownPath)}">Copy Markdown</button>` : ""}
      ${markdownPath ? `<a class="run-skill-button secondary" href="${escapeHtml(listOfDatesRawFileUrl(markdownPath))}" download="${escapeHtml(downloadName(markdownPath))}">Download Markdown</a>` : ""}
      ${csvPath ? `<a class="run-skill-button secondary" href="${escapeHtml(listOfDatesRawFileUrl(csvPath))}" download="${escapeHtml(downloadName(csvPath))}">Download CSV</a>` : ""}
      <span class="listofdates-copy-status" id="listOfDatesCopyStatus" role="status" aria-live="polite"></span>
    </div>
  `;
}

function downloadName(filePath) {
  return String(filePath || "").split(/[\\/]/).pop() || "download";
}

function renderSourceCell(entry, escapeHtml) {
  const sources = Array.isArray(entry.supporting_sources) && entry.supporting_sources.length
    ? entry.supporting_sources
    : [entry];
  return `
    <div class="source-stack">
      ${sources.map((source) => {
        const label = source.source_label || source.original_name || source.source_path || "Source";
        return `
          <span class="source-stack-item">
            ${escapeHtml(label)}
            ${source.citation ? `<br /><code>${escapeHtml(source.citation)}</code>` : ""}
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function clusterLabel(clusterType) {
  return String(clusterType || "single_event").replace(/_/g, " ");
}
