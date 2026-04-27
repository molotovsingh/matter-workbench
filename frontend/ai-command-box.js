import { postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";

export function createAiCommandBox(ctx) {
  const {
    aiCommandForm,
    aiCommandInput,
    aiCommandSubmit,
    breadcrumbs,
    editorContent,
  } = ctx.elements;

  function wire() {
    if (!aiCommandForm) return;
    aiCommandForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await checkIntent({
        userRequest: aiCommandInput.value.trim(),
        overrideJustification: "",
      });
    });
  }

  async function checkIntent({ userRequest, overrideJustification }) {
    if (!userRequest) {
      renderCommandError("Enter an AI command or proposed skill request.");
      return;
    }

    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Checking...";
    breadcrumbs.textContent = "ai command";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>AI command</strong><br />Routing request through the skill registry.",
      bar: "AI Command",
      terminal: `[ai-command] checking intent: ${userRequest}`,
    });

    try {
      const decision = await postJson("/api/skills/check-intent", {
        userRequest,
        overrideJustification,
      });
      renderCommandDecision({ userRequest, overrideJustification, decision });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Router decision</strong><br />${escapeHtml(decision.decision)}${decision.matched_skill ? ` for <code>${escapeHtml(decision.matched_skill)}</code>` : ""}.`,
        bar: "Router Ready",
        terminal: `[ai-command] ${decision.decision}${decision.matched_skill ? ` -> ${decision.matched_skill}` : ""}`,
      });
    } catch (error) {
      renderCommandError(error.message);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>AI command failed</strong><br />${escapeHtml(error.message)}`,
        bar: "AI Command Failed",
        terminal: `[ai-command] failed: ${error.message}`,
      });
    } finally {
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Route";
    }
  }

  function renderCommandDecision({ userRequest, overrideJustification, decision }) {
    editorContent.innerHTML = `
      <h1>AI command</h1>
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

  function renderCommandError(message) {
    breadcrumbs.textContent = "ai command";
    editorContent.innerHTML = `
      <h1>AI command</h1>
      <p class="form-error">${escapeHtml(message)}</p>
    `;
  }

  return {
    checkIntent,
    wire,
  };
}
