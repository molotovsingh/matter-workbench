import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { SKILL_IDEA_STATUS, normalizeSkillIdeaStatus } from '../lib/skillIdeaStatuses';
import type { ConfigurableSkill, Skill, SkillFactoryHealth, SkillIdea } from '../types';

export default function SkillsPage() {
  const { state, appendTerminal } = useApp();
  const [registrySkills, setRegistrySkills] = useState<Skill[]>([]);
  const [customSkills, setCustomSkills] = useState<ConfigurableSkill[]>([]);
  const [ideas, setIdeas] = useState<SkillIdea[]>([]);
  const [health, setHealth] = useState<SkillFactoryHealth | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
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
    setLoadingRun(skill.id);
    appendTerminal([`[skill] running ${skill.slash} on ${state.activeMatter.name}…`]);
    try {
      const result = await api.runConfigurableSkill({ slash: skill.slash, overwrite: false });
      if (result.state === 'requires_overwrite') {
        appendTerminal([`[skill] ${skill.slash} artifact exists at ${result.artifactPath ?? '?'} — overwrite not confirmed`]);
      } else {
        appendTerminal([`[skill] ${skill.title} completed`]);
      }
    } catch (e) {
      appendTerminal([`[skill] error: ${getErrorMessage(e)}`]);
    } finally {
      setLoadingRun(null);
    }
  }

  const activeIdeas = ideas.filter((i) => normalizeSkillIdeaStatus(i.status) !== SKILL_IDEA_STATUS.DISMISSED);
  const dismissedIdeas = ideas.filter((i) => normalizeSkillIdeaStatus(i.status) === SKILL_IDEA_STATUS.DISMISSED);

  return (
    <div className="skills-page">
      <div className="skills-hero">
        <div>
          <h1>Skills</h1>
          <p>Built-in workflows and custom AI skills available in this workbench.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {health && (
            <span className={`pipeline-state ${health.state === 'ok' ? 'present' : 'warning'}`}>
              Factory: {health.state}
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
        {registrySkills.length > 0 && (
          <span className="pipeline-state present">
            {registrySkills.length} built-in
          </span>
        )}
        {customSkills.length > 0 && (
          <span className="pipeline-state present">
            {customSkills.length} custom
          </span>
        )}
        {activeIdeas.length > 0 && (
          <span className="pipeline-state pending">
            {activeIdeas.length} idea{activeIdeas.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Custom skills */}
      {customSkills.length > 0 && (
        <div className="skills-section">
          <h2>Your custom skills</h2>
          <div className="active-custom-skills-list">
            {customSkills.map((skill) => (
              <div key={skill.id} className="active-custom-skill-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{skill.title}</strong>
                  </div>
                  <button
                    className="run-skill-button secondary"
                    type="button"
                    onClick={() => handleRunCustomSkill(skill)}
                    disabled={loadingRun === skill.id}
                    style={{ flexShrink: 0 }}
                  >
                    {loadingRun === skill.id ? 'Running…' : 'Run'}
                  </button>
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
              </div>
            ))}
          </div>
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
                      <span>{idea.status}</span>
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
      {Object.entries(groupByCategory(registrySkills)).map(([category, skills]) => (
        <div key={category} className="skills-section">
          <h2>{category}</h2>
          <div className="builtin-skills-list">
            {skills.map((skill) => (
              <div key={skill.slash} className="builtin-skill-row">
                <div>
                  <h3>{skill.display?.action || skill.title}</h3>
                </div>
                <div className="builtin-skill-command">
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
