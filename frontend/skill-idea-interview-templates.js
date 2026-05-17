const DEFAULT_SOURCE_CITATION_RULE = "Every material point must cite source labels and raw FILE-NNNN pX.bY citations.";

export const ADJACENT_SKILL_PATTERNS = [
  {
    slash: "/create_listofdates",
    title: "Create List of Dates",
    patterns: [/list\s+of\s+dates/i, /chronolog/i, /timeline/i],
    targetLane: "10_Library",
    outputArtifact: "10_Library/List of Dates.md",
  },
  {
    slash: "/describe_sources",
    title: "Source Labels / Document Index",
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

export const DOMAIN_INTERVIEW_TEMPLATES = [
  {
    id: "limitation_review",
    patterns: [/\blimitation\b/i, /limitatation/i, /time[-\s]?barred/i, /within\s+time/i, /outside\s+limitation/i, /\bdelay\b/i, /\bcondonation\b/i],
    understood: "You want a limitation review skill that helps a lawyer assess whether a claim, issue, or defence appears within limitation, outside limitation, or uncertain, using source-backed dates.",
    designBrief: {
      intendedUser: "Lawyer reviewing limitation risk",
      problem: "Assess whether a claim, issue, or defence appears within limitation, outside limitation, or uncertain using cited source-backed dates.",
      expectedInputs: "Source-backed matter context, limitation-relevant dates, pleadings, notices, acknowledgements, and applicable legal setting supplied by the user.",
      expectedOutputArtifact: "20_Workshop/Limitation Review.md",
      targetLane: "20_Workshop",
      paidPosture: "unknown",
      riskLevel: "high",
      notes: "Not runnable yet. Default evidence rule: every limitation date and conclusion must cite source labels plus raw FILE-NNNN pX.bY citations.",
    },
    defaultAssumptions: [
      "Default evidence rule: every limitation date and conclusion must cite source labels plus raw FILE-NNNN pX.bY citations.",
    ],
    questions: [
      {
        id: "limitationPosition",
        label: "Whose limitation position should it assess?",
        help: "Choose the legal posture before the skill exists.",
        examples: ["client's claim", "opponent's claim", "both sides", "ask each run"],
      },
      {
        id: "decisionShape",
        label: "What should the output decide?",
        help: "Pick the review shape a lawyer would use.",
        examples: ["within limitation / outside limitation / uncertain", "limitation risk note", "issue-wise limitation table"],
      },
      {
        id: "legalSetting",
        label: "What legal setting should it assume?",
        help: "Limitation depends on forum and claim type, so this should be explicit.",
        examples: ["Indian civil litigation", "consumer complaint", "arbitration", "recovery suit", "ask each run"],
      },
    ],
  },
  {
    id: "pleading_summary",
    patterns: [/pleading/i, /written\s+statement/i, /\bplaint\b/i, /petition/i, /\breply\b/i, /best\s+case/i],
    understood: "You want a pleading-review skill that helps a lawyer turn pleadings into a source-backed summary or issue note without treating allegations as proven facts.",
    designBrief: {
      intendedUser: "Lawyer reviewing pleadings",
      problem: "Summarize pleadings in a lawyer-usable form while separating admissions, disputed allegations, and unsupported assertions.",
      expectedInputs: "Pleadings, replies, petitions, written statements, annexures, and source-backed extraction records.",
      expectedOutputArtifact: "20_Workshop/Pleadings Summary.md",
      targetLane: "20_Workshop",
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: `Not runnable yet. Default evidence rule: ${DEFAULT_SOURCE_CITATION_RULE}`,
    },
    defaultAssumptions: [`Default evidence rule: ${DEFAULT_SOURCE_CITATION_RULE}`],
    questions: [
      {
        id: "outputShape",
        label: "What shape should the output take?",
        help: "Choose the lawyer-facing structure before the skill exists.",
        examples: ["concise summary", "issue-wise matrix", "best-case argument note"],
      },
      {
        id: "pleadingScope",
        label: "Which pleadings should it read?",
        help: "Scope the source set so the future skill does not overreach.",
        examples: ["all pleadings", "plaint and written statement only", "petition and reply", "ask each run"],
      },
      {
        id: "factTreatment",
        label: "Should it separate admitted facts, disputed allegations, and unsupported assertions?",
        help: "This keeps the output useful without turning pleadings into proved facts.",
        examples: ["yes, separate all three", "only admissions and disputes", "ask each run"],
      },
    ],
  },
  {
    id: "evidence_gap",
    patterns: [/evidence\s+gap/i, /missing\s+documents?/i, /missing\s+facts?/i, /fact\s+gap/i, /proof\s+gap/i],
    understood: "You want an evidence-gap skill that helps a lawyer identify missing documents, facts, or proof points from source-backed matter materials.",
    designBrief: {
      intendedUser: "Lawyer preparing evidence strategy",
      problem: "Identify missing documents, fact gaps, and proof gaps in a lawyer-reviewable way.",
      expectedInputs: "Source-backed matter context, pleadings, correspondence, exhibits, and available evidence records.",
      expectedOutputArtifact: "20_Workshop/Evidence Gaps.md",
      targetLane: "20_Workshop",
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: `Not runnable yet. Default evidence rule: ${DEFAULT_SOURCE_CITATION_RULE}`,
    },
    defaultAssumptions: [`Default evidence rule: ${DEFAULT_SOURCE_CITATION_RULE}`],
    questions: [
      {
        id: "gapGrouping",
        label: "How should gaps be grouped?",
        help: "Choose the review structure a lawyer would scan.",
        examples: ["by issue", "by source", "by party burden"],
      },
      {
        id: "followUps",
        label: "Should it suggest follow-up documents or questions?",
        help: "Decide whether the future skill should only identify gaps or also suggest next steps.",
        examples: ["suggest documents", "suggest client questions", "both", "no suggestions"],
      },
      {
        id: "gapPriority",
        label: "Should it mark critical vs optional gaps?",
        help: "This helps separate case-blocking gaps from useful clean-up.",
        examples: ["critical / optional", "high / medium / low", "ask each run"],
      },
    ],
  },
  {
    id: "weakness_review",
    patterns: [/\bweakness(?:es)?\b/i, /weak\s+facts?/i, /\brisk(?:s)?\b/i, /adverse\s+facts?/i, /bad\s+facts?/i, /opponent(?:'s)?\s+arguments?/i, /client\s+perspective/i],
    understood: "You want a weakness review skill that helps a lawyer identify adverse facts, evidence gaps, contradictions, procedural or legal risks, and opponent-facing arguments from the client's perspective.",
    designBrief: {
      intendedUser: "Lawyer reviewing client-side case risk",
      problem: "Identify weaknesses, risks, adverse facts, evidentiary gaps, contradictions, credibility concerns, and likely opponent arguments from the client's perspective.",
      expectedInputs: "Whole matter context, extracted records, Source Index, List of Dates, pleadings, notices, correspondence, orders, receipts, and other source-backed records.",
      expectedOutputArtifact: "20_Workshop/Weakness Review.md",
      targetLane: "20_Workshop",
      paidPosture: "unknown",
      riskLevel: "high",
      notes: "Not runnable yet. Default evidence rule: every factual weakness must cite source labels plus raw FILE-NNNN pX.bY citations. Unsupported strategic concerns must be marked as lawyer-review assumptions. Default tone: candid internal lawyer review from the client's perspective.",
    },
    defaultAssumptions: [
      "Default evidence rule: every factual weakness must cite source labels plus raw FILE-NNNN pX.bY citations.",
      "Default tone: candid internal lawyer review from the client's perspective.",
    ],
    questions: [
      {
        id: "weaknessFocus",
        label: "What type of weaknesses should it focus on?",
        help: "Choose the risk lens before the skill exists.",
        examples: ["facts", "evidence gaps", "contradictions", "procedural/legal risks", "opponent arguments", "all"],
      },
      {
        id: "weaknessStructure",
        label: "How should the output be structured?",
        help: "Pick the review format a lawyer would use first.",
        examples: ["ranked risk list", "issue-wise weakness table", "strategy memo", "follow-up checklist"],
      },
      {
        id: "weaknessAudience",
        label: "Who is the audience?",
        help: "This controls how candid or client-safe the future output should be.",
        examples: ["internal lawyer only", "client-safe summary", "court-prep note"],
      },
    ],
  },
];

export const SIMPLE_OUTPUT_PATTERNS = [
  {
    patterns: [/draft/i, /notice/i],
    targetLane: "30_Drafts",
    outputArtifact: "30_Drafts/Draft Legal Output.md",
    expectedInputs: "Source-backed matter records and lawyer instructions.",
    riskLevel: "high",
  },
  {
    patterns: [/dispatch/i, /bundle/i, /exhibit/i],
    targetLane: "40_Dispatch",
    outputArtifact: "40_Dispatch/Review Bundle Index.md",
    expectedInputs: "Selected sources, labels, citations, and reviewed matter files.",
    riskLevel: "medium",
  },
  {
    patterns: [/issue/i, /contradiction/i],
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Issue Review Notes.md",
    expectedInputs: "Source-backed matter context, citations, and relevant Library files.",
    riskLevel: "medium",
  },
  {
    patterns: [/summary/i, /summar/i],
    targetLane: "20_Workshop",
    outputArtifact: "20_Workshop/Matter Summary.md",
    expectedInputs: "Source-backed matter records and selected Library files.",
    riskLevel: "medium",
  },
];
