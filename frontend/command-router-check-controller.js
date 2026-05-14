import { escapeHtml } from "./dom-utils.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";

export function createCommandRouterCheckController({
  aiCommandSession,
  aiCommandSubmit,
  breadcrumbs,
  checkSkillIntent,
  ctx,
  editorContent,
  getLatestTerminalLines,
  getStatusBarText,
  recordCommandInteraction,
  renderCommandError,
  renderCommandRailError,
  startReport,
  updateReport,
}) {
  async function checkIntent({ userRequest, overrideJustification }) {
    if (!userRequest) {
      renderCommandError("Enter a command or future skill idea.");
      return;
    }

    startReport({
      typedInput: userRequest,
      matchedCommand: "router/check",
      status: "pending",
    });
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Checking...";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Command</strong><br />Checking this future skill idea against the current skill list.",
      bar: "Command Check",
      terminal: `[ai-command] checking intent: ${userRequest}`,
    });

    try {
      const decision = await checkSkillIntent({
        userRequest,
        overrideJustification,
      });
      renderCommandRailDecision({ userRequest, overrideJustification, decision });
      updateReport({
        status: "checked",
        routerDecision: decision.decision || "",
        routerMatchedSkill: decision.matched_skill || "",
      });
      recordCommandInteraction({
        renderedState: "router/check",
        status: "router_checked",
        routerDecision: decision,
        providerRunInvoked: true,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Router decision</strong><br />${escapeHtml(decision.decision)}${decision.matched_skill ? ` for <code>${escapeHtml(decision.matched_skill)}</code>` : ""}.`,
        bar: "Router Ready",
        terminal: `[ai-command] ${decision.decision}${decision.matched_skill ? ` -> ${decision.matched_skill}` : ""}`,
      });
    } catch (error) {
      renderCommandRailError(error.message);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "router/check",
        status: "failed",
        providerRunInvoked: true,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Command check failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Command Check Failed",
        terminal: `[ai-command] failed: ${error.message}`,
      });
    } finally {
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
  }

  function renderCommandDecision({ userRequest, overrideJustification, decision }) {
    editorContent.innerHTML = `
      <h1>Command</h1>
      <p><code>${escapeHtml(userRequest)}</code></p>
      <form class="new-matter-form ai-command-override-form" id="aiCommandOverrideForm" hidden>
        <label id="aiCommandOverrideLabel">
          <span>Override justification</span>
          <textarea id="aiCommandOverrideInput" spellcheck="true" placeholder="Explain the distinct purpose, input, output, workflow stage, legal setting, or audience.">${escapeHtml(overrideJustification || "")}</textarea>
        </label>
        <div class="form-actions">
          <button type="submit" id="aiCommandOverrideSubmit">Re-check with justification</button>
        </div>
        <div id="aiCommandOverrideError" class="form-error" hidden></div>
      </form>
      <div id="aiCommandResult" class="skill-router-result">
        ${renderRouterDecision(decision, { prefix: "aiCommand" })}
      </div>
    `;

    const overrideForm = document.getElementById("aiCommandOverrideForm");
    const overrideInput = document.getElementById("aiCommandOverrideInput");
    const overrideError = document.getElementById("aiCommandOverrideError");
    const resultBox = document.getElementById("aiCommandResult");

    wireRouterGateButtons({
      prefix: "aiCommand",
      decision,
      overrideLabel: overrideForm,
      overrideInput,
      resultBox,
      approveMessage: decision.matched_skill
        ? `Approved locally: this should become a modification request for ${decision.matched_skill}.`
        : "Approved locally: this should become a modification request.",
    });

    overrideForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nextJustification = overrideInput.value.trim();
      if (!nextJustification) {
        overrideError.textContent = "Override justification is required.";
        overrideError.hidden = false;
        return;
      }
      overrideError.hidden = true;
      await checkIntent({ userRequest, overrideJustification: nextJustification });
    });
  }

  function renderCommandRailDecision({ userRequest, overrideJustification, decision }) {
    if (!aiCommandSession) {
      renderCommandDecision({ userRequest, overrideJustification, decision });
      return;
    }
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderInlineRouterDecision({ userRequest, overrideJustification, decision });
    wireCommandRailDecisionActions({ userRequest, decision });
  }

  function renderInlineRouterDecision({ userRequest, overrideJustification, decision }) {
    const matchedSkill = decision.matched_skill || "none";
    const confidence = Number.isFinite(decision.confidence)
      ? `${Math.round(decision.confidence * 100)}%`
      : "n/a";
    const gateActions = decision.user_gate_required ? `
      <button type="button" class="secondary" data-command-router-action="approve">Approve modification</button>
      <button type="button" class="secondary" data-command-router-action="justify">Justify new skill</button>
    ` : "";
    return `
      <section class="command-interview command-router-result" aria-live="polite">
        <h3>Router/check result</h3>
        <p class="muted">This response stays in the Command rail. Nothing ran.</p>
        <p><code>${escapeHtml(userRequest)}</code></p>
        <dl class="skill-card-meta">
          <div><dt>Decision</dt><dd>${escapeHtml(decision.decision || "")}</dd></div>
          <div><dt>Recommended action</dt><dd>${escapeHtml(decision.recommended_action || "")}</dd></div>
          <div><dt>Matched skill</dt><dd><code>${escapeHtml(matchedSkill)}</code></dd></div>
          <div><dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd></div>
          <div><dt>Reason</dt><dd>${escapeHtml(decision.reason || "")}</dd></div>
          <div><dt>Next action</dt><dd>${escapeHtml(decision.suggested_next_action || "")}</dd></div>
        </dl>
        <form class="ai-command-override-form" data-command-router-override hidden>
          <label>
            <span>Override justification</span>
            <textarea data-command-router-override-input spellcheck="true" placeholder="Explain the distinct purpose, input, output, workflow stage, legal setting, or audience.">${escapeHtml(overrideJustification || "")}</textarea>
          </label>
          <div class="command-interview-actions">
            <button type="submit">Re-check</button>
          </div>
          <div class="form-error" data-command-router-override-error hidden></div>
        </form>
        <div class="command-interview-actions">
          ${gateActions}
          <button type="button" class="secondary" data-command-router-action="open-full">Open full result</button>
        </div>
        <div class="form-note" data-command-router-message></div>
      </section>
    `;
  }

  function wireCommandRailDecisionActions({ userRequest, decision }) {
    if (!aiCommandSession?.querySelectorAll) return;
    const message = aiCommandSession.querySelector?.("[data-command-router-message]");
    const overrideForm = aiCommandSession.querySelector?.("[data-command-router-override]");
    const overrideInput = aiCommandSession.querySelector?.("[data-command-router-override-input]");
    const overrideError = aiCommandSession.querySelector?.("[data-command-router-override-error]");
    aiCommandSession.querySelectorAll("[data-command-router-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.commandRouterAction;
        if (action === "approve") {
          if (message) {
            message.textContent = decision.matched_skill
              ? `Approved locally: this should become a modification request for ${decision.matched_skill}.`
              : "Approved locally: this should become a modification request.";
          }
          return;
        }
        if (action === "justify") {
          if (overrideForm) overrideForm.hidden = false;
          overrideInput?.focus?.();
          if (message) message.textContent = "Add an override justification, then re-check.";
          return;
        }
        if (action === "open-full") {
          renderCommandDecision({ userRequest, overrideJustification: overrideInput?.value?.trim?.() || "", decision });
        }
      });
    });
    overrideForm?.addEventListener?.("submit", async (event) => {
      event.preventDefault();
      const nextJustification = overrideInput?.value?.trim?.() || "";
      if (!nextJustification) {
        if (overrideError) {
          overrideError.textContent = "Override justification is required.";
          overrideError.hidden = false;
        }
        return;
      }
      if (overrideError) overrideError.hidden = true;
      await checkIntent({ userRequest, overrideJustification: nextJustification });
    });
  }

  return {
    checkIntent,
    renderCommandDecision,
  };
}
