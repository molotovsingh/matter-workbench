import {
  CONFIGURABLE_SKILL_SCHEMA_VERSION,
  normalizeStoredSkill,
} from "./configurable-skill-definition.mjs";
import { LEGAL_WORKBENCH_POLICY_PROMPT_VERSION } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS } from "../shared/model-policy.mjs";

export function buildDraftConfigurableSkill({
  authored = {},
  idea = {},
  sample = {},
  targetSkill = null,
  runProviderConfig = {},
  timestamp = "",
  skillId = "",
} = {}) {
  const version = targetSkill ? Number(targetSkill.version || 0) + 1 : 1;
  return normalizeStoredSkill({
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
      policyPromptVersion: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
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
}

export function activateDraftConfigurableSkillVersion({
  store,
  draft,
  targetSkill = null,
  timestamp = "",
} = {}) {
  if (!store || !Array.isArray(store.skills)) throw new Error("store.skills is required");
  const activated = normalizeStoredSkill({
    ...draft,
    status: "active",
    activatedAt: timestamp,
    updatedAt: timestamp,
  });

  if (targetSkill) {
    const previousIndex = store.skills.findIndex((skill) => skill.id === targetSkill.id);
    if (previousIndex !== -1) {
      store.skills[previousIndex] = normalizeStoredSkill({
        ...store.skills[previousIndex],
        status: "disabled",
        replacedBySkillId: activated.id,
        supersededAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  store.skills.push(activated);
  return activated;
}
