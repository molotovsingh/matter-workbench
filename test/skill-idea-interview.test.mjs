import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  planSkillIdeaInterview,
  parseAdaptiveSkillIdeaInput,
} from "../frontend/skill-idea-interview.js";

test("skill idea interview plans limitation review with legally apt questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a new skill that checks if the issue is within or outside of limitation",
    idea: "checks if the issue is within or outside of limitation",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /limitation review skill/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.defaultAssumptions.join("\n"), /every limitation date and conclusion must cite source labels plus raw FILE-NNNN pX\.bY citations/i);
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["limitationPosition", "decisionShape", "legalSetting"],
  );
  assert.match(interview.questions[0].label, /Whose limitation position/i);
  assert.doesNotMatch(interview.questions[0].label, /citation/i);
});

test("skill idea interview treats detailed limitation specifications as ready without generic questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "You are a Limitation Law Expert. For any given case, fact situation, or cause of action, strictly check the limitation period under the Limitation Act, 1963. Steps: Identify the exact Article(s) applicable. State the prescribed limitation period. Calculate when limitation starts from cause of action, knowledge, or accrual. Check if the suit, appeal, or application is within time or barred. Mention extensions, exclusions, or savings under Sections 5, 6, 12-15, 18-20 if applicable. Give a clear final answer: Within time or Barred by limitation with brief reasoning.",
    idea: "strictly check limitation period, articles, starting point, extensions, exclusions, and final within time or barred answer",
  });

  assert.equal(interview.mode, "new_skill");
  assert.match(interview.understood, /ready to save or test with a sample/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
  assert.equal(interview.questions.length, 0);
  assert.match(interview.defaultAssumptions.join("\n"), /detailed skill specification/i);
  assert.match(interview.designBrief.notes, /Detailed user specification supplied/i);
});

test("skill idea interview plans pleading summary with pleading-specific questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    idea: "summarises the best case pleadings for the lawyer",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /pleading-review skill/i);
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Pleadings Summary.md");
  assert.equal(interview.designBrief.paidPosture, "unknown");
  assert.equal(interview.designBrief.riskLevel, "medium");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["outputShape", "pleadingScope", "factTreatment"],
  );
  assert.match(interview.questions[0].examples.join(" "), /issue-wise matrix/);
  assert.match(interview.questions[2].label, /admitted facts, disputed allegations, and unsupported assertions/i);
});

test("skill idea interview plans evidence-gap review with gap-specific questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a skill to find missing documents and evidence gaps",
    idea: "find missing documents and evidence gaps",
  });

  assert.equal(interview.mode, "new_skill");
  assert.match(interview.understood, /evidence-gap skill/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Evidence Gaps.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["gapGrouping", "followUps", "gapPriority"],
  );
  assert.match(interview.questions[1].label, /follow-up documents or questions/i);
  assert.match(interview.questions[2].label, /critical vs optional gaps/i);
});

test("skill idea interview plans weakness review with client-risk questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a skill to find weaknesses and opponent arguments from the client perspective",
    idea: "find weaknesses and opponent arguments from the client perspective",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /weakness review skill/i);
  assert.match(interview.understood, /adverse facts, evidence gaps, contradictions/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Weakness Review.md");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.problem, /opponent arguments/i);
  assert.match(interview.designBrief.notes, /candid internal lawyer review/i);
  assert.match(interview.defaultAssumptions.join("\n"), /every factual weakness must cite source labels plus raw FILE-NNNN pX\.bY citations/i);
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["weaknessFocus", "weaknessStructure", "weaknessAudience"],
  );
  assert.match(interview.questions[0].label, /type of weaknesses/i);
  assert.match(interview.questions[0].examples.join(" "), /procedural\/legal risks/);
  assert.match(interview.questions[1].examples.join(" "), /issue-wise weakness table/);
  assert.match(interview.questions[2].examples.join(" "), /internal lawyer only/);
});

test("skill idea interview detects adjacent list-of-dates improvement", () => {
  const interview = buildSkillIdeaInterview({
    text: "can we make a skill for list of dates to flag limitation issues",
    idea: "list of dates to flag limitation issues",
  });

  assert.equal(interview.mode, "adjacent_improvement");
  assert.equal(interview.targetSkill, "/create_listofdates");
  assert.match(interview.understood, /Create List of Dates/);
  assert.equal(interview.designBrief.targetLane, "10_Library");
  assert.equal(interview.designBrief.expectedOutputArtifact, "10_Library/List of Dates.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["change", "unchanged", "artifact"],
  );
});

test("skill idea interview treats pleading summary as a new skill, not list-of-dates modification", () => {
  const interview = buildSkillIdeaInterview({
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    idea: "summarises the best case pleadings for the lawyer",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Pleadings Summary.md");
  assert.doesNotMatch(interview.understood, /Create List of Dates/);
});

test("skill interview planner falls back deterministically without provider configuration", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a skill to find missing documents and evidence gaps",
    idea: "find missing documents and evidence gaps",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Evidence Gaps.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["gapGrouping", "followUps", "gapPriority"],
  );
});

test("skill interview planner falls back deterministically when provider fails", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a new skill that checks if the issue is within or outside of limitation",
    idea: "checks if the issue is within or outside of limitation",
  }, "", {
    plannerProvider: async () => {
      throw new Error("planner unavailable");
    },
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["limitationPosition", "decisionShape", "legalSetting"],
  );
});

test("skill interview planner preserves six-question model plans", async () => {
  const questions = Array.from({ length: 6 }, (_, index) => ({
    id: `q${index + 1}`,
    label: `Question ${index + 1}?`,
    help: `Help ${index + 1}.`,
    examples: [`example ${index + 1}`],
  }));
  const interview = await planSkillIdeaInterview({
    text: "design a complex client update and document request skill",
    idea: "design a complex client update and document request skill",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a complex client communication skill.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Draft client updates and request documents.",
        expectedInputs: "Matter context and lawyer instructions.",
        expectedOutputArtifact: "30_Drafts/Client Update Email.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "high",
        notes: "Client-facing draft; lawyer review required.",
      },
      default_assumptions: ["No raw FILE citations in client-facing drafts unless requested."],
      questions,
      open_questions: [],
      risk_flags: ["External-facing draft requires lawyer review."],
    }),
  });

  assert.equal(interview.questions.length, 6);
  assert.deepEqual(interview.questions.map((question) => question.id), ["q1", "q2", "q3", "q4", "q5", "q6"]);
});

test("skill interview planner keeps detailed limitation plans beyond three questions", async () => {
  const questions = [
    "Whose position should it assess?",
    "Which claim or defence should it review?",
    "Which forum or statute should it assume?",
    "Should special statute limitation be checked before the Limitation Act?",
    "Should acknowledgment, part payment, or continuing cause be flagged?",
    "How should favourable, adverse, and uncertain points be shown?",
  ].map((label, index) => ({
    id: `limitationQ${index + 1}`,
    label,
    help: "Limitation review needs this design choice.",
    examples: ["ask each run"],
  }));
  const interview = await planSkillIdeaInterview({
    text: "create a limitation review skill for client and opponent claims, special statutes, acknowledgment, and uncertainty",
    idea: "review limitation for client and opponent claims with special statutes and uncertainty",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a limitation review skill that handles both sides, special statutes, and uncertainty.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Review limitation for client and opponent positions.",
        expectedInputs: "Matter dates, pleadings, notices, acknowledgments, filings, forum, and statute.",
        expectedOutputArtifact: "20_Workshop/Limitation Review.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "high",
        notes: "High-risk limitation review with source-backed dates.",
      },
      default_assumptions: ["Every limitation conclusion must cite source labels and raw citations."],
      questions,
      open_questions: [],
      risk_flags: ["High legal-risk review."],
    }),
  });

  assert.equal(interview.questions.length, 6);
  assert.deepEqual(interview.questions.map((question) => question.id), [
    "limitationQ1",
    "limitationQ2",
    "limitationQ3",
    "limitationQ4",
    "limitationQ5",
    "limitationQ6",
  ]);
  assert.match(interview.questions[3].label, /special statute/i);
  assert.match(interview.questions[5].label, /favourable, adverse, and uncertain/i);
});

test("skill interview planner accepts model plans that are ready without follow-up questions", async () => {
  const interview = await planSkillIdeaInterview({
    text: "write a fully specified limitation review skill",
    idea: "write a fully specified limitation review skill",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You supplied enough detail for a limitation review skill to move to sample review.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Assess limitation with article, start date, savings, exclusions, and final cautious conclusion.",
        expectedInputs: "Matter context, dates, pleadings, filings, acknowledgments, forum, and applicable statute.",
        expectedOutputArtifact: "20_Workshop/Limitation Review.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "high",
        notes: "Ready for sample review; lawyer must verify limitation conclusions.",
      },
      default_assumptions: ["Every conclusion must cite source labels and raw citations."],
      questions: [],
      open_questions: [],
      risk_flags: ["High legal-risk review."],
    }),
  });

  assert.equal(interview.questions.length, 0);
  assert.match(interview.understood, /move to sample review/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
});

test("skill interview planner drops provider questions for detailed step-by-step specifications", async () => {
  const interview = await planSkillIdeaInterview({
    text: "You are a Limitation Law Expert. For any given case, fact situation, or cause of action, strictly check the limitation period under the Limitation Act, 1963. Steps: Identify the exact Article(s) applicable. State the prescribed limitation period. Calculate when limitation starts from cause of action, knowledge, or accrual. Check if the suit, appeal, or application is within time or barred. Mention extensions, exclusions, or savings under Sections 5, 6, 12-15, 18-20 if applicable. Give a clear final answer: Within time or Barred by limitation with brief reasoning.",
    idea: "strictly check limitation period, articles, starting point, extensions, exclusions, and final within time or barred answer",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You supplied a detailed limitation review workflow.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Assess limitation under the applicable statute and give a cautious source-backed conclusion.",
        expectedInputs: "Matter context, dates, cause of action, forum, statute, pleadings, filings, acknowledgments, and exclusions.",
        expectedOutputArtifact: "20_Workshop/Limitation Review.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "high",
        notes: "Detailed limitation workflow supplied.",
      },
      default_assumptions: ["Use the supplied step-by-step limitation workflow."],
      questions: [{
        id: "genericCitation",
        label: "What source or citation discipline should it follow?",
        help: "Generic question that should be skipped for a detailed spec.",
        examples: ["cite everything"],
      }],
      open_questions: [],
      risk_flags: ["High legal-risk review."],
    }),
  });

  assert.equal(interview.questions.length, 0);
  assert.match(interview.understood, /detailed limitation review workflow/i);
});

test("skill interview planner normalizes limitation plans back to workshop review", async () => {
  const interview = await planSkillIdeaInterview({
    text: "checks if limitation is for or against the client",
    idea: "checks if limitation is for or against the client",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "limitation_clause",
      understood_summary: "You want a limitation clause assessment skill.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Assess limitation wording.",
        expectedInputs: "Contract clauses.",
        expectedOutputArtifact: "30_Drafts/Limitation Clause Assessment.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Assess limitation clause drafting.",
      },
      default_assumptions: [],
      questions: [{
        id: "statute",
        label: "Which statute or forum should it consider?",
        help: "Limitation depends on the legal setting.",
        examples: ["Limitation Act", "consumer complaint"],
      }],
      open_questions: [],
      risk_flags: ["Medium risk because lawyer review is useful."],
    }),
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.notes, /special statute/i);
  assert.match(interview.designBrief.notes, /raw FILE-NNNN pX\.bY citations/i);
  assert.match(interview.riskFlags.join("\n"), /High legal-risk review/i);
});

test("skill interview planner normalizes weakness plans back to workshop review", async () => {
  const interview = await planSkillIdeaInterview({
    text: "highlights weaknesses of the matter from the client's perspective",
    idea: "highlights weaknesses of the matter from the client's perspective",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a client-facing weakness summary.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Summarize weaknesses.",
        expectedInputs: "Matter summary.",
        expectedOutputArtifact: "30_Drafts/Weaknesses Summary.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Draft a summary.",
      },
      default_assumptions: [],
      questions: [{
        id: "audience",
        label: "Who is the audience?",
        help: "Choose the review audience.",
        examples: ["internal lawyer", "client-safe"],
      }],
      open_questions: [],
      risk_flags: ["Medium risk because lawyer review is useful."],
    }),
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Weakness Review.md");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.notes, /factual weakness/i);
  assert.match(interview.designBrief.notes, /raw FILE-NNNN pX\.bY citations/i);
  assert.match(interview.riskFlags.join("\n"), /High legal-risk review/i);
});

test("skill interview planner normalizes party and officer mapping to workshop", async () => {
  const interview = await planSkillIdeaInterview({
    text: "discover the formal names of client its officers and same for opposite party",
    idea: "discover formal names of client, its officers, and the opposite party officers",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a party-name lookup skill.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Find formal names and officers.",
        expectedInputs: "Matter files.",
        expectedOutputArtifact: "10_Library/Party and Officer Names.md",
        targetLane: "10_Library",
        paidPosture: "paid",
        riskLevel: "low",
        notes: "Identify names.",
      },
      default_assumptions: [],
      questions: [{
        id: "scope",
        label: "What names should it include?",
        help: "Choose the party identity scope.",
        examples: ["formal names", "officers", "aliases"],
      }],
      open_questions: [],
      risk_flags: [],
    }),
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Party and Officer Map.md");
  assert.equal(interview.designBrief.riskLevel, "medium");
  assert.match(interview.designBrief.notes, /source-backed/i);
  assert.match(interview.designBrief.notes, /raw FILE-NNNN pX\.bY citations/i);
});

test("skill interview planner keeps client-safe weakness summaries in drafts", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a skill that turns internal weaknesses into a client safe summary without scaring the client",
    idea: "turns internal weaknesses into a client safe summary without scaring the client",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a client-safe weakness summary.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Summarize weaknesses for client communication.",
        expectedInputs: "Internal weakness review.",
        expectedOutputArtifact: "30_Drafts/Client Update Email.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Turn internal weaknesses into client-safe language.",
      },
      default_assumptions: [],
      questions: [{
        id: "tone",
        label: "What tone should the client-safe summary use?",
        help: "Choose how candid or reassuring it should be.",
        examples: ["reassuring", "strictly factual"],
      }],
      open_questions: [],
      risk_flags: ["Medium risk because lawyer review is useful."],
    }),
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.equal(interview.designBrief.targetLane, "30_Drafts");
  assert.equal(interview.designBrief.expectedOutputArtifact, "30_Drafts/Client-Safe Weakness Summary.md");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.notes, /raw FILE citations internal/i);
  assert.match(interview.riskFlags.join("\n"), /High-risk client-facing draft/i);
});

test("skill interview planner normalizes dispatch preparation to dispatch lane", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a skill to check drafts for private information and redact passport numbers before dispatch",
    idea: "check drafts for private information and redact passport numbers before dispatch",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a redacted draft skill.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Redact private information.",
        expectedInputs: "Draft documents.",
        expectedOutputArtifact: "30_Drafts/Redacted Draft.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Check draft before dispatch.",
      },
      default_assumptions: [],
      questions: [{
        id: "redactionScope",
        label: "What private information should be redacted?",
        help: "Choose the redaction scope.",
        examples: ["passport numbers", "addresses"],
      }],
      open_questions: [],
      risk_flags: [],
    }),
  });

  assert.equal(interview.designBrief.targetLane, "40_Dispatch");
  assert.equal(interview.designBrief.expectedOutputArtifact, "40_Dispatch/Redaction Review Checklist.md");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.notes, /Not runnable yet/);
});

test("skill interview planner normalizes strategy and deadline review to high-risk workshop", async () => {
  const interview = await planSkillIdeaInterview({
    text: "make a skill that maps the opponent strongest arguments and our replies with citations",
    idea: "maps the opponent strongest arguments and our replies with citations",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want an argument map.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Map opponent arguments.",
        expectedInputs: "Matter context.",
        expectedOutputArtifact: "20_Workshop/Opponent Argument Map.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Internal analysis.",
      },
      default_assumptions: [],
      questions: [{
        id: "argumentStrength",
        label: "How should strongest arguments be identified?",
        help: "Choose the review lens.",
        examples: ["legal strength", "evidence strength"],
      }],
      open_questions: [],
      risk_flags: ["Medium risk because lawyer review is useful."],
    }),
  });

  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Opponent Argument Map.md");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.notes, /Not runnable yet/);
  assert.match(interview.riskFlags.join("\n"), /High legal-risk review/i);
});

test("skill interview planner normalizes filing bundle index to dispatch lane", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a skill to make a paginated index for a filing bundle with exhibit descriptions",
    idea: "make a paginated index for a filing bundle with exhibit descriptions",
    mode: "new_skill",
    forceNewSkill: true,
  }, "", {
    plannerProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a bundle index.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Prepare a paginated index.",
        expectedInputs: "Bundle documents.",
        expectedOutputArtifact: "30_Drafts/Paginated Bundle Index.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "External filing support.",
      },
      default_assumptions: [],
      questions: [{
        id: "pagination",
        label: "How should pagination work?",
        help: "Choose pagination rules.",
        examples: ["start from 1"],
      }],
      open_questions: [],
      risk_flags: [],
    }),
  });

  assert.equal(interview.designBrief.targetLane, "40_Dispatch");
  assert.equal(interview.designBrief.expectedOutputArtifact, "40_Dispatch/Filing Bundle Index.md");
  assert.equal(interview.designBrief.riskLevel, "high");
});

test("adaptive skill idea parser catches adjacent improvement requests without skill wording", () => {
  assert.deepEqual(parseAdaptiveSkillIdeaInput("can list of dates also flag limitation issues"), {
    type: "skill_idea",
    text: "can list of dates also flag limitation issues",
    idea: "can list of dates also flag limitation issues",
  });
  assert.equal(parseAdaptiveSkillIdeaInput("list of dates"), null);
  assert.equal(parseAdaptiveSkillIdeaInput("please extract"), null);
});

test("skill idea interview payload stores answers in design brief notes", () => {
  const interview = buildSkillIdeaInterview({
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    idea: "summarises the best case pleadings for the lawyer",
  });
  const payload = buildSkillIdeaPayloadFromInterview({
    interview,
    answers: {
      outputShape: "Issue-wise matrix.",
      pleadingScope: "Plaint and written statement.",
      factTreatment: "Separate admissions, disputes, and unsupported assertions.",
    },
    designBrief: {
      expectedOutputArtifact: "20_Workshop/Pleading Issues.md",
    },
  });

  assert.equal(payload.text, "make a new skill that summarises the best case pleadings for the lawyer");
  assert.equal(payload.designBrief.expectedOutputArtifact, "20_Workshop/Pleading Issues.md");
  assert.equal(payload.designBrief.targetLane, "20_Workshop");
  assert.match(payload.designBrief.notes, /Interview answers:/);
  assert.match(payload.designBrief.notes, /Default evidence rule:/);
  assert.match(payload.designBrief.notes, /Issue-wise matrix/);
  assert.match(payload.designBrief.notes, /Separate admissions, disputes, and unsupported assertions/);
});

test("skill idea interview payload synthesizes text when opened from blank new-skill chip", () => {
  const interview = buildSkillIdeaInterview({
    text: "",
    idea: "",
    mode: "new_skill",
  });
  const payload = buildSkillIdeaPayloadFromInterview({
    interview,
    answers: {
      citationDiscipline: "Every point must cite source labels.",
      matterScope: "Whole matter.",
    },
    designBrief: {
      problem: "",
      expectedOutputArtifact: "20_Workshop/Source Support Note.md",
      expectedInputs: "List of Dates plus source records.",
    },
  });

  assert.equal(
    payload.text,
    "Create a reusable skill that produces 20_Workshop/Source Support Note.md from List of Dates plus source records.",
  );
  assert.equal(payload.designBrief.expectedOutputArtifact, "20_Workshop/Source Support Note.md");
});
