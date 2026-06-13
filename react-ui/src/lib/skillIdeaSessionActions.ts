import { api } from '../api/client';
import {
  buildSkillCreationOverlapRequest,
  isBlockingSkillOverlapDecision,
} from './skillCreationOverlap';
import {
  buildSkillIdeaDesignBrief,
  findSkillIdeaSampleByVersion,
  formatSkillIdeaReviewPacket,
  formatSkillIdeaSampleCopy,
  skillIdeaTextForSaveWithName,
  type InterviewQuestion,
  type SkillIdeaSampleCopy,
} from './skillIdeaSession';
import { writeClipboardText } from './clipboard';
import { SKILL_SAMPLE_STATE } from './skillSampleStates';
import type { ConfigurableSkill, SkillIdea, SkillIdeaDesignBrief, SkillRouterDecision, SkillSampleOutputResponse } from '../types';

interface PersistableSkillIdeaSession {
  savedIdeaId: string | null;
  ideaText: string;
  answers: Record<string, string>;
  plannedBrief: SkillIdeaDesignBrief | null;
  questions: InterviewQuestion[];
}

interface PersistSkillIdeaSessionArgs {
  session: PersistableSkillIdeaSession;
  matterName?: string;
}

export interface PersistSkillIdeaSessionResult {
  brief: SkillIdeaDesignBrief;
  ideaTextForSave: string;
  savedIdea: SkillIdea;
  updatingExistingIdea: boolean;
}

interface GenerateSkillIdeaSessionSampleArgs {
  idea: SkillIdea;
  feedback?: string;
  previousSample?: string;
}

export interface GeneratedSkillIdeaSessionSample {
  result: SkillSampleOutputResponse;
  sampleId: string;
  output: string;
  matterFolder: string;
  warnings?: string[];
  version?: number;
  approved?: boolean;
  state?: string;
}

interface ApproveAndCreateSkillFromIdeaSessionArgs {
  ideaId: string;
  idea: SkillIdea;
  designBrief?: SkillIdeaDesignBrief | null;
  sample: { id: string; approved?: boolean };
  overlapOverrideJustification?: string;
  matterName?: string;
  isCurrentMatterName?: (matterName: string) => boolean;
  onCreating?: () => void;
}

export type ApproveAndCreateSkillFromIdeaSessionResult =
  | { status: 'created'; skill?: ConfigurableSkill }
  | { status: 'blocked'; decision: SkillRouterDecision; userRequest: string }
  | { status: 'matter_changed' };

export async function persistSkillIdeaSession({
  session,
  matterName = '',
}: PersistSkillIdeaSessionArgs): Promise<PersistSkillIdeaSessionResult> {
  const updatingExistingIdea = Boolean(session.savedIdeaId);
  const brief = buildSkillIdeaDesignBrief(
    session.ideaText,
    session.answers,
    session.plannedBrief,
    session.questions,
  );
  const ideaTextForSave = skillIdeaTextForSaveWithName(session.ideaText, brief, session.answers.skillName || '');
  const result = updatingExistingIdea && session.savedIdeaId
    ? await api.updateSkillIdeaBrief(session.savedIdeaId, { designBrief: brief })
    : await api.createSkillIdea({
      text: ideaTextForSave,
      designBrief: brief,
      matterName: matterName || undefined,
    });

  return {
    brief,
    ideaTextForSave,
    savedIdea: result.idea,
    updatingExistingIdea,
  };
}

export async function generateSkillIdeaSessionSample({
  idea,
  feedback = '',
  previousSample = '',
}: GenerateSkillIdeaSessionSampleArgs): Promise<GeneratedSkillIdeaSessionSample> {
  const result = await api.generateSampleOutput({
    idea,
    feedback,
    previousSample,
  });
  return normalizeGeneratedSkillIdeaSample(result);
}

function normalizeGeneratedSkillIdeaSample(result: SkillSampleOutputResponse): GeneratedSkillIdeaSessionSample {
  return {
    result,
    sampleId: result.sample_id || result.storedSample?.id || '',
    output: result.sample_markdown || result.storedSample?.sampleMarkdown || '',
    matterFolder: generatedSkillIdeaSampleMatterFolder(result),
    warnings: result.warnings || result.storedSample?.warnings,
    version: result.storedSample?.version,
    approved: result.storedSample?.approved,
    state: result.storedSample?.state || SKILL_SAMPLE_STATE.CURRENT,
  };
}

export function generatedSkillIdeaSampleMatterFolder(result: SkillSampleOutputResponse): string {
  const storedSample = result.storedSample as { matter?: Record<string, unknown> } | undefined;
  const matter = result.matter || storedSample?.matter || {};
  return String(matter.folder_name || matter.folderName || '').trim();
}

export async function copySkillIdeaSample(sample: SkillIdeaSampleCopy): Promise<void> {
  await writeClipboardText(formatSkillIdeaSampleCopy(sample, {
    version: sample.version || 1,
    approved: sample.approved,
  }));
}

export async function copySkillIdeaSampleVersion(ideaId: string, version: number): Promise<boolean> {
  const payload = await api.getSkillIdeaSamples(ideaId);
  const sample = findSkillIdeaSampleByVersion(payload.samples || [], version);
  if (!sample) return false;
  await writeClipboardText(formatSkillIdeaSampleCopy(sample, {
    version,
    approved: sample.approved,
  }));
  return true;
}

export async function copySkillIdeaReviewPacket(
  idea: SkillIdea,
  { onRegistryError }: { onRegistryError?: (error: unknown) => void } = {},
): Promise<void> {
  const registry = await api.getSkills().catch((error) => {
    onRegistryError?.(error);
    return null;
  });
  await writeClipboardText(formatSkillIdeaReviewPacket(idea, registry));
}

export async function approveAndCreateSkillFromIdeaSession({
  ideaId,
  idea,
  designBrief = null,
  sample,
  overlapOverrideJustification = '',
  matterName = '',
  isCurrentMatterName = () => true,
  onCreating = () => {},
}: ApproveAndCreateSkillFromIdeaSessionArgs): Promise<ApproveAndCreateSkillFromIdeaSessionResult> {
  if (!isCurrentMatterName(matterName)) return { status: 'matter_changed' };
  if (!sample.approved) {
    await api.approveSkillIdeaSample(ideaId, sample.id);
  }
  if (!isCurrentMatterName(matterName)) return { status: 'matter_changed' };

  const userRequest = buildSkillCreationOverlapRequest(idea, designBrief || idea.designBrief);
  if (userRequest.trim()) {
    const decision = await api.checkIntent({
      userRequest,
      matterName: matterName || undefined,
      overrideJustification: overlapOverrideJustification,
    });
    if (!isCurrentMatterName(matterName)) return { status: 'matter_changed' };
    if (isBlockingSkillOverlapDecision(decision, overlapOverrideJustification)) {
      return { status: 'blocked', decision, userRequest };
    }
  }

  if (!isCurrentMatterName(matterName)) return { status: 'matter_changed' };
  onCreating();
  const result = await api.createSkillFromIdea(ideaId, { overlapOverrideJustification });
  if (!isCurrentMatterName(matterName)) return { status: 'matter_changed' };
  return { status: 'created', skill: result.skill };
}
