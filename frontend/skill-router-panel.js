import { postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";

export function renderSkillRouterPanel(registry, loadError) {
  if (loadError) {
    return `
      <h2>Runnable skills</h2>
      <p class="form-error">Skill registry unavailable: ${escapeHtml(loadError)}</p>
    `;
  }

  const skills = Array.isArray(registry?.skills) ? registry.skills : [];
  const rows = skills.map((skill) => `
    <tr>
      <td><code>${escapeHtml(skill.slash || "")}</code></td>
      <td>${escapeHtml(skill.category || "")}</td>
      <td>${escapeHtml(skill.mode || "")}</td>
      <td>${escapeHtml(skill.purpose || "")}</td>
    </tr>
  `).join("");

  return `
    <h2>Runnable skills</h2>
    <p>These slash commands are implemented and can run in the current workbench.</p>
    <table class="extract-table skill-registry-table">
      <thead>
        <tr>
          <th>Skill</th>
          <th>Category</th>
          <th>Mode</th>
          <th>Purpose</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4">No registered skills.</td></tr>'}
      </tbody>
    </table>
    <h2>Skill router</h2>
    <p>Check proposed AI-native skills against the current registry before adding new workflow surface area.</p>
    <form class="new-matter-form skill-router-form" id="skillRouterForm">
      <label>
        <span>Proposed skill or change request</span>
        <textarea id="skillIntentRequest" placeholder="Example: Create a new skill to generate a chronology from extracted records." spellcheck="true"></textarea>
      </label>
      <label id="skillIntentOverrideLabel" hidden>
        <span>Override justification</span>
        <textarea id="skillIntentOverride" placeholder="Explain the distinct purpose, input, output, workflow stage, legal setting, or audience." spellcheck="true"></textarea>
      </label>
      <div class="form-actions">
        <button type="submit" id="skillRouterSubmit">Check proposed skill</button>
      </div>
      <div id="skillRouterError" class="form-error" hidden></div>
    </form>
    <div id="skillRouterResult" class="skill-router-result" hidden></div>
  `;
}

export function wireSkillRouterPanel() {
  const form = document.getElementById("skillRouterForm");
  if (!form) return;

  const requestInput = document.getElementById("skillIntentRequest");
  const overrideLabel = document.getElementById("skillIntentOverrideLabel");
  const overrideInput = document.getElementById("skillIntentOverride");
  const submit = document.getElementById("skillRouterSubmit");
  const errorBox = document.getElementById("skillRouterError");
  const resultBox = document.getElementById("skillRouterResult");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const userRequest = requestInput.value.trim();
    const overrideJustification = overrideInput.value.trim();
    if (!userRequest) {
      errorBox.textContent = "Proposed skill request is required.";
      errorBox.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = "Checking...";
    try {
      const decision = await postJson("/api/skills/check-intent", {
        userRequest,
        overrideJustification,
      });
      resultBox.innerHTML = renderRouterDecision(decision);
      resultBox.hidden = false;
      wireRouterGateButtons({ decision, overrideLabel, overrideInput, resultBox });
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      resultBox.hidden = true;
    } finally {
      submit.disabled = false;
      submit.textContent = "Check proposed skill";
    }
  });
}

export function renderRouterDecision(decision, options = {}) {
  const prefix = options.prefix || "skillRouter";
  const matchedSkill = decision.matched_skill || "none";
  const confidence = Number.isFinite(decision.confidence)
    ? `${Math.round(decision.confidence * 100)}%`
    : "n/a";
  const gateRequired = decision.user_gate_required ? "Yes" : "No";
  const mece = decision.mece_violation ? "Yes" : "No";
  const legalSetting = renderLegalSetting(decision.legal_setting);
  const overrideRequires = Array.isArray(decision.override_requires) && decision.override_requires.length
    ? `<ul>${decision.override_requires.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "None";
  const matchedCard = decision.matched_skill_card
    ? `<p class="form-note">Matched purpose: ${escapeHtml(decision.matched_skill_card.purpose || "")}</p>`
    : "";
  const gateActions = decision.user_gate_required ? `
    <div class="form-actions skill-router-gate-actions">
      <button type="button" id="${escapeHtml(prefix)}ApproveModification">Approve modification</button>
      <button type="button" class="secondary" id="${escapeHtml(prefix)}JustifyNew">Justify new skill</button>
    </div>
    <div id="${escapeHtml(prefix)}GateMessage" class="form-note"></div>
  ` : "";

  return `
    <h3>Router decision</h3>
    <dl class="skill-contract skill-router-contract">
      <div><dt>Decision</dt><dd>${escapeHtml(decision.decision || "")}</dd></div>
      <div><dt>Recommended action</dt><dd>${escapeHtml(decision.recommended_action || "")}</dd></div>
      <div><dt>Matched skill</dt><dd><code>${escapeHtml(matchedSkill)}</code>${matchedCard}</dd></div>
      <div><dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd></div>
      <div><dt>MECE violation</dt><dd>${escapeHtml(mece)}</dd></div>
      <div><dt>User gate</dt><dd>${escapeHtml(gateRequired)}</dd></div>
      <div><dt>Reason</dt><dd>${escapeHtml(decision.reason || "")}</dd></div>
      <div><dt>Next action</dt><dd>${escapeHtml(decision.suggested_next_action || "")}</dd></div>
      <div><dt>Legal setting</dt><dd>${legalSetting}</dd></div>
      <div><dt>Override requires</dt><dd>${overrideRequires}</dd></div>
    </dl>
    ${gateActions}
  `;
}

function renderLegalSetting(legalSetting = {}) {
  const fields = [
    ["Jurisdiction", legalSetting.jurisdiction],
    ["Forum", legalSetting.forum],
    ["Case type", legalSetting.case_type],
    ["Procedure stage", legalSetting.procedure_stage],
    ["Side", legalSetting.side],
    ["Relief type", legalSetting.relief_type],
  ].filter(([, value]) => value);

  if (!fields.length) return "Not identified";
  return fields.map(([label, value]) => `
    <span class="skill-router-chip">${escapeHtml(label)}: ${escapeHtml(value)}</span>
  `).join("");
}

export function wireRouterGateButtons({
  prefix = "skillRouter",
  decision,
  overrideLabel,
  overrideInput,
  resultBox,
  approveMessage,
}) {
  const gateMessage = document.getElementById(`${prefix}GateMessage`);
  const approveButton = document.getElementById(`${prefix}ApproveModification`);
  const justifyButton = document.getElementById(`${prefix}JustifyNew`);

  if (approveButton) {
    approveButton.addEventListener("click", () => {
      if (gateMessage) {
        gateMessage.textContent = approveMessage || (decision.matched_skill
          ? `Approved locally: treat this as a modification request for ${decision.matched_skill}.`
          : "Approved locally: treat this as a modification request.");
      }
    });
  }
  if (justifyButton) {
    justifyButton.addEventListener("click", () => {
      if (overrideLabel && overrideInput) {
        overrideLabel.hidden = false;
        overrideInput.focus();
        resultBox?.scrollIntoView({ block: "nearest" });
        if (gateMessage) gateMessage.textContent = "Add an override justification above, then run the check again.";
        return;
      }
      if (gateMessage) gateMessage.textContent = "Add a short justification in your next Unibox message.";
    });
  }
}
