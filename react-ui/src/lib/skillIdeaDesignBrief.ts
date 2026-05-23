import { SKILL_IDEA_STATUS } from './skillIdeaStatuses';
import type { SkillIdeaDesignBrief } from '../types';

export const SKILL_IDEA_DESIGN_BRIEF_FIELDS = [
  'intendedUser',
  'problem',
  'expectedInputs',
  'expectedOutputArtifact',
  'targetLane',
  'paidPosture',
  'riskLevel',
  'notes',
] as const;

export const SKILL_IDEA_TARGET_LANE_VALUES = [
  '10_Library',
  '20_Workshop',
  '30_Drafts',
  '40_Dispatch',
] as const;

export const SKILL_IDEA_PAID_POSTURE_VALUES = [
  'free',
  'paid',
  'unknown',
] as const;

export const SKILL_IDEA_RISK_LEVEL_VALUES = [
  'low',
  'medium',
  'high',
] as const;

export const DEFAULT_SKILL_IDEA_DESIGN_BRIEF = {
  intendedUser: 'Lawyer',
  expectedInputs: 'Selected matter documents and source labels',
  expectedOutputArtifact: 'Internal matter review note',
  targetLane: '20_Workshop',
  paidPosture: 'paid',
  riskLevel: 'medium',
  notes: 'No extra format rules supplied.',
} as const;

export const SKILL_IDEA_READINESS_CHECKS = [
  ['intendedUser', 'Intended user present'],
  ['problem', 'Problem/job present'],
  ['expectedInputs', 'Expected inputs present'],
  ['expectedOutputArtifact', 'Expected output artifact present'],
  ['targetLane', 'Target lane selected'],
  ['paidPosture', 'Paid/free posture selected'],
  ['riskLevel', 'Risk level selected'],
  ['notes', 'Notes or acceptance criteria present'],
] as const;

type SkillIdeaDesignBriefField = (typeof SKILL_IDEA_DESIGN_BRIEF_FIELDS)[number];

export function normalizeSkillIdeaDesignBriefForView(brief: SkillIdeaDesignBrief | undefined): Record<SkillIdeaDesignBriefField, string> {
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

export function calculateSkillIdeaReadinessForView(brief: Record<SkillIdeaDesignBriefField, string>) {
  const items = SKILL_IDEA_READINESS_CHECKS.map(([key, label]) => ({
    key,
    label,
    passed: Boolean(brief[key]),
  }));
  const passedCount = items.filter((item) => item.passed).length;
  const ready = passedCount === items.length;
  return {
    state: ready ? SKILL_IDEA_STATUS.READY_FOR_REVIEW : SKILL_IDEA_STATUS.INCOMPLETE,
    ready,
    passedCount,
    totalCount: items.length,
    items,
  };
}
