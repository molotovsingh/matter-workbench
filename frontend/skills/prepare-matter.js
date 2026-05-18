import { getJson, postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { lawyerActionCompleteLabel, lawyerActionLabel, lawyerActionRunningLabel } from "../lawyer-labels.js";
import { PREPARATION_STAGE_ACTIONS } from "../../shared/preparation-stage-actions.mjs";
import {
  renderPrepareMatterHtml,
  renderPreparePaidConfirmationHtml,
} from "../views/prepare-matter-result.js";

export function createPrepareMatterSkill(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;
  let latestPlan = null;

  async function runPrepareMatter(command = "/prepare_matter") {
    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = "Prepare matter";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Preparing matter</strong><br />Checking saved matter work...",
      bar: "Prepare Matter",
      terminal: [
        `> workbench.run ${command}`,
        "[prepare] reading disk-derived matter status...",
        "[prepare] provider calls disabled for planning",
      ],
    });
    await loadAndRenderPlan();
  }

  async function loadAndRenderPlan() {
    latestPlan = await getJson("/api/prepare-matter");
    renderPlan(latestPlan);
    return latestPlan;
  }

  function renderPlan(plan) {
    editorContent.innerHTML = renderPrepareMatterHtml(plan, escapeHtml);
    const runPlan = document.getElementById("runPrepareMatterPlan");
    const runNext = document.getElementById("runPrepareMatterNext");
    const refresh = document.getElementById("refreshPrepareMatterPlan");
    if (runPlan) runPlan.addEventListener("click", () => runPreparation({ oneStage: false }));
    if (runNext) runNext.addEventListener("click", () => runPreparation({ oneStage: true }));
    if (refresh) refresh.addEventListener("click", () => loadAndRenderPlan());

    const next = plan?.nextStep || {};
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Prepare Matter</strong><br />${escapeHtml(next.message || "Review the preparation plan.")}`,
      bar: "Prepare Matter Ready",
      terminal: [
        "[prepare] plan ready",
        `[prepare] next: ${next.message || "review plan"}`,
      ],
    });
  }

  async function runPreparation({ oneStage }) {
    let loops = 0;
    while (loops < 5) {
      loops += 1;
      const plan = await loadAndRenderPlan();
      const stage = nextActionableStage(plan);
      if (!stage) {
        ctx.setStatus({
          mood: "success",
          card: "<strong>Preparation current</strong><br />Core preparation stages are current or blocked for review.",
          bar: "Prepare Matter Current",
          terminal: "[prepare] no runnable preparation stage",
        });
        return;
      }
      if (stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED) {
        const stageLabel = lawyerActionLabel(stage, stage.label);
        ctx.setStatus({
          mood: "idle",
          card: `<strong>${escapeHtml(stageLabel)} blocked</strong><br />${escapeHtml(stage.reason || "Resolve this before continuing.")}`,
          bar: "Prepare Matter Blocked",
          terminal: `[prepare] blocked: ${stage.slash}`,
        });
        return;
      }
      if (stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
        const confirmed = await confirmPaidSourceLabeling(stage);
        if (!confirmed) {
          await loadAndRenderPlan();
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Preparation paused</strong><br />Paid source labeling was not run.",
            bar: "Prepare Matter Paused",
            terminal: "[prepare] paid source labeling cancelled by user",
          });
          return;
        }
      }

      const ok = await runStage(stage);
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
      if (!ok || oneStage) {
        await loadAndRenderPlan();
        return;
      }
    }
    await loadAndRenderPlan();
  }

  async function runStage(stage) {
    const stageLabel = lawyerActionLabel(stage, stage.label);
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${escapeHtml(lawyerActionRunningLabel(stage, `Running ${stageLabel}`))}</strong><br />Using the existing preparation step.`,
      bar: `${stageLabel} Running`,
      terminal: [
        `> workbench.run ${stage.slash}`,
        `[prepare] running child stage: ${stage.slash}`,
      ],
    });
    try {
      if (stage.slash === "/matter-init") {
        const activeMatter = ctx.getActiveMatter();
        const payload = await postJson("/api/matter-init", { metadata: activeMatter.metadata || {} });
        ctx.mergeActiveMatterState?.({ fileCount: payload.counts?.scannedFiles || activeMatter.fileCount });
      } else if (stage.slash === "/extract") {
        await postJson("/api/extract", { dryRun: false });
      } else if (stage.slash === "/describe_sources") {
        await postJson("/api/describe-sources", { dryRun: false });
      } else {
        throw new Error(`Unsupported preparation stage: ${stage.slash}`);
      }
      ctx.setStatus({
        mood: "success",
        card: `<strong>${escapeHtml(lawyerActionCompleteLabel(stage, `${stageLabel} complete`))}</strong><br />Preparation will recompute the next step from saved files.`,
        bar: `${stageLabel} Complete`,
        terminal: `[prepare] complete: ${stage.slash}`,
      });
      return true;
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>${escapeHtml(stageLabel)} failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Prepare Matter Failed",
        terminal: [
          `[prepare] failed: ${stage.slash}`,
          `[prepare] ${error.message}`,
          "[prepare] downstream preparation steps were not run",
        ],
      });
      editorContent.innerHTML = `
        <h1>Prepare Matter</h1>
        <div class="run-failure-card">
          <strong>${escapeHtml(stageLabel)} failed</strong>
          ${escapeHtml(error.message)}<br />
          Downstream preparation steps were not run. Fix the issue, then run Prepare Matter again to resume from saved files.
        </div>
        <div class="form-actions">
          <button type="button" class="run-skill-button" id="prepareMatterRetry">Refresh plan</button>
        </div>
      `;
      document.getElementById("prepareMatterRetry")?.addEventListener("click", () => loadAndRenderPlan());
      return false;
    }
  }

  function confirmPaidSourceLabeling(stage) {
    editorContent.innerHTML = renderPreparePaidConfirmationHtml(stage, escapeHtml);
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Confirm paid source labeling</strong><br />Label sources may call the configured AI provider.",
      bar: "Prepare Matter Confirmation",
      terminal: "[prepare] paid source labeling confirmation shown",
    });
    return new Promise((resolve) => {
      const cancel = document.getElementById("preparePaidCancel");
      const run = document.getElementById("preparePaidRun");
      if (!cancel || !run) {
        resolve(false);
        return;
      }
      cancel.focus?.();
      cancel.addEventListener("click", () => resolve(false), { once: true });
      run.addEventListener("click", () => resolve(true), { once: true });
    });
  }

  return { runPrepareMatter };
}

function nextActionableStage(plan) {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => stage.action === PREPARATION_STAGE_ACTIONS.RUN || stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN)
    || stages.find((stage) => stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED)
    || null;
}
