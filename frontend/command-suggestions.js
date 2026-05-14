import { listSlashCommandSuggestions } from "./command-parsing.js";
import { escapeHtml } from "./dom-utils.js";

export function createCommandSuggestionController({
  input,
  suggestionsElement,
  loadSkillRegistry,
  isSuppressed = () => false,
  runCommand,
} = {}) {
  let activeSuggestionIndex = -1;
  let configurableSlashSuggestions = [];
  let configurableSlashSuggestionsLoaded = false;
  let configurableSlashSuggestionsLoading = false;

  function render() {
    if (!suggestionsElement || !input) return;
    if (isSuppressed()) {
      hide();
      return;
    }
    if (String(input.value || "").trim().startsWith("/") && !configurableSlashSuggestionsLoaded && !configurableSlashSuggestionsLoading) {
      void refreshConfigurableSlashSuggestions().then(() => render());
    }
    const suggestions = listSlashCommandSuggestions(input.value, configurableSlashSuggestions);
    if (!suggestions.length) {
      hide();
      return;
    }
    activeSuggestionIndex = Math.min(Math.max(activeSuggestionIndex, 0), suggestions.length - 1);
    suggestionsElement.hidden = false;
    suggestionsElement.innerHTML = suggestions.map((suggestion, index) => `
      <button
        type="button"
        class="command-suggestion${index === activeSuggestionIndex ? " active" : ""}"
        data-command-suggestion="${escapeHtml(suggestion.command)}"
        role="option"
        aria-selected="${index === activeSuggestionIndex ? "true" : "false"}"
      >
        <strong>${escapeHtml(suggestion.command)}</strong>
        <span>${escapeHtml(suggestion.description)}</span>
      </button>
    `).join("");
    suggestionsElement.querySelectorAll("[data-command-suggestion]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", async () => {
        await runSuggestedCommand(button.dataset.commandSuggestion);
      });
    });
  }

  async function handleKeydown(event) {
    if (!input || !suggestionsElement) return;
    if (isSuppressed()) return;
    const suggestions = listSlashCommandSuggestions(input.value, configurableSlashSuggestions);
    if (!suggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeSuggestionIndex = activeSuggestionIndex < 0
        ? 0
        : (activeSuggestionIndex + 1) % suggestions.length;
      render();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeSuggestionIndex = activeSuggestionIndex < 0
        ? suggestions.length - 1
        : (activeSuggestionIndex - 1 + suggestions.length) % suggestions.length;
      render();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
      return;
    }
    if (event.key === "Enter" && !suggestionsElement.hidden && activeSuggestionIndex >= 0) {
      event.preventDefault();
      await runSuggestedCommand(suggestions[activeSuggestionIndex].command);
    }
  }

  async function runSuggestedCommand(command) {
    if (!command || !input) return;
    input.value = command;
    hide();
    await runCommand?.(command);
  }

  async function refreshConfigurableSlashSuggestions({ force = false } = {}) {
    if (configurableSlashSuggestionsLoading) return;
    if (configurableSlashSuggestionsLoaded && !force) return;
    configurableSlashSuggestionsLoading = true;
    try {
      const registry = await loadSkillRegistry?.();
      const skills = Array.isArray(registry?.skills) ? registry.skills : [];
      configurableSlashSuggestions = skills
        .filter((skill) => skill?.configurable && skill.status === "active" && skill.slash)
        .map((skill) => ({
          command: skill.slash,
          description: skill.purpose || skill.title || "Run custom skill.",
        }));
      configurableSlashSuggestionsLoaded = true;
    } catch {
      configurableSlashSuggestions = [];
      configurableSlashSuggestionsLoaded = true;
    } finally {
      configurableSlashSuggestionsLoading = false;
    }
  }

  function hide() {
    activeSuggestionIndex = -1;
    if (!suggestionsElement) return;
    suggestionsElement.hidden = true;
    suggestionsElement.innerHTML = "";
  }

  return {
    handleKeydown,
    hide,
    refreshConfigurableSlashSuggestions,
    render,
  };
}
