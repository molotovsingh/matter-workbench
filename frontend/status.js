import { escapeHtml } from "./dom-utils.js";
import { createActivityLogStore } from "./activity-log-store.js";

const COMPACT_ACTIVITY_LINE_CAP = 3;

export function createStatusController({
  terminalOutput,
  statusBarRight,
  aiCommandActivityStrip,
  activityLogStore = createActivityLogStore(),
}) {
  function appendTerminal(lines) {
    const trimmed = activityLogStore.append(lines);
    if (terminalOutput) {
      terminalOutput.textContent = trimmed.join("\n");
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
    renderCommandActivityStrip(trimmed);
  }

  function setStatus({ bar, terminal } = {}) {
    if (bar !== undefined && statusBarRight) statusBarRight.innerHTML = `<span>${escapeHtml(bar)}</span>`;
    if (terminal !== undefined) appendTerminal(terminal);
  }

  function getActivityLogLines(options = {}) {
    return activityLogStore.getLines(options);
  }

  function getActivityLogText() {
    return activityLogStore.getText();
  }

  function renderCommandActivityStrip(lines) {
    if (!aiCommandActivityStrip) return;
    const compactRows = lines
      .map(formatCompactActivityLine)
      .filter(Boolean)
      .slice(-COMPACT_ACTIVITY_LINE_CAP);

    if (!compactRows.length) {
      aiCommandActivityStrip.hidden = true;
      aiCommandActivityStrip.innerHTML = "";
      return;
    }

    aiCommandActivityStrip.hidden = false;
    aiCommandActivityStrip.innerHTML = `
      <div class="command-activity-title">Recent activity</div>
      ${compactRows.map((row) => `
        <div class="command-activity-row">
          <time>${escapeHtml(row.time)}</time>
          <span>${escapeHtml(row.message)}</span>
        </div>
      `).join("")}
    `;
  }

  return {
    activityLogStore,
    appendTerminal,
    getActivityLogLines,
    getActivityLogText,
    setStatus,
  };
}

export function formatCompactActivityLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}:\d{2})(?::\d{2})?\s+(.+)$/);
  const time = match ? match[1].padStart(5, "0") : "";
  const body = match ? match[2] : raw;
  const message = body
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s+->\s+/g, " → ")
    .replace(/\s+/g, " ")
    .trim();
  if (!message) return null;
  return { time, message };
}
