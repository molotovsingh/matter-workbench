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
    ${renderOutputPaths(outputPaths, escapeHtml)}
    ${renderOutputActions(outputPaths, escapeHtml)}
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

function renderOutputPaths(outputPaths, escapeHtml) {
  if (!outputPaths.json && !outputPaths.csv && !outputPaths.markdown) {
    return "<p>No files written.</p>";
  }

  return `
    <p>
      ${outputPaths.json ? `<code>${escapeHtml(outputPaths.json)}</code>` : ""}
      ${outputPaths.csv ? `<br /><code>${escapeHtml(outputPaths.csv)}</code>` : ""}
      ${outputPaths.markdown ? `<br /><code>${escapeHtml(outputPaths.markdown)}</code>` : ""}
    </p>
  `;
}

function renderOutputActions(outputPaths, escapeHtml) {
  if (!outputPaths.markdown) return "";
  return `
    <div class="artifact-actions" data-listofdates-artifact-actions>
      <button
        type="button"
        class="run-skill-button"
        data-listofdates-copy-markdown
        data-path="${escapeHtml(outputPaths.markdown)}"
      >
        Copy Markdown
      </button>
      ${renderDownloadLink(outputPaths.markdown, "Download Markdown", escapeHtml)}
      ${outputPaths.csv ? renderDownloadLink(outputPaths.csv, "Download CSV", escapeHtml) : ""}
      <span class="artifact-action-status muted" data-listofdates-action-status></span>
    </div>
  `;
}

function renderDownloadLink(filePath, label, escapeHtml) {
  const fileName = filePath.split("/").pop() || filePath;
  const href = `/api/file-raw?path=${encodeURIComponent(filePath)}`;
  return `
    <a
      class="run-skill-button secondary"
      href="${escapeHtml(href)}"
      download="${escapeHtml(fileName)}"
    >${escapeHtml(label)}</a>
  `;
}

function renderSourceCell(entry, escapeHtml) {
  const sources = Array.isArray(entry.supporting_sources) && entry.supporting_sources.length
    ? entry.supporting_sources
    : [entry];
  const labels = uniqueSourceLabels(sources);
  return `
    <div class="source-stack">
      ${labels.map((label) => `<span class="source-stack-item">${escapeHtml(label)}</span>`).join("")}
    </div>
  `;
}

function uniqueSourceLabels(sources = []) {
  const labels = [];
  const seen = new Set();
  for (const source of sources) {
    const label = sourceLabel(source);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels.length ? labels : ["Unlabeled source"];
}

function sourceLabel(source = {}) {
  return source.source_label
    || source.source_short_label
    || source.original_name
    || readableSourcePath(source.source_path)
    || "Unlabeled source";
}

function readableSourcePath(sourcePath = "") {
  const parts = String(sourcePath || "").split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] || "";
  return name
    .replace(/^FILE-\d{4,}__/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterLabel(clusterType) {
  return String(clusterType || "single_event").replace(/_/g, " ");
}
