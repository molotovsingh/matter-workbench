import { getJson } from "./api-client.js";

export async function confirmCurrentArtifactRerun({
  ctx,
  skill,
  escapeHtml = defaultEscapeHtml,
  title = "Confirm rerun",
  confirmLabel = "Run anyway",
  cancelLabel = "Cancel",
}) {
  let advice = null;
  try {
    advice = await getJson(`/api/rerun-advice?skill=${encodeURIComponent(skill)}`);
  } catch (error) {
    advice = rerunAdviceUnavailable(skill, error);
  }
  if (!advice?.shouldConfirm) return true;

  const { breadcrumbs, editorContent } = ctx.elements;
  ctx.setActivityActive("explorer");
  breadcrumbs.textContent = title;
  const statusMessage = advice.state === "unknown"
    ? "Rerun status could not be checked."
    : `${escapeHtml(advice.skill || skill)} already has a current artifact.`;
  ctx.setStatus({
    mood: "idle",
    card: `<strong>Confirm rerun</strong><br />${statusMessage}`,
    bar: "Rerun Confirmation",
    terminal: `${terminalPrefix(skill)} rerun confirmation shown`,
  });
  editorContent.innerHTML = renderRerunConfirmationHtml(advice, escapeHtml, {
    title,
    confirmLabel,
    cancelLabel,
  });

  return new Promise((resolve) => {
    const runButton = document.getElementById("rerunConfirmRun");
    const cancelButton = document.getElementById("rerunConfirmCancel");
    if (!runButton || !cancelButton) {
      resolve(false);
      return;
    }
    cancelButton.focus?.();
    runButton.addEventListener("click", () => resolve(true), { once: true });
    cancelButton.addEventListener("click", () => resolve(false), { once: true });
  });
}

export function renderRerunConfirmationHtml(advice, escapeHtml = defaultEscapeHtml, options = {}) {
  const {
    title = "Confirm rerun",
    confirmLabel = "Run anyway",
    cancelLabel = "Cancel",
  } = options;
  const heading = advice.state === "unknown" ? "Rerun confirmation needed" : "Existing artifact is current";
  const skill = advice.skill || "This skill";
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(" / ");
  const details = [
    ["Skill", skill, true],
    ["Artifact", advice.artifactPath || "Unknown", true],
    ["Last run", advice.lastRunAt || "Unknown", false],
    ["Provider / model", providerModel || "Unknown", false],
    ["State", advice.state || "current", false],
  ];

  return `
    <h1>${escapeHtml(title)}</h1>
    <div class="form-warning" role="alertdialog" aria-labelledby="rerunConfirmTitle">
      <h2 id="rerunConfirmTitle">${escapeHtml(heading)}</h2>
      <p>${escapeHtml(advice.message || fallbackRerunMessage(advice)).replace(/\n/g, "<br />")}</p>
      <ul class="overlap-list">
        ${details.map(([label, value, code]) => `
          <li><strong>${escapeHtml(label)}:</strong> ${code ? `<code>${escapeHtml(value)}</code>` : escapeHtml(value)}</li>
        `).join("")}
      </ul>
      <p>This can start a paid AI provider call. Cancel leaves the existing artifact unchanged.</p>
      <div class="warning-actions">
        <button type="button" id="rerunConfirmCancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="secondary" id="rerunConfirmRun">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;
}

export function fallbackRerunMessage(advice) {
  const lines = [
    `${advice.skill || "This skill"} already has a current artifact.`,
  ];
  if (advice.artifactPath) lines.push(`Artifact: ${advice.artifactPath}`);
  if (advice.lastRunAt) lines.push(`Last run: ${advice.lastRunAt}`);
  if (advice.model || advice.provider) {
    lines.push(`Provider/model: ${[advice.provider, advice.model].filter(Boolean).join(" / ")}`);
  }
  lines.push("Run it again anyway?");
  return lines.join("\n");
}

function rerunAdviceUnavailable(skill, error) {
  return {
    skill,
    state: "unknown",
    shouldConfirm: true,
    artifactPath: "",
    message: [
      `Could not confirm whether ${skill} has a current artifact.`,
      `The rerun check failed${error?.message ? `: ${error.message}` : "."}`,
      "Run it anyway?",
    ].join("\n"),
  };
}

function terminalPrefix(skill) {
  return skill === "/describe_sources" ? "[source-index]" : "[listofdates]";
}

function defaultEscapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
