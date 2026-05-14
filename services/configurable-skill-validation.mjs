import { boundedOutputMarkdown, normalizeText } from "./configurable-skill-definition.mjs";
import {
  buildConfigurableSkillMatterContextPacket,
  summarizeMatterContext,
} from "./configurable-skill-context.mjs";

export async function validateDraftSkill({
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
      const packet = await buildConfigurableSkillMatterContextPacket(matterRoot);
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
