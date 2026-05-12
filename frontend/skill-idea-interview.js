const ADJACENT_SKILL_PATTERNS = [
  {
    slash: "/create_listofdates",
    title: "Create List of Dates",
    patterns: [/list\s+of\s+dates/i, /chronolog/i, /timeline/i],
    targetLane: "10_Library",
    outputArtifact: "10_Library/List of Dates.md",
  },
  {
    slash: "/describe_sources",
    title: "Describe Sources",
    patterns: [/describe\s+sources/i, /source\s+labels?/i, /source\s+descriptors?/i],
    targetLane: "10_Library",
    outputArtifact: "10_Library/Source Index.json",
  },
  {
    slash: "/context_search",
    title: "Context Search",
    patterns: [/context\s+search/i, /\bfind\b/i, /\bsearch\b/i],
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Search Review Notes.md",
  },
];

const SIMPLE_OUTPUT_PATTERNS = [
  {
    patterns: [/pleading/i, /written\s+statement/i, /petition/i],
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Pleadings Summary.md",
    expectedInputs: "Pleadings, replies, annexures, and source-backed extraction records.",
    riskLevel: "medium",
  },
  {
    patterns: [/draft/i, /notice/i, /reply/i],
    targetLane: "30_Drafts",
    outputArtifact: "30_Drafts/Draft Legal Output.md",
    expectedInputs: "Source-backed matter records and lawyer instructions.",
    riskLevel: "high",
  },
  {
    patterns: [/dispatch/i, /bundle/i, /exhibit/i],
    targetLane: "40_Dispatch",
    outputArtifact: "40_Dispatch/Review Bundle Index.md",
    expectedInputs: "Selected sources, labels, citations, and reviewed matter artifacts.",
    riskLevel: "medium",
  },
  {
    patterns: [/issue/i, /contradiction/i, /limitation/i],
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Issue Review Notes.md",
    expectedInputs: "Source-backed matter context, citations, and relevant library artifacts.",
    riskLevel: "medium",
  },
  {
    patterns: [/summary/i, /summar/i],
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Matter Summary.md",
    expectedInputs: "Source-backed matter records and selected library artifacts.",
    riskLevel: "medium",
  },
];

export function buildSkillIdeaInterview(skillIdea, userRequest = "") {
  const originalText = String(skillIdea?.text || userRequest || "").trim();
  const ideaText = String(skillIdea?.idea || originalText).trim();
  const adjacent = detectAdjacentSkill(originalText);
  if (adjacent) {
    return buildAdjacentInterview({ originalText, ideaText, adjacent });
  }
  return buildSimpleInterview({ originalText, ideaText });
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
      expectedInputs: `Existing ${adjacent.title} inputs and source-backed matter artifacts.`,
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
        placeholder: "Example: flag limitation dates separately from ordinary chronology rows.",
      },
      {
        id: "unchanged",
        label: "What must stay unchanged?",
        placeholder: "Example: preserve raw FILE citations and existing List of Dates output.",
      },
      {
        id: "artifact",
        label: "Modify existing artifact or create a separate review artifact?",
        placeholder: "Example: separate 20_Workshop/Limitation Review.md first.",
      },
    ],
  };
}

function buildSimpleInterview({ originalText, ideaText }) {
  const output = inferSimpleOutput(ideaText);
  const questions = [
    {
      id: "citationDiscipline",
      label: "What source or citation discipline should it follow?",
      placeholder: "Example: every point must cite FILE-NNNN pX.bY and source labels.",
    },
    {
      id: "matterScope",
      label: "Should it cover the whole matter or selected sources?",
      placeholder: "Example: whole matter, or only pleadings and replies.",
    },
  ];
  if (isRiskyLegalIdea(ideaText)) {
    questions.push({
      id: "legalSetting",
      label: "What legal setting or review risk should it respect?",
      placeholder: "Example: civil recovery pleadings; avoid final legal conclusions.",
    });
  }

  return {
    mode: "new_skill",
    originalText,
    ideaText,
    targetSkill: "",
    understood: `You want to save a future skill idea for: ${ideaText || originalText}.`,
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
    questions,
  };
}

function detectAdjacentSkill(text) {
  return ADJACENT_SKILL_PATTERNS.find((candidate) => (
    candidate.patterns.some((pattern) => pattern.test(text))
  )) || null;
}

function inferSimpleOutput(text) {
  const match = SIMPLE_OUTPUT_PATTERNS.find((candidate) => (
    candidate.patterns.some((pattern) => pattern.test(text))
  ));
  return match || {
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Skill Idea Notes.md",
    expectedInputs: "Source-backed matter records and selected library artifacts.",
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

function mergeInterviewNotes({ existingNotes, questions, answers }) {
  const lines = [];
  const normalizedExisting = String(existingNotes || "").trim();
  if (normalizedExisting) lines.push(normalizedExisting);
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
