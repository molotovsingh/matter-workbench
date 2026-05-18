import { getJson } from "./api-client.js";
import { RERUN_ADVICE_STATES } from "../shared/rerun-advice-states.mjs";

export async function confirmCurrentArtifactRerun({
  ctx,
  skill,
  escapeHtml = defaultEscapeHtml,
  title = "Review before regenerating",
  confirmLabel = "Regenerate anyway",
  cancelLabel = "Keep current",
  extraActions = [],
}) {
  let advice = null;
  try {
    advice = await getJson(`/api/rerun-advice?skill=${encodeURIComponent(skill)}`);
  } catch (error) {
    advice = rerunAdviceUnavailable(skill, error);
  }
  if (!advice?.shouldConfirm) return true;
  const actions = typeof extraActions === "function" ? extraActions(advice) : extraActions;
  const normalizedActions = Array.isArray(actions) ? actions : [];

  const { breadcrumbs, editorContent } = ctx.elements;
  ctx.setActivityActive("explorer");
  breadcrumbs.textContent = title;
  const statusMessage = advice.state === RERUN_ADVICE_STATES.UNKNOWN
    ? "Rerun status could not be checked."
    : `${escapeHtml(advice.skill || skill)} already has a current output document.`;
  ctx.setStatus({
    mood: "idle",
    card: `<strong>Review before regenerating</strong><br />${statusMessage}`,
    bar: "Review Current Artifact",
    terminal: `${terminalPrefix(skill)} rerun confirmation shown`,
  });
  editorContent.innerHTML = renderRerunConfirmationHtml(advice, escapeHtml, {
    title,
    confirmLabel,
    cancelLabel,
    extraActions: normalizedActions,
  });

  return new Promise((resolve) => {
    const runButton = document.getElementById("rerunConfirmRun");
    const cancelButton = document.getElementById("rerunConfirmCancel");
    if (!runButton || !cancelButton) {
      resolve(false);
      return;
    }
    cancelButton.focus?.();
    for (const action of normalizedActions) {
      const actionButton = document.getElementById(actionButtonId(action.id));
      if (actionButton) {
        actionButton.addEventListener("click", () => resolve(action.id), { once: true });
      }
    }
    runButton.addEventListener("click", () => resolve(true), { once: true });
    cancelButton.addEventListener("click", () => resolve(false), { once: true });
  });
}

export function renderRerunConfirmationHtml(advice, escapeHtml = defaultEscapeHtml, options = {}) {
  const {
    title = "Review before regenerating",
    confirmLabel = "Regenerate anyway",
    cancelLabel = "Keep current",
    extraActions = [],
  } = options;
  const heading = advice.state === RERUN_ADVICE_STATES.UNKNOWN ? "Could not verify current output" : "Review current output before regenerating";
  const skill = advice.skill || "This skill";
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(" / ");
  const details = [
    ["Skill", skill, true],
    ["Output document", advice.artifactPath || "Unknown", true],
    ["Last run", advice.lastRunAt || "Unknown", false],
    ["Provider / model", providerModel || "Unknown", false],
    ["State", advice.state || RERUN_ADVICE_STATES.CURRENT, false],
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
      <p>Regenerating can start a paid AI provider call and may replace the output document. Keeping current leaves the existing output unchanged.</p>
      <div class="warning-actions">
        <button type="button" id="rerunConfirmCancel">${escapeHtml(cancelLabel)}</button>
        ${extraActions.map((action) => `
          <button type="button" class="secondary" id="${escapeHtml(actionButtonId(action.id))}">${escapeHtml(action.label)}</button>
        `).join("")}
        <button type="button" class="secondary" id="rerunConfirmRun">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;
}

export function fallbackRerunMessage(advice) {
  const lines = [
    `${advice.skill || "This skill"} already has a current work product.`,
  ];
  if (advice.artifactPath) lines.push(`Output document: ${advice.artifactPath}`);
  if (advice.lastRunAt) lines.push(`Last run: ${advice.lastRunAt}`);
  if (advice.model || advice.provider) {
    lines.push(`Provider/model: ${[advice.provider, advice.model].filter(Boolean).join(" / ")}`);
  }
  lines.push("Regenerate it anyway?");
  return lines.join("\n");
}

function rerunAdviceUnavailable(skill, error) {
  return {
    skill,
    state: RERUN_ADVICE_STATES.UNKNOWN,
    shouldConfirm: true,
    artifactPath: "",
    message: [
      `Could not confirm whether ${skill} has a current work product.`,
      `The rerun check failed${error?.message ? `: ${error.message}` : "."}`,
      "Keep current unless you deliberately want to regenerate.",
    ].join("\n"),
  };
}

function terminalPrefix(skill) {
  return skill === "/describe_sources" ? "[source-index]" : "[listofdates]";
}

function actionButtonId(id) {
  return `rerunAction${String(id || "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
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
