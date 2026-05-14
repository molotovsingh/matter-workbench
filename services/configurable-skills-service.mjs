import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildMatterContextPacket } from "./matter-context-service.mjs";
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
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { BUILTIN_SKILL_COMMANDS } from "../shared/builtin-skill-commands.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import {
  extractOpenAiOutputText,
  extractOpenRouterMessageText,
  fetchProviderJsonWithTimeout,
  parseOpenAiJsonOutput,
  parseOpenRouterJsonMessage,
} from "../shared/provider-http.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";

export const CONFIGURABLE_SKILLS_SCHEMA_VERSION = "configurable-skills/v1";
export { CONFIGURABLE_SKILL_SCHEMA_VERSION, skillToRegistryCard } from "./configurable-skill-definition.mjs";

const CONTEXT_LIMITS = Object.freeze({
  maxSources: 40,
  maxBlocks: 70,
  maxCharsPerBlock: 900,
  maxLibraryArtifacts: 4,
});
const AUTHORING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "slash",
    "description",
    "target_lane",
    "output_artifact",
    "matter_required",
    "paid_provider_call",
    "source_backed",
    "prompt",
    "citation_policy",
  ],
  properties: {
    title: { type: "string" },
    slash: { type: "string" },
    description: { type: "string" },
    target_lane: { type: "string", enum: ["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"] },
    output_artifact: { type: "string" },
    matter_required: { type: "boolean" },
    paid_provider_call: { type: "boolean" },
    source_backed: { type: "string", enum: ["required", "optional", "none"] },
    prompt: { type: "string" },
    citation_policy: { type: "string" },
  },
};

const AUTHORING_SYSTEM_PROMPT = [
  "You create strict configurable skill definitions for Matter Workbench.",
  "Return only JSON matching the schema.",
  "Do not generate code, routes, tests, files, or executable JavaScript.",
  "Create a reusable prompt/config for the future skill runner.",
  "The skill must be faithful to the approved sample and design brief.",
  "Prefer safe internal workshop artifacts unless the approved design clearly asks for drafts or dispatch.",
  "The prompt must require source-backed factual statements when the skill is internal legal work product.",
  "Never claim the skill is court-ready or final legal advice.",
].join(" ");

const RUN_SYSTEM_PROMPT = [
  "You are running an approved configurable Matter Workbench skill.",
  "Return Markdown only.",
  "Use the supplied skill prompt, matter context packet, and output artifact contract.",
  "Do not produce code, schema, provider config, or activation text.",
  "Do not mention that you are an AI model.",
  "Do not invent facts. Mark uncertainty and missing evidence clearly.",
  "For source-backed internal work, cite readable source labels plus raw FILE-NNNN pX.bY citations.",
].join(" ");

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

  const root = path.resolve(appDir || process.cwd());
  const storePath = skillsPath || path.join(root, "configurable-skills.json");
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
    const store = await readStore();
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
      await writeStore(store);
      throw makeHttpError(`Draft skill validation failed: ${validation.messages.join("; ")}`, 422);
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
    await writeStore(store);
    return {
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skill: normalizeStoredSkill(draft),
    };
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
      title: skill.title,
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
      const packet = await buildMatterContextPacket(matterRoot, CONTEXT_LIMITS);
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
      await writeFile(markdownPath, `${markdown}\n`);
      await writeFile(jsonPath, `${JSON.stringify({
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
      title: skill.title,
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

  async function readStore() {
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      if (parsed?.schema_version !== CONFIGURABLE_SKILLS_SCHEMA_VERSION || !Array.isArray(parsed.skills)) {
        throw makeHttpError(`Invalid configurable skills store at ${storePath}`, 500);
      }
      return {
        schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
        skills: parsed.skills.map(normalizeStoredSkill),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION, skills: [] };
      }
      throw error;
    }
  }

  async function writeStore(store) {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify({
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skills: store.skills.map(normalizeStoredSkill),
    }, null, 2)}\n`);
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

function createNoopRunLedger() {
  return {
    createRun: async (entry = {}) => ({
      id: "",
      ...entry,
      status: entry.status || "running",
    }),
    updateRun: async (id, patch = {}) => ({
      id,
      ...patch,
    }),
    recordCancelledRun: async (entry = {}) => ({
      id: "",
      ...entry,
      status: "cancelled",
    }),
  };
}

function matterSummaryForRun(matter = null, matterRoot = "") {
  const source = matter && typeof matter === "object" ? matter : {};
  const folder = path.basename(matterRoot || "");
  return {
    matterName: normalizeText(
      source.matterName
      || source.matter_name
      || source.name
      || folder,
    ),
    matterFolder: normalizeText(
      source.folderName
      || source.folder_name
      || folder,
    ),
  };
}

function createDefaultAuthoringProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterAuthoringProvider({
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      model: providerConfig.model,
      maxOutputTokens: providerConfig.maxOutputTokens,
      timeoutMs: providerConfig.timeoutMs,
    });
  }
  return createOpenAiAuthoringProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

function createDefaultRunProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterRunProvider({
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      model: providerConfig.model,
      maxOutputTokens: providerConfig.maxOutputTokens,
      timeoutMs: providerConfig.timeoutMs,
    });
  }
  return createOpenAiRunProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

export function createOpenAiAuthoringProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openAiAuthoringProvider({ idea, sample, existingSlashes, targetSkill, schema } = {}) {
    if (!apiKey) throw makeHttpError("OPENAI_API_KEY is required for skill authoring", 409);
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      timeoutMessage: `OpenAI skill authoring request timed out after ${timeoutMs}ms`,
      body: {
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          { role: "system", content: AUTHORING_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(authoringPayload({ idea, sample, existingSlashes, targetSkill })) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "configurable_skill_definition",
            strict: true,
            schema,
          },
        },
      },
    });
    return parseOpenAiJsonOutput(payload, "OpenAI skill authoring");
  };
}

export function createOpenRouterAuthoringProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openRouterAuthoringProvider({ idea, sample, existingSlashes, targetSkill, schema } = {}) {
    if (!apiKey) throw makeHttpError("OPENROUTER_API_KEY is required for skill authoring", 409);
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Skill Authoring",
      },
      timeoutMessage: `OpenRouter skill authoring request timed out after ${timeoutMs}ms`,
      body: {
        model,
        messages: [
          { role: "system", content: AUTHORING_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(authoringPayload({ idea, sample, existingSlashes, targetSkill })) },
        ],
        temperature: 0,
        max_tokens: maxOutputTokens,
        provider: { require_parameters: true, allow_fallbacks: false },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "configurable_skill_definition",
            strict: true,
            schema,
          },
        },
      },
    });
    return parseOpenRouterJsonMessage(payload, "OpenRouter skill authoring");
  };
}

export function createOpenAiRunProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openAiRunProvider({ skill, matterContext } = {}) {
    if (!apiKey) throw makeHttpError("OPENAI_API_KEY is required for configurable skill runs", 409);
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      timeoutMessage: `OpenAI configurable skill run timed out after ${timeoutMs}ms`,
      body: {
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          { role: "system", content: RUN_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(runPayload({ skill, matterContext })) },
        ],
      },
    });
    return extractOpenAiOutputText(payload, "OpenAI configurable skill run");
  };
}

export function createOpenRouterRunProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openRouterRunProvider({ skill, matterContext } = {}) {
    if (!apiKey) throw makeHttpError("OPENROUTER_API_KEY is required for configurable skill runs", 409);
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Configurable Skill Run",
      },
      timeoutMessage: `OpenRouter configurable skill run timed out after ${timeoutMs}ms`,
      body: {
        model,
        messages: [
          { role: "system", content: RUN_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(runPayload({ skill, matterContext })) },
        ],
        temperature: 0,
        max_tokens: maxOutputTokens,
        provider: { require_parameters: true, allow_fallbacks: false },
      },
    });
    return extractOpenRouterMessageText(payload, "OpenRouter configurable skill run");
  };
}

async function validateDraftSkill({
  draft,
  sample,
  matterStore,
  runProvider,
  providerConfig,
}) {
  const messages = [];
  if (!draft.slash.startsWith("/")) messages.push("Slash command must start with /.");
  if (!draft.outputArtifact.endsWith(".md")) messages.push("Output artifact must be Markdown.");
  if (!draft.outputArtifact.startsWith(`${draft.targetLane}/`)) messages.push("Output artifact must live inside target lane.");
  if (!draft.promptConfig.prompt || draft.promptConfig.prompt.length < 80) messages.push("Prompt is too short.");
  if (/Skill Ready|Use \//i.test(sample.sampleMarkdown)) messages.push("Approved sample contains activation language.");
  if (!sample.sampleMarkdown.startsWith("#")) messages.push("Approved sample must be Markdown with a heading.");
  if (draft.sourceBacked === "required" && !/FILE-\d{4}\s+p\d+\.b\d+/i.test(sample.sampleMarkdown)) {
    messages.push("Approved source-backed sample must include raw FILE citations.");
  }
  if (!messages.length) {
    try {
      const matterRoot = resolveSampleMatterRoot({ sample, matterStore });
      const packet = await buildMatterContextPacket(matterRoot, CONTEXT_LIMITS);
      const validationMarkdown = boundedOutputMarkdown(await runProvider({
        skill: draft,
        matterContext: summarizeMatterContext(packet),
        providerConfig,
      }));
      messages.push(...validateDraftRunOutput({
        markdown: validationMarkdown,
        draft,
        sample,
        packet,
      }));
    } catch (error) {
      messages.push(`Draft skill validation run failed: ${error.message}`);
    }
  }
  return {
    status: messages.length ? "failed" : "passed",
    messages,
    validatedAt: new Date().toISOString(),
  };
}

function resolveSampleMatterRoot({ sample, matterStore }) {
  const folderName = normalizeText(sample?.matter?.folderName || sample?.matter?.folder_name);
  if (folderName && typeof matterStore?.matterPathForName === "function") {
    return matterStore.matterPathForName(folderName).matterPath;
  }
  return matterStore.ensureMatterRoot();
}

function validateDraftRunOutput({ markdown, draft, sample, packet }) {
  const messages = [];
  if (!markdown.startsWith("#")) messages.push("Validation run output must be Markdown with a heading.");
  if (/Skill Ready|Use \//i.test(markdown)) messages.push("Validation run output must not contain activation language.");
  if (draft.sourceBacked === "required" && !/FILE-\d{4}\s+p\d+\.b\d+/i.test(markdown)) {
    messages.push("Validation run output must include raw FILE citations.");
  }
  if (!mentionsMatterSpecificTerm(markdown, sample, packet)) {
    messages.push("Validation run output must include matter-specific content.");
  }
  return messages;
}

function mentionsMatterSpecificTerm(markdown, sample, packet) {
  const haystack = markdown.toLowerCase();
  const matter = packet?.matter || {};
  const terms = [
    sample?.matter?.matterName,
    sample?.matter?.matter_name,
    sample?.matter?.folderName,
    sample?.matter?.folder_name,
    matter.matterName,
    matter.matter_name,
    matter.clientName,
    matter.client_name,
    matter.oppositeParty,
    matter.opposite_party,
  ]
    .flatMap((value) => normalizeText(value).split(/\s+vs\s+|\s+v\s+|\s+/i))
    .map((value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter((value) => value.length >= 4);
  return terms.some((term) => haystack.includes(term));
}

function authoringPayload({ idea, sample, existingSlashes, targetSkill = null }) {
  return {
    task: targetSkill
      ? "Create a new version of an existing configurable skill from an approved revised sample."
      : "Create a configurable skill definition from an approved sample.",
    strict_boundaries: [
      "Do not generate code.",
      "Do not create routes.",
      "Do not claim activation.",
      "Return only the skill definition JSON.",
      "For an existing-skill revision, keep the slash command stable unless the caller explicitly supplied a different activation plan.",
    ],
    idea: {
      id: idea.id,
      text: idea.text,
      designBrief: idea.designBrief,
    },
    approved_sample: {
      id: sample.id,
      matter: sample.matter,
      markdown: sample.sampleMarkdown,
    },
    existing_skill: targetSkill ? publicSkill(targetSkill) : null,
    existing_slashes: existingSlashes,
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

function runPayload({ skill, matterContext }) {
  return {
    task: "Run this active configurable skill for the selected matter.",
    skill: {
      title: skill.title,
      slash: skill.slash,
      description: skill.description,
      outputArtifact: skill.outputArtifact,
      sourceBacked: skill.sourceBacked,
      prompt: skill.promptConfig.prompt,
      citationPolicy: skill.promptConfig.citationPolicy,
    },
    matter_context: matterContext,
  };
}

function summarizeMatterContext(packet) {
  const blocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];
  const sources = Array.isArray(packet?.sources) ? packet.sources : [];
  return {
    schema_version: packet?.schema_version || "",
    matter: packet?.matter || {},
    counts: {
      sources: sources.length,
      evidence_blocks_included: blocks.length,
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
      library_artifacts: Array.isArray(packet?.library_artifacts) ? packet.library_artifacts.length : 0,
    },
    sources: sources.slice(0, 30).map((source) => ({
      file_id: source.file_id || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      sample_citations: Array.isArray(source.sample_citations) ? source.sample_citations.slice(0, 3) : [],
    })),
    evidence_blocks: blocks.slice(0, CONTEXT_LIMITS.maxBlocks).map((block) => ({
      citation: block.citation || "",
      source_label: block.source_label || "",
      source_short_label: block.source_short_label || "",
      text: normalizeText(block.text).slice(0, CONTEXT_LIMITS.maxCharsPerBlock),
    })),
    library_artifacts: (Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : []).slice(0, 4),
    warnings: Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 5) : [],
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
