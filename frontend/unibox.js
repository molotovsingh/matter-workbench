import { postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";

export function createUnibox(ctx, skillDispatch = {}) {
  const {
    uniboxForm,
    uniboxInput,
    uniboxSubmit,
    breadcrumbs,
    editorContent,
    uniboxHistory,
    resetConversationBtn,
  } = ctx.elements;

  let conversationHistory = [];
  let conversationTurns = [];

  function wire() {
    if (!uniboxForm) return;

    uniboxForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await processInput(uniboxInput.value.trim());
    });

    uniboxInput.addEventListener("input", () => {
      updatePlaceholder();
    });

    if (resetConversationBtn) {
      resetConversationBtn.addEventListener("click", resetConversation);
    }

    if (uniboxHistory) {
      uniboxHistory.innerHTML = `
        <div class="unibox-empty">
          <div class="unibox-empty-icon">&#9673;</div>
          <p>Ask about your matter, run a skill, or search documents.</p>
        </div>
      `;
    }
  }

  function updatePlaceholder() {
    const value = uniboxInput.value.trim();
    if (value.startsWith("/")) {
      uniboxInput.placeholder = "Run a skill, e.g. /extract";
    } else if (/^\b(what|who|where|when|why|how|is|are)\b/i.test(value)) {
      uniboxInput.placeholder = "Ask about the current matter...";
    } else if (/^\b(find|search|look for)\b/i.test(value)) {
      uniboxInput.placeholder = "Search across matter documents...";
    } else {
      uniboxInput.placeholder = "Ask, search, or run a skill...";
    }
  }

  async function processInput(userInput) {
    if (!userInput) {
      renderError("Type a question, search term, or skill command.");
      return;
    }

    uniboxSubmit.disabled = true;
    uniboxSubmit.textContent = "Processing...";
    breadcrumbs.textContent = "unibox";

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Unibox</strong><br />Processing: ${escapeHtml(userInput)}`,
      bar: "Unibox Processing",
      terminal: `[unibox] input: ${userInput}`,
    });

    try {
      const result = await postJson("/api/unibox", {
        userInput,
        conversationHistory,
      });

      if (result.conversationHistory) {
        conversationHistory = result.conversationHistory;
      }

      renderResult(userInput, result);

      if (result.conversationHistory) {
        conversationTurns.push({
          userInput,
          intent: result.intent,
          displayType: result.displayType,
          result: result.result,
        });
      } else if (shouldKeepTurn(result)) {
        conversationTurns.push({
          userInput,
          intent: result.intent,
          displayType: result.displayType,
          result: result.result,
        });
      }
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Unibox</strong><br />Intent: ${escapeHtml(result.intent)}`,
        bar: "Unibox Ready",
        terminal: `[unibox] ${result.intent} -> ${result.displayType}`,
      });
    } catch (error) {
      renderError(error.message);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Unibox failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Unibox Failed",
        terminal: `[unibox] failed: ${error.message}`,
      });
    } finally {
      uniboxSubmit.disabled = false;
      uniboxSubmit.textContent = "Go";
    }
  }

  function resetConversation(options = {}) {
    const quiet = Boolean(options?.quiet);
    const message = typeof options?.message === "string" ? options.message : "";
    conversationHistory = [];
    conversationTurns = [];
    uniboxInput.value = "";
    if (uniboxHistory) {
      uniboxHistory.innerHTML = quiet && !message
        ? `
          <div class="unibox-empty">
            <div class="unibox-empty-icon">&#9673;</div>
            <p>Ask about your matter, run a skill, or search documents.</p>
          </div>
        `
        : message
          ? `<p class="form-note">${escapeHtml(message)}</p>`
        : `
          <p class="form-note">Conversation reset. Ask a question about the current matter.</p>
        `;
    }
  }

  function renderResult(userInput, result) {
    const autoRunSkill = getAutoRunSkill(result);
    const resultHtml = autoRunSkill
      ? renderChatResponse({ message: `Running ${autoRunSkill}...` })
      : renderResultBody(result.displayType, result.result);

    const conversationHtml = renderConversation();

    if (uniboxHistory) {
      uniboxHistory.innerHTML = `
        ${conversationHtml}
        <div class="chat-turn user">
          <div class="chat-bubble user">${escapeHtml(userInput)}</div>
        </div>
        <div class="chat-turn assistant">
          <div class="chat-bubble assistant">
            ${resultHtml}
          </div>
        </div>
      `;
      uniboxHistory.scrollTop = uniboxHistory.scrollHeight;
    }

    wireResultActions(userInput, result);
    if (autoRunSkill) {
      skillDispatch[autoRunSkill](autoRunSkill);
    }
  }

  function renderConversation() {
    if (!conversationTurns.length) return "";

    return conversationTurns.map((turn, idx) => `
      <div class="chat-turn user">
        <div class="chat-bubble user">${escapeHtml(turn.userInput)}</div>
      </div>
      <div class="chat-turn assistant">
        <div class="chat-bubble assistant">
          ${renderResultBody(turn.displayType, turn.result, turn.intent)}
        </div>
      </div>
    `).join("");
  }

  function renderResultBody(displayType, result, intent = "") {
    switch (displayType) {
      case "qa_answer":
        return renderQaAnswer(result);
      case "search_results":
        return renderSearchResults(result);
      case "skill_router": {
        const runnableSkill = getAutoRunSkill({ intent, displayType, result });
        return runnableSkill
          ? renderChatResponse({ message: `Running ${runnableSkill}...` })
          : renderSkillRouterResult(result);
      }
      case "chat_response":
        return renderChatResponse(result);
      case "error":
        return `<p class="form-error">${escapeHtml(result.message)}</p>`;
      default:
        return `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
    }
  }

  function shouldKeepTurn(result) {
    return result.displayType === "skill_router"
      || result.displayType === "search_results"
      || result.displayType === "error";
  }

  function getAutoRunSkill(result) {
    if (result.intent !== "run_skill") return "";
    if (result.displayType !== "skill_router") return "";
    if (result.result?.decision !== "run_existing_skill") return "";
    if (result.result?.user_gate_required) return "";
    const matchedSkill = result.result?.matched_skill || "";
    return skillDispatch[matchedSkill] ? matchedSkill : "";
  }

  function renderQaAnswer(qa) {
    const confidence = Math.round((qa.confidence || 0) * 100);
    const sources = Array.isArray(qa.sources) && qa.sources.length
      ? `<p><strong>Sources:</strong></p><ul>${qa.sources.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join("")}</ul>`
      : "";

    return `
      <div class="qa-answer">
        <h3>Answer</h3>
        <div class="qa-text">${escapeHtml(qa.answer).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</div>
        <p><strong>Confidence:</strong> ${confidence}%</p>
        ${sources}
      </div>
    `;
  }

  function renderChatResponse(response) {
    const message = response.message || "";
    const formattedMessage = escapeHtml(message).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />");
    return `<div class="chat-response">${formattedMessage}</div>`;
  }

  function renderSearchResults(search) {
    if (!search.results || !search.results.length) {
      return `<p>No results found for <code>${escapeHtml(search.query)}</code>.</p>`;
    }

    const rows = search.results.map((r) => `
      <tr>
        <td><code>${escapeHtml(r.path)}</code></td>
        <td>${r.line || "n/a"}</td>
        <td>${escapeHtml(r.snippet).replace(/\*\*(.*?)\*\*/g, "<mark>$1</mark>")}</td>
      </tr>
    `).join("");

    return `
      <p>Found <strong>${search.totalResults}</strong> result(s) for <code>${escapeHtml(search.query)}</code>:</p>
      <table class="extract-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Line</th>
            <th>Snippet</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderSkillRouterResult(decision) {
    return renderRouterDecision(decision, { prefix: "unibox" });
  }

  function renderNextActions(actions) {
    if (!Array.isArray(actions) || !actions.length) return "None";
    return actions.map((a) => `<span class="skill-router-chip">${escapeHtml(a)}</span>`).join(" ");
  }

  function wireResultActions(userInput, result) {
    if (result.displayType !== "skill_router") return;

    const overrideLabel = document.getElementById("uniboxOverrideLabel");
    const overrideInput = document.getElementById("uniboxOverrideInput");
    const resultBox = document.getElementById("uniboxResult");

    if (overrideLabel && overrideInput && resultBox) {
      wireRouterGateButtons({
        prefix: "unibox",
        decision: result.result,
        overrideLabel,
        overrideInput,
        resultBox,
        approveMessage: result.result.matched_skill
          ? `Approved: will modify ${result.result.matched_skill}`
          : "Approved: will create new skill",
      });
    }
  }

  function renderError(message) {
    if (breadcrumbs) breadcrumbs.textContent = "unibox";
    if (uniboxHistory) {
      uniboxHistory.innerHTML = `
        <p class="form-error">${escapeHtml(message)}</p>
      `;
    }
  }

  return {
    wire,
    processInput,
    resetConversation,
  };
}

const intentLabelMap = {
  copilot_qa: "Copilot",
  search: "Search",
  run_skill: "Run Skill",
  skill_request: "Skill Request",
  skill_router: "Skill Router",
  greeting: "Greeting",
  casual: "Casual",
  unknown: "Unknown",
};
