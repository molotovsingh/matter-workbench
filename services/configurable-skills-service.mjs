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
import { resolveProviderConfig, modelPolicyMetadata } from "../shared/ai-provider-policy.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { SKILL_IDEA_STATUS } from "../shared/skill-idea-statuses.mjs";

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
  matterEventsService = null,
  skillStore = null,
  authoringProvider,
  runProvider,
  providerService,
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
  } = skillStore || createConfigurableSkillStore({ appDir, skillsPath });
  const runLedger = configurableSkillRunsService || createNoopRunLedger();
  const lifecycleTransitions = {
    active: { suspend: "suspended", archive: "archived", delete: "deleted" },
    suspended: { resume: "active", archive: "archived", delete: "deleted" },
    archived: { restore: "suspended", delete: "deleted" },
    draft: { delete: "deleted" },
  };

  async function listSkills({ includeDeleted = false } = {}) {
    const store = await readStore();
    return {
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skills: store.skills
        .map(normalizeStoredSkill)
        .filter((skill) => includeDeleted || skill.status !== "deleted"),
    };
  }

  async function activeSkillCards() {
    const { skills } = await listSkills();
    return primaryActiveSkills(skills)
      .map(skillToRegistryCard);
  }

  async function createSkillFromApprovedSample({
    ideaId,
    matterRootOverride = "",
    matterRecordOverride = null,
    matterContextPacketOverride = null,
  } = {}) {
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
        providerService,
        env,
        fetchImpl,
        endpoint,
        matterRootOverride,
        matterRecordOverride,
        matterContextPacketOverride,
        now,
        idFactory,
      });
    }, customSkillCreatedEventWriteHooks({
      idea,
      sample,
      matterEventsService,
      matterRecord: matterRecordOverride,
    }));
    if (validationError) throw validationError;
    if (typeof skillIdeasService.updateIdeaStatus === "function") {
      await skillIdeasService.updateIdeaStatus(idea.id, SKILL_IDEA_STATUS.CREATED);
    }
    return result;
  }

  async function runSkill({
    slash,
    overwrite = false,
    matterName = "",
    matterRootOverride = "",
    matterRecordOverride = null,
    matterContextPacketOverride = null,
    artifactExistsOverride = null,
    artifactWriter = null,
  } = {}) {
    const normalizedSlash = normalizeSlash(slash);
    const store = await readStore();
    const skill = findActiveSkillForRun(store.skills, normalizedSlash);
    const matterContext = await matterContextForRun({ matterName, matterRootOverride, matterRecordOverride });
    const matterRoot = matterContext.matterRoot;
    const { outputPaths, filePaths } = resolveConfigurableSkillRunArtifacts({ matterRoot, skill });
    const artifactExists = typeof artifactExistsOverride === "function"
      ? await artifactExistsOverride(outputPaths.markdown)
      : await exists(filePaths.markdown);
    if (!overwrite && artifactExists) {
      return {
        schema_version: "configurable-skill-run/v1",
        state: "requires_overwrite",
        skill: publicSkill(skill),
        artifactPath: outputPaths.markdown,
      };
    }

    const policy = resolveModelPolicy(AI_TASKS.CONFIGURABLE_SKILL_RUN, { env });
    const providerConfig = resolveProviderConfig(policy, { endpoint });
    if (!providerConfig.model) {
      throw makeHttpError(
        "Configurable skill run model is not configured.",
        409,
        "configurable_skill_run.model_not_configured",
      );
    }
    const provider = runProvider || createDefaultRunProvider({
      providerService,
      providerConfig,
      env,
      fetchImpl,
    });
    const timestamp = now().toISOString();
    const aiRun = modelPolicyMetadata(policy, providerConfig);
    let runRecord = await runLedger.createRun({
      skillId: skill.id,
      slash: skill.slash,
      title: skillRunTitle(skill),
      matterId: matterContext.matterId,
      matterName: matterContext.matterName,
      matterFolder: matterContext.matterFolder,
      matterRoot: matterContext.ledgerMatterRoot,
      outputPaths,
      aiRun,
      overwrite: overwrite ? "approved" : "not_needed",
      skillVersion: skill.version,
      startedAt: timestamp,
    });
    try {
      const packet = matterContextPacketOverride || await buildConfigurableSkillMatterContextPacket(matterRoot);
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
      const artifactPersistence = typeof artifactWriter === "function"
        ? await artifactWriter({ filePaths, outputPaths, markdown, metadata, runId: runRecord.id })
        : await writeConfigurableSkillRunArtifacts({
          filePaths,
          markdown,
          metadata,
          runId: runRecord.id,
        });
      runRecord = await runLedger.updateRun(runRecord.id, {
        status: "succeeded",
        ...matterSummary,
        matterId: matterContext.matterId,
        matterName: matterContext.matterName,
        matterFolder: matterContext.matterFolder,
        matterRoot: matterContext.ledgerMatterRoot,
        availabilityMatterRoot: matterRoot,
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
        ...(artifactPersistence ? { artifactPersistence } : {}),
      };
    } catch (error) {
      await preservePrimaryRunFailure(runLedger, runRecord.id, error);
      throw error;
    }
  }

  async function recordCancelledRun({
    slash,
    artifactPath = "",
    matterName = "",
    matterRootOverride = "",
    matterRecordOverride = null,
  } = {}) {
    const normalizedSlash = normalizeSlash(slash);
    const store = await readStore();
    const skill = findActiveSkillForRun(store.skills, normalizedSlash);
    const matterContext = await matterContextForRun({ matterName, matterRootOverride, matterRecordOverride });
    const outputArtifact = normalizeText(artifactPath) || normalizeArtifactPath(skill.outputArtifact, skill.targetLane);
    const outputJson = outputArtifact.endsWith(".md")
      ? outputArtifact.replace(/\.md$/i, ".json")
      : "";
    const record = await runLedger.recordCancelledRun({
      skillId: skill.id,
      slash: skill.slash,
      title: skillRunTitle(skill),
      ...matterSummaryForRun(null, matterContext.matterRoot),
      matterId: matterContext.matterId,
      matterName: matterContext.matterName,
      matterFolder: matterContext.matterFolder,
      matterRoot: matterContext.ledgerMatterRoot,
      outputPaths: {
        markdown: outputArtifact,
        json: outputJson,
      },
      aiRun: {},
      overwrite: "cancelled",
      skillVersion: skill.version,
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

  async function updateSkillLifecycle({ skillId = "", action = "", reason = "" } = {}) {
    const normalizedSkillId = normalizeText(skillId);
    const normalizedAction = normalizeText(action).toLowerCase();
    if (!normalizedSkillId) {
      throw makeHttpError(
        "Custom skill id is required.",
        400,
        "configurable_skill_lifecycle.skill_id_required",
      );
    }
    if (!normalizedAction) {
      throw makeHttpError(
        "Lifecycle action is required.",
        400,
        "configurable_skill_lifecycle.action_required",
      );
    }

    return updateStore((store) => {
      const index = store.skills.findIndex((candidate) => normalizeText(candidate.id) === normalizedSkillId);
      if (index === -1) {
        throw makeHttpError(
          `Custom skill not found: ${normalizedSkillId}`,
          404,
          "configurable_skill_lifecycle.not_found",
        );
      }
      const current = normalizeStoredSkill(store.skills[index]);
      if (current.status === "disabled") {
        throw makeHttpError(
          "Previous versions are retained as history and cannot be managed here.",
          409,
          "configurable_skill_lifecycle.previous_version_read_only",
        );
      }
      if (current.status === "deleted") {
        throw makeHttpError(
          "Deleted custom skills cannot be changed from the normal lifecycle controls.",
          409,
          "configurable_skill_lifecycle.deleted_read_only",
        );
      }
      const nextStatus = lifecycleTransitions[current.status]?.[normalizedAction];
      if (!nextStatus) {
        throw makeHttpError(
          `Cannot ${normalizedAction} a custom skill with status ${current.status}.`,
          409,
          "configurable_skill_lifecycle.invalid_transition",
        );
      }
      if (normalizedAction === "resume") {
        const collision = store.skills
          .map(normalizeStoredSkill)
          .find((candidate) => candidate.id !== current.id && candidate.status === "active" && candidate.slash === current.slash);
        if (collision) {
          throw makeHttpError(
            `Another active custom skill already uses ${current.slash}.`,
            409,
            "configurable_skill_lifecycle.slash_collision",
          );
        }
      }
      const timestamp = now().toISOString();
      const updated = normalizeStoredSkill({
        ...current,
        status: nextStatus,
        updatedAt: timestamp,
        lifecycle: {
          statusChangedAt: timestamp,
          statusChangedBy: "local-user",
          reason: normalizeText(reason),
          previousStatus: current.status,
        },
      });
      store.skills[index] = updated;
      return {
        schema_version: "configurable-skill-lifecycle/v1",
        skill: publicSkill(updated),
      };
    });
  }

  return {
    activeSkillCards,
    createSkillFromApprovedSample,
    listSkills,
    recordCancelledRun,
    runSkill,
    storePath,
    updateSkillLifecycle,
  };

  function customSkillCreatedEventWriteHooks({ idea, sample, matterEventsService, matterRecord = null } = {}) {
    if (!matterEventsService) return {};
    return {
      afterWriteSql: typeof matterEventsService.appendEventMutationSql === "function"
        ? ({ result }) => {
          const event = customSkillCreatedEvent({ result, idea, sample, matterRecord });
          return event ? matterEventsService.appendEventMutationSql(event) : [];
        }
        : null,
      afterWrite: typeof matterEventsService.appendEventMutationSql === "function" || typeof matterEventsService.appendEvent !== "function"
        ? null
        : async ({ result }) => {
          const event = customSkillCreatedEvent({ result, idea, sample, matterRecord });
          if (event) await matterEventsService.appendEvent(event);
        },
    };
  }

  function customSkillCreatedEvent({ result, idea, sample, matterRecord = null } = {}) {
    if (result?.validationError) return null;
    const activationResult = result?.result && typeof result.result === "object" ? result.result : result;
    const skill = normalizeStoredSkill(activationResult?.skill || {});
    if (!skill.id || skill.status !== "active") return null;
    return {
      eventType: "custom_skill.created",
      matterId: normalizeText(matterRecord?.id),
      matterName: matterNameForEvent({ matterRecord, idea, sample }),
      summaryKey: "custom_skill_created",
      object: { type: "custom_skill", id: skill.id, label: skill.title },
      payload: {
        skill_id: skill.id,
        slash: skill.slash,
        title: skill.title,
        source_idea_id: idea.id,
        source_sample_id: sample.id || skill.sourceSampleId,
        skill_version: skill.version,
        status: skill.status,
        output_artifact: skill.outputArtifact,
        target_lane: skill.targetLane,
        source_backed: skill.sourceBacked,
      },
      idempotencyKey: ["custom_skill.created", skill.id, `v${skill.version}`].join(":"),
    };
  }

  function matterNameForEvent({ matterRecord = null, idea = {}, sample = {} } = {}) {
    const recordName = normalizeText(matterRecord?.name || matterRecord?.folderName || matterRecord?.matterName);
    if (recordName) return recordName;
    const ideaMatter = idea?.matter && typeof idea.matter === "object" ? idea.matter : {};
    const ideaMatterName = normalizeText(ideaMatter.folderName || ideaMatter.matterName);
    if (ideaMatterName) return ideaMatterName;
    const sampleMatter = sample?.matter && typeof sample.matter === "object" ? sample.matter : {};
    return normalizeText(sampleMatter.folder_name || sampleMatter.folderName || sampleMatter.matter_name || sampleMatter.matterName);
  }

  async function matterContextForRun({
    matterName: rawMatterName = "",
    matterRootOverride = "",
    matterRecordOverride = null,
  } = {}) {
    const overrideRoot = normalizeText(matterRootOverride, 10_000);
    const record = matterRecordOverride && typeof matterRecordOverride === "object" ? matterRecordOverride : null;
    if (overrideRoot) {
      const name = normalizeText(record?.name || record?.folderName || rawMatterName || path.basename(overrideRoot));
      const displayName = normalizeText(record?.matterName || name);
      return {
        matterId: normalizeText(record?.id),
        matterRoot: overrideRoot,
        matterName: displayName,
        matterFolder: name,
        ledgerMatterRoot: record?.runtimeStorageMode === "postgres" ? `postgres:${name}` : overrideRoot,
      };
    }
    const matterName = normalizeText(rawMatterName);
    if (!matterName) {
      const root = matterStore.ensureMatterRoot();
      return {
        matterId: "",
        matterRoot: root,
        matterName: path.basename(root),
        matterFolder: path.basename(root),
        ledgerMatterRoot: root,
      };
    }
    const { matterPath } = await matterStore.resolveExistingMatter(matterName);
    return {
      matterId: "",
      matterRoot: matterPath,
      matterName: path.basename(matterPath),
      matterFolder: path.basename(matterPath),
      ledgerMatterRoot: matterPath,
    };
  }
}

function findActiveSkillForRun(skills = [], normalizedSlash = "") {
  const normalized = skills.map(normalizeStoredSkill);
  const active = normalized.find((candidate) => candidate.slash === normalizedSlash && candidate.status === "active");
  if (active) return active;
  const inactive = normalized
    .filter((candidate) => candidate.slash === normalizedSlash)
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
  if (inactive?.status === "suspended") {
    throw makeHttpError(
      `This custom skill is paused. Resume it before running ${normalizedSlash}.`,
      409,
      "configurable_skill_run.suspended",
    );
  }
  if (inactive?.status === "archived") {
    throw makeHttpError(
      `This custom skill is archived. Restore it before running ${normalizedSlash}.`,
      409,
      "configurable_skill_run.archived",
    );
  }
  if (inactive?.status === "deleted") {
    throw makeHttpError(
      `This custom skill was deleted and cannot be run: ${normalizedSlash}`,
      409,
      "configurable_skill_run.deleted",
    );
  }
  throw makeHttpError(
    `No active configurable skill for ${normalizedSlash}`,
    404,
    "configurable_skill_run.not_found",
  );
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
