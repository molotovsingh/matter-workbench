import { escapeHtml } from "./dom-utils.js";
import { refreshSkillIdeaSampleLedger as refreshSampleLedger } from "./skill-idea-sample-ledger.js";
import {
  ensureSampleReview,
  findSampleByVersion,
  formatSampleProvider,
  formatSkillSampleCopy,
  getLedgerSamples,
  getSampleId,
  getSampleMarkdown,
  getSampleState,
  getSampleVersion,
  normalizeUiSample,
  SKILL_SAMPLE_STATE,
} from "./skill-sample-review.js";
import { renderSkillSampleOutputHtml } from "./skill-builder-result-rendering.js";

export function createSkillIdeaSampleActions({
  aiCommandInput,
  aiCommandSubmit,
  approveSkillIdeaSample,
  breadcrumbs,
  createConfigurableSkillFromApprovedSample,
  ctx,
  editorContent,
  generateSkillIdeaSampleOutput,
  getLatestTerminalLines,
  getSession,
  getStatusBarText,
  listSkillIdeaSamples,
  recordCommandInteraction,
  renderSkillIdeaSession,
  saveSkillIdeaInterviewSession,
  updateReport,
  writeClipboardText,
} = {}) {
  async function generateSavedSkillIdeaSample({ feedback = "" } = {}) {
    const session = getSession?.();
    const activeMatter = ctx.getActiveMatter?.() || {};
    if (!activeMatter?.folderName) {
      renderSkillIdeaSession("Pick a test matter before generating sample output.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No test matter selected</strong><br />Pick a matter, then generate a sample output.",
        bar: "No Test Matter",
        terminal: "[skill-ideas] sample requested without active matter",
      });
      return;
    }
    let idea = session?.savedIdea;
    if (!idea) {
      idea = await saveSkillIdeaInterviewSession({ silent: true });
      if (!idea) return;
    }

    const sampleReview = ensureSampleReview(session);
    const previousSample = getSampleMarkdown(sampleReview.activeSample);
    sampleReview.generating = true;
    session.sampleReview = sampleReview;
    renderSkillIdeaSession();
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Generating...";
    ctx.setStatus({
      mood: "thinking",
      card: "<strong>Generating sample output</strong><br />This may take a minute. No matter files will be changed.",
      bar: "Generating Sample",
      terminal: `[skill-ideas] generating sample output for ${idea.id || "proposal"}`,
    });
    try {
      const sample = normalizeUiSample(await generateSkillIdeaSampleOutput({
        idea,
        feedback,
        previousSample,
      }));
      if (!sample.version || sample.version === 1 && sampleReview.samples.length > 0) {
        sample.version = sampleReview.samples.length + 1;
      }
      sampleReview.samples.push(sample);
      sampleReview.activeSample = sample;
      sampleReview.approved = false;
      sampleReview.stale = false;
      sampleReview.staleReason = "";
      sampleReview.generating = false;
      session.sampleReview = sampleReview;
      await refreshSkillIdeaSampleLedger({ selectSampleId: getSampleId(sample) });
      updateReport({
        status: feedback ? "sample_feedback" : "sample_generated",
        skillIdeaId: idea.id || "",
        providerModel: formatSampleProvider(sample),
        sampleId: getSampleId(sample),
      });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: feedback ? "sample_feedback" : "sample_generated",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
      });
      renderSkillSampleOutput(sampleReview.activeSample || sample, {
        version: getSampleVersion(sampleReview.activeSample || sample, sampleReview.samples.length),
        approved: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Sample output ready</strong><br />Review it, type feedback to regenerate, or choose Looks useful to try creating the skill.",
        bar: "Sample Output Ready",
        terminal: `[skill-ideas] sample v${sampleReview.samples.length} generated`,
      });
      aiCommandInput.value = "";
      aiCommandInput.placeholder = "Type feedback, Looks useful, Copy Sample, or Regenerate sample";
      renderSkillIdeaSession();
    } catch (error) {
      sampleReview.generating = false;
      session.sampleReview = sampleReview;
      updateReport({ status: "failed", error: error.message, skillIdeaId: idea.id || "" });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
        error: error.message,
      });
      renderSkillIdeaSession(`Sample generation failed: ${error.message}`);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Sample generation failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Sample Failed",
        terminal: `[skill-ideas] sample failed: ${error.message}`,
      });
    } finally {
      sampleReview.generating = false;
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "→";
    }
  }

  async function approveSavedSkillIdeaSampleAndCreateSkill() {
    const session = getSession?.();
    const idea = session?.savedIdea;
    if (!idea) return;
    const sampleReview = ensureSampleReview(session);
    if (!sampleReview.activeSample) {
      renderSkillIdeaSession("Generate a sample output before approving it.");
      return;
    }
    const sampleId = getSampleId(sampleReview.activeSample);
    if (!sampleId) {
      renderSkillIdeaSession("The current sample is not persisted. Regenerate the sample before approving it.");
      return;
    }
    if (sampleReview.stale) {
      renderSkillIdeaSession("Regenerate the sample after the design brief changes before approving it.");
      return;
    }
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Approving...";
    try {
      const payload = await approveSkillIdeaSample(idea.id, sampleId);
      const approvedSample = payload.sample || {};
      sampleReview.activeSample = normalizeUiSample({
        ...sampleReview.activeSample,
        approved: true,
        approved_at: approvedSample.approvedAt || approvedSample.approved_at || "",
        state: SKILL_SAMPLE_STATE.APPROVED_CURRENT,
      });
      sampleReview.approved = true;
      sampleReview.stale = false;
      sampleReview.staleReason = "";
      session.sampleReview = sampleReview;
      await refreshSkillIdeaSampleLedger({ selectSampleId: sampleId });
      updateReport({
        status: "sample_approved",
        skillIdeaId: idea.id || "",
        sampleId,
      });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "sample_approved",
        skillIdeaId: idea.id || "",
        sampleId,
        providerRunInvoked: false,
      });
      renderSkillSampleOutput(sampleReview.activeSample, {
        version: getSampleVersion(sampleReview.activeSample, sampleReview.samples.length),
        approved: true,
      });
      renderSkillIdeaSession();
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Sample approved</strong><br />Checking whether it can become a runnable skill.",
        bar: "Sample Approved",
        terminal: "[skill-ideas] sample approved",
      });
      await createConfigurableSkillFromApprovedSample();
    } catch (error) {
      renderSkillIdeaSession(`Sample approval failed: ${error.message}`);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "failed",
        skillIdeaId: idea.id || "",
        sampleId,
        providerRunInvoked: false,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Sample approval failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Sample Approval Failed",
        terminal: `[skill-ideas] sample approval failed: ${error.message}`,
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

  async function copySavedSkillIdeaSample() {
    const session = getSession?.();
    const idea = session?.savedIdea;
    const sample = session?.sampleReview?.activeSample;
    if (!idea || !sample) return;
    await copySkillIdeaSample(sample, {
      version: getSampleVersion(sample, session.sampleReview.samples.length),
      approved: session.sampleReview.approved,
    });
  }

  async function copySavedSkillIdeaSampleByVersion(version) {
    const session = getSession?.();
    const idea = session?.savedIdea;
    const sampleReview = ensureSampleReview(session || {});
    const sample = findSampleByVersion(sampleReview, version);
    if (!idea || !sample) {
      renderSkillIdeaSession(`Sample v${Number(version || 0) || "?"} is not available in the ledger.`);
      return;
    }
    await copySkillIdeaSample(sample, {
      version: getSampleVersion(sample, version),
      approved: getSampleState(sample) === SKILL_SAMPLE_STATE.APPROVED_CURRENT,
    });
  }

  async function copyLedgerSampleById(sampleId = "") {
    const sampleReview = getSession?.()?.sampleReview || {};
    const sample = getLedgerSamples(sampleReview).find((candidate) => getSampleId(candidate) === sampleId);
    if (!sample) return;
    await copySkillIdeaSample(sample, {
      version: getSampleVersion(sample, 1),
      approved: getSampleState(sample) === SKILL_SAMPLE_STATE.APPROVED_CURRENT,
    });
  }

  async function copySkillIdeaSample(sample, { version, approved } = {}) {
    const session = getSession?.();
    const idea = session?.savedIdea;
    if (!idea || !sample) return;
    try {
      await writeClipboardText(formatSkillSampleCopy(sample, {
        version,
        approved,
      }));
      updateReport({
        status: "copied_sample",
        skillIdeaId: idea.id || "",
        sampleId: getSampleId(sample),
      });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "copied_sample",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Sample copied</strong><br />This is a review sample only; no skill was created.",
        bar: "Sample Copied",
        terminal: `[skill-ideas] copied sample ${getSampleId(sample)}`,
      });
      renderSkillIdeaSession();
    } catch (error) {
      renderSkillIdeaSession(`Sample copy failed: ${error.message}`);
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Sample copy failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Sample Copy Failed",
        terminal: `[skill-ideas] sample copy failed: ${error.message}`,
      });
    }
  }

  function renderSkillSampleOutput(sample, { version, approved } = {}) {
    const sampleReview = getSession?.()?.sampleReview || {};
    breadcrumbs.textContent = "sample output";
    editorContent.innerHTML = renderSkillSampleOutputHtml(sample, { version, approved, sampleReview });
  }

  async function refreshSkillIdeaSampleLedger({ selectSampleId = "" } = {}) {
    return refreshSampleLedger({
      session: getSession?.(),
      listSkillIdeaSamples,
      selectSampleId,
    });
  }

  return {
    approveSavedSkillIdeaSampleAndCreateSkill,
    copyLedgerSampleById,
    copySavedSkillIdeaSample,
    copySavedSkillIdeaSampleByVersion,
    generateSavedSkillIdeaSample,
  };
}
