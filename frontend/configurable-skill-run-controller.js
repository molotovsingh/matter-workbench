import {
  findActiveConfigurableSkillBySlash,
  parseConfigurableSkillRevisionCommand,
} from "./configurable-skill-commands.js";
import { createConfigurableSkillImprovementActions } from "./configurable-skill-improvement-actions.js";
import { classifyConfigurableSkillRunInput } from "./configurable-skill-run-commands.js";
import {
  buildConfigurableRunPending,
  getConfigurableRunArtifactPath,
  renderConfigurableSkillCancelledRail,
  renderConfigurableSkillExistingOutputSheetHtml,
  renderConfigurableSkillOverwritePromptHtml,
  renderConfigurableSkillRunOutput,
  renderConfigurableSkillRunRail,
} from "./configurable-skill-run-ui.js";
import { formatConfigurableSkillDisplayName } from "./configurable-skill-version-labels.js";
import { escapeHtml } from "./dom-utils.js";
import { renderCreatedSkillCommandRailHtml } from "./skill-builder-result-rendering.js";
import { formatConfigurableSkillRunReport } from "./views/skills-page.js";

export function createConfigurableSkillRunController({
  aiCommandInput,
  aiCommandSession,
  aiCommandSubmit,
  breadcrumbs,
  cancelConfigurableSkillRun,
  commandReport,
  copyLatestReport,
  ctx,
  defaultPlaceholder,
  deterministicCommands,
  editorContent,
  getLatestTerminalLines,
  getStatusBarText,
  loadSkillRegistry,
  recordCommandInteraction,
  renderCommandError,
  renderCommandRailError,
  renderSkillIdeaSession,
  runConfigurableSkill,
  saveSkillIdea,
  setCurrentSkillIdeaInterview,
  setReportStatus,
  updateReport,
  writeClipboardText,
}) {
  let pendingConfigurableRun = null;
  let lastCreatedConfigurableSkill = null;
  const improvementActions = createConfigurableSkillImprovementActions({
    aiCommandInput,
    aiCommandSession,
    aiCommandSubmit,
    ctx,
    defaultPlaceholder,
    getPendingRun: () => pendingConfigurableRun,
    recordCommandInteraction,
    renderCommandError,
    renderCommandRailError,
    renderSkillIdeaSession,
    saveSkillIdea,
    setCurrentSkillIdeaInterview,
    setPendingRun: (pending) => {
      pendingConfigurableRun = pending;
    },
    updateReport,
    wireConfigurableSkillActions,
  });

  async function findConfigurableSkillCommand(userRequest) {
    const registry = await loadSkillRegistry().catch(() => null);
    const skills = Array.isArray(registry?.skills) ? registry.skills : [];
    return findActiveConfigurableSkillBySlash(skills, userRequest);
  }

  async function findConfigurableSkillRevisionCommand(userRequest) {
    const parsed = parseConfigurableSkillRevisionCommand(userRequest);
    if (!parsed) return null;
    const registry = await loadSkillRegistry().catch(() => null);
    const skills = Array.isArray(registry?.skills) ? registry.skills : [];
    const skill = findActiveConfigurableSkillBySlash(skills, parsed.targetSlash);
    return skill ? { skill, revisionText: parsed.revisionText } : null;
  }

  async function startConfigurableSkillImprovement(skill = {}, revisionText = "") {
    await improvementActions.startConfigurableSkillImprovement(skill, revisionText, {
      startReport: commandReport.startReport,
    });
  }

  async function runConfigurableSkillCommand(skill, userRequest, { overwrite = false } = {}) {
    const slash = skill?.slash || pendingConfigurableRun?.slash || "";
    if (!slash) {
      renderCommandError("No configurable skill selected.");
      return;
    }
    if (!overwrite) {
      commandReport.startReport({
        typedInput: userRequest,
        matchedCommand: slash,
        status: "pending",
      });
    }
    pendingConfigurableRun = null;
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Running...";
    ctx.setStatus({
      mood: "thinking",
      card: `<strong>Running skill</strong><br /><code>${escapeHtml(slash)}</code> is using the selected matter context.`,
      bar: "Running Skill",
      terminal: `[configurable-skill] running ${slash}`,
    });
    try {
      const result = await runConfigurableSkill({ slash, overwrite });
      if (result.state === "requires_overwrite") {
        pendingConfigurableRun = {
          phase: "action_sheet",
          slash,
          title: skill?.title || result.skill?.title || slash,
          artifactPath: result.artifactPath || "",
          skill: result.skill || skill || {},
        };
        renderConfigurableSkillExistingOutputSheet(result);
        updateReport({
          status: "warned",
          artifacts: result.artifactPath ? [result.artifactPath] : [],
        });
        recordCommandInteraction({
          renderedState: "configurable_skill/output_replace",
          status: "warned",
          providerRunInvoked: false,
        });
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Output document already exists</strong><br /><code>${escapeHtml(result.artifactPath || "output document")}</code> already exists. This does not replace or edit the skill version.`,
          bar: "Output Exists",
          terminal: `[configurable-skill] output replacement required for ${slash}`,
        });
        return;
      }
      renderConfigurableSkillRunResult(result);
      const skillName = formatConfigurableSkillDisplayName(result.skill || skill || result.runRecord || {}, slash || "Custom Skill");
      updateReport({
        status: "ran",
        skillName,
        providerModel: [result.aiRun?.provider, result.aiRun?.model].filter(Boolean).join(" / "),
        artifacts: [result.outputPaths?.markdown, result.outputPaths?.json].filter(Boolean),
        runId: result.runId || result.runRecord?.id || "",
        runRecord: result.runRecord || null,
        overwrite: result.runRecord?.overwrite || (overwrite ? "approved" : "not_needed"),
      });
      recordCommandInteraction({
        renderedState: "configurable_skill/run",
        status: "ran",
        providerRunInvoked: true,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill complete</strong><br />Wrote <code>${escapeHtml(result.outputPaths?.markdown || result.outputPath || "configured artifact")}</code>.`,
        bar: "Skill Complete",
        terminal: `[configurable-skill] wrote ${result.outputPaths?.markdown || result.outputPath || slash}`,
      });
    } catch (error) {
      renderCommandRailError(error.message);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "configurable_skill/run",
        status: "failed",
        providerRunInvoked: overwrite,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Failed",
        terminal: `[configurable-skill] failed: ${error.message}`,
      });
    } finally {
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "→";
    }
  }

  async function handlePendingConfigurableRunInput(userRequest) {
    const pendingPhase = pendingConfigurableRun?.phase || "overwrite";
    const action = classifyConfigurableSkillRunInput(userRequest, { phase: pendingPhase });
    if (action === "cancel_improvement") {
      clearPendingConfigurableRun("Skill improvement cancelled", "No improvement idea was saved.");
      return true;
    }
    if (action === "save_improvement") {
      await improvementActions.saveConfigurableSkillImprovement(userRequest);
      return true;
    }
    if (action === "open_output") {
      openPendingConfigurableOutput();
      return true;
    }
    if (action === "accept_run") {
      markConfigurableSkillRunAccepted();
      return true;
    }
    if (action === "improve_skill") {
      improvementActions.renderConfigurableSkillImprovementPrompt();
      return true;
    }
    if (action === "show_overwrite_prompt") {
      renderConfigurableSkillOverwritePrompt(pendingConfigurableRun);
      return true;
    }
    if (action === "clear_action_sheet") {
      clearPendingConfigurableRun("No action taken", "Kept the existing output document. Nothing ran and the skill was not changed.");
      return true;
    }
    if (action === "cancel_overwrite") {
      const pending = pendingConfigurableRun;
      pendingConfigurableRun = null;
      let cancelled = null;
      try {
        cancelled = await cancelConfigurableSkillRun({
          slash: pending?.slash || "",
          artifactPath: pending?.artifactPath || "",
        });
      } catch {
        cancelled = null;
      }
      renderConfigurableSkillCancelledResult(cancelled || {
        skill: pending?.skill || { slash: pending?.slash, title: pending?.title },
        artifactPath: pending?.artifactPath || "",
      });
      updateReport({
        status: "cancelled",
        skillName: formatConfigurableSkillDisplayName(cancelled?.skill || pending?.skill || cancelled?.runRecord || {}, pending?.slash || "Custom Skill"),
        artifacts: pending?.artifactPath ? [pending.artifactPath] : [],
        runId: cancelled?.runId || cancelled?.runRecord?.id || "",
        runRecord: cancelled?.runRecord || null,
        overwrite: "cancelled",
      });
      recordCommandInteraction({
        renderedState: "configurable_skill/output_replace",
        status: "cancelled",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Kept existing output document</strong><br />Nothing ran and the skill was not changed.",
        bar: "Run Cancelled",
        terminal: "[configurable-skill] output replacement cancelled",
      });
      return true;
    }
    if (action === "replace_output") {
      const pending = pendingConfigurableRun;
      await runConfigurableSkillCommand(pending, userRequest, { overwrite: true });
      return true;
    }
    return false;
  }

  function renderConfigurableSkillExistingOutputSheet(result = {}) {
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillExistingOutputSheetHtml(result, pendingConfigurableRun || {});
    aiCommandInput.placeholder = "Open output, Run again, Improve this skill, or Cancel";
    wireConfigurableSkillActions();
  }

  function renderConfigurableSkillOverwritePrompt(result = {}) {
    if (!aiCommandSession) return;
    if (pendingConfigurableRun) pendingConfigurableRun.phase = "overwrite";
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillOverwritePromptHtml(result, pendingConfigurableRun || {});
    aiCommandInput.placeholder = "Replace output document or Keep existing output document";
    wireConfigurableSkillActions();
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Output document exists</strong><br /><code>${escapeHtml(result.artifactPath || pendingConfigurableRun?.artifactPath || "output document")}</code> already exists. This does not replace or edit the skill version.`,
      bar: "Replace Output?",
      terminal: `[configurable-skill] output replacement confirmation for ${pendingConfigurableRun?.slash || ""}`,
    });
  }

  function clearPendingConfigurableRun(title, message) {
    pendingConfigurableRun = null;
    aiCommandInput.placeholder = defaultPlaceholder;
    aiCommandSubmit.textContent = "→";
    if (aiCommandSession) {
      aiCommandSession.hidden = false;
      aiCommandSession.innerHTML = `
        <section class="command-interview" aria-live="polite">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
        </section>
      `;
    }
    updateReport({ status: "cancelled" });
    recordCommandInteraction({
      renderedState: "configurable_skill/action_sheet",
      status: "cancelled",
      providerRunInvoked: false,
    });
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${escapeHtml(title)}</strong><br />${escapeHtml(message)}`,
      bar: title,
      terminal: "[configurable-skill] no action taken",
    });
  }

  function openPendingConfigurableOutput() {
    const pending = pendingConfigurableRun;
    const artifactPath = pending?.artifactPath || "";
    if (!artifactPath || !ctx.openFilePreview) {
      renderCommandRailError("Output preview is unavailable.");
      return;
    }
    ctx.openFilePreview(artifactPath, "true", artifactPath.endsWith(".md") ? "markdown" : "");
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Opened output</strong><br /><code>${escapeHtml(artifactPath)}</code>.`,
      bar: "Output Opened",
      terminal: `[configurable-skill] opened ${artifactPath}`,
    });
  }

  function renderConfigurableSkillRunResult(result = {}) {
    setCurrentSkillIdeaInterview(null);
    aiCommandInput.placeholder = defaultPlaceholder;
    aiCommandSubmit.textContent = "→";
    const skill = result.skill || {};
    pendingConfigurableRun = buildConfigurableRunPending(result);
    breadcrumbs.textContent = skill.slash || "custom skill";
    editorContent.innerHTML = renderConfigurableSkillRunOutput(result);
    if (aiCommandSession) {
      aiCommandSession.hidden = false;
      aiCommandSession.innerHTML = renderConfigurableSkillRunRail(result);
      wireConfigurableSkillActions();
      wireConfigurableRunReportActions();
    }
  }

  function renderConfigurableSkillCancelledResult(result = {}) {
    aiCommandInput.placeholder = defaultPlaceholder;
    aiCommandSubmit.textContent = "→";
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillCancelledRail(result);
    wireConfigurableRunReportActions();
  }

  function wireConfigurableRunReportActions() {
    aiCommandSession?.querySelectorAll?.("[data-configurable-run-action='copy-report']")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const runRecord = commandReport.getReport()?.runRecord;
        if (!runRecord) {
          await copyLatestReport();
          return;
        }
        button.disabled = true;
        try {
          await writeClipboardText(formatConfigurableSkillRunReport(runRecord));
          setReportStatus("Run report copied.");
        } catch (error) {
          setReportStatus(`Copy failed: ${error.message}`, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function wireConfigurableSkillActions() {
    aiCommandSession?.querySelectorAll?.("[data-configurable-skill-action]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.configurableSkillAction;
        if (action === "overwrite") {
          const pending = pendingConfigurableRun;
          await runConfigurableSkillCommand(pending, "replace output document", { overwrite: true });
          return;
        }
        if (action === "run-again") {
          renderConfigurableSkillOverwritePrompt(pendingConfigurableRun || {});
          return;
        }
        if (action === "looks-good") {
          markConfigurableSkillRunAccepted();
          return;
        }
        if (action === "open-output") {
          openPendingConfigurableOutput();
          return;
        }
        if (action === "improve") {
          improvementActions.renderConfigurableSkillImprovementPrompt();
          return;
        }
        if (action === "open-skills") {
          await deterministicCommands.showSkillsPage("open skills");
          return;
        }
        if (action === "cancel") {
          await handlePendingConfigurableRunInput(pendingConfigurableRun?.phase === "overwrite" ? "keep current" : "cancel");
        }
      });
    });
  }

  function markConfigurableSkillRunAccepted() {
    const slash = pendingConfigurableRun?.slash || pendingConfigurableRun?.skill?.slash || "";
    const artifactPath = getConfigurableRunArtifactPath(pendingConfigurableRun?.result || {}) || pendingConfigurableRun?.artifactPath || "";
    const acceptance = aiCommandSession?.querySelector?.("[data-configurable-run-acceptance]");
    if (acceptance) {
      acceptance.textContent = "Marked as good for this run. The active skill was not changed.";
    } else if (aiCommandSession?.innerHTML) {
      aiCommandSession.innerHTML = aiCommandSession.innerHTML.replace(
        "The result is also shown in the main pane for review.",
        "Marked as good for this run. The active skill was not changed.",
      );
    }
    updateReport({
      status: "accepted",
      artifacts: artifactPath ? [artifactPath] : commandReport.getReport()?.artifacts || [],
    });
    recordCommandInteraction({
      renderedState: "configurable_skill/run_review",
      status: "accepted",
      providerRunInvoked: false,
    });
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Run accepted</strong><br />Marked <code>${escapeHtml(slash || "this skill")}</code> output as good for this run.`,
      bar: "Run Accepted",
      terminal: `[configurable-skill] run accepted ${slash}`.trim(),
    });
  }

  function wireCreatedSkillActions() {
    aiCommandSession?.querySelectorAll?.("[data-created-skill-action]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.createdSkillAction;
        if (action === "run") {
          const skill = lastCreatedConfigurableSkill;
          if (skill?.slash) await runConfigurableSkillCommand(skill, skill.slash);
          return;
        }
        if (action === "open-skills") {
          await deterministicCommands.showSkillsPage("open skills");
          return;
        }
        if (action === "start-another") {
          setCurrentSkillIdeaInterview(null);
          if (aiCommandInput) {
            aiCommandInput.value = "";
            aiCommandInput.placeholder = "create a skill to...";
          }
          aiCommandSubmit.disabled = false;
          aiCommandSubmit.textContent = "→";
          if (aiCommandSession) {
            aiCommandSession.hidden = true;
            aiCommandSession.innerHTML = "";
          }
          editorContent.innerHTML = `
            <h1>Command</h1>
            <section class="skill-router-result">
              <h2>Start another idea</h2>
              <p>Type the next skill idea in the Command rail. Nothing will run until it becomes a validated skill in a later workflow.</p>
            </section>
          `;
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Ready for another idea</strong><br />Type a new skill idea in the Command rail.",
            bar: "Skill Idea",
            terminal: "[skill-ideas] ready for another idea",
          });
          recordCommandInteraction({
            renderedState: "skill_idea/start_another",
            status: "started_another_idea",
            providerRunInvoked: false,
          });
        }
      });
    });
  }

  function renderCreatedSkillCommandRail(skill = {}) {
    lastCreatedConfigurableSkill = skill;
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderCreatedSkillCommandRailHtml(skill);
    wireCreatedSkillActions();
  }

  function clearPendingForMatterChange() {
    pendingConfigurableRun = null;
  }

  function hasPendingRun() {
    return Boolean(pendingConfigurableRun);
  }

  return {
    clearPendingForMatterChange,
    findConfigurableSkillCommand,
    findConfigurableSkillRevisionCommand,
    handlePendingConfigurableRunInput,
    hasPendingRun,
    renderCreatedSkillCommandRail,
    runConfigurableSkillCommand,
    startConfigurableSkillImprovement,
  };
}
