import type {
  ActiveMatter,
  SkillIdea,
  SkillIdeaDesignBrief,
  SkillIdeaSample,
  SkillInterviewPlanResponse,
  SkillRegistry,
  SkillRouterDecision,
} from '../types';
import { SKILL_IDEA_STATUS } from './skillIdeaStatuses';
import { normalizeSkillSampleState, SKILL_SAMPLE_STATE, type SkillSampleState } from './skillSampleStates';
import { redactSensitiveText } from './secretRedaction';
import {
  DEFAULT_SKILL_IDEA_DESIGN_BRIEF,
  SKILL_IDEA_READINESS_CHECKS,
  calculateSkillIdeaReadinessForView,
  normalizeSkillIdeaDesignBriefForView,
} from './skillIdeaDesignBrief';

export interface InterviewQuestion {
  id: string;
  label: string;
  help?: string;
  examples?: string[];
  placeholder?: string;
}

type PacketDesignBrief = {
  intendedUser: string;
  problem: string;
  expectedInputs: string;
  expectedOutputArtifact: string;
  targetLane: string;
  paidPosture: string;
  riskLevel: string;
  notes: string;
};

export const SIMPLE_SKILL_IDEA_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'output',
    label: 'What should this skill produce?',
    help: 'Describe the output document or artifact.',
    examples: ['A summary table of key dates', 'A limitations letter draft', 'A comparison chart of terms'],
    placeholder: 'e.g. a timeline with key events and sources',
  },
  {
    id: 'input',
    label: 'What inputs does it need?',
    help: 'Describe what source documents or data it reads.',
    examples: ['The extracted documents', 'Source labels and metadata', 'All matter files'],
    placeholder: 'e.g. the extracted documents and source labels',
  },
  {
    id: 'rules',
    label: 'Any special rules or format requirements?',
    help: 'Optional — constraints, sorting, structure, tone.',
    examples: ['Sort chronologically', 'Use formal legal language', 'Include page references'],
    placeholder: 'e.g. sort by date, include source file names',
  },
];

export const SKILL_IDEA_KICKOFF_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'problem',
    label: 'What is the exact skill idea in one sentence?',
    help: "Example: 'review limitation risk for a consumer complaint' or 'draft a client update email from the latest matter record'.",
    examples: [
      'review limitation risk for a consumer complaint',
      'draft a client update email from the latest matter record',
    ],
  },
];

export const SKILL_IDEA_NAME_QUESTION: InterviewQuestion = {
  id: 'skillName',
  label: 'What would you like to name this skill?',
  help: 'Pick a short name the lawyer can recognize later on the Skills page.',
  examples: ['Limitation Risk Review', 'Client Update Email', 'Filing Route Plan'],
};

export function hasSkillIdeaTestMatter(activeMatter: ActiveMatter | null | undefined): boolean {
  return Boolean(activeMatter?.folderName);
}

export function buildSkillIdeaDesignBrief(
  ideaText: string,
  answers: Record<string, string>,
  plannedBrief: SkillIdeaDesignBrief | null,
  questions: InterviewQuestion[],
): SkillIdeaDesignBrief {
  const answerNotes = formatSkillIdeaAnswerNotes(answers, questions);
  const notes = [
    plannedBrief?.notes,
    answerNotes,
  ].filter(Boolean).join('\n');
  const plannedProblem = usableSkillIdeaProblem(plannedBrief?.problem);
  const problem = answers.problem
    || answers.goal
    || answers.job
    || ideaText
    || inferSkillIdeaProblemFromAnswers(answers, questions)
    || plannedProblem;
  return {
    intendedUser: plannedBrief?.intendedUser || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.intendedUser,
    problem,
    expectedInputs: answers.input || plannedBrief?.expectedInputs || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.expectedInputs,
    expectedOutputArtifact: answers.output || plannedBrief?.expectedOutputArtifact || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.expectedOutputArtifact,
    targetLane: plannedBrief?.targetLane || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.targetLane,
    paidPosture: plannedBrief?.paidPosture || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.paidPosture,
    riskLevel: plannedBrief?.riskLevel || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.riskLevel,
    notes: notes || DEFAULT_SKILL_IDEA_DESIGN_BRIEF.notes,
  };
}

export function skillIdeaTextForSave(ideaText: string, brief: SkillIdeaDesignBrief): string {
  return skillIdeaTextForSaveWithName(ideaText, brief, '');
}

export function skillIdeaTextForSaveWithName(
  ideaText: string,
  brief: SkillIdeaDesignBrief,
  skillName: string,
): string {
  const name = normalizeBriefText(skillName);
  if (name) return name;
  const text = normalizeBriefText(ideaText);
  if (text) return text;
  const problem = usableSkillIdeaProblem(brief.problem);
  if (problem) return `Create a reusable skill to ${lowercaseLead(problem)}`;
  const output = normalizeBriefText(brief.expectedOutputArtifact);
  const inputs = normalizeBriefText(brief.expectedInputs);
  if (output && inputs) return `Create a reusable skill that produces ${output} from ${inputs}`;
  if (output) return `Create a reusable skill that produces ${output}`;
  return 'New Matter Skill';
}

export function formatSkillIdeaDesignBrief(brief: SkillIdeaDesignBrief): string {
  return [
    `Problem: ${brief.problem || ''}`,
    `Expected inputs: ${brief.expectedInputs || ''}`,
    `Expected output: ${brief.expectedOutputArtifact || ''}`,
    `Target lane: ${brief.targetLane || ''}`,
    `Paid posture: ${brief.paidPosture || ''}`,
    `Risk: ${brief.riskLevel || ''}`,
    `Notes: ${brief.notes || ''}`,
  ].join('\n');
}

export function normalizePlannedSkillIdeaInterview(
  result: SkillInterviewPlanResponse,
  fallbackIdeaText: string,
) {
  const plan = result.plan;
  if (!plan) {
    return {
      understoodText: fallbackIdeaText,
      questions: SIMPLE_SKILL_IDEA_QUESTIONS,
      designBrief: null,
      defaultAssumptions: [],
      riskFlags: [],
    };
  }
  const questions = ensureProblemQuestionForEmptyIdea(
    Array.isArray(plan.questions)
    ? plan.questions
      .filter((question) => question?.id && question?.label)
      .map((question) => ({
        id: question.id,
        label: question.label,
        help: question.help,
        examples: Array.isArray(question.examples) ? question.examples : [],
      }))
    : [],
    fallbackIdeaText,
  );
  const designBrief = plan.inferred_design_brief || null;
  return {
    understoodText: plan.understood_summary || fallbackIdeaText,
    questions: appendSkillNameQuestion(questions, fallbackIdeaText, designBrief),
    designBrief,
    defaultAssumptions: Array.isArray(plan.default_assumptions) ? plan.default_assumptions : [],
    riskFlags: Array.isArray(plan.risk_flags) ? plan.risk_flags : [],
  };
}

export function formatSkillIdeaPlannerTerminalLine(result: SkillInterviewPlanResponse): string {
  if (result.planner?.used) {
    return `[skill-idea] model-planned interview ready: ${result.planner.provider || 'provider'} ${result.planner.model || ''}`.trim();
  }
  return `[skill-idea] basic interview ready${result.planner?.reason ? `: ${result.planner.reason}` : ''}`;
}

export function formatSkillIdeaAnswerNotes(answers: Record<string, string>, questions: InterviewQuestion[]): string {
  const byId = new Map(questions.map((question) => [question.id, question.label]));
  return Object.entries(answers)
    .filter(([, value]) => value.trim())
    .map(([id, value]) => `${byId.get(id) || id}: ${value.trim()}`)
    .join('\n');
}

function ensureProblemQuestionForEmptyIdea(questions: InterviewQuestion[], fallbackIdeaText: string): InterviewQuestion[] {
  if (fallbackIdeaText.trim()) return questions;
  const hasExactIdeaQuestion = questions.some((question) => {
    const label = String(question.label || '').toLowerCase();
    return /\bwhat is the exact skill idea\b/.test(label);
  });
  if (hasExactIdeaQuestion) return questions;
  return [
    SKILL_IDEA_KICKOFF_QUESTIONS[0],
    ...questions,
  ];
}

function appendSkillNameQuestion(
  questions: InterviewQuestion[],
  fallbackIdeaText: string,
  plannedBrief: SkillIdeaDesignBrief | null,
): InterviewQuestion[] {
  const withoutExistingName = questions.filter((question) => question.id !== SKILL_IDEA_NAME_QUESTION.id);
  return [
    ...withoutExistingName,
    {
      ...SKILL_IDEA_NAME_QUESTION,
      examples: skillNameSuggestions(fallbackIdeaText, plannedBrief),
    },
  ];
}

export function skillNameSuggestions(
  ideaText: string,
  plannedBrief: SkillIdeaDesignBrief | null,
  answers: Record<string, string> = {},
): string[] {
  const intentText = [
    answers.problem,
    answers.goal,
    answers.job,
    answers.task,
    answers.purpose,
    answers.decision,
  ].filter(Boolean).join(' ');
  const answerText = Object.entries(answers)
    .filter(([id, value]) => id !== SKILL_IDEA_NAME_QUESTION.id && normalizeBriefText(value))
    .map(([, value]) => value)
    .join(' ');
  const candidates = [
    titleFromIntent(intentText),
    titleFromIntent(answers.output || ''),
    titleFromIntent(answerText),
    titleFromIntent(ideaText),
    titleFromText(plannedBrief?.expectedOutputArtifact || ''),
    titleFromIntent(plannedBrief?.problem || ''),
    ...(SKILL_IDEA_NAME_QUESTION.examples || []),
  ].filter(Boolean);
  return Array.from(new Set(candidates)).slice(0, 3);
}

function titleFromIntent(value: string): string {
  const text = normalizeBriefText(value);
  if (!text || /^unknown\b/i.test(text)) return '';
  if (/\blimitation|time[- ]bar|time barred|delay\b/i.test(text)) return 'Limitation Risk Review';
  if (/\bclient\b/i.test(text) && /\b(update|email|mail|letter)\b/i.test(text)) return 'Client Update Email';
  if (/\b(email|mail)\b/i.test(text) && /\bclient|party|opposite|respondent|petitioner\b/i.test(text)) return 'Client Update Email';
  if (/\bforum|jurisdiction|filing route|where to file|petition|notice|external documents?\b/i.test(text)) return 'Filing Route Plan';
  if (/\b(document|documents|notice|notices|petition|petitions|annexure|filings?)\b/i.test(text)) return 'Document Preparation Plan';
  if (/\bparty|parties|officer|entity|entities|director|signatory\b/i.test(text)) return 'Party and Officer Map';
  if (/\bchronolog|timeline|list of dates|key dates?\b/i.test(text)) return 'Case Timeline Review';
  if (/\bweakness|risk|gap|support|unsupported|merits?\b/i.test(text)) return 'Case Risk Review';
  return titleFromText(text);
}

function titleFromText(value: string): string {
  const text = normalizeBriefText(value)
    .replace(/^\d+_[^/]+\//, '')
    .replace(/\.(md|json|txt)$/i, '')
    .replace(/^create (a )?(reusable )?skill (to|that)\s+/i, '')
    .replace(/^draft a?\s+/i, 'draft ')
    .replace(/\bfrom the latest matter record\b/i, '')
    .replace(/\bfrom selected matter documents\b/i, '')
    .trim();
  if (!text || /^unknown\b/i.test(text)) return '';
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function usableSkillIdeaProblem(value: unknown): string {
  const text = normalizeBriefText(value);
  if (!text) return '';
  if (/^unknown\b/i.test(text)) return '';
  if (/not (?:yet )?(?:provided|described|specified|known)/i.test(text)) return '';
  if (/skill idea has not been described/i.test(text)) return '';
  return text;
}

function inferSkillIdeaProblemFromAnswers(answers: Record<string, string>, questions: InterviewQuestion[]): string {
  const entries = Object.entries(answers)
    .map(([id, value]) => ({
      id,
      value: normalizeBriefText(value),
      label: normalizeBriefText(questions.find((question) => question.id === id)?.label),
    }))
    .filter((entry) => entry.value);
  const direct = entries.find((entry) => /\b(problem|goal|job|task|purpose)\b/i.test(`${entry.id} ${entry.label}`));
  if (direct) return direct.value;
  const output = entries.find((entry) => /\b(output|produce|decision|structure|flow)\b/i.test(`${entry.id} ${entry.label}`));
  if (output) return `Produce ${output.value}`;
  return entries[0]?.value || '';
}

function normalizeBriefText(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function lowercaseLead(value: string): string {
  const text = normalizeBriefText(value);
  if (!text) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export function overlapMatchedLabel(decision: SkillRouterDecision): string {
  const matched = decision.matched_skill || '';
  const title = decision.matched_skill_card?.title || decision.matched_skill_card?.display?.action || matched;
  return [title, matched && matched !== title ? matched : ''].filter(Boolean).join(' ');
}

export type SkillIdeaSampleCopy = Omit<Partial<SkillIdeaSample>, 'state'> & {
  state?: string;
  sample_id?: string;
  sampleMarkdown?: string;
  sample_markdown?: string;
  output?: string;
  ai_run?: { provider?: string; model?: string };
  aiRun?: { provider?: string; model?: string };
  matter?: {
    matterName?: string;
    matter_name?: string;
    folderName?: string;
    folder_name?: string;
  };
  feedback?: string;
};

export function findSkillIdeaSampleByVersion(
  samples: SkillIdeaSample[] = [],
  version: number,
): SkillIdeaSample | null {
  const requested = Number(version || 0);
  if (!requested) return null;
  return samples.find((sample, index) => sampleVersion(sample, index + 1) === requested) || null;
}

export function formatSkillIdeaSampleCopy(
  sample: SkillIdeaSampleCopy,
  { version, approved }: { version?: number; approved?: boolean } = {},
): string {
  const state = normalizeSkillSampleState(sample);
  const warnings = Array.isArray(sample.warnings) ? sample.warnings.filter(Boolean) : [];
  const matter = sampleMatterLabel(sample);
  const provider = sampleProviderLabel(sample);
  const statusText = sampleStatusText(state, Boolean(approved || sample.approved));
  return [
    '# Skill Sample Output',
    '',
    `- Sample: v${Number(version || sampleVersion(sample, 1))}`,
    `- Status: ${statusText}`,
    `- Ledger state: ${sampleStateLabel(state)}`,
    `- Matter: ${redactSensitiveText(matter || 'Selected matter')}`,
    `- Provider/model: ${redactSensitiveText(provider)}`,
    `- Feedback: ${redactSensitiveText(String(sample.feedback || 'None'))}`,
    `- Warnings: ${redactSensitiveText(warnings.length ? warnings.join('; ') : 'None')}`,
    '',
    state === SKILL_SAMPLE_STATE.APPROVED_CURRENT || approved
      ? 'This sample is approved, but it cannot be used as a skill until creation and validation succeed.'
      : 'This is not yet a usable skill. It has not been created, checked, or activated.',
    '',
    '## Sample',
    '',
    redactSensitiveText(sampleMarkdown(sample)),
  ].join('\n');
}

export function formatSkillIdeaReviewPacket(idea: SkillIdea, registry?: SkillRegistry | null): string {
  const status = idea.status || SKILL_IDEA_STATUS.INCOMPLETE;
  const brief = normalizeDesignBriefForPacket(idea.designBrief);
  const readiness = normalizeReadinessForPacket(idea.readiness, brief);
  const matter = idea.matter || {};
  const classification = classifySkillIdeaForPacket(idea, registry);
  const openQuestions = buildSkillIdeaOpenQuestions({ brief, readiness });
  const statusText = reviewPacketStatusText(status, readiness.ready);
  const checklistText = readiness.ready
    ? 'Complete'
    : `Incomplete ${readiness.passedCount}/${readiness.totalCount}`;
  return [
    '# Skill Idea Review Packet',
    '',
    `- Idea id: ${packetValue(idea.id)}`,
    `- Status: ${statusText}`,
    `- Checklist: ${checklistText}`,
    `- Suggested classification: ${classification}`,
    `- Matter: ${packetValue(matter.matterName || matter.folderName)}`,
    `- Matter folder: ${packetValue(matter.folderName)}`,
    '',
    '## Original User Text',
    '',
    packetBlock(idea.text),
    '',
    '## Design Brief',
    '',
    `- Intended user: ${packetValue(brief.intendedUser)}`,
    `- Problem / job to be done: ${packetValue(brief.problem)}`,
    `- Expected inputs: ${packetValue(brief.expectedInputs)}`,
    `- Expected output document: ${packetValue(brief.expectedOutputArtifact)}`,
    `- Target matter area: ${packetValue(brief.targetLane)}`,
    `- Paid/free posture: ${packetValue(brief.paidPosture)}`,
    `- Risk level: ${packetValue(brief.riskLevel)}`,
    '',
    '## Interview Answers / Notes',
    '',
    packetBlock(brief.notes),
    '',
    '## Readiness Checklist',
    '',
    ...readiness.items.map((item) => `- ${item.passed ? '[x]' : '[ ]'} ${item.label}`),
    '',
    '## Open Questions',
    '',
    ...openQuestions.map((question) => `- ${question}`),
    '',
    '## Boundary',
    '',
    'This is not yet a usable skill. It has not been created, checked, or activated.',
    '',
  ].join('\n');
}

function reviewPacketStatusText(status: string, readinessReady: boolean): string {
  if (status === SKILL_IDEA_STATUS.READY_FOR_REVIEW) return 'Ready for review';
  if (status === SKILL_IDEA_STATUS.PARKED) return 'Parked';
  if (status === SKILL_IDEA_STATUS.DISMISSED) return 'Dismissed';
  if (status === SKILL_IDEA_STATUS.INCOMPLETE && readinessReady) return 'Draft complete - ready to mark for review';
  return 'Incomplete';
}

function normalizeDesignBriefForPacket(brief: SkillIdeaDesignBrief | undefined): PacketDesignBrief {
  return normalizeSkillIdeaDesignBriefForView(brief);
}

function normalizeReadinessForPacket(
  readiness: SkillIdea['readiness'] | undefined,
  brief: PacketDesignBrief,
): { ready: boolean; passedCount: number; totalCount: number; items: Array<{ label: string; passed: boolean }> } {
  if (readiness && Array.isArray(readiness.items)) {
    return {
      ready: Boolean(readiness.ready),
      passedCount: Number(readiness.passedCount || 0),
      totalCount: Number(readiness.totalCount || readiness.items.length),
      items: readiness.items.map((item) => ({
        label: item.label || item.key || 'Readiness item',
        passed: Boolean(item.passed),
      })),
    };
  }
  const fallback = calculateSkillIdeaReadinessForView(brief);
  return {
    ready: fallback.ready,
    passedCount: fallback.passedCount,
    totalCount: fallback.totalCount,
    items: SKILL_IDEA_READINESS_CHECKS.map(([key, label]) => ({
      label,
      passed: Boolean(brief[key]),
    })),
  };
}

function classifySkillIdeaForPacket(idea: SkillIdea, registry?: SkillRegistry | null): string {
  const primaryText = `${idea.text || ''}\n${idea.designBrief?.problem || ''}\n${idea.designBrief?.expectedOutputArtifact || ''}`;
  const notes = String(idea.designBrief?.notes || '');
  const targetSkill = extractTargetSkill(notes) || extractTargetSkill(primaryText);
  const knownSlashes = new Set((Array.isArray(registry?.skills) ? registry.skills : [])
    .map((skill) => skill.slash)
    .filter(Boolean));
  if (targetSkill && knownSlashes.has(targetSkill)) return `modification candidate (${targetSkill})`;
  if (targetSkill) return `adjacent skill improvement (${targetSkill})`;
  if (/\b(list\s+of\s+dates|chronolog|timeline|describe\s+sources|source\s+labels?|context\s+search|find|search)\b/i.test(primaryText)) {
    return 'adjacent skill improvement';
  }
  return 'new skill idea';
}

function extractTargetSkill(text: string): string {
  const match = String(text || '').match(/\bTarget skill:\s*(\/[a-z0-9_-]+)/i);
  return match?.[1] || '';
}

function buildSkillIdeaOpenQuestions({
  brief,
  readiness,
}: {
  brief: PacketDesignBrief;
  readiness: { items: Array<{ label: string; passed: boolean }> };
}): string[] {
  const questions = readiness.items
    .filter((item) => !item.passed)
    .map((item) => `Complete readiness item: ${item.label}.`);
  if (!brief.paidPosture || brief.paidPosture === 'unknown') questions.push('Confirm whether this should be free/local or paid/provider-backed.');
  if (!brief.expectedOutputArtifact) questions.push('Confirm the durable output document, if any.');
  if (!brief.targetLane) questions.push('Confirm the target matter area.');
  return questions.length ? questions : ['None from the readiness checklist.'];
}

function sampleVersion(sample: SkillIdeaSampleCopy, fallback: number): number {
  const version = Number(sample.version || 0);
  return Number.isFinite(version) && version > 0 ? version : fallback;
}

function sampleMarkdown(sample: SkillIdeaSampleCopy): string {
  return String(sample.sample_markdown || sample.sampleMarkdown || sample.output || '').trim();
}

function sampleMatterLabel(sample: SkillIdeaSampleCopy): string {
  const matter = sample.matter || {};
  return String(matter.matter_name || matter.matterName || matter.folder_name || matter.folderName || '').trim();
}

function sampleProviderLabel(sample: SkillIdeaSampleCopy): string {
  const aiRun = sample.ai_run || sample.aiRun || {};
  return [aiRun.provider, aiRun.model].filter(Boolean).join(' / ') || 'configured provider';
}

function sampleStatusText(state: SkillSampleState, approved: boolean): string {
  if (state === SKILL_SAMPLE_STATE.APPROVED_STALE) return 'Approved earlier, now stale. Regenerate before creating a skill.';
  if (approved) return 'Sample approved. Creation and validation required before the skill is runnable.';
  if (state === SKILL_SAMPLE_STATE.STALE) return 'Stale after design brief changes. Regenerate before approval.';
  return 'Awaiting review';
}

function sampleStateLabel(state: SkillSampleState): string {
  if (state === SKILL_SAMPLE_STATE.APPROVED_CURRENT) return 'Approved current';
  if (state === SKILL_SAMPLE_STATE.APPROVED_STALE) return 'Approved stale';
  if (state === SKILL_SAMPLE_STATE.STALE) return 'Stale';
  return 'Current';
}

function packetValue(value: unknown): string {
  const text = redactSensitiveText(String(value || '').trim());
  return text || 'Not specified';
}

function packetBlock(value: unknown): string {
  const text = redactSensitiveText(String(value || '').trim());
  return text || '_Not specified_';
}
