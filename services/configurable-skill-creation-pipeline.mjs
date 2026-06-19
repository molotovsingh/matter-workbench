import {
  normalizeAuthoredDefinition,
  normalizeSlash,
  normalizeStoredSkill,
  slashFromTitle,
  uniqueSlash,
} from "./configurable-skill-definition.mjs";
import {
  AUTHORING_SCHEMA,
  createDefaultAuthoringProvider,
  createDefaultRunProvider,
} from "./configurable-skill-providers.mjs";
import {
  activateDraftConfigurableSkillVersion,
  buildDraftConfigurableSkill,
} from "./configurable-skill-lifecycle.mjs";
import { CONFIGURABLE_SKILLS_SCHEMA_VERSION } from "./configurable-skill-store.mjs";
import { validateDraftSkill } from "./configurable-skill-validation.mjs";
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { BUILTIN_SKILL_COMMANDS } from "../shared/builtin-skill-commands.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export async function createSkillFromApprovedSampleInStore({
  store,
  idea,
  sample,
  matterStore,
  authoringProvider,
  runProvider,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  matterRootOverride = "",
  matterRecordOverride = null,
  matterContextPacketOverride = null,
  now = () => new Date(),
  idFactory,
} = {}) {
  if (!store || !Array.isArray(store.skills)) throw new Error("store.skills is required");
  if (!idea?.id) {
    throw makeHttpError(
      "Skill idea is required",
      400,
      "configurable_skill_creation.idea_required",
    );
  }
  if (!sample?.id) {
    throw makeHttpError(
      "Approved sample is required",
      400,
      "configurable_skill_creation.approved_sample_required",
    );
  }

  const targetSkill = resolveTargetSkill({ idea, store });
  const reservedCustomSlashes = activeCustomSlashes(store.skills);
  const {
    provider,
    authoringProviderConfig,
    validationRunProvider,
    runProviderConfig,
  } = resolveCreationProviders({
    authoringProvider,
    runProvider,
    env,
    fetchImpl,
    endpoint,
  });

  const authored = await authorSkillDefinition({
    provider,
    idea,
    sample,
    existingSlashes: reservedCustomSlashes,
    targetSkill,
    authoringProviderConfig,
  });
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
    matterRootOverride,
    matterRecordOverride,
    matterContextPacketOverride,
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
    return {
      result: {
        schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
        skill: normalizeStoredSkill(draft),
      },
      validationError: makeHttpError(
        `Draft skill validation failed: ${validation.messages.join("; ")}`,
        422,
        "configurable_skill_creation.draft_validation_failed",
      ),
    };
  }

  const activated = activateDraftConfigurableSkillVersion({ store, draft, targetSkill, timestamp });
  return {
    result: {
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skill: activated,
    },
    validationError: null,
  };
}

export function extractTargetSkillSlash(idea = {}) {
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

function resolveTargetSkill({ idea, store }) {
  const targetSlash = extractTargetSkillSlash(idea);
  const targetSkill = targetSlash
    ? store.skills.find((candidate) => candidate.slash === targetSlash && candidate.status === "active")
    : null;
  if (targetSlash && !targetSkill) {
    throw makeHttpError(
      `No active configurable skill found for ${targetSlash}`,
      409,
      "configurable_skill_creation.target_skill_not_found",
    );
  }
  return targetSkill;
}

function resolveCreationProviders({
  authoringProvider,
  runProvider,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
} = {}) {
  const authoringPolicy = resolveModelPolicy(AI_TASKS.SKILL_AUTHORING, { env });
  const authoringProviderConfig = resolveProviderConfig(authoringPolicy, { endpoint });
  if (!authoringProviderConfig.model) {
    throw makeHttpError(
      "Skill authoring model is not configured.",
      409,
      "configurable_skill_creation.authoring_model_not_configured",
    );
  }
  const provider = authoringProvider || createDefaultAuthoringProvider({
    providerConfig: authoringProviderConfig,
    env,
    fetchImpl,
  });

  const runPolicy = resolveModelPolicy(AI_TASKS.CONFIGURABLE_SKILL_RUN, { env });
  const runProviderConfig = resolveProviderConfig(runPolicy, { endpoint });
  if (!runProviderConfig.model) {
    throw makeHttpError(
      "Configurable skill run model is not configured.",
      409,
      "configurable_skill_creation.run_model_not_configured",
    );
  }
  const validationRunProvider = runProvider || createDefaultRunProvider({
    providerConfig: runProviderConfig,
    env,
    fetchImpl,
  });

  return {
    provider,
    authoringProviderConfig,
    validationRunProvider,
    runProviderConfig,
  };
}

async function authorSkillDefinition({
  provider,
  idea,
  sample,
  existingSlashes,
  targetSkill,
  authoringProviderConfig,
} = {}) {
  return normalizeAuthoredDefinition(await provider({
    idea,
    sample,
    existingSlashes,
    targetSkill,
    providerConfig: authoringProviderConfig,
    schema: AUTHORING_SCHEMA,
  }), idea);
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
