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
  normalizeSlash,
  normalizeStoredSkill,
  normalizeText,
  primaryActiveSkills,
  publicSkill,
  skillToRegistryCard,
} from "./configurable-skill-definition.mjs";
import {
  createDefaultRunProvider,
} from "./configurable-skill-providers.mjs";
import {
  resolveConfigurableSkillRunArtifacts,
  writeConfigurableSkillRunArtifacts,
} from "./configurable-skill-run-artifacts.mjs";
import { createSkillFromApprovedSampleInStore } from "./configurable-skill-creation-pipeline.mjs";
import {
  createNoopRunLedger,
  matterSummaryForRun,
  skillRunTitle,
} from "./configurable-skill-run-metadata.mjs";
import {
  CONFIGURABLE_SKILLS_SCHEMA_VERSION,
  createConfigurableSkillStore,
} from "./configurable-skill-store.mjs";
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
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
    const { result, validationError } = await updateStore(async (store) => {
      return createSkillFromApprovedSampleInStore({
        store,
        idea,
        sample,
        matterStore,
        authoringProvider,
        runProvider,
        env,
        fetchImpl,
        endpoint,
        now,
        idFactory,
      });
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
      runRecord = await runLedger.annotateRun(runRecord);
      return {
        ...metadata,
        state: "written",
        markdown,
        outputPaths,
        runId: runRecord.id,
        runRecord,
      };
    } catch (error) {
      await preservePrimaryRunFailure(runLedger, runRecord.id, error);
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
    const runRecord = await runLedger.annotateRun(record);
    return {
      schema_version: "configurable-skill-run/v1",
      state: "cancelled",
      skill: publicSkill(skill),
      artifactPath: outputArtifact,
      runId: runRecord.id,
      runRecord,
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

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function preservePrimaryRunFailure(runLedger, runId, error) {
  try {
    await runLedger.updateRun(runId, {
      status: "failed",
      errorMessage: error.message,
    });
  } catch {
    // Preserve the original provider/artifact error for the caller.
  }
}
