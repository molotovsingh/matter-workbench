import { redactSensitiveText } from "./secret-redaction.js";
import {
  SKILL_IDEA_STATUS,
  normalizeSkillIdeaStatus,
} from "../shared/skill-idea-statuses.mjs";

const KNOWN_TARGETS = [
  {
    slash: "/create_listofdates",
    title: "Create List of Dates",
    keywords: /\b(list\s+of\s+dates|chronolog|timeline)\b/i,
  },
  {
    slash: "/describe_sources",
    title: "Source Labels / Document Index",
    keywords: /\b(describe\s+sources|source\s+labels?|source\s+descriptors?)\b/i,
  },
  {
    slash: "/context_search",
    title: "Context Search",
    keywords: /\b(context\s+search|search|find)\b/i,
  },
];

export function buildSkillIdeaImplementationBrief(idea = {}, registry = {}) {
  const brief = normalizeDesignBrief(idea.designBrief);
  const text = joinText([
    idea.text,
    brief.problem,
    brief.expectedInputs,
    brief.expectedOutputArtifact,
    brief.notes,
  ]);
  const registrySkills = Array.isArray(registry?.skills) ? registry.skills : [];
  const targetSkill = resolveTargetSkill(text, registrySkills);
  const specialty = inferSpecialty(text, brief);
  const proposalType = shouldModifyExistingSkill(text, targetSkill)
    ? "modify_existing_skill"
    : "new_skill";
  const base = proposalType === "modify_existing_skill"
    ? buildModifyBrief({ idea, brief, text, targetSkill })
    : buildNewSkillBrief({ idea, brief, text, specialty });

  return {
    version: "implementation-brief/v1",
    ideaId: stringOrEmpty(idea.id),
    status: normalizeStatus(idea.status),
    readiness: normalizeReadiness(idea.readiness, brief),
    matter: {
      matterName: stringOrEmpty(idea.matter?.matterName),
      folderName: stringOrEmpty(idea.matter?.folderName),
    },
    originalText: stringOrEmpty(idea.text),
    designBrief: brief,
    ...base,
    generatedAt: new Date().toISOString(),
  };
}

export function formatSkillIdeaImplementationBriefMarkdown(idea = {}, registry = {}) {
  const brief = buildSkillIdeaImplementationBrief(idea, registry);
  const lines = [
    "# Skill Idea Implementation Brief",
    "",
    "This is a non-running implementation brief. It does not create a skill, prompt, route, schema, provider call, activation, or matter file.",
    "",
    "## Proposal",
    "",
    `- Idea id: ${packetValue(brief.ideaId)}`,
    `- Proposal type: ${brief.proposalType === "modify_existing_skill" ? "Improve existing skill" : "New skill"}`,
    `- Title: ${packetValue(brief.title)}`,
    `- Status: ${packetValue(statusLabel(brief.status))}`,
    `- Readiness: ${brief.readiness.ready ? "Checklist complete" : `Incomplete ${brief.readiness.passedCount}/${brief.readiness.totalCount}`}`,
    `- Matter: ${packetValue(brief.matter.matterName || brief.matter.folderName)}`,
    `- Matter folder: ${packetValue(brief.matter.folderName)}`,
    "",
    "## Original User Text",
    "",
    packetBlock(brief.originalText),
    "",
    "## User-Facing Purpose",
    "",
    packetBlock(brief.userFacingPurpose),
    "",
    "## Intended User",
    "",
    packetBlock(brief.intendedUser),
    "",
    "## Problem / Job To Be Done",
    "",
    packetBlock(brief.problem),
    "",
    "## Inputs",
    "",
    ...listOrFallback(brief.expectedInputs),
    "",
    "## Output",
    "",
    `- Output document: ${packetValue(brief.outputArtifact)}`,
    `- Target workspace area: ${packetValue(brief.targetLane)}`,
    `- Output posture: ${packetValue(brief.outputPosture)}`,
    "",
    "## Provider / Model Posture",
    "",
    packetBlock(brief.providerModelPosture),
    "",
    "## Source And Citation Discipline",
    "",
    packetBlock(brief.sourceCitationDiscipline),
    "",
    "## UI Entry Points",
    "",
    ...listOrFallback(brief.uiEntryPoints),
    "",
    "## Rerun / Overwrite Behavior",
    "",
    packetBlock(brief.rerunBehavior),
    "",
  ];

  if (brief.proposalType === "new_skill") {
    lines.push(
      "## New Skill Shape",
      "",
      `- Proposed slash command: ${packetValue(brief.proposedSlash)}`,
      `- Draft/internal/client/court posture: ${packetValue(brief.outputPosture)}`,
      "",
      "### Runtime Confirmations",
      "",
      ...listOrFallback(brief.runtimeConfirmations),
      "",
    );
  } else {
    lines.push(
      "## Existing Skill Change",
      "",
      `- Target existing skill: ${packetValue(brief.targetSkillId)}`,
      `- Change shape: ${packetValue(brief.changeShape)}`,
      "",
      "### What Should Change",
      "",
      ...listOrFallback(brief.whatChanges),
      "",
      "### What Must Stay Unchanged",
      "",
      ...listOrFallback(brief.whatMustStayUnchanged),
      "",
      "### Compatibility Risks",
      "",
      ...listOrFallback(brief.compatibilityRisks),
      "",
      "### Regression Tests Required",
      "",
      ...listOrFallback(brief.regressionTests),
      "",
    );
  }

  lines.push(
    "## Acceptance Tests",
    "",
    ...listOrFallback(brief.acceptanceTests),
    "",
    "## Non-Goals",
    "",
    ...listOrFallback(brief.nonGoals),
    "",
    "## Open Questions",
    "",
    ...listOrFallback(brief.openQuestions),
    "",
    "## What The Coder Should Build",
    "",
    ...listOrFallback(brief.implementationNotes),
    "",
    "## Hard Boundary",
    "",
    "This remains governance-only until a separate reviewed runtime PR implements it. No prompt, code, route, provider-backed skill execution, or activation has been generated by this brief.",
  );

  return `${lines.join("\n")}\n`;
}

function buildNewSkillBrief({ idea, brief, specialty }) {
  const defaults = specialtyDefaults(specialty);
  const outputArtifact = brief.expectedOutputArtifact || defaults.outputArtifact;
  const targetLane = brief.targetLane || defaults.targetLane;
  const title = defaults.title || titleFromArtifact(outputArtifact) || "Proposed Skill";
  const proposedSlash = defaults.proposedSlash || slashFromTitle(title);
  const risk = brief.riskLevel || defaults.riskLevel || "medium";
  const intendedUser = brief.intendedUser || defaults.intendedUser || "Lawyer or legal team member";
  const problem = brief.problem || defaults.problem || idea.text || "Define the job this skill should do.";
  const expectedInputs = splitInputs(brief.expectedInputs || defaults.expectedInputs);
  const outputPosture = defaults.outputPosture || outputPostureFromText(joinText([idea.text, brief.notes]));

  return {
    proposalType: "new_skill",
    title,
    proposedSkillName: title,
    proposedSlash,
    targetSkillId: "",
    userFacingPurpose: defaults.userFacingPurpose || problem,
    intendedUser,
    problem,
    expectedInputs,
    outputArtifact,
    targetLane,
    outputPosture,
    providerModelPosture: defaults.providerModelPosture || providerPostureFor({ paidPosture: brief.paidPosture, risk }),
    riskLevel: risk,
    sourceCitationDiscipline: defaults.sourceCitationDiscipline || defaultCitationDiscipline(outputPosture),
    uiEntryPoints: [
      `Command rail: ${proposedSlash}`,
      `Skills tab: built-in card after implementation`,
      "Output appears in the target workspace area after a confirmed run.",
    ],
    rerunBehavior: "Use a paid-rerun confirmation when the output document already exists and upstream inputs are current. Do not overwrite a lawyer-reviewed draft without confirmation.",
    runtimeConfirmations: defaults.runtimeConfirmations || [
      "Confirm the output document path before first run.",
      "Confirm whether the result is internal-only, client-facing, or court-facing.",
      "Confirm rerun/overwrite when a current draft already exists.",
    ],
    acceptanceTests: defaults.acceptanceTests || [
      "Given a saved idea, the runtime stays unavailable until a separate implementation PR adds it.",
      `When the skill runs in a future PR, it writes only ${outputArtifact}.`,
      "The output clearly identifies itself as a draft or review document as applicable.",
      "The run records provider/model metadata if a provider is used.",
    ],
    nonGoals: defaults.nonGoals || standardNonGoals(),
    openQuestions: defaults.openQuestions || buildOpenQuestions(brief, [
      "Confirm the exact output structure before runtime implementation.",
      "Confirm whether source citations should appear in the final output or stay internal.",
    ]),
    implementationNotes: defaults.implementationNotes || [
      `Add a built-in skill stub for ${proposedSlash} only in the runtime PR.`,
      "Reuse existing matter context packet boundaries; do not read raw source files directly.",
      "Keep this as a non-sending, lawyer-reviewable output.",
    ],
  };
}

function buildModifyBrief({ idea, brief, text, targetSkill }) {
  const targetSkillId = targetSkill?.slash || extractTargetSkill(text) || "/create_listofdates";
  const targetTitle = targetSkill?.title || targetSkillId;
  const limitationRelated = /\b(limitation|time[-\s]?barred|within\s+time|outside\s+limitation|delay|condonation)\b/i.test(text);
  const whatChanges = limitationRelated
    ? [
      "Add limitation-aware review signals to the lawyer-facing chronology experience.",
      "Surface dates or events that may affect limitation, while marking uncertain legal conclusions for lawyer review.",
      "Decide whether limitation appears as a separate review document or a clearly labelled mode/profile.",
    ]
    : [
      brief.problem || idea.text || `Improve ${targetTitle} as described by the saved idea.`,
      "Keep the change narrow and reviewable.",
    ];
  const outputArtifact = brief.expectedOutputArtifact || (limitationRelated
    ? "20_Workshop/Limitation Review.md"
    : "Separate review document unless the implementation brief justifies changing the existing output.");
  return {
    proposalType: "modify_existing_skill",
    title: limitationRelated ? "List of Dates Limitation Flags" : `Improve ${targetTitle}`,
    proposedSkillName: "",
    proposedSlash: "",
    targetSkillId,
    userFacingPurpose: brief.problem || idea.text || `Improve ${targetTitle}.`,
    intendedUser: brief.intendedUser || "Lawyer reviewing an existing matter output",
    problem: brief.problem || idea.text || `The current ${targetTitle} workflow needs a narrowly defined improvement.`,
    expectedInputs: splitInputs(brief.expectedInputs || "Existing skill inputs and current output documents."),
    outputArtifact,
    targetLane: brief.targetLane || (limitationRelated ? "20_Workshop" : "10_Library"),
    outputPosture: "Review document or explicit mode; not a silent change to current output.",
    providerModelPosture: providerPostureFor({ paidPosture: brief.paidPosture || "paid", risk: brief.riskLevel || "high" }),
    riskLevel: brief.riskLevel || (limitationRelated ? "high" : "medium"),
    sourceCitationDiscipline: "Every new factual flag, date, or legal-risk note must preserve readable source labels plus raw FILE-NNNN pX.bY citations. Do not turn uncertain legal analysis into final conclusions.",
    uiEntryPoints: [
      `Existing skill surface: ${targetSkillId}`,
      "Skills tab: improvement proposal stays non-runnable until separately implemented.",
      "If implemented as a separate review document, show it in the target workspace area.",
    ],
    rerunBehavior: "Do not change existing rerun behavior silently. If a new output document is introduced, add the same current-output confirmation pattern before overwriting it.",
    changeShape: limitationRelated
      ? "Likely separate review document that reads List of Dates, unless later review approves a List of Dates mode/profile."
      : "To be decided: mode/profile, output change, or separate review document.",
    whatChanges,
    whatMustStayUnchanged: [
      `${targetTitle} must preserve its current accepted output contract unless the runtime PR explicitly changes it.`,
      "Raw FILE-NNNN pX.bY citations remain canonical.",
      "Existing tests and beta workflows for the target skill must keep passing.",
      "No automatic provider fallback or silent model change should be introduced as part of this proposal.",
    ],
    compatibilityRisks: [
      "Existing users may rely on the current output shape and row wording.",
      "Adding legal-risk notes can overstate conclusions unless uncertainty is clearly marked.",
      "If folded into the existing output, regression risk is higher than a separate review document.",
    ],
    regressionTests: [
      `Existing tests for ${targetSkillId} still pass unchanged unless the PR explicitly updates the contract.`,
      "A fixture with no limitation issue does not invent one.",
      "A fixture with limitation-related dates preserves source labels and raw citations.",
      "Current rerun guardrails still appear before overwriting existing paid outputs.",
    ],
    acceptanceTests: [
      "Proposal remains non-runnable until a separate runtime PR.",
      "Implementation decision is explicit: mode/profile, existing output change, or separate review document.",
      "Every new legal-risk note is source-backed or marked for lawyer review.",
      "Existing target-skill outputs are not overwritten without confirmation.",
    ],
    nonGoals: [
      "Do not replace the existing target skill output silently.",
      "Do not produce final legal advice on limitation or merits.",
      "Do not generate runtime prompts, code, routes, or activation from this brief.",
      "Do not mutate built-in skill stubs in the governance-only PR.",
    ],
    openQuestions: buildOpenQuestions(brief, [
      "Should this be a new mode/profile of the existing skill, an output change, or a separate review document?",
      "What old behavior must be protected by regression tests?",
    ]),
    implementationNotes: [
      "Start with a design/runtime contract PR before changing the existing skill.",
      "Prefer a separate review document when legal analysis would clutter or destabilize the existing output.",
      "Use the matter context packet and current source-label contracts; do not read raw matter files directly.",
    ],
  };
}

function specialtyDefaults(specialty) {
  if (specialty === "client_update_email") {
    return {
      title: "Client Update Email",
      proposedSlash: "/client_update_email",
      userFacingPurpose: "Draft a warm, careful client update email after reviewing the matter materials and List of Dates.",
      intendedUser: "Lawyer preparing client communication",
      problem: "Reassure the client that the matter has been reviewed and further work is underway without giving unsupported legal advice.",
      expectedInputs: "Matter metadata, Source Index, List of Dates, and selected source-backed context needed to draft a status email.",
      outputArtifact: "30_Drafts/Client Update Email.md",
      targetLane: "30_Drafts",
      outputPosture: "Client-facing draft; lawyer must review before sending.",
      providerModelPosture: "Use a strong drafting model under a client-facing draft policy. Fail closed on malformed output. Never send the email automatically.",
      riskLevel: "high",
      sourceCitationDiscipline: "Use source-backed reasoning internally, but do not expose raw FILE-NNNN pX.bY citations in the client-facing email unless the lawyer explicitly requests them.",
      runtimeConfirmations: [
        "Confirm recipient style, such as Sir/Madam, client name, company/team, or custom salutation.",
        "Confirm tone: warm, formal, cautious, urgent, or neutral.",
        "Confirm whether to include only status/next steps or also a limited legal assessment.",
        "Confirm overwrite before replacing an existing Client Update Email.md draft.",
      ],
      acceptanceTests: [
        "A client-update idea is classified as a new skill, not a List of Dates modification.",
        "The future runtime writes only 30_Drafts/Client Update Email.md.",
        "The draft states that review/work is underway without promising outcome, strength, timeline, or final advice.",
        "The client-facing draft does not include raw FILE-NNNN citations unless explicitly requested.",
        "No email is sent or exported automatically.",
      ],
      nonGoals: [
        "Do not send email.",
        "Do not promise case outcome, court timeline, settlement, or legal success.",
        "Do not expose raw source citations to the client by default.",
        "Do not overwrite an existing draft without confirmation.",
        "Do not implement a general skill factory.",
      ],
      openQuestions: [
        "Should the first runtime ask for recipient name/style each run?",
        "Should the draft include document requests or only reassurance and next steps?",
        "Should citations be hidden entirely from the client draft or placed in an internal notes section?",
      ],
      implementationNotes: [
        "Implement as a hand-built built-in skill only after this governance brief is accepted.",
        "Reuse the matter context packet and List of Dates output; do not read raw source files directly.",
        "Render clearly as Draft - lawyer review required.",
      ],
    };
  }
  if (specialty === "party_officer_map") {
    return {
      title: "Party and Officer Map",
      proposedSlash: "/party_officer_map",
      userFacingPurpose: "Identify formal party names, officers, aliases, designations, and relationships from source-backed matter materials.",
      intendedUser: "Lawyer or paralegal preparing a party identity and relationship note",
      problem: "Matter materials may refer to parties and officers inconsistently; the legal team needs a cited map before drafting or review.",
      expectedInputs: "Matter metadata, extraction records, Source Index, pleadings, correspondence, invoices, notices, contracts, and orders represented through source-backed context.",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      targetLane: "20_Workshop",
      outputPosture: "Internal review document; source-backed identity map.",
      providerModelPosture: "Use a source-backed analysis policy with strict citation requirements. Strong model preferred because identity resolution errors are costly.",
      riskLevel: "high",
      sourceCitationDiscipline: "Every formal name, officer, alias, role, and relationship must cite readable source labels plus raw FILE-NNNN pX.bY citations. Uncertain identities must be marked uncertain.",
      runtimeConfirmations: [
        "Confirm whether to include only parties or also officers, agents, aliases, and related entities.",
        "Confirm whether uncertain matches should be grouped or left separate.",
        "Confirm overwrite before replacing an existing Party and Officer Map.md output.",
      ],
      acceptanceTests: [
        "A party/officer-name idea is classified as a new skill, not a List of Dates modification.",
        "The future runtime writes only 20_Workshop/Party and Officer Map.md.",
        "Every identity claim includes readable label plus raw citation.",
        "Conflicting names or aliases are marked for lawyer review rather than silently merged.",
      ],
      nonGoals: [
        "Do not decide legal liability from officer relationships.",
        "Do not merge uncertain aliases without showing uncertainty.",
        "Do not write to List of Dates or Source Index.",
        "Do not implement a general skill factory.",
      ],
      openQuestions: [
        "Should the first runtime include a relationship graph or only a table?",
        "Should it include external corporate-registry checks later, or stay matter-only in V0?",
      ],
      implementationNotes: [
        "Treat this as a bounded source-backed review document.",
        "Prefer tables: entity, role, aliases, related people/entities, source support, uncertainty.",
        "Use context packet boundaries and avoid raw-file reads.",
      ],
    };
  }
  return {};
}

function inferSpecialty(text, brief) {
  const haystack = joinText([text, brief.expectedOutputArtifact]);
  if (/\b(client\s+(update|email|communication)|email\s+to\s+client|update\s+client|comfort|reassur|warm\s+client)\b/i.test(haystack)) {
    return "client_update_email";
  }
  if (/\b(formal\s+names?|officers?|aliases?|relationships?|party\s+names?|parties?|directors?|authorised\s+signator(?:y|ies))\b/i.test(haystack)) {
    return "party_officer_map";
  }
  return "generic";
}

function shouldModifyExistingSkill(text, targetSkill) {
  if (!targetSkill?.slash) return false;
  if (/\b(new\s+skill|separate\s+(artifact|review)|draft\s+(a|an)|email|party|officer|formal\s+names?|relationship)\b/i.test(text)) {
    return false;
  }
  if (/\b(also|add|flag|include|change|modify|improve|make\s+.+\s+also|must\s+stay\s+unchanged|target\s+skill)\b/i.test(text)) {
    return true;
  }
  return Boolean(extractTargetSkill(text));
}

function resolveTargetSkill(text, registrySkills) {
  const explicit = extractTargetSkill(text);
  if (explicit) {
    return registrySkills.find((skill) => skill.slash === explicit) || { slash: explicit, title: explicit };
  }
  for (const target of KNOWN_TARGETS) {
    if (target.keywords.test(text)) {
      return registrySkills.find((skill) => skill.slash === target.slash) || target;
    }
  }
  return null;
}

function extractTargetSkill(text) {
  const match = String(text || "").match(/\bTarget skill:\s*(\/[a-z0-9_-]+)/i);
  return match?.[1] || "";
}

function normalizeDesignBrief(designBrief = {}) {
  return {
    intendedUser: stringOrEmpty(designBrief.intendedUser),
    problem: stringOrEmpty(designBrief.problem),
    expectedInputs: stringOrEmpty(designBrief.expectedInputs),
    expectedOutputArtifact: stringOrEmpty(designBrief.expectedOutputArtifact),
    targetLane: stringOrEmpty(designBrief.targetLane),
    paidPosture: stringOrEmpty(designBrief.paidPosture),
    riskLevel: stringOrEmpty(designBrief.riskLevel),
    notes: stringOrEmpty(designBrief.notes),
  };
}

function normalizeReadiness(readiness, brief) {
  if (readiness && Array.isArray(readiness.items)) {
    return {
      ready: Boolean(readiness.ready),
      passedCount: Number(readiness.passedCount || 0),
      totalCount: Number(readiness.totalCount || readiness.items.length),
    };
  }
  const keys = ["intendedUser", "problem", "expectedInputs", "expectedOutputArtifact", "targetLane", "paidPosture", "riskLevel", "notes"];
  const passedCount = keys.filter((key) => Boolean(brief[key])).length;
  return {
    ready: passedCount === keys.length,
    passedCount,
    totalCount: keys.length,
  };
}

function normalizeStatus(status) {
  return normalizeSkillIdeaStatus(status);
}

function statusLabel(status) {
  if (status === SKILL_IDEA_STATUS.READY_FOR_REVIEW) return "Ready for review";
  if (status === SKILL_IDEA_STATUS.PARKED) return "Parked";
  if (status === SKILL_IDEA_STATUS.DISMISSED) return "Dismissed";
  return "Incomplete";
}

function splitInputs(value) {
  const text = stringOrEmpty(value);
  if (!text) return [];
  const parts = text.split(/\n|;|,(?=\s+(?:and\s+)?(?:Source|List|matter|selected|pleadings|notices|contracts|orders|extraction|file|current|existing)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

function buildOpenQuestions(brief, defaults) {
  const questions = [];
  if (!brief.expectedOutputArtifact) questions.push("Confirm the exact output document path.");
  if (!brief.targetLane) questions.push("Confirm the target workspace area.");
  if (!brief.paidPosture || brief.paidPosture === "unknown") questions.push("Confirm whether the future runtime should be free/local or paid/provider-backed.");
  if (!brief.riskLevel) questions.push("Confirm the risk level before implementation.");
  return [...questions, ...defaults].filter(Boolean);
}

function providerPostureFor({ paidPosture, risk }) {
  if (paidPosture === "free") return "Prefer deterministic/local execution. If a provider becomes necessary later, require a separate model-policy review.";
  if (risk === "high") return "Use a strong task-specific model policy with fail-closed behavior, provider metadata, and human review before the output is relied on.";
  return "Use the future skill's own task policy. Do not expose model choice to the lawyer during idea capture.";
}

function defaultCitationDiscipline(outputPosture) {
  if (/\bclient-facing|court-facing/i.test(outputPosture)) {
    return "Use source-backed reasoning internally. Show citations in the final output only when the lawyer explicitly asks for them.";
  }
  return "Every factual assertion should preserve readable source labels plus raw FILE-NNNN pX.bY citations.";
}

function outputPostureFromText(text) {
  if (/\b(client|email|dispatch|send)\b/i.test(text)) return "Client-facing draft; lawyer review required.";
  if (/\b(court|pleading|application|affidavit)\b/i.test(text)) return "Court-facing draft; lawyer review required.";
  return "Internal review document.";
}

function titleFromArtifact(artifact) {
  const file = stringOrEmpty(artifact).split("/").pop() || "";
  return file.replace(/\.[a-z0-9]+$/i, "").trim();
}

function slashFromTitle(title) {
  const slug = stringOrEmpty(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `/${slug}` : "";
}

function standardNonGoals() {
  return [
    "Do not generate or activate a runnable skill from this brief.",
    "Do not mutate built-in skill stubs.",
    "Do not write into a matter folder from the governance flow.",
    "Do not bypass human review, rerun confirmation, or source-discipline requirements.",
  ];
}

function listOrFallback(values, fallback = "Not specified") {
  const list = Array.isArray(values) ? values : splitInputs(values);
  const normalized = list.map((value) => stringOrEmpty(value)).filter(Boolean);
  return normalized.length ? normalized.map((value) => `- ${redactSensitiveText(value)}`) : [`- ${redactSensitiveText(fallback)}`];
}

function packetValue(value) {
  return redactSensitiveText(stringOrEmpty(value) || "Not specified");
}

function packetBlock(value) {
  return redactSensitiveText(stringOrEmpty(value) || "Not specified");
}

function stringOrEmpty(value) {
  return String(value || "").trim();
}

function joinText(values) {
  return values.map(stringOrEmpty).filter(Boolean).join("\n");
}
