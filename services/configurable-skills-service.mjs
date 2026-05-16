import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  buildConfigurableSkillMatterContextPacket,
  summarizeMatterContext,
} from "./configurable-skill-context.mjs";
import {
  boundedOutputMarkdown,
  CONFIGURABLE_SKILL_SCHEMA_VERSION,
  normalizeArtifactPath,
  normalizeAuthoredDefinition,
  normalizeSlash,
  normalizeStoredSkill,
  normalizeText,
  primaryActiveSkills,
  publicSkill,
  skillToRegistryCard,
  slashFromTitle,
  uniqueSlash,
} from "./configurable-skill-definition.mjs";
import {
  AUTHORING_SCHEMA,
  createDefaultAuthoringProvider,
  createDefaultRunProvider,
} from "./configurable-skill-providers.mjs";
import {
  createNoopRunLedger,
  matterSummaryForRun,
  skillRunTitle,
} from "./configurable-skill-run-metadata.mjs";
import {
  CONFIGURABLE_SKILLS_SCHEMA_VERSION,
  createConfigurableSkillStore,
} from "./configurable-skill-store.mjs";
import { validateDraftSkill } from "./configurable-skill-validation.mjs";
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { BUILTIN_SKILL_COMMANDS } from "../shared/builtin-skill-commands.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";

export { CONFIGURABLE_SKILLS_SCHEMA_VERSION } from "./configurable-skill-store.mjs";
export { CONFIGURABLE_SKILL_SCHEMA_VERSION, skillToRegistryCard } from "./configurable-skill-definition.mjs";
export {
  createOpenAiAuthoringProvider,
  createOpenAiRunProvider,
  createOpenRouterAuthoringProvider,
  createOpenRouterRunProvider,
} from "./configurable-skill-providers.mjs";

export function createConfigurableSkillsService({
  appDir,
  skillsPath,
  matterStore,
  skillIdeasService,
  skillSamplesService,
  configurableSkillRunsService,
  authoringProvider,
  runProvider,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  now = () => new Date(),
  idFactory = () => `skill_${randomUUID()}`,
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!skillIdeasService) throw new Error("skillIdeasService is required");
  if (!skillSamplesService) throw new Error("skillSamplesService is required");

  const {
    readStore,
    storePath,
    updateStore,
  } = createConfigurableSkillStore({ appDir, skillsPath });
  const runLedger = configurableSkillRunsService || createNoopRunLedger();

  async function listSkills() {
    const store = await readStore();
    return {
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skills: store.skills.map(normalizeStoredSkill),
    };
  }

  async function activeSkillCards() {
    const { skills } = await listSkills();
    return primaryActiveSkills(skills)
      .map(skillToRegistryCard);
  }

  async function createSkillFromApprovedSample({ ideaId } = {}) {
    const idea = await skillIdeasService.getIdea(ideaId);
    const sample = await skillSamplesService.getApprovedCurrentSample({
      ideaId: idea.id,
      designBrief: idea.designBrief,
    });
    let validationError = null;
    const result = await updateStore(async (store) => {
      const targetSlash = extractTargetSkillSlash(idea);
      const targetSkill = targetSlash
        ? store.skills.find((candidate) => candidate.slash === targetSlash && candidate.status === "active")
        : null;
      if (targetSlash && !targetSkill) {
        throw makeHttpError(`No active configurable skill found for ${targetSlash}`, 409);
      }
      const authoringPolicy = resolveModelPolicy(AI_TASKS.SKILL_AUTHORING, { env });
      const authoringProviderConfig = resolveProviderConfig(authoringPolicy, { endpoint });
      if (!authoringProviderConfig.model) throw makeHttpError("Skill authoring model is not configured.", 409);
      const provider = authoringProvider || createDefaultAuthoringProvider({
        providerConfig: authoringProviderConfig,
        env,
        fetchImpl,
      });
      const runPolicy = resolveModelPolicy(AI_TASKS.CONFIGURABLE_SKILL_RUN, { env });
      const runProviderConfig = resolveProviderConfig(runPolicy, { endpoint });
      if (!runProviderConfig.model) throw makeHttpError("Configurable skill run model is not configured.", 409);
      const validationRunProvider = runProvider || createDefaultRunProvider({
        providerConfig: runProviderConfig,
        env,
        fetchImpl,
      });
      const authored = normalizeAuthoredDefinition(await provider({
        idea,
        sample,
        existingSlashes: store.skills.map((skill) => skill.slash),
        targetSkill,
        providerConfig: authoringProviderConfig,
        schema: AUTHORING_SCHEMA,
      }), idea);
      authored.slash = targetSkill
        ? targetSkill.slash
        : uniqueSlash(authored.slash || slashFromTitle(authored.title), [
          ...store.skills.map((skill) => skill.slash),
          ...BUILTIN_SKILL_COMMANDS,
        ]);

      const timestamp = now().toISOString();
      const skillId = idFactory();
      const version = targetSkill ? targetSkill.version + 1 : 1;
      const draft = normalizeStoredSkill({
        id: skillId,
        schema_version: CONFIGURABLE_SKILL_SCHEMA_VERSION,
        status: "draft",
        version,
        familyId: targetSkill?.familyId || targetSkill?.id || skillId,
        previousSkillId: targetSkill?.id || "",
        replacedBySkillId: "",
        supersededAt: "",
        title: authored.title,
        slash: authored.slash,
        description: authored.description,
        sourceIdeaId: idea.id,
        sourceSampleId: sample.id,
        approvedSampleHash: sample.designBriefHash,
        targetLane: authored.target_lane,
        outputArtifact: authored.output_artifact,
        matterRequired: authored.matter_required,
        paidProviderCall: authored.paid_provider_call,
        sourceBacked: authored.source_backed,
        promptConfig: {
          prompt: authored.prompt,
          citationPolicy: authored.citation_policy,
        },
        modelPolicy: {
          task: AI_TASKS.CONFIGURABLE_SKILL_RUN,
          provider: runProviderConfig.provider,
          model: runProviderConfig.model,
        },
        validation: {
          status: "pending",
          messages: [],
          validatedAt: "",
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        activatedAt: "",
      });

      const validation = await validateDraftSkill({
        draft,
        sample,
        matterStore,
        runProvider: validationRunProvider,
        providerConfig: runProviderConfig,
      });
      draft.validation = validation;
      if (validation.status !== "passed") {
        store.skills.push(draft);
        validationError = makeHttpError(`Draft skill validation failed: ${validation.messages.join("; ")}`, 422);
        return {
          schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
          skill: normalizeStoredSkill(draft),
        };
      }
      draft.status = "active";
      draft.activatedAt = timestamp;
      draft.updatedAt = timestamp;
      if (targetSkill) {
        const previousIndex = store.skills.findIndex((skill) => skill.id === targetSkill.id);
        if (previousIndex !== -1) {
          store.skills[previousIndex] = normalizeStoredSkill({
            ...store.skills[previousIndex],
            status: "disabled",
            replacedBySkillId: draft.id,
            supersededAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
      store.skills.push(draft);
      return {
        schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
        skill: normalizeStoredSkill(draft),
      };
    });
    if (validationError) throw validationError;
    return result;
  }

  async function runSkill({ slash, overwrite = false } = {}) {
    const normalizedSlash = normalizeSlash(slash);
    const store = await readStore();
    const skill = store.skills.find((candidate) => candidate.slash === normalizedSlash && candidate.status === "active");
    if (!skill) throw makeHttpError(`No active configurable skill for ${normalizedSlash}`, 404);
    const matterRoot = matterStore.ensureMatterRoot();
    const outputArtifact = normalizeArtifactPath(skill.outputArtifact, skill.targetLane);
    const outputJson = outputArtifact.replace(/\.md$/i, ".json");
    const markdownPath = resolveRelativeInside(matterRoot, outputArtifact);
    const jsonPath = resolveRelativeInside(matterRoot, outputJson);
    if (!overwrite && await exists(markdownPath)) {
      return {
        schema_version: "configurable-skill-run/v1",
        state: "requires_overwrite",
        skill: publicSkill(skill),
        artifactPath: outputArtifact,
      };
    }

    const policy = resolveModelPolicy(AI_TASKS.CONFIGURABLE_SKILL_RUN, { env });
    const providerConfig = resolveProviderConfig(policy, { endpoint });
    if (!providerConfig.model) throw makeHttpError("Configurable skill run model is not configured.", 409);
    const provider = runProvider || createDefaultRunProvider({
      providerConfig,
      env,
      fetchImpl,
    });
    const timestamp = now().toISOString();
    const aiRun = {
      provider: providerConfig.provider,
      model: providerConfig.model,
      task: AI_TASKS.CONFIGURABLE_SKILL_RUN,
    };
    let runRecord = await runLedger.createRun({
      skillId: skill.id,
      slash: skill.slash,
      title: skillRunTitle(skill),
      matterName: path.basename(matterRoot),
      matterFolder: path.basename(matterRoot),
      matterRoot,
      outputPaths: {
        markdown: outputArtifact,
        json: outputJson,
      },
      aiRun,
      overwrite: overwrite ? "approved" : "not_needed",
      startedAt: timestamp,
    });
    try {
      const packet = await buildConfigurableSkillMatterContextPacket(matterRoot);
      const matterSummary = matterSummaryForRun(packet.matter, matterRoot);
      const warnings = Array.isArray(packet.warnings) ? packet.warnings.slice(0, 5) : [];
      const markdown = boundedOutputMarkdown(await provider({
        skill,
        matterContext: summarizeMatterContext(packet),
        providerConfig,
      }));
      await mkdir(path.dirname(markdownPath), { recursive: true });
      const metadata = {
        schema_version: "configurable-skill-run/v1",
        skill: publicSkill(skill),
        matter: packet.matter || {},
        outputPath: outputArtifact,
        generatedAt: now().toISOString(),
        aiRun,
        warnings,
      };
      await writeFileAtomic(markdownPath, `${markdown}\n`);
      await writeFileAtomic(jsonPath, `${JSON.stringify({
        ...metadata,
        runId: runRecord.id,
        markdown,
      }, null, 2)}\n`);
      runRecord = await runLedger.updateRun(runRecord.id, {
        status: "succeeded",
        ...matterSummary,
        warnings,
        outputPaths: {
          markdown: outputArtifact,
          json: outputJson,
        },
      });
      return {
        ...metadata,
        state: "written",
        markdown,
        outputPaths: {
          markdown: outputArtifact,
          json: outputJson,
        },
        runId: runRecord.id,
        runRecord,
      };
    } catch (error) {
      await runLedger.updateRun(runRecord.id, {
        status: "failed",
        errorMessage: error.message,
      }).catch(() => {});
      throw error;
    }
  }

  async function recordCancelledRun({ slash, artifactPath = "" } = {}) {
    const normalizedSlash = normalizeSlash(slash);
    const store = await readStore();
    const skill = store.skills.find((candidate) => candidate.slash === normalizedSlash && candidate.status === "active");
    if (!skill) throw makeHttpError(`No active configurable skill for ${normalizedSlash}`, 404);
    const matterRoot = matterStore.ensureMatterRoot();
    const outputArtifact = normalizeText(artifactPath) || normalizeArtifactPath(skill.outputArtifact, skill.targetLane);
    const outputJson = outputArtifact.endsWith(".md")
      ? outputArtifact.replace(/\.md$/i, ".json")
      : "";
    const record = await runLedger.recordCancelledRun({
      skillId: skill.id,
      slash: skill.slash,
      title: skillRunTitle(skill),
      ...matterSummaryForRun(null, matterRoot),
      matterRoot,
      outputPaths: {
        markdown: outputArtifact,
        json: outputJson,
      },
      aiRun: {},
      overwrite: "cancelled",
    });
    return {
      schema_version: "configurable-skill-run/v1",
      state: "cancelled",
      skill: publicSkill(skill),
      artifactPath: outputArtifact,
      runId: record.id,
      runRecord: record,
    };
  }

  return {
    activeSkillCards,
    createSkillFromApprovedSample,
    listSkills,
    recordCancelledRun,
    runSkill,
    storePath,
  };
}

function extractTargetSkillSlash(idea = {}) {
  const text = [
    idea?.designBrief?.notes,
    idea?.designBrief?.problem,
    idea?.text,
  ].map((value) => String(value || "")).join("\n");
  const direct = text.match(/Target skill:\s*(\/[a-z0-9_-]+)/i);
  if (direct) return normalizeSlash(direct[1]);
  const improve = text.match(/\bImprove\s+(\/[a-z0-9_-]+)/i);
  if (improve) return normalizeSlash(improve[1]);
  return "";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
