import { postJson } from "./api-client.js";
import { writeClipboardText } from "./clipboard.js";
import { escapeHtml } from "./dom-utils.js";
import {
  formatSkillSampleCopy,
  getSampleId,
  getSampleState,
  getSampleVersion,
  normalizeUiSample,
} from "./skill-sample-review.js";
import {
  formatConfigurableSkillRunReport,
  formatSkillFactoryHealthReport,
  formatSkillIdeaImplementationBrief,
  formatSkillIdeaReviewPacket,
} from "./views/skills-page.js";

export function wireSkillsPageActions({
  configurableSkillRuns = null,
  ctx,
  editorContent,
  registry = {},
  renderSkills,
  skillFactoryHealth = null,
  skillIdeaSamplesById = {},
  skillIdeas = [],
} = {}) {
  wireSkillsPageCommandActions({ ctx, editorContent });
  wireSkillFactoryHealthActions({ ctx, editorContent, skillFactoryHealth });
  wireSkillIdeaActions({
    ctx,
    editorContent,
    ideas: skillIdeas,
    registry,
    renderSkills,
    samplesByIdea: skillIdeaSamplesById,
  });
  wireConfigurableSkillRunActions({ configurableSkillRuns, ctx, editorContent });
}

export function wireActivityPageActions({ configurableSkillRuns = null, ctx, editorContent } = {}) {
  wireConfigurableSkillRunActions({ configurableSkillRuns, ctx, editorContent });
}

function wireSkillsPageCommandActions({ ctx, editorContent } = {}) {
  editorContent?.querySelectorAll?.("[data-skill-card-command]")?.forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.skillCardCommand || "";
      if (!command) return;
      if (ctx.elements.aiCommandInput) ctx.elements.aiCommandInput.value = command;
      ctx.runCommand?.(command);
    });
  });
}

function wireConfigurableSkillRunActions({ configurableSkillRuns = null, ctx, editorContent } = {}) {
  const runsById = new Map((Array.isArray(configurableSkillRuns?.runs) ? configurableSkillRuns.runs : [])
    .map((run) => [run.id, run]));
  editorContent?.querySelectorAll?.("[data-configurable-run-copy]")?.forEach((button) => {
    button.addEventListener("click", async () => {
      const runId = button.dataset.configurableRunCopy;
      const run = runsById.get(runId);
      if (!run) return;
      button.disabled = true;
      try {
        await writeClipboardText(formatConfigurableSkillRunReport(run));
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Run report copied</strong><br />Metadata only. No provider call or matter artifact write occurred.",
          bar: "Run Report Copied",
          terminal: `[skills] copied run report for ${run.slash || run.id}`,
        });
      } catch (error) {
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Run report copy failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Run Report Failed",
          terminal: `[skills] run report copy failed: ${error.message}`,
        });
      } finally {
        button.disabled = false;
      }
    });
  });
  editorContent?.querySelectorAll?.("[data-activity-open-output]")?.forEach((button) => {
    button.addEventListener("click", () => {
      const filePath = button.dataset.activityOpenOutput || "";
      if (!filePath || !ctx.openFilePreview) return;
      ctx.openFilePreview(filePath, "true", "markdown");
    });
  });
}

function wireSkillFactoryHealthActions({ ctx, editorContent, skillFactoryHealth = null } = {}) {
  const button = editorContent?.querySelector?.("[data-skill-factory-copy-health]");
  if (!button) return;
  button.addEventListener("click", async () => {
    const status = editorContent.querySelector("[data-skill-factory-copy-health-status]");
    if (!skillFactoryHealth) {
      setArtifactActionStatus(status, "Health report unavailable.", true);
      return;
    }
    button.disabled = true;
    setArtifactActionStatus(status, "Copying health report...");
    try {
      await writeClipboardText(formatSkillFactoryHealthReport(skillFactoryHealth));
      setArtifactActionStatus(status, "Health report copied.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Health report copied</strong><br />Read-only. No provider call, skill run, repair, or matter artifact write occurred.",
        bar: "Skill Factory Health Copied",
        terminal: "[skills] copied skill factory health report",
      });
    } catch (error) {
      setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Health report copy failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Factory Health Failed",
        terminal: `[skills] health report copy failed: ${error.message}`,
      });
    } finally {
      button.disabled = false;
    }
  });
}

function wireSkillIdeaActions({ ctx, editorContent, ideas = [], registry = {}, renderSkills, samplesByIdea = {} } = {}) {
  const ideaById = new Map((Array.isArray(ideas) ? ideas : [])
    .map((idea) => [idea.id, idea]));
  const sampleById = new Map();
  for (const samples of Object.values(samplesByIdea || {})) {
    for (const sample of Array.isArray(samples) ? samples : []) {
      const normalized = normalizeUiSample(sample);
      const sampleId = getSampleId(normalized);
      if (sampleId) sampleById.set(sampleId, normalized);
    }
  }
  editorContent?.querySelectorAll?.("[data-skill-idea-copy-packet]")?.forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.skillIdeaId;
      const idea = ideaById.get(id);
      const status = editorContent.querySelector(`[data-skill-idea-copy-status="${cssEscape(id || "")}"]`);
      if (!idea) {
        setArtifactActionStatus(status, "Idea not found.", true);
        return;
      }
      button.disabled = true;
      setArtifactActionStatus(status, "Copying review packet...");
      try {
        await writeClipboardText(formatSkillIdeaReviewPacket(idea, registry));
        setArtifactActionStatus(status, "Review packet copied.");
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Review packet copied</strong><br />No provider call, prompt generation, or matter artifact write occurred.",
          bar: "Skill Idea Packet Copied",
          terminal: `[skill-ideas] copied review packet for ${id}`,
        });
      } catch (error) {
        setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Review packet copy failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Skill Idea Copy Failed",
          terminal: `[skill-ideas] copy failed: ${error.message}`,
        });
      } finally {
        button.disabled = false;
      }
    });
  });

  editorContent?.querySelectorAll?.("[data-skill-idea-copy-implementation-brief]")?.forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.skillIdeaId;
      const idea = ideaById.get(id);
      const status = editorContent.querySelector(`[data-skill-idea-copy-status="${cssEscape(id || "")}"]`);
      if (!idea) {
        setArtifactActionStatus(status, "Idea not found.", true);
        return;
      }
      button.disabled = true;
      setArtifactActionStatus(status, "Copying implementation brief...");
      try {
        await writeClipboardText(formatSkillIdeaImplementationBrief(idea, registry));
        setArtifactActionStatus(status, "Implementation brief copied.");
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Implementation brief copied</strong><br />Governance-only. No skill, prompt, provider call, or matter artifact was created.",
          bar: "Implementation Brief Copied",
          terminal: `[skill-ideas] copied implementation brief for ${id}`,
        });
      } catch (error) {
        setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Implementation brief copy failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Implementation Brief Failed",
          terminal: `[skill-ideas] implementation brief copy failed: ${error.message}`,
        });
      } finally {
        button.disabled = false;
      }
    });
  });

  editorContent?.querySelectorAll?.("[data-skill-idea-copy-sample]")?.forEach((button) => {
    button.addEventListener("click", async () => {
      const ideaId = button.dataset.skillIdeaId || "";
      const sampleId = button.dataset.sampleId || "";
      const sample = sampleById.get(sampleId);
      const status = editorContent.querySelector(`[data-skill-idea-copy-status="${cssEscape(ideaId)}"]`);
      if (!sample) {
        setArtifactActionStatus(status, "Sample not found.", true);
        return;
      }
      button.disabled = true;
      setArtifactActionStatus(status, "Copying sample...");
      try {
        await writeClipboardText(formatSkillSampleCopy(sample, {
          version: getSampleVersion(sample, 1),
          approved: getSampleState(sample) === "approved_current",
        }));
        setArtifactActionStatus(status, "Sample copied.");
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Sample copied</strong><br />This is review output only; no skill or matter artifact was created.",
          bar: "Sample Copied",
          terminal: `[skill-ideas] copied sample ${sampleId}`,
        });
      } catch (error) {
        setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Sample copy failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Sample Copy Failed",
          terminal: `[skill-ideas] sample copy failed: ${error.message}`,
        });
      } finally {
        button.disabled = false;
      }
    });
  });

  editorContent?.querySelectorAll?.("[data-skill-idea-brief-form]")?.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = form.dataset.skillIdeaId;
      if (!id) return;
      const submit = form.querySelector("button[type='submit']");
      const originalText = submit?.textContent || "Save design brief";
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Saving...";
      }
      try {
        const formData = new FormData(form);
        await postJson(`/api/skill-ideas/${encodeURIComponent(id)}/design-brief`, {
          designBrief: {
            intendedUser: formData.get("intendedUser") || "",
            problem: formData.get("problem") || "",
            expectedInputs: formData.get("expectedInputs") || "",
            expectedOutputArtifact: formData.get("expectedOutputArtifact") || "",
            targetLane: formData.get("targetLane") || "",
            paidPosture: formData.get("paidPosture") || "",
            riskLevel: formData.get("riskLevel") || "",
            notes: formData.get("notes") || "",
          },
        });
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Design brief saved</strong><br />Still not runnable. No provider call or matter artifact was created.",
          bar: "Skill Idea Saved",
          terminal: `[skill-ideas] saved design brief for ${id}`,
        });
        await renderSkills();
      } catch (error) {
        if (submit) {
          submit.disabled = false;
          submit.textContent = originalText;
        }
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Design brief save failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Skill Idea Failed",
          terminal: `[skill-ideas] design brief failed: ${error.message}`,
        });
      }
    });
  });

  editorContent?.querySelectorAll?.("[data-skill-idea-id][data-skill-idea-status]")?.forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.skillIdeaId;
      const status = button.dataset.skillIdeaStatus;
      if (!id || !status) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "Saving...";
      try {
        await postJson(`/api/skill-ideas/${encodeURIComponent(id)}/status`, { status });
        await renderSkills();
      } catch (error) {
        button.disabled = false;
        button.textContent = originalText;
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Skill idea update failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Skill Idea Failed",
          terminal: `[skill-ideas] update failed: ${error.message}`,
        });
      }
    });
  });
}

function setArtifactActionStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("form-error", Boolean(isError));
}

function cssEscape(value) {
  if (globalThis.window?.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
