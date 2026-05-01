import { postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";

const CHECK_OVERLAP_COMMAND = /^(?:check overlap|check mece|check against existing skills|route it|run router)$/i;

export function createUnibox(ctx, skillDispatch = {}) {
  const {
    uniboxForm,
    uniboxInput,
    uniboxSubmit,
    breadcrumbs,
    editorContent,
    uniboxHistory,
    exportConversationBtn,
    resetConversationBtn,
  } = ctx.elements;

  let conversationHistory = [];
  let conversationTurns = [];
  let turnSequence = 0;

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

    if (exportConversationBtn) {
      exportConversationBtn.addEventListener("click", exportConversation);
      updateExportButton();
    }

    if (uniboxHistory) {
      uniboxHistory.addEventListener("click", handleHistoryClick);
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
      uniboxInput.placeholder = value.startsWith("/new_skill")
        ? "Describe the skill idea in simple terms..."
        : "Run a skill, e.g. /extract";
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
      attachProposalContext(userInput, result);

      renderResult(userInput, result);
      updateConversationState(userInput, result);
      uniboxInput.value = "";
      updatePlaceholder();

      ctx.setStatus(statusForResult(result));
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
    turnSequence = 0;
    uniboxInput.value = "";
    updateExportButton();
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
    const currentTurnId = turnSequence + 1;
    const autoRunSkill = getAutoRunSkill(result);
    const resultHtml = autoRunSkill
      ? renderChatResponse({ message: `Running ${autoRunSkill}...` })
      : renderResultBody(result.displayType, result.result, result.intent, currentTurnId);

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

    wireResultActions(userInput, result, currentTurnId);
    if (autoRunSkill) {
      skillDispatch[autoRunSkill](autoRunSkill);
    }
  }

  function renderConversation() {
    if (!conversationTurns.length) return "";

    return conversationTurns.map((turn) => `
      <div class="chat-turn user">
        <div class="chat-bubble user">${escapeHtml(turn.userInput)}</div>
      </div>
      <div class="chat-turn assistant">
        <div class="chat-bubble assistant">
          ${renderResultBody(turn.displayType, turn.result, turn.intent, turn.id)}
        </div>
      </div>
    `).join("");
  }

  function renderResultBody(displayType, result, intent = "", turnId = 0) {
    switch (displayType) {
      case "qa_answer":
        return renderQaAnswer(result);
      case "search_results":
        return renderSearchResults(result);
      case "skill_router": {
        const runnableSkill = getAutoRunSkill({ intent, displayType, result });
        return runnableSkill
          ? renderChatResponse({ message: `Running ${runnableSkill}...` })
          : renderSkillRouterResult(result, turnId);
      }
      case "skill_design":
        return renderSkillDesign(result);
      case "chat_response":
        return renderChatResponse(result);
      case "error":
        return `<p class="form-error">${escapeHtml(result.message)}</p>`;
      default:
        return `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
    }
  }

  function shouldKeepTurn(result = {}) {
    return result.conversationHistory
      || result.displayType === "skill_router"
      || result.displayType === "skill_design"
      || result.displayType === "search_results"
      || result.displayType === "chat_response"
      || result.displayType === "error";
  }

  function updateConversationState(userInput, result) {
    if (!shouldKeepTurn(result)) return;

    turnSequence += 1;
    conversationTurns.push({
      id: turnSequence,
      userInput,
      intent: result.intent,
      displayType: result.displayType,
      result: result.result,
    });

    if (result.conversationHistory) {
      conversationHistory = result.conversationHistory;
    } else {
      conversationHistory = appendHistorySummary(conversationHistory, userInput, result);
    }
    updateExportButton();
  }

  function appendHistorySummary(history, userInput, result) {
    const summary = summarizeResultForHistory(result);
    if (!summary) return history;
    return [
      ...history,
      { role: "user", content: userInput },
      { role: "assistant", content: summary },
    ].slice(-20);
  }

  function summarizeResultForHistory(result = {}) {
    if (result.displayType === "skill_router") {
      const decision = result.result || {};
      return [
        "Skill router result.",
        `intent=${result.intent || ""}`,
        `decision=${decision.decision || ""}`,
        `recommended_action=${decision.recommended_action || ""}`,
        `matched_skill=${decision.matched_skill || ""}`,
        `user_gate_required=${decision.user_gate_required ? "yes" : "no"}`,
        `reason=${decision.reason || ""}`,
        `next_action=${decision.suggested_next_action || ""}`,
      ].join("\n");
    }
    if (result.displayType === "skill_design" && result.result?.historySummary) {
      return result.result.historySummary;
    }
    if (result.displayType === "search_results") {
      return `Search result for "${result.result?.query || ""}" with ${result.result?.totalResults || 0} match(es).`;
    }
    if (result.displayType === "error") {
      return `Unibox error: ${result.result?.message || ""}`;
    }
    if (result.displayType === "chat_response" && result.result?.historySummary) {
      return result.result.historySummary;
    }
    return "";
  }

  function updateExportButton() {
    if (!exportConversationBtn) return;
    exportConversationBtn.disabled = conversationTurns.length === 0;
    exportConversationBtn.title = conversationTurns.length
      ? "Export this conversation as Markdown"
      : "Start a conversation before exporting";
  }

  function exportConversation() {
    if (!conversationTurns.length) {
      ctx.setStatus?.({
        mood: "idle",
        card: "<strong>No conversation to export</strong><br />Ask a question or run a skill first.",
        bar: "Export Unavailable",
        terminal: "[unibox] export skipped: no conversation",
      });
      return;
    }

    const matter = ctx.getActiveMatter?.() || {};
    const matterName = matter.folderName || matter.metadata?.matterName || "unibox";
    const exportedAt = new Date();
    const markdown = buildConversationMarkdown({
      matterName,
      exportedAt,
      turns: conversationTurns,
    });
    const fileName = `${safeFileName(matterName)}-unibox-chat-${formatDateStamp(exportedAt)}.md`;
    downloadTextFile(markdown, fileName, "text/markdown;charset=utf-8");
    ctx.setStatus?.({
      mood: "idle",
      card: `<strong>Chat exported</strong><br />${escapeHtml(fileName)}`,
      bar: "Chat Exported",
      terminal: `[unibox] exported chat: ${fileName}`,
    });
  }

  function buildConversationMarkdown({ matterName, exportedAt, turns }) {
    const lines = [
      "# Unibox Chat Export",
      "",
      `Matter: ${matterName || "Unknown matter"}`,
      `Exported: ${exportedAt.toLocaleString()}`,
      `Turns: ${turns.length}`,
      "",
    ];

    turns.forEach((turn, index) => {
      lines.push(`## Turn ${index + 1}`);
      lines.push("");
      lines.push("### You");
      lines.push("");
      lines.push(turn.userInput || "");
      lines.push("");
      lines.push("### Workbench");
      lines.push("");
      lines.push(formatResultForExport(turn));
      lines.push("");
    });

    return `${lines.join("\n").trim()}\n`;
  }

  function formatResultForExport(turn) {
    switch (turn.displayType) {
      case "qa_answer":
        return formatQaForExport(turn.result);
      case "search_results":
        return formatSearchForExport(turn.result);
      case "skill_router":
        return formatSkillRouterForExport(turn.result);
      case "skill_design":
        return formatSkillDesignForExport(turn.result);
      case "chat_response":
        return turn.result?.message || "";
      case "error":
        return `Error: ${turn.result?.message || "Unknown error"}`;
      default:
        return JSON.stringify(turn.result || {}, null, 2);
    }
  }

  function formatQaForExport(qa = {}) {
    const lines = [qa.answer || ""];
    if (Number.isFinite(Number(qa.confidence))) {
      lines.push("", `Confidence: ${Math.round(Number(qa.confidence) * 100)}%`);
    }
    if (Array.isArray(qa.sources) && qa.sources.length) {
      lines.push("", "Sources:");
      qa.sources.forEach((source) => lines.push(`- ${source}`));
    }
    return lines.join("\n");
  }

  function formatSearchForExport(search = {}) {
    const lines = [
      `Search: ${search.query || ""}`,
      `Results: ${search.totalResults || 0}`,
    ];
    if (Array.isArray(search.results) && search.results.length) {
      lines.push("");
      search.results.forEach((result, index) => {
        lines.push(`${index + 1}. ${result.path || "Unknown file"}${result.line ? `:${result.line}` : ""}`);
        if (result.snippet) lines.push(`   ${stripMarkdownHighlights(result.snippet)}`);
      });
    }
    return lines.join("\n");
  }

  function formatSkillRouterForExport(decision = {}) {
    const lines = [
      `Decision: ${decision.decision || "unknown"}`,
      `Recommended action: ${decision.recommended_action || "none"}`,
      `Matched skill: ${decision.matched_skill || "none"}`,
      `Confidence: ${Math.round(Number(decision.confidence || 0) * 100)}%`,
      `User gate: ${decision.user_gate_required ? "Yes" : "No"}`,
      `MECE violation: ${decision.mece_violation ? "Yes" : "No"}`,
      "",
      `Reason: ${decision.reason || ""}`,
      "",
      `Next action: ${decision.suggested_next_action || "None"}`,
      "",
      `Override requires: ${Array.isArray(decision.override_requires) && decision.override_requires.length ? decision.override_requires.join(", ") : "None"}`,
    ];
    if (decision.proposalSave?.id) {
      lines.push("", `Saved proposal: ${decision.proposalSave.id}`);
    } else if (decision.proposalContext?.title) {
      lines.push("", `Proposed skill: ${decision.proposalContext.title}`);
    }
    return lines.join("\n");
  }

  function formatSkillDesignForExport(result = {}) {
    return result.briefMarkdown || result.message || "";
  }

  function stripMarkdownHighlights(value) {
    return String(value || "").replace(/\*\*(.*?)\*\*/g, "$1");
  }

  function downloadTextFile(text, fileName, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function safeFileName(value) {
    return String(value || "unibox")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unibox";
  }

  function formatDateStamp(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
    ].join("");
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

  function renderSkillDesign(result = {}) {
    const state = result.state || {};
    const progress = state.progress || {};
    const progressLabel = state.expectedSlotLabel
      ? `Question ${progress.current || "?"}/${progress.total || "?"}: ${state.expectedSlotLabel}`
      : "";
    const message = renderPlainMessage(result.message || "");
    const meta = progressLabel
      ? `<div class="skill-design-meta">${escapeHtml(progressLabel)}</div>`
      : "";
    const choices = Array.isArray(result.choices) && result.choices.length
      ? `<div class="skill-design-choices">${result.choices.map((choice) => `<code>${escapeHtml(choice)}</code>`).join(" ")}</div>`
      : "";
    const actions = result.briefMarkdown
      ? `
        <div class="form-actions skill-design-actions">
          <button type="button" class="secondary" data-unibox-command="check overlap">Check overlap</button>
        </div>
      `
      : "";
    return `
      <div class="skill-design-result">
        ${meta}
        ${message}
        ${choices}
        ${actions}
      </div>
    `;
  }

  function renderPlainMessage(message) {
    return escapeHtml(message)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br />");
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

  function renderSkillRouterResult(decision, turnId = 0) {
    return [
      renderRouterDecision(decision, { prefix: `unibox${turnId}` }),
      renderProposalSavePanel(decision, turnId),
    ].join("");
  }

  function renderNextActions(actions) {
    if (!Array.isArray(actions) || !actions.length) return "None";
    return actions.map((a) => `<span class="skill-router-chip">${escapeHtml(a)}</span>`).join(" ");
  }

  function wireResultActions(userInput, result, currentTurnId) {
    if (result.displayType !== "skill_router") return;

    const prefix = `unibox${currentTurnId}`;
    const overrideLabel = document.getElementById(`${prefix}OverrideLabel`);
    const overrideInput = document.getElementById(`${prefix}OverrideInput`);
    const resultBox = document.getElementById(`${prefix}Result`) || uniboxHistory;
    const hasGateActions = document.getElementById(`${prefix}ApproveModification`)
      || document.getElementById(`${prefix}JustifyNew`);

    if (hasGateActions) {
      wireRouterGateButtons({
        prefix,
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

  async function handleHistoryClick(event) {
    const commandButton = event.target.closest?.("[data-unibox-command]");
    if (commandButton) {
      event.preventDefault();
      await processInput(commandButton.dataset.uniboxCommand || "");
      return;
    }

    const saveButton = event.target.closest?.(".skill-proposal-save");
    if (saveButton) {
      event.preventDefault();
      await saveProposalFromButton(saveButton);
    }
  }

  function attachProposalContext(userInput, result = {}) {
    if (result.displayType !== "skill_router") return result;
    if (!CHECK_OVERLAP_COMMAND.test(String(userInput || "").trim())) return result;
    const briefTurn = [...conversationTurns].reverse().find((turn) => turn.displayType === "skill_design" && turn.result?.briefMarkdown);
    const briefMarkdown = briefTurn?.result?.briefMarkdown || "";
    if (!briefMarkdown) return result;
    const matter = ctx.getActiveMatter?.() || {};
    result.result = {
      ...(result.result || {}),
      proposalContext: {
        briefMarkdown,
        title: titleFromBrief(briefMarkdown),
        matterName: matter.folderName || matter.metadata?.matterName || "",
      },
    };
    return result;
  }

  function renderProposalSavePanel(decision = {}, turnId = 0) {
    const context = decision.proposalContext || {};
    if (!context.briefMarkdown) return "";
    if (decision.proposalSave?.id) {
      return `<p class="form-note skill-proposal-saved">Saved proposal: <code>${escapeHtml(decision.proposalSave.id)}</code></p>`;
    }
    if (canSaveAsProposedSkill(decision)) {
      return `
        <div class="skill-proposal-actions">
          <p class="form-note">This looks distinct enough to keep as a proposed skill. It will not become runnable until a developer implements it.</p>
          <div class="form-actions">
            <button type="button" class="skill-proposal-save" data-skill-proposal-turn-id="${Number(turnId)}">Save proposed skill</button>
          </div>
          <div id="unibox${Number(turnId)}ProposalMessage" class="form-note"></div>
        </div>
      `;
    }
    const matched = decision.matched_skill ? ` <code>${escapeHtml(decision.matched_skill)}</code>` : "";
    return `
      <p class="form-note skill-proposal-guidance">
        This looks like an improvement to an existing skill${matched} rather than a new runnable skill. Refine the brief and run <code>check overlap</code> again if it needs a separate workflow.
      </p>
    `;
  }

  function canSaveAsProposedSkill(decision = {}) {
    return Boolean(decision.proposalContext?.briefMarkdown)
      && !decision.user_gate_required
      && !decision.mece_violation
      && ["new_skill", "adjacent_skill"].includes(decision.decision);
  }

  async function saveProposalFromButton(button) {
    const turnId = Number(button.dataset.skillProposalTurnId || 0);
    const turn = conversationTurns.find((item) => item.id === turnId);
    const decision = turn?.result;
    if (!decision?.proposalContext?.briefMarkdown) return;

    const message = document.getElementById(`unibox${turnId}ProposalMessage`);
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      const saved = await postJson("/api/skill-proposals", {
        title: decision.proposalContext.title,
        briefMarkdown: decision.proposalContext.briefMarkdown,
        routerDecision: stripProposalUiState(decision),
        createdFrom: "unibox",
        matterName: decision.proposalContext.matterName || "",
      });
      decision.proposalSave = {
        id: saved.id,
        status: saved.status,
      };
      if (message) {
        message.classList.remove("form-error");
        message.innerHTML = `Saved proposal: <code>${escapeHtml(saved.id)}</code>`;
      }
      button.textContent = "Saved";
      ctx.setStatus?.({
        mood: "idle",
        card: `<strong>Proposed skill saved</strong><br />${escapeHtml(saved.title)} is now listed in Settings.`,
        bar: "Proposed Skill Saved",
        terminal: `[skills] proposed skill saved: ${saved.id}`,
      });
      updateExportButton();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Save proposed skill";
      if (message) {
        message.textContent = error.message;
        message.classList.add("form-error");
      }
      ctx.setStatus?.({
        mood: "idle",
        card: `<strong>Save failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Proposal Save Failed",
        terminal: `[skills] proposed skill save failed: ${error.message}`,
      });
    }
  }

  function stripProposalUiState(decision = {}) {
    const {
      proposalContext,
      proposalSave,
      ...routerDecision
    } = decision;
    return routerDecision;
  }

  function titleFromBrief(briefMarkdown = "") {
    const heading = String(briefMarkdown || "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("## "));
    return heading ? heading.replace(/^##\s+/, "") : "Untitled Skill";
  }

  function renderError(message) {
    if (breadcrumbs) breadcrumbs.textContent = "unibox";
    if (uniboxHistory) {
      uniboxHistory.innerHTML = `
        <p class="form-error">${escapeHtml(message)}</p>
      `;
    }
  }

  function statusForResult(result = {}) {
    if (result.displayType === "skill_design") {
      const designStatus = summarizeSkillDesignStatus(result.result || {});
      return {
        mood: "idle",
        card: `<strong>Skill design</strong><br />${escapeHtml(designStatus.card)}`,
        bar: designStatus.bar,
        terminal: `[unibox] skill_design -> ${designStatus.terminal}`,
      };
    }

    return {
      mood: "idle",
      card: `<strong>Unibox</strong><br />Intent: ${escapeHtml(result.intent)}`,
      bar: "Unibox Ready",
      terminal: `[unibox] ${result.intent} -> ${result.displayType}`,
    };
  }

  function summarizeSkillDesignStatus(result = {}) {
    const state = result.state || {};
    const progress = state.progress || {};
    if (result.briefMarkdown) {
      return {
        card: "Skill Brief ready. Reply `check overlap` to compare it with existing skills.",
        bar: "Skill Brief Ready",
        terminal: "brief_ready",
      };
    }
    if (Array.isArray(result.choices) && result.choices.length) {
      return {
        card: `Choose: ${result.choices.join(" / ")}`,
        bar: "Skill Design: Choose path",
        terminal: "awaiting_choice",
      };
    }
    if (state.expectedSlotLabel) {
      const prefix = progress.current && progress.total
        ? `${progress.current}/${progress.total}: `
        : "";
      return {
        card: `Waiting for ${prefix}${state.expectedSlotLabel}`,
        bar: `Skill Design: ${state.expectedSlotLabel}`,
        terminal: `waiting_for=${state.expectedSlot || state.expectedSlotLabel}`,
      };
    }
    if (state.phase === "cancelled") {
      return {
        card: "Cancelled. No skill was created or changed.",
        bar: "Skill Design Cancelled",
        terminal: "cancelled",
      };
    }
    return {
      card: "Waiting for the skill idea.",
      bar: "Skill Design Started",
      terminal: state.phase || "started",
    };
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
  skill_design: "Skill Design",
  skill_router: "Skill Router",
  greeting: "Greeting",
  casual: "Casual",
  unknown: "Unknown",
};
