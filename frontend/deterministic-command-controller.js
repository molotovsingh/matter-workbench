import { isProviderBackedCommand } from "./command-parsing.js";
import { escapeHtml } from "./dom-utils.js";

export function createDeterministicCommandController({
  aiCommandSubmit,
  commandReport,
  ctx,
  getLatestTerminalLines,
  getStatusBarText,
  recordCommandInteraction,
  renderCommandError,
  skillDispatch,
  updateReport,
}) {
  const {
    captureStatusDuringCommand,
    startReport,
  } = commandReport;

  async function runDeterministicCommand(parsedCommand, userRequest) {
    startReport({
      typedInput: userRequest,
      matchedCommand: parsedCommand.command || parsedCommand.input || "status",
      status: "pending",
    });
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = parsedCommand.type === "search"
      ? "Searching..."
      : parsedCommand.type === "skill"
        ? "Running..."
        : "Opening...";
    const restoreStatus = captureStatusDuringCommand();
    try {
      if (parsedCommand.type === "status") {
        showMatterStatus(userRequest);
        updateReport({ status: "ran" });
        return;
      }
      if (parsedCommand.type === "skills") {
        await showSkillsPage(userRequest);
        updateReport({ status: "ran" });
        return;
      }
      if (parsedCommand.type === "lane") {
        const result = showWorkspaceLane(parsedCommand, userRequest);
        updateReport({ status: result?.ok ? "ran" : "failed" });
        return;
      }
      if (parsedCommand.type === "search") {
        await runContextSearch(parsedCommand, userRequest);
        if (commandReport.getReport()?.status === "pending" || commandReport.getReport()?.status === "warned") {
          updateReport({ status: "ran" });
        }
        return;
      }

      const runSkill = skillDispatch[parsedCommand.command];
      if (!runSkill) {
        renderCommandError("This command is unavailable in this build.");
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Command unavailable</strong><br />This action is not available in this build.",
          bar: "Command Unavailable",
          terminal: `[ai-command] no runner for ${parsedCommand.command}`,
        });
        updateReport({ status: "failed" });
        return;
      }

      ctx.setStatus({
        mood: "idle",
        card: `<strong>Running skill</strong><br />Starting <code>${escapeHtml(parsedCommand.command)}</code>.`,
        bar: "Running Skill",
        terminal: `[ai-command] ${userRequest} -> ${parsedCommand.command}`,
      });
      await runSkill(parsedCommand.command);
      if (commandReport.getReport()?.status === "pending" || commandReport.getReport()?.status === "warned") {
        updateReport({ status: "ran" });
      }
    } catch (error) {
      updateReport({ status: "failed" });
      throw error;
    } finally {
      restoreStatus();
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      recordCommandInteraction({
        renderedState: `command/${parsedCommand.type}`,
        providerRunInvoked: parsedCommand.type === "skill" && isProviderBackedCommand(parsedCommand.command),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "→";
    }
  }

  function showWorkspaceLane(parsedCommand, userRequest) {
    if (!ctx.openWorkspaceLane) {
      renderCommandError("Workspace navigation is unavailable.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Command unavailable</strong><br />Workspace navigation is not available in this build.",
        bar: "Command Unavailable",
        terminal: `[ai-command] lane navigation unavailable for ${parsedCommand.lanePath}`,
      });
      return { ok: false, reason: "unwired" };
    }

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Opening workspace</strong><br />Opening ${escapeHtml(parsedCommand.title || parsedCommand.lanePath)}.`,
      bar: "Opening Workspace",
      terminal: `[ai-command] ${userRequest} -> ${parsedCommand.lanePath}`,
    });
    return ctx.openWorkspaceLane(parsedCommand.lanePath);
  }

  async function runContextSearch(parsedCommand, userRequest) {
    const runSearch = skillDispatch[parsedCommand.command];
    if (!runSearch) {
      renderCommandError("Search is unavailable in this build.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Search unavailable</strong><br />Matter search is not available in this build.",
        bar: "Command Unavailable",
        terminal: `[ai-command] no runner for ${parsedCommand.command}`,
      });
      updateReport({ status: "failed" });
      return;
    }

    ctx.setStatus({
      mood: "idle",
      card: "<strong>Searching matter</strong><br />Searching the selected matter context.",
      bar: "Searching Matter",
      terminal: `[ai-command] ${userRequest} -> ${parsedCommand.command}`,
    });
    await runSearch({
      command: parsedCommand.command,
      query: parsedCommand.query,
      typedInput: userRequest,
    });
  }

  function showMatterStatus(userRequest) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      renderCommandError("Pick a matter from Home before showing status.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from Home before showing status.",
        bar: "No Matter",
        terminal: "[ai-command] status requested without active matter",
      });
      return;
    }

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Status</strong><br />Showing pipeline status for <code>${escapeHtml(activeMatter.folderName)}</code>.`,
      bar: "Matter Status",
      terminal: `[ai-command] ${userRequest} -> matter status`,
    });
    ctx.renderSkillOverview();
    if (typeof document !== "undefined") {
      setTimeout(() => {
        document.getElementById("matterPipelineStatus")?.scrollIntoView?.({ block: "start" });
      }, 0);
    }
  }

  async function showSkillsPage(userRequest) {
    if (!ctx.renderSkills) {
      renderCommandError("Skills view is unavailable.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Command unavailable</strong><br />The Skills page is not available in this build.",
        bar: "Command Unavailable",
        terminal: "[ai-command] skills view unavailable",
      });
      updateReport({ status: "failed" });
      return;
    }

    ctx.setStatus({
      mood: "idle",
      card: "<strong>Opening Skills</strong><br />Opening the read-only Skills page.",
      bar: "Opening Skills",
      terminal: `[ai-command] ${userRequest} -> skills`,
    });
    await ctx.renderSkills();
  }

  return {
    runDeterministicCommand,
    runContextSearch,
    showMatterStatus,
    showSkillsPage,
    showWorkspaceLane,
  };
}
