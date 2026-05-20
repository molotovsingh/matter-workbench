import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  buildConfigurableSkillMatterContextPacket,
  summarizeMatterContext,
} from "./configurable-skill-context.mjs";
import {
  boundedOutputMarkdown,
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
  resolveConfigurableSkillRunArtifacts,
  writeConfigurableSkillRunArtifacts,
} from "./configurable-skill-run-artifacts.mjs";
import {
  activateDraftConfigurableSkillVersion,
  buildDraftConfigurableSkill,
} from "./configurable-skill-lifecycle.mjs";
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
import { BUILTIN_SKILL_COMMANDS } from "../shared/builtin-skill-commands.mjs";
import { LEGAL_WORKBENCH_POLICY_PROMPT_VERSION } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

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
      const reservedCustomSlashes = activeCustomSlashes(store.skills);
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
        existingSlashes: reservedCustomSlashes,
        targetSkill,
        providerConfig: authoringProviderConfig,
        schema: AUTHORING_SCHEMA,
      }), idea);
      authored.slash = targetSkill
        ? targetSkill.slash
        : uniqueSlash(authored.slash || slashFromTitle(authored.title), [
          ...reservedCustomSlashes,
          ...BUILTIN_SKILL_COMMANDS,
        ]);

      const timestamp = now().toISOString();
      const skillId = idFactory();
      let draft = buildDraftConfigurableSkill({
        authored,
        idea,
        sample,
        targetSkill,
        runProviderConfig,
        timestamp,
        skillId,
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
        if (!targetSkill) {
          draft = normalizeStoredSkill({
            ...draft,
            slash: failedValidationSlash(draft.slash, store.skills),
          });
        }
        store.skills.push(draft);
        validationError = makeHttpError(`Draft skill validation failed: ${validation.messages.join("; ")}`, 422);
        return {
          schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
          skill: normalizeStoredSkill(draft),
        };
      }
      const activated = activateDraftConfigurableSkillVersion({ store, draft, targetSkill, timestamp });
      return {
        schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
        skill: activated,
      };
    });
    if (validationError) throw validationError;
    return result;
  }

  async function runSkill({ slash, overwrite = false, matterName = "" } = {}) {
    const normalizedSlash = normalizeSlash(slash);
    const store = await readStore();
    const skill = store.skills.find((candidate) => candidate.slash === normalizedSlash && candidate.status === "active");
    if (!skill) throw makeHttpError(`No active configurable skill for ${normalizedSlash}`, 404);
    const matterRoot = await matterRootForName(matterName);
    const { outputPaths, filePaths } = resolveConfigurableSkillRunArtifacts({ matterRoot, skill });
    if (!overwrite && await exists(filePaths.markdown)) {
      return {
        schema_version: "configurable-skill-run/v1",
        state: "requires_overwrite",
        skill: publicSkill(skill),
        artifactPath: outputPaths.markdown,
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
      policyPromptVersion: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
    };
    let runRecord = await runLedger.createRun({
      skillId: skill.id,
      slash: skill.slash,
      title: skillRunTitle(skill),
      matterName: path.basename(matterRoot),
      matterFolder: path.basename(matterRoot),
      matterRoot,
      outputPaths,
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
      const metadata = {
        schema_version: "configurable-skill-run/v1",
        skill: publicSkill(skill),
        matter: packet.matter || {},
        outputPath: outputPaths.markdown,
        generatedAt: now().toISOString(),
        aiRun,
        warnings,
      };
      await writeConfigurableSkillRunArtifacts({
        filePaths,
        markdown,
        metadata,
        runId: runRecord.id,
      });
      runRecord = await runLedger.updateRun(runRecord.id, {
        status: "succeeded",
        ...matterSummary,
        warnings,
        outputPaths,
      });
      return {
        ...metadata,
        state: "written",
        markdown,
        outputPaths,
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

  async function recordCancelledRun({ slash, artifactPath = "", matterName = "" } = {}) {
    const normalizedSlash = normalizeSlash(slash);
    const store = await readStore();
    const skill = store.skills.find((candidate) => candidate.slash === normalizedSlash && candidate.status === "active");
    if (!skill) throw makeHttpError(`No active configurable skill for ${normalizedSlash}`, 404);
    const matterRoot = await matterRootForName(matterName);
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

  async function matterRootForName(rawMatterName = "") {
    const matterName = normalizeText(rawMatterName);
    if (!matterName) return matterStore.ensureMatterRoot();
    const { matterPath } = await matterStore.resolveExistingMatter(matterName);
    return matterPath;
  }
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

function activeCustomSlashes(skills = []) {
  return skills
    .filter((skill) => skill.status === "active")
    .map((skill) => skill.slash);
}

function failedValidationSlash(baseSlash, skills = []) {
  const base = normalizeSlash(baseSlash || "/custom_skill");
  return uniqueSlash(`${base}_failed_validation`, [
    ...skills.map((skill) => skill.slash),
    ...BUILTIN_SKILL_COMMANDS,
  ]);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
