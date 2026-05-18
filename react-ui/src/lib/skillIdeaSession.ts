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
  return {
    intendedUser: plannedBrief?.intendedUser || 'Lawyer',
    problem: plannedBrief?.problem || ideaText,
    expectedInputs: answers.input || plannedBrief?.expectedInputs || 'Selected matter documents and source labels',
    expectedOutputArtifact: answers.output || plannedBrief?.expectedOutputArtifact || 'Internal matter review note',
    targetLane: plannedBrief?.targetLane || '20_Workshop',
    paidPosture: plannedBrief?.paidPosture || 'paid',
    riskLevel: plannedBrief?.riskLevel || 'medium',
    notes: notes || 'No extra format rules supplied.',
  };
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
  const questions = Array.isArray(plan.questions)
    ? plan.questions
      .filter((question) => question?.id && question?.label)
      .map((question) => ({
        id: question.id,
        label: question.label,
        help: question.help,
        examples: Array.isArray(question.examples) ? question.examples : [],
      }))
    : [];
  return {
    understoodText: plan.understood_summary || fallbackIdeaText,
    questions,
    designBrief: plan.inferred_design_brief || null,
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
      ? 'This sample is approved, but it is not a runnable skill until creation and validation succeed.'
      : 'This is not a runnable skill. No prompt, code, slash command, provider runtime, or activation has been generated.',
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
    `- Target workspace area: ${packetValue(brief.targetLane)}`,
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
    'This is not a runnable skill. No prompt, code, or provider call has been generated.',
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
  return {
    intendedUser: brief?.intendedUser || '',
    problem: brief?.problem || '',
    expectedInputs: brief?.expectedInputs || '',
    expectedOutputArtifact: brief?.expectedOutputArtifact || '',
    targetLane: brief?.targetLane || '',
    paidPosture: brief?.paidPosture || '',
    riskLevel: brief?.riskLevel || '',
    notes: brief?.notes || '',
  };
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
  const items = [
    ['intendedUser', 'Intended user present'],
    ['problem', 'Problem/job present'],
    ['expectedInputs', 'Expected inputs present'],
    ['expectedOutputArtifact', 'Expected output document present'],
    ['targetLane', 'Workspace area selected'],
    ['paidPosture', 'Paid/free posture selected'],
    ['riskLevel', 'Risk level selected'],
    ['notes', 'Notes or acceptance criteria present'],
  ].map(([key, label]) => ({
    label,
    passed: Boolean(brief[key as keyof PacketDesignBrief]),
  }));
  const passedCount = items.filter((item) => item.passed).length;
  return {
    ready: passedCount === items.length,
    passedCount,
    totalCount: items.length,
    items,
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
  if (!brief.targetLane) questions.push('Confirm the target workspace area.');
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
