import {
  ADJACENT_SKILL_PATTERNS,
  DOMAIN_INTERVIEW_TEMPLATES,
  SIMPLE_OUTPUT_PATTERNS,
} from "./skill-idea-interview-templates.js";

const MAX_PLANNER_QUESTIONS = 10;
const VALID_TARGET_LANES = new Set(["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"]);
const VALID_PAID_POSTURES = new Set(["free", "paid", "unknown"]);
const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);

export function buildSkillIdeaInterview(skillIdea, userRequest = "") {
  const originalText = String(skillIdea?.text || userRequest || "").trim();
  const ideaText = String(skillIdea?.idea || originalText).trim();
  const forceNewSkill = skillIdea?.mode === "new_skill" || skillIdea?.forceNewSkill === true;
  const adjacent = forceNewSkill ? null : detectAdjacentSkill(originalText);
  if (adjacent) {
    return buildAdjacentInterview({ originalText, ideaText, adjacent });
  }
  const domainTemplate = detectDomainTemplate(`${originalText} ${ideaText}`);
  if (domainTemplate) {
    return buildDomainInterview({ originalText, ideaText, template: domainTemplate });
  }
  return buildSimpleInterview({ originalText, ideaText });
}

export async function planSkillIdeaInterview(skillIdea, userRequest = "", {
  plannerProvider,
  activeMatter,
  skillRegistry,
  designBrief,
} = {}) {
  if (typeof plannerProvider === "function") {
    try {
      const planned = await plannerProvider({
        skillIdea,
        userRequest,
        activeMatter: summarizeActiveMatter(activeMatter),
        skillRegistry: summarizeSkillRegistry(skillRegistry),
        designBrief: sanitizeDesignBrief(designBrief),
      });
      return normalizePlannerInterview(planned, skillIdea, userRequest);
    } catch {
      // V1 must never block idea capture; deterministic planning is the safe fallback.
    }
  }
  return buildSkillIdeaInterview(skillIdea, userRequest);
}

export function parseAdaptiveSkillIdeaInput(userRequest) {
  const normalized = String(userRequest || "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (!detectAdjacentSkill(normalized)) return null;
  if (!/\b(can|could|should|also|add|flag|include|change|improve|support|show|surface)\b/i.test(normalized)) {
    return null;
  }
  return {
    type: "skill_idea",
    text: normalized,
    idea: normalized,
  };
}

export function buildSkillIdeaPayloadFromInterview({
  interview,
  answers = {},
  designBrief = {},
} = {}) {
  const source = interview || {};
  const suggested = source.designBrief || {};
  const mergedBrief = {
    intendedUser: pickText(designBrief.intendedUser, suggested.intendedUser),
    problem: pickText(designBrief.problem, suggested.problem),
    expectedInputs: pickText(designBrief.expectedInputs, suggested.expectedInputs),
    expectedOutputArtifact: pickText(designBrief.expectedOutputArtifact, suggested.expectedOutputArtifact),
    targetLane: pickText(designBrief.targetLane, suggested.targetLane),
    paidPosture: pickText(designBrief.paidPosture, suggested.paidPosture),
    riskLevel: pickText(designBrief.riskLevel, suggested.riskLevel),
    notes: mergeInterviewNotes({
      existingNotes: pickText(designBrief.notes, suggested.notes),
      defaultAssumptions: source.defaultAssumptions,
      questions: source.questions || [],
      answers,
    }),
  };
  return {
    text: source.originalText || "",
    designBrief: mergedBrief,
  };
}

function buildAdjacentInterview({ originalText, ideaText, adjacent }) {
  const changeText = cleanImprovementText(ideaText, adjacent);
  return {
    mode: "adjacent_improvement",
    originalText,
    ideaText,
    targetSkill: adjacent.slash,
    understood: `You want a future change around ${adjacent.title}, without changing or running that skill now.`,
    designBrief: {
      intendedUser: "Legal team",
      problem: `Explore whether ${adjacent.title} should ${changeText || "change its output or review behavior"}.`,
      expectedInputs: `Existing ${adjacent.title} inputs and source-backed matter files.`,
      expectedOutputArtifact: adjacent.outputArtifact,
      targetLane: adjacent.targetLane,
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: `Target skill: ${adjacent.slash}. Not runnable yet.`,
    },
    questions: [
      {
        id: "change",
        label: "What should change?",
        examples: ["flag limitation dates separately from ordinary chronology rows"],
      },
      {
        id: "unchanged",
        label: "What must stay unchanged?",
        examples: ["preserve raw FILE citations and existing List of Dates output"],
      },
      {
        id: "artifact",
        label: "Modify existing output or create a separate review document?",
        examples: ["create 20_Workshop/Limitation Review.md first"],
      },
    ],
  };
}

function buildDomainInterview({ originalText, ideaText, template }) {
  const sourceText = `${originalText} ${ideaText}`;
  const hasDetailedSpec = isDetailedSkillSpecification(sourceText);
  const questions = hasDetailedSpec
    ? []
    : template.questions.map(normalizeQuestion);
  const defaultAssumptions = [...template.defaultAssumptions];
  const designBrief = { ...template.designBrief };
  if (hasDetailedSpec) {
    defaultAssumptions.push("The initial request already contains a detailed skill specification; no generic follow-up questions are needed before saving or sample review.");
    designBrief.notes = [
      designBrief.notes,
      "Detailed user specification supplied in the original idea. Treat it as the controlling design direction unless the lawyer later edits it.",
    ].filter(Boolean).join("\n");
  }
  return {
    mode: "new_skill",
    originalText,
    ideaText,
    targetSkill: "",
    understood: hasDetailedSpec
      ? `${template.understood} The first message already gives a detailed proposed workflow, so this is ready to save or test with a sample instead of asking generic setup questions.`
      : template.understood,
    designBrief,
    defaultAssumptions,
    openQuestions: [],
    riskFlags: template.designBrief.riskLevel === "high"
      ? ["High legal-risk review. Human lawyer review required before relying on output."]
      : [],
    questions,
  };
}

function buildSimpleInterview({ originalText, ideaText }) {
  const output = inferSimpleOutput(ideaText);
  const questions = [
    {
      id: "citationDiscipline",
      label: "What source or citation discipline should it follow?",
      examples: ["every point must cite FILE-NNNN pX.bY and source labels"],
    },
    {
      id: "matterScope",
      label: "Should it cover the whole matter or selected sources?",
      examples: ["whole matter", "only pleadings and replies"],
    },
  ];
  if (isRiskyLegalIdea(ideaText)) {
    questions.push({
      id: "legalSetting",
      label: "What legal setting or review risk should it respect?",
      examples: ["civil recovery pleadings; avoid final legal conclusions"],
    });
  }

  return {
    mode: "new_skill",
    originalText,
    ideaText,
    targetSkill: "",
    understood: `You want to save a skill idea for: ${ideaText || originalText}.`,
    designBrief: {
      intendedUser: "Legal team",
      problem: sentenceCase(ideaText || originalText),
      expectedInputs: output.expectedInputs,
      expectedOutputArtifact: output.outputArtifact,
      targetLane: output.targetLane,
      paidPosture: "unknown",
      riskLevel: output.riskLevel,
      notes: "Not runnable yet. Interview answers should define evidence discipline and review boundaries.",
    },
    defaultAssumptions: [],
    openQuestions: [],
    riskFlags: [],
    questions: questions.map(normalizeQuestion),
  };
}

function detectAdjacentSkill(text) {
  const explicitSkillIdea = /\bskil{1,2}\b/i.test(text);
  return ADJACENT_SKILL_PATTERNS.find((candidate) => (
    !(explicitSkillIdea && candidate.slash === "/context_search" && !/context\s+search/i.test(text))
    &&
    candidate.patterns.some((pattern) => pattern.test(text))
  )) || null;
}

function detectDomainTemplate(text) {
  return DOMAIN_INTERVIEW_TEMPLATES.find((template) => (
    template.patterns.some((pattern) => pattern.test(text))
  )) || null;
}

function isDetailedSkillSpecification(text) {
  const normalized = String(text || "").trim();
  if (normalized.length < 220) return false;
  const signals = [
    /\bsteps?\s*:/i,
    /\bidentify\b/i,
    /\bstate\b/i,
    /\bcalculate\b/i,
    /\bcheck\b/i,
    /\bmention\b/i,
    /\bgive a clear final answer\b/i,
    /\bwithin time\b/i,
    /\bbarred by limitation\b/i,
    /\barticle\(s\)?\b/i,
    /\bsections?\s+\d/i,
    /\bprescribed limitation period\b/i,
    /\bcause of action\b/i,
    /\baccrual\b/i,
  ];
  return signals.filter((pattern) => pattern.test(normalized)).length >= 4;
}

function inferSimpleOutput(text) {
  const match = SIMPLE_OUTPUT_PATTERNS.find((candidate) => (
    candidate.patterns.some((pattern) => pattern.test(text))
  ));
  return match || {
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Skill Idea Notes.md",
    expectedInputs: "Source-backed matter records and selected Library files.",
    riskLevel: "medium",
  };
}

function cleanImprovementText(text, adjacent) {
  return String(text || "")
    .replace(new RegExp(adjacent.title, "ig"), "")
    .replace(/list\s+of\s+dates/ig, "")
    .replace(/chronology/ig, "")
    .replace(/\balso\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRiskyLegalIdea(text) {
  return /\b(pleadings?|petition|claim|notice|reply|court|legal|limitation|breach|damages|liability|draft)\b/i.test(text);
}

function sentenceCase(text) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}.`;
}

function pickText(primary, fallback) {
  return String(primary || "").trim() || String(fallback || "").trim();
}

function mergeInterviewNotes({ existingNotes, defaultAssumptions, questions, answers }) {
  const lines = [];
  const normalizedExisting = String(existingNotes || "").trim();
  if (normalizedExisting) lines.push(normalizedExisting);
  const assumptions = normalizeStringArray(defaultAssumptions);
  for (const assumption of assumptions) {
    if (!lines.some((line) => line.includes(assumption))) {
      lines.push(assumption);
    }
  }
  const answered = (questions || [])
    .map((question) => ({
      label: question.label,
      answer: String(answers?.[question.id] || "").trim(),
    }))
    .filter((item) => item.answer);
  if (answered.length) {
    lines.push("Interview answers:");
    for (const item of answered) {
      lines.push(`- ${item.label}: ${item.answer}`);
    }
  }
  return lines.join("\n");
}

function normalizeQuestion(question = {}) {
  const examples = Array.isArray(question.examples)
    ? question.examples.map((example) => String(example || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  const placeholder = String(question.placeholder || "").trim()
    || (examples.length ? `Examples: ${examples.join(", ")}.` : "");
  return {
    id: String(question.id || "").trim(),
    label: String(question.label || "").trim(),
    help: String(question.help || "").trim(),
    examples,
    placeholder,
  };
}

function normalizePlannerInterview(planned, skillIdea, userRequest) {
  const plannerMeta = planned?.__plannerMeta || null;
  const fallback = buildSkillIdeaInterview(skillIdea, userRequest);
  if (!planned || typeof planned !== "object") return { ...fallback, planner: plannerMeta };
  let questions = Array.isArray(planned.questions)
    ? planned.questions.map(normalizeQuestion).filter((question) => question.id && question.label).slice(0, MAX_PLANNER_QUESTIONS)
    : [];
  const hasPlannerContent = Boolean(
    String(planned.understood_summary || planned.understood || "").trim()
    || planned.inferred_design_brief
    || planned.designBrief
  );
  if (!questions.length && !hasPlannerContent) return { ...fallback, planner: plannerMeta };
  const mode = normalizeMode(planned.mode) || fallback.mode;
  const contextText = `${fallback.originalText} ${fallback.ideaText}`;
  if (mode === "new_skill" && isDetailedSkillSpecification(contextText)) {
    questions = [];
  }
  const designBrief = normalizePlannerDesignBrief(
    planned.inferred_design_brief || planned.designBrief,
    fallback.designBrief,
    contextText,
  );
  return {
    mode,
    originalText: fallback.originalText,
    ideaText: fallback.ideaText,
    targetSkill: normalizePlannerTargetSkill(planned.target_skill || planned.targetSkill || fallback.targetSkill, mode),
    understood: String(planned.understood_summary || planned.understood || fallback.understood || "").trim(),
    designBrief,
    defaultAssumptions: normalizeStringArray(planned.default_assumptions || planned.defaultAssumptions),
    openQuestions: normalizeStringArray(planned.open_questions || planned.openQuestions),
    riskFlags: normalizePlannerRiskFlags(planned.risk_flags || planned.riskFlags, contextText, designBrief),
    questions,
    planner: plannerMeta,
  };
}

function normalizePlannerTargetSkill(value, mode) {
  if (mode === "new_skill") return "";
  const text = String(value || "").trim();
  return text.startsWith("/") ? text : "";
}

function normalizePlannerDesignBrief(value, fallback = {}, contextText = "") {
  const raw = sanitizeDesignBrief(value);
  const brief = {
    ...fallback,
    ...raw,
  };
  if (!VALID_TARGET_LANES.has(brief.targetLane)) brief.targetLane = fallback.targetLane || "20_Workshop";
  if (!VALID_PAID_POSTURES.has(brief.paidPosture)) brief.paidPosture = fallback.paidPosture || "unknown";
  if (!VALID_RISK_LEVELS.has(brief.riskLevel)) brief.riskLevel = fallback.riskLevel || "medium";

  const clientFacingDraft = isClientFacingDraftIdea(contextText);
  if (clientFacingDraft) {
    brief.targetLane = "30_Drafts";
    brief.riskLevel = "high";
    const clientFacingArtifact = inferClientFacingDraftArtifact(contextText);
    if (
      !brief.expectedOutputArtifact
      || !brief.expectedOutputArtifact.startsWith("30_Drafts/")
      || isWeaknessReviewIdea(contextText)
    ) {
      brief.expectedOutputArtifact = clientFacingArtifact;
    }
    if (!/raw FILE citations internal/i.test(brief.notes || "")) {
      brief.notes = [
        brief.notes,
        "Client-facing draft. Keep raw FILE citations internal with source-backed reasoning; do not show raw FILE citations unless the lawyer asks.",
      ].filter(Boolean).join("\n");
    }
  }
  if (isLimitationReviewIdea(contextText)) {
    brief.targetLane = "20_Workshop";
    brief.riskLevel = "high";
    brief.expectedOutputArtifact = "20_Workshop/Limitation Review.md";
    if (!/special statute|limitation act|raw FILE citations/i.test(brief.notes || "")) {
      brief.notes = [
        brief.notes,
        "Limitation review. Do not assume the general Limitation Act always governs; identify or ask whether a special statute or forum-specific limitation period applies. Every limitation date and conclusion must cite source labels plus raw FILE-NNNN pX.bY citations.",
      ].filter(Boolean).join("\n");
    }
  }
  if (isWeaknessReviewIdea(contextText) && !clientFacingDraft) {
    brief.targetLane = "20_Workshop";
    brief.riskLevel = "high";
    brief.expectedOutputArtifact = "20_Workshop/Weakness Review.md";
    if (!/factual weakness|opponent/i.test(brief.notes || "")) {
      brief.notes = [
        brief.notes,
        "Weakness review. Every factual weakness must cite source labels plus raw FILE-NNNN pX.bY citations. Unsupported strategic concerns must be marked as lawyer-review assumptions.",
      ].filter(Boolean).join("\n");
    }
  }
  if (isPartyOfficerMappingIdea(contextText) && !clientFacingDraft) {
    brief.targetLane = "20_Workshop";
    if (brief.riskLevel === "low") brief.riskLevel = "medium";
    brief.expectedOutputArtifact = "20_Workshop/Party and Officer Map.md";
    if (!/party|officer|source labels|raw FILE citations/i.test(brief.notes || "")) {
      brief.notes = [
        brief.notes,
        "Party and officer map. Formal names, officer roles, signatories, aliases, and conflicts must stay source-backed with source labels plus raw FILE-NNNN pX.bY citations.",
      ].filter(Boolean).join("\n");
    }
  }
  if (isWorkshopStrategyIdea(contextText) && !clientFacingDraft) {
    brief.targetLane = "20_Workshop";
    brief.riskLevel = "high";
    brief.expectedOutputArtifact = inferWorkshopStrategyArtifact(contextText);
  }
  if (isDispatchPreparationIdea(contextText)) {
    brief.targetLane = "40_Dispatch";
    brief.riskLevel = "high";
    brief.expectedOutputArtifact = inferDispatchArtifact(contextText);
  }
  if (isHighLegalRiskIdea(contextText)) {
    brief.riskLevel = "high";
  }
  if (!/not runnable yet/i.test(brief.notes || "")) {
    brief.notes = [
      brief.notes,
      "Not runnable yet. This is a design brief only; no prompt, code, provider call, or executable skill has been generated.",
    ].filter(Boolean).join("\n");
  }
  return brief;
}

function isClientFacingDraftIdea(text) {
  return /\b(client|client-facing|client-safe|client safe)\b/i.test(text)
    && /\b(email|update|communication|comfort|reassur|warm|draft|summary|memo|send|share|safe)\b/i.test(text);
}

function inferClientFacingDraftArtifact(text) {
  if (isWeaknessReviewIdea(text)) return "30_Drafts/Client-Safe Weakness Summary.md";
  if (/\b(settlement|without prejudice|proposal)\b/i.test(text)) return "30_Drafts/Settlement Proposal Email.md";
  if (/\b(email|update|communication|comfort|reassur|warm)\b/i.test(text)) return "30_Drafts/Client Update Email.md";
  return "30_Drafts/Client-Facing Draft.md";
}

function isWorkshopStrategyIdea(text) {
  return /\b(senior\s+counsel|conference\s+briefing|opponent(?:'s)?\s+strongest|opponent(?:'s)?\s+arguments?|argument\s+map|settlement\s+risk|best\s+case\s+worst\s+case|likely\s+outcome|witness\s+prep(?:aration)?|contradictions?|procedural\s+timeline|appeal\s+deadline|deadline\s+check)\b/i.test(text);
}

function inferWorkshopStrategyArtifact(text) {
  if (/\b(senior\s+counsel|conference\s+briefing)\b/i.test(text)) return "20_Workshop/Senior Counsel Briefing Note.md";
  if (/\b(opponent(?:'s)?\s+strongest|opponent(?:'s)?\s+arguments?|argument\s+map)\b/i.test(text)) return "20_Workshop/Opponent Argument Map.md";
  if (/\b(settlement\s+risk|best\s+case\s+worst\s+case|likely\s+outcome)\b/i.test(text)) return "20_Workshop/Settlement Risk Matrix.md";
  if (/\bwitness\s+prep(?:aration)?\b/i.test(text)) return "20_Workshop/Witness Preparation Note.md";
  if (/\bappeal\s+deadline|deadline\s+check\b/i.test(text)) return "20_Workshop/Appeal Deadline Review.md";
  if (/\bprocedural\s+timeline\b/i.test(text)) return "20_Workshop/Procedural Timeline.md";
  if (/\bcontradictions?\b/i.test(text)) return "20_Workshop/Contradiction Analysis.md";
  return "20_Workshop/Strategy Review.md";
}

function isDispatchPreparationIdea(text) {
  return /\b(redact|redaction|private\s+information|passport|phone\s+numbers?|addresses?|dispatch|paginated\s+index|filing\s+bundle|bundle\s+index|exhibit\s+descriptions?)\b/i.test(text);
}

function inferDispatchArtifact(text) {
  if (/\b(redact|redaction|private\s+information|passport|phone\s+numbers?|addresses?)\b/i.test(text)) return "40_Dispatch/Redaction Review Checklist.md";
  if (/\b(paginated\s+index|filing\s+bundle|bundle\s+index|exhibit\s+descriptions?)\b/i.test(text)) return "40_Dispatch/Filing Bundle Index.md";
  return "40_Dispatch/Dispatch Checklist.md";
}

function isHighLegalRiskIdea(text) {
  return /\b(court|synopsis|legal\s+notice|affidavit|interim\s+application|cross[-\s]?examination|witness|settlement\s+risk|best\s+case\s+worst\s+case|likely\s+outcome|appeal\s+deadline|deadline\s+check|opponent(?:'s)?\s+arguments?|senior\s+counsel|redaction|filing\s+bundle)\b/i.test(text);
}

function isLimitationReviewIdea(text) {
  return /\b(limitation|limitatation|time[-\s]?barred|within\s+time|outside\s+limitation|condonation)\b/i.test(text);
}

function isWeaknessReviewIdea(text) {
  return /\b(weakness(?:es)?|weak\s+facts?|adverse\s+facts?|bad\s+facts?|opponent(?:'s)?\s+arguments?|client\s+perspective)\b/i.test(text);
}

function isPartyOfficerMappingIdea(text) {
  return /\b(formal\s+names?|legal\s+names?|party\s+names?|parties|client(?:'s)?\s+officers?|opposite\s+part(?:y|ies)(?:'s)?\s+officers?|officers?|directors?|signator(?:y|ies)|authorised\s+representatives?|authorized\s+representatives?|aliases?|trading\s+names?)\b/i.test(text)
    && /\b(client|opposite\s+part(?:y|ies)|party|parties|officers?|directors?|signator(?:y|ies)|names?)\b/i.test(text);
}

function normalizePlannerRiskFlags(value, contextText = "", designBrief = {}) {
  const flags = normalizeStringArray(value);
  if (designBrief.riskLevel !== "high") return flags;
  const hasHighSignal = flags.some((flag) => /\bhigh\b|human lawyer review required|required before/i.test(flag));
  if (hasHighSignal) return flags;
  const fallbackFlag = isClientFacingDraftIdea(contextText)
    ? "High-risk client-facing draft. Human lawyer review required before sending."
    : "High legal-risk review. Human lawyer review required before relying on output.";
  return [fallbackFlag, ...flags].slice(0, 5);
}

function normalizeMode(mode) {
  const normalized = String(mode || "").trim();
  return ["new_skill", "adjacent_improvement", "modification_candidate"].includes(normalized)
    ? normalized
    : "";
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)
    : [];
}

function sanitizeDesignBrief(value = {}) {
  return {
    intendedUser: String(value.intendedUser || "").trim(),
    problem: String(value.problem || "").trim(),
    expectedInputs: String(value.expectedInputs || "").trim(),
    expectedOutputArtifact: String(value.expectedOutputArtifact || "").trim(),
    targetLane: String(value.targetLane || "").trim(),
    paidPosture: String(value.paidPosture || "").trim(),
    riskLevel: String(value.riskLevel || "").trim(),
    notes: String(value.notes || "").trim(),
  };
}

function summarizeActiveMatter(activeMatter) {
  if (!activeMatter || typeof activeMatter !== "object") return null;
  const metadata = activeMatter.metadata || {};
  return {
    matterName: String(metadata.matterName || activeMatter.folderName || "").trim(),
    matterType: String(metadata.matterType || "").trim(),
    jurisdiction: String(metadata.jurisdiction || "").trim(),
    client: String(metadata.client || "").trim(),
    oppositeParty: String(metadata.oppositeParty || "").trim(),
  };
}

function summarizeSkillRegistry(registry) {
  const skills = Array.isArray(registry?.skills) ? registry.skills : [];
  return skills.map((skill) => ({
    slash: String(skill.slash || "").trim(),
    title: String(skill.title || "").trim(),
    purpose: String(skill.purpose || skill.description || "").trim(),
    inputs: Array.isArray(skill.inputs) ? skill.inputs.slice(0, 5) : [],
    outputs: Array.isArray(skill.outputs) ? skill.outputs.slice(0, 5) : [],
    lane: String(skill.default_lane || skill.defaultLane || "").trim(),
    sourceBacked: String(skill.source_backed || skill.sourceBacked || "").trim(),
  })).filter((skill) => skill.slash || skill.title);
}
