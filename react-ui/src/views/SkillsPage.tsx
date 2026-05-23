import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { SKILL_IDEA_STATUS, normalizeSkillIdeaStatus, skillIdeaStatusLabel } from '../lib/skillIdeaStatuses';
import { humanizeArtifactPath } from '../lib/presentationLabels';
import { useLatestValue } from '../hooks/useLatestValue';
import type { ConfigurableSkill, Skill, SkillFactoryHealth, SkillIdea } from '../types';

export default function SkillsPage() {
  const { state, appendTerminal } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [registrySkills, setRegistrySkills] = useState<Skill[]>([]);
  const [customSkills, setCustomSkills] = useState<ConfigurableSkill[]>([]);
  const [ideas, setIdeas] = useState<SkillIdea[]>([]);
  const [health, setHealth] = useState<SkillFactoryHealth | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const [loadingLifecycle, setLoadingLifecycle] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const recordLoadError = useCallback((label: string, error: unknown) => {
    const message = `${label}: ${getErrorMessage(error)}`;
    setLoadError((current) => current ? `${current}\n${message}` : message);
    appendTerminal([`[skills] load failed — ${message}`]);
  }, [appendTerminal]);

  useEffect(() => {
    let cancelled = false;
    api.getSkills().then((r) => {
      if (cancelled) return;
      setRegistrySkills(r.skills ?? []);
    }).catch((e) => { if (!cancelled) recordLoadError('built-in skills', e); });
    api.getConfigurableSkills().then((r) => {
      if (cancelled) return;
      setCustomSkills(r.skills || []);
    }).catch((e) => { if (!cancelled) recordLoadError('custom skills', e); });
    api.getSkillIdeas().then((r) => {
      if (cancelled) return;
      setIdeas(r.ideas || []);
    }).catch((e) => { if (!cancelled) recordLoadError('skill ideas', e); });
    api.getSkillFactoryHealth().then((payload) => {
      if (cancelled) return;
      setHealth(payload);
    }).catch((e) => { if (!cancelled) recordLoadError('skill factory health', e); });
    return () => {
      cancelled = true;
    };
  }, [recordLoadError]);

  async function handleRunCustomSkill(skill: ConfigurableSkill) {
    if (!state.activeMatter) {
      appendTerminal(['[skill] select a matter first']);
      return;
    }
    const matterName = state.activeMatter.name;
    setLoadingRun(skill.id);
    appendTerminal([`[skill] running ${skill.title || 'custom skill'} on ${matterName}…`]);
    try {
      const result = await api.runConfigurableSkill({ slash: skill.slash, overwrite: false, matterName });
      if (activeMatterNameRef.current !== matterName) return;
      if (result.state === 'requires_overwrite') {
        appendTerminal([`[skill] ${skill.title || 'Custom skill'} output exists at ${humanizeArtifactPath(result.artifactPath)} — overwrite not confirmed`]);
      } else {
        appendTerminal([`[skill] ${skill.title} completed`]);
      }
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      appendTerminal([`[skill] error: ${getErrorMessage(e)}`]);
    } finally {
      if (activeMatterNameRef.current === matterName) setLoadingRun(null);
    }
  }

  async function refreshCustomSkills() {
    const result = await api.getConfigurableSkills();
    setCustomSkills(result.skills || []);
  }

  async function handleLifecycleAction(
    skill: ConfigurableSkill,
    action: 'suspend' | 'resume' | 'archive' | 'restore' | 'delete',
  ) {
    if (action === 'delete') {
      const ok = window.confirm('Delete this custom skill? Past run records and matter files stay.');
      if (!ok) return;
    }
    setLoadingLifecycle(`${skill.id}:${action}`);
    try {
      await api.updateConfigurableSkillLifecycle(skill.id, {
        action,
        reason: lifecycleReason(action),
      });
      await refreshCustomSkills();
      appendTerminal([`[skills] ${lifecyclePastLabel(action)} ${skill.title || skill.slash}`]);
    } catch (e) {
      appendTerminal([`[skills] lifecycle error: ${getErrorMessage(e)}`]);
    } finally {
      setLoadingLifecycle(null);
    }
  }

  const activeIdeas = ideas.filter((i) => normalizeSkillIdeaStatus(i.status) !== SKILL_IDEA_STATUS.DISMISSED);
  const dismissedIdeas = ideas.filter((i) => normalizeSkillIdeaStatus(i.status) === SKILL_IDEA_STATUS.DISMISSED);
  const builtinRegistrySkills = registrySkills.filter((skill) => !skill.configurable);
  const visibleCustomSkills = customSkills.filter((skill) => skill.status === 'active' || skill.status === 'suspended');
  const draftCustomSkills = customSkills.filter((skill) => skill.status === 'draft');
  const archivedCustomSkills = customSkills.filter((skill) => skill.status === 'archived');
  const previousVersionCustomSkills = customSkills.filter((skill) => skill.status === 'disabled');

  return (
    <div className="skills-page">
      <div className="skills-hero">
        <div>
          <h1>Skills</h1>
          <p>Built-in legal workflows and reviewed custom skills available in this workbench.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {health && (
            <span className={`pipeline-state ${health.state === 'ok' ? 'present' : 'warning'}`}>
              {health.state === 'ok' ? 'Skill setup ready' : 'Skill setup needs attention'}
            </span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="run-failure-card" style={{ marginBottom: 18 }}>
          <strong>Some skill data could not be loaded</strong>
          <p style={{ whiteSpace: 'pre-line' }}>{loadError}</p>
        </div>
      )}

      {/* Summary */}
      <div className="skills-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {builtinRegistrySkills.length > 0 && (
          <span className="pipeline-state present">
            {builtinRegistrySkills.length} built-in workflow{builtinRegistrySkills.length !== 1 ? 's' : ''}
          </span>
        )}
        {visibleCustomSkills.length > 0 && (
          <span className="pipeline-state present">
            {visibleCustomSkills.length} custom skill{visibleCustomSkills.length !== 1 ? 's' : ''}
          </span>
        )}
        {activeIdeas.length > 0 && (
          <span className="pipeline-state pending">
            {activeIdeas.length} idea{activeIdeas.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Custom skills */}
      {visibleCustomSkills.length > 0 && (
        <div className="skills-section">
          <h2>Your custom skills</h2>
          <div className="active-custom-skills-list">
            {visibleCustomSkills.map((skill) => (
              <div key={skill.id} className="active-custom-skill-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{skill.title}</strong>
                    <div style={{ marginTop: 6 }}>
                      <span className={`pipeline-state ${customSkillStateClass(skill.status)}`}>
                        {customSkillStateLabel(skill.status)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                    {skill.status === 'active' && (
                      <button
                        className="run-skill-button secondary"
                        type="button"
                        onClick={() => handleRunCustomSkill(skill)}
                        disabled={loadingRun === skill.id}
                        style={{ flexShrink: 0 }}
                      >
                        {loadingRun === skill.id ? 'Running…' : 'Run'}
                      </button>
                    )}
                    {lifecycleActionsFor(skill.status).map((action) => (
                      <button
                        key={action}
                        className="run-skill-button secondary"
                        type="button"
                        onClick={() => { void handleLifecycleAction(skill, action); }}
                        disabled={Boolean(loadingLifecycle)}
                        style={{ flexShrink: 0 }}
                      >
                        {loadingLifecycle === `${skill.id}:${action}` ? 'Working…' : lifecycleActionLabel(action)}
                      </button>
                    ))}
                  </div>
                </div>
                {skill.description && (
                  <p style={{ margin: 0, color: 'var(--muted-strong)', fontSize: 13 }}>{skill.description}</p>
                )}
                {(skill.lastRunAt || skill.runCount !== undefined) && (
                  <div className="active-custom-skill-run">
                    {skill.runCount !== undefined && (
                      <strong>{skill.runCount} run{skill.runCount !== 1 ? 's' : ''}</strong>
                    )}{' '}
                    {skill.lastRunAt && <span>last {new Date(skill.lastRunAt).toLocaleDateString()}</span>}
                  </div>
                )}
                {skill.lifecycle?.statusChangedAt && (
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Last changed {new Date(skill.lifecycle.statusChangedAt).toLocaleDateString()}
                    {skill.lifecycle.reason ? ` — ${skill.lifecycle.reason}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {draftCustomSkills.length > 0 && (
        <div className="skills-section">
          <details>
            <summary>Draft custom skills ({draftCustomSkills.length})</summary>
            <div className="active-custom-skills-list" style={{ marginTop: 12 }}>
              {draftCustomSkills.map((skill) => (
                <div key={skill.id} className="active-custom-skill-card">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{skill.title}</strong>
                      <div style={{ marginTop: 6 }}>
                        <span className="pipeline-state pending">Draft</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                      {lifecycleActionsFor(skill.status).map((action) => (
                        <button
                          key={action}
                          className="run-skill-button secondary"
                          type="button"
                          onClick={() => { void handleLifecycleAction(skill, action); }}
                          disabled={Boolean(loadingLifecycle)}
                        >
                          {loadingLifecycle === `${skill.id}:${action}` ? 'Working…' : lifecycleActionLabel(action)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {skill.description && (
                    <p style={{ margin: 0, color: 'var(--muted-strong)', fontSize: 13 }}>{skill.description}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {archivedCustomSkills.length > 0 && (
        <div className="skills-section">
          <details>
            <summary>Archived custom skills ({archivedCustomSkills.length})</summary>
            <div className="active-custom-skills-list" style={{ marginTop: 12 }}>
              {archivedCustomSkills.map((skill) => (
                <div key={skill.id} className="active-custom-skill-card">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{skill.title}</strong>
                      <div style={{ marginTop: 6 }}>
                        <span className="pipeline-state not-run">Archived</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                      {lifecycleActionsFor(skill.status).map((action) => (
                        <button
                          key={action}
                          className="run-skill-button secondary"
                          type="button"
                          onClick={() => { void handleLifecycleAction(skill, action); }}
                          disabled={Boolean(loadingLifecycle)}
                        >
                          {loadingLifecycle === `${skill.id}:${action}` ? 'Working…' : lifecycleActionLabel(action)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {skill.description && (
                    <p style={{ margin: 0, color: 'var(--muted-strong)', fontSize: 13 }}>{skill.description}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {previousVersionCustomSkills.length > 0 && (
        <div className="skills-section">
          <details>
            <summary>Previous versions ({previousVersionCustomSkills.length})</summary>
            <div className="active-custom-skills-list" style={{ marginTop: 12 }}>
              {previousVersionCustomSkills.map((skill) => (
                <div key={skill.id} className="active-custom-skill-card">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{skill.title}</strong>
                      <div style={{ marginTop: 6 }}>
                        <span className="pipeline-state not-run">Previous version</span>
                      </div>
                    </div>
                  </div>
                  {skill.description && (
                    <p style={{ margin: 0, color: 'var(--muted-strong)', fontSize: 13 }}>{skill.description}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Skill ideas */}
      {activeIdeas.length > 0 && (
        <div className="skills-section">
          <h2>Skill ideas</h2>
          <p className="muted" style={{ margin: '-6px 0 16px', fontSize: 13, maxWidth: 640 }}>
            Ideas for new skills you've described. Use the command box to continue developing them.
          </p>
          <div className="skill-ideas-list">
            {activeIdeas.map((idea) => (
              <div key={idea.id} className="skill-idea-row">
                <div className="skill-idea-row-main">
                  <div>
                    <p>{idea.text}</p>
                    <div className="skill-idea-row-meta">
                      <span>{skillIdeaStatusLabel(idea.status)}</span>
                      <span>{new Date(idea.createdAt).toLocaleDateString()}</span>
                      {idea.sampleCount !== undefined && <span>{idea.sampleCount} sample{idea.sampleCount !== 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {dismissedIdeas.length > 0 && (
              <details className="skill-ideas-dismissed">
                <summary>{dismissedIdeas.length} dismissed</summary>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Built-in skills by category */}
      {Object.entries(groupByCategory(builtinRegistrySkills)).map(([category, skills]) => (
        <div key={category} className="skills-section">
          <h2>{category}</h2>
          <div className="builtin-skills-list">
            {skills.map((skill) => (
              <div key={skill.slash} className="builtin-skill-row">
                <div>
                  <h3>{skill.display?.action || skill.title}</h3>
                </div>
                <div className="builtin-skill-command">
                  <span>Built-in · Managed by Matter Workbench</span>
                  {skill.paid_provider_call && <span className="pipeline-state pending">Uses AI</span>}
                  {!skill.paid_provider_call && <span className="pipeline-state present">Local</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {registrySkills.length === 0 && customSkills.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 24 }}>
          Loading skills… Make sure the Matter Workbench server is running.
        </div>
      )}
    </div>
  );
}

function groupByCategory(skills: Skill[]): Record<string, Skill[]> {
  const map: Record<string, Skill[]> = {};
  for (const s of skills) {
    const cat = s.category || 'Other';
    (map[cat] ??= []).push(s);
  }
  return map;
}

type LifecycleAction = 'suspend' | 'resume' | 'archive' | 'restore' | 'delete';

function lifecycleActionsFor(status?: string): LifecycleAction[] {
  if (status === 'active') return ['suspend', 'archive', 'delete'];
  if (status === 'suspended') return ['resume', 'archive', 'delete'];
  if (status === 'archived') return ['restore', 'delete'];
  if (status === 'draft') return ['delete'];
  return [];
}

function lifecycleActionLabel(action: LifecycleAction): string {
  if (action === 'suspend') return 'Pause';
  if (action === 'resume') return 'Resume';
  if (action === 'archive') return 'Archive';
  if (action === 'restore') return 'Restore to paused';
  return 'Delete';
}

function lifecyclePastLabel(action: LifecycleAction): string {
  if (action === 'suspend') return 'paused';
  if (action === 'resume') return 'resumed';
  if (action === 'archive') return 'archived';
  if (action === 'restore') return 'restored to paused';
  return 'deleted';
}

function lifecycleReason(action: LifecycleAction): string {
  if (action === 'suspend') return 'Paused from Skills page.';
  if (action === 'resume') return 'Resumed from Skills page.';
  if (action === 'archive') return 'Archived from Skills page.';
  if (action === 'restore') return 'Restored to paused from Skills page.';
  return 'Deleted from Skills page.';
}

function customSkillStateLabel(status?: string): string {
  if (status === 'active') return 'Active';
  if (status === 'suspended') return 'Paused';
  if (status === 'archived') return 'Archived';
  if (status === 'disabled') return 'Previous version';
  if (status === 'draft') return 'Draft';
  return 'Custom skill';
}

function customSkillStateClass(status?: string): string {
  if (status === 'active') return 'present';
  if (status === 'suspended' || status === 'draft') return 'pending';
  if (status === 'archived' || status === 'disabled') return 'not-run';
  return 'pending';
}
