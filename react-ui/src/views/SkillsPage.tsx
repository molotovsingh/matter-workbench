import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { SKILL_IDEA_STATUS, normalizeSkillIdeaStatus, skillIdeaStatusLabel } from '../lib/skillIdeaStatuses';
import { skillIdeaDisplayTitle } from '../lib/skillIdeaLabels';
import { humanizeArtifactPath } from '../lib/presentationLabels';
import { useLatestValue } from '../hooks/useLatestValue';
import type { ConfigurableSkill, Skill, SkillFactoryHealth, SkillIdea } from '../types';

const SKILLS_INTRO_STORAGE_KEY = 'mwb.skillsIntro.hidden.v1';

type LifecycleAction = 'suspend' | 'resume' | 'archive' | 'restore' | 'delete';

interface LifecycleRenderContext {
  loadingLifecycle: string | null;
  loadingRun: string | null;
  onLifecycleAction: (skill: ConfigurableSkill, action: LifecycleAction) => void;
}

interface PendingOverwrite {
  skillId: string;
  matterName: string;
  artifactPath?: string | null;
}

export default function SkillsPage() {
  const { state, dispatch, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [registrySkills, setRegistrySkills] = useState<Skill[]>([]);
  const [customSkills, setCustomSkills] = useState<ConfigurableSkill[]>([]);
  const [ideas, setIdeas] = useState<SkillIdea[]>([]);
  const [health, setHealth] = useState<SkillFactoryHealth | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const [loadingLifecycle, setLoadingLifecycle] = useState<string | null>(null);
  const [loadingIdeaStatus, setLoadingIdeaStatus] = useState<string | null>(null);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [introHidden, setIntroHidden] = useState(readSkillsIntroHidden);
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null);

  const loadSkillData = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoadingSkills(true);
    setLoadError('');

    const [
      skillsResult,
      customSkillsResult,
      ideasResult,
      healthResult,
    ] = await Promise.allSettled([
      api.getSkills(),
      api.getConfigurableSkills(),
      api.getSkillIdeas(),
      api.getSkillFactoryHealth(),
    ]);

    if (isCancelled()) return;

    const errors: string[] = [];

    if (skillsResult.status === 'fulfilled') {
      setRegistrySkills(skillsResult.value.skills ?? []);
    } else {
      errors.push(`built-in skills: ${getErrorMessage(skillsResult.reason)}`);
    }

    if (customSkillsResult.status === 'fulfilled') {
      setCustomSkills(customSkillsResult.value.skills || []);
    } else {
      errors.push(`custom skills: ${getErrorMessage(customSkillsResult.reason)}`);
    }

    if (ideasResult.status === 'fulfilled') {
      setIdeas(ideasResult.value.ideas || []);
    } else {
      errors.push(`skill ideas: ${getErrorMessage(ideasResult.reason)}`);
    }

    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
    } else {
      errors.push(`skill factory health: ${getErrorMessage(healthResult.reason)}`);
    }

    setLoadError(errors.join('\n'));
    setLoadingSkills(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSkillData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadSkillData]);

  useEffect(() => {
    setPendingOverwrite(null);
  }, [state.activeMatter?.name]);

  async function handleRunCustomSkill(skill: ConfigurableSkill) {
    if (loadingRun || loadingLifecycle) return;
    if (!state.activeMatter) {
      appendTerminal(['[skill] select a matter first']);
      return;
    }
    const matterName = state.activeMatter.name;
    const isOverwritePending = pendingOverwrite?.skillId === skill.id && pendingOverwrite?.matterName === matterName;
    setLoadingRun(skill.id);
    appendTerminal([`[skill] ${isOverwritePending ? 'overwriting' : 'running'} ${skill.title || 'custom skill'} on ${matterName}…`]);
    try {
      const result = await api.runConfigurableSkill({ slash: skill.slash, overwrite: isOverwritePending, matterName });
      if (activeMatterNameRef.current !== matterName) return;
      if (result.state === 'requires_overwrite') {
        const artifactPath = result.artifactPath || result.outputPaths?.markdown || null;
        setPendingOverwrite({ skillId: skill.id, matterName, artifactPath: result.artifactPath || result.outputPaths?.markdown || null });
        appendTerminal([`[skill] ${skill.title || 'Custom skill'} output exists at ${humanizeArtifactPath(artifactPath ?? '')} — click Run anyway / overwrite to replace it`]);
      } else {
        if (isOverwritePending) setPendingOverwrite(null);
        try {
          await refreshCustomSkills();
        } catch (refreshError) {
          appendTerminal([`[skills] could not refresh skill metadata: ${getErrorMessage(refreshError)}`]);
        }
        await refreshActiveMatterWorkspace({
          expectedMatterName: matterName,
          failurePrefix: '[workspace] refresh failed after custom skill output',
        });
        if (activeMatterNameRef.current !== matterName) return;
        appendTerminal([`[skill] ${skill.title} completed`]);
      }
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      appendTerminal([`[skill] error: ${getErrorMessage(e)}`]);
    } finally {
      setLoadingRun(null);
    }
  }

  async function refreshCustomSkills() {
    const result = await api.getConfigurableSkills();
    setCustomSkills(result.skills || []);
  }

  async function handleLifecycleAction(
    skill: ConfigurableSkill,
    action: LifecycleAction,
  ) {
    if (loadingLifecycle || loadingRun) return;
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

  function hideIntro() {
    persistSkillsIntroHidden();
    setIntroHidden(true);
  }

  const activeIdeas = ideas.filter((i) => {
    const status = normalizeSkillIdeaStatus(i.status);
    return status !== SKILL_IDEA_STATUS.DISMISSED && status !== SKILL_IDEA_STATUS.CREATED && status !== SKILL_IDEA_STATUS.PARKED;
  });
  const dismissedIdeas = ideas.filter((i) => {
    const status = normalizeSkillIdeaStatus(i.status);
    return status === SKILL_IDEA_STATUS.DISMISSED || status === SKILL_IDEA_STATUS.CREATED || status === SKILL_IDEA_STATUS.PARKED;
  });
  const builtinRegistrySkills = registrySkills.filter((skill) => !skill.configurable);
  const visibleCustomSkills = customSkills.filter((skill) => skill.status === 'active' || skill.status === 'suspended');
  const draftCustomSkills = customSkills.filter((skill) => skill.status === 'draft');
  const archivedCustomSkills = customSkills.filter((skill) => skill.status === 'archived');
  const previousVersionCustomSkills = customSkills.filter((skill) => skill.status === 'disabled');
  const inProgressCount = activeIdeas.length + draftCustomSkills.length;
  const historyCount = archivedCustomSkills.length + previousVersionCustomSkills.length + dismissedIdeas.length;
  const lifecycleContext: LifecycleRenderContext = {
    loadingLifecycle,
    loadingRun,
    onLifecycleAction: (skill, action) => { void handleLifecycleAction(skill, action); },
  };

  function handleContinueIdea(idea: SkillIdea) {
    if (!state.activeMatter) {
      appendTerminal(['[skill-idea] pick a matter before continuing this saved idea']);
      dispatch({ type: 'SET_TAB', payload: 'home' });
      dispatch({ type: 'SET_VIEW', payload: 'find-matter' });
      dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter, then continue the saved skill idea from Skills.' });
      return;
    }
    dispatch({ type: 'SET_PENDING_SKILL_IDEA_RESUME', payload: idea });
    appendTerminal([`[skill-idea] continuing saved idea — id: ${idea.id}`]);
  }

  async function handleParkIdea(idea: SkillIdea) {
    if (loadingIdeaStatus) return;
    setLoadingIdeaStatus(idea.id);
    try {
      await api.updateSkillIdeaStatus(idea.id, { status: SKILL_IDEA_STATUS.PARKED });
      await loadSkillData();
      appendTerminal([`[skill-idea] parked saved idea — id: ${idea.id}`]);
    } catch (error) {
      appendTerminal([`[skill-idea] park failed: ${getErrorMessage(error)}`]);
    } finally {
      setLoadingIdeaStatus(null);
    }
  }

  return (
    <div className="skills-page">
      <div className="skills-hero">
        <div>
          <h1>Skills</h1>
          <p>Reusable matter work routines. Keep your own skills easy to run, and keep app-managed workflows out of the way until needed.</p>
        </div>
      </div>

      {!introHidden && <SkillsIntroCard onDismiss={hideIntro} />}

      {loadError && (
        <div className="run-failure-card" style={{ marginBottom: 18 }}>
          <strong>Some skill data could not be loaded</strong>
          <p style={{ whiteSpace: 'pre-line' }}>{loadError}</p>
          <button
            type="button"
            className="run-skill-button secondary"
            onClick={() => { void loadSkillData(); }}
            disabled={loadingSkills}
          >
            {loadingSkills ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}

      <SkillsStatusRow
        yourSkillsCount={visibleCustomSkills.length}
        inProgressCount={inProgressCount}
        builtinCount={builtinRegistrySkills.length}
        health={health}
      />

      <YourSkillsSection
        skills={visibleCustomSkills}
        hasActiveMatter={Boolean(state.activeMatter)}
        activeMatterName={state.activeMatter?.name ?? null}
        loadingRun={loadingRun}
        loadingLifecycle={loadingLifecycle}
        pendingOverwrite={pendingOverwrite}
        onRunSkill={(skill) => { void handleRunCustomSkill(skill); }}
        onLifecycleAction={(skill, action) => { void handleLifecycleAction(skill, action); }}
        renderManageActions={(skill, actions) => renderManageActions(skill, actions, lifecycleContext)}
      />

      {inProgressCount > 0 && (
        <SkillsInProgressSection
          ideas={activeIdeas}
          draftCustomSkills={draftCustomSkills}
          hasActiveMatter={Boolean(state.activeMatter)}
          onContinueIdea={handleContinueIdea}
          onParkIdea={(idea) => { void handleParkIdea(idea); }}
          loadingIdeaStatus={loadingIdeaStatus}
          renderManageActions={(skill, actions) => renderManageActions(skill, actions, lifecycleContext)}
        />
      )}

      {builtinRegistrySkills.length > 0 && (
        <BuiltInWorkflowsSection groupedSkills={groupByCategory(builtinRegistrySkills)} />
      )}

      {historyCount > 0 && (
        <SkillHistorySection
          archivedCustomSkills={archivedCustomSkills}
          previousVersionCustomSkills={previousVersionCustomSkills}
          dismissedIdeas={dismissedIdeas}
          renderManageActions={(skill, actions) => renderManageActions(skill, actions, lifecycleContext)}
        />
      )}

      {registrySkills.length === 0 && customSkills.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 24 }}>
          Loading skills… Make sure the Matter Workbench server is running.
        </div>
      )}
    </div>
  );
}

function SkillsIntroCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="skills-intro-card">
      <div>
        <h2>New to skills?</h2>
        <div className="skills-intro-grid">
          <div>
            <strong>A skill is a repeatable work routine.</strong>
            <p>Use it when you want the same kind of legal output across matters.</p>
          </div>
          <div>
            <strong>Built-in skills are app workflows.</strong>
            <p>They are maintained by Matter Workbench and cannot be edited here.</p>
          </div>
          <div>
            <strong>Your skills are under your control.</strong>
            <p>Run, pause, archive, or delete custom skills without touching past matter files.</p>
          </div>
          <div>
            <strong>Not a skill? Ask a one-off question.</strong>
            <p>Use the Matter Assistant for a temporary answer that should not become a reusable workflow.</p>
          </div>
        </div>
      </div>
      <button type="button" className="run-skill-button secondary" onClick={onDismiss}>
        Hide this note
      </button>
    </div>
  );
}

function SkillsStatusRow({
  yourSkillsCount,
  inProgressCount,
  builtinCount,
  health,
}: {
  yourSkillsCount: number;
  inProgressCount: number;
  builtinCount: number;
  health: SkillFactoryHealth | null;
}) {
  return (
    <div className="skills-status-row">
      <span>Your Skills: {yourSkillsCount}</span>
      <span>Skills in Progress: {inProgressCount}</span>
      <span>Built-in Workflows: {builtinCount}</span>
      {health && (
        <span className={`skills-health ${health.state === 'ok' ? 'is-ok' : 'needs-attention'}`}>
          {health.state === 'ok' ? 'Setup ready' : 'Setup needs attention'}
        </span>
      )}
    </div>
  );
}

function YourSkillsSection({
  skills,
  hasActiveMatter,
  activeMatterName,
  loadingRun,
  loadingLifecycle,
  pendingOverwrite,
  onRunSkill,
  onLifecycleAction,
  renderManageActions,
}: {
  skills: ConfigurableSkill[];
  hasActiveMatter: boolean;
  activeMatterName: string | null;
  loadingRun: string | null;
  loadingLifecycle: string | null;
  pendingOverwrite: PendingOverwrite | null;
  onRunSkill: (skill: ConfigurableSkill) => void;
  onLifecycleAction: (skill: ConfigurableSkill, action: LifecycleAction) => void;
  renderManageActions: (skill: ConfigurableSkill, actions: LifecycleAction[]) => JSX.Element | null;
}) {
  return (
    <section className="skills-section">
      <h2>Your Skills</h2>
      {skills.length === 0 ? (
        <div className="skills-empty-state">
          No custom skills yet. Use the Matter Assistant when a repeated legal workflow should become reusable.
        </div>
      ) : (
        <div className="skills-row-list">
          {skills.map((skill) => {
            const isOverwritePending = pendingOverwrite?.skillId === skill.id && pendingOverwrite?.matterName === activeMatterName;
            return (
              <CustomSkillRow
                key={skill.id}
                skill={skill}
                primaryAction={skill.status === 'active' ? (
                  <button
                    className="run-skill-button secondary"
                    type="button"
                    onClick={() => onRunSkill(skill)}
                    disabled={!hasActiveMatter || loadingRun === skill.id || Boolean(loadingLifecycle)}
                    title={isOverwritePending && pendingOverwrite?.artifactPath
                      ? `Replace ${humanizeArtifactPath(pendingOverwrite.artifactPath)}`
                      : undefined}
                  >
                    {!hasActiveMatter
                      ? 'Pick matter first'
                      : loadingRun === skill.id
                        ? 'Running…'
                        : isOverwritePending
                          ? 'Run anyway / overwrite'
                          : 'Run'}
                  </button>
                ) : (
                  <button
                    className="run-skill-button secondary"
                    type="button"
                    onClick={() => onLifecycleAction(skill, 'resume')}
                    disabled={Boolean(loadingLifecycle) || Boolean(loadingRun)}
                  >
                    {loadingLifecycle === `${skill.id}:resume` ? 'Working…' : 'Resume'}
                  </button>
                )}
                manageActions={skill.status === 'active'
                  ? renderManageActions(skill, ['suspend', 'archive', 'delete'])
                  : renderManageActions(skill, ['archive', 'delete'])}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function SkillsInProgressSection({
  ideas,
  draftCustomSkills,
  hasActiveMatter,
  onContinueIdea,
  onParkIdea,
  loadingIdeaStatus,
  renderManageActions,
}: {
  ideas: SkillIdea[];
  draftCustomSkills: ConfigurableSkill[];
  hasActiveMatter: boolean;
  onContinueIdea: (idea: SkillIdea) => void;
  onParkIdea: (idea: SkillIdea) => void;
  loadingIdeaStatus: string | null;
  renderManageActions: (skill: ConfigurableSkill, actions: LifecycleAction[]) => JSX.Element | null;
}) {
  return (
    <section className="skills-section">
      <h2>Skills in Progress</h2>
      <div className="skills-row-list">
        {draftCustomSkills.length > 0 && (
          <div className="skills-subsection-label">Draft custom skills</div>
        )}
        {draftCustomSkills.map((skill) => (
          <CustomSkillRow
            key={skill.id}
            skill={skill}
            statusOverride="Draft"
            showCommandInline={false}
            manageActions={renderManageActions(skill, ['delete'])}
          />
        ))}
        {ideas.length > 0 && (
          <div className="skills-subsection-label">Skill ideas</div>
        )}
        {ideas.map((idea) => (
          <SkillIdeaRow
            key={idea.id}
            idea={idea}
            primaryAction={(
              <>
                <button
                  type="button"
                  className="run-skill-button secondary"
                  onClick={() => onContinueIdea(idea)}
                  disabled={loadingIdeaStatus === idea.id}
                >
                  {hasActiveMatter ? 'Continue' : 'Pick matter first'}
                </button>
                <button
                  type="button"
                  className="run-skill-button secondary"
                  onClick={() => onParkIdea(idea)}
                  disabled={loadingIdeaStatus === idea.id}
                >
                  {loadingIdeaStatus === idea.id ? 'Parking…' : 'Park'}
                </button>
              </>
            )}
          />
        ))}
      </div>
    </section>
  );
}

function BuiltInWorkflowsSection({ groupedSkills }: { groupedSkills: Record<string, Skill[]> }) {
  return (
    <details className="skills-collapsible-section">
      <summary>Built-in Workflows</summary>
      <div className="builtin-skills-list">
        {Object.entries(groupedSkills).map(([category, skills]) => (
          <div key={category} className="builtin-skill-category">
            <h3>{category}</h3>
            {skills.map((skill) => (
              <div key={skill.slash} className="builtin-skill-row">
                <div>
                  <strong>{skill.display?.action || skill.title}</strong>
                  {skill.purpose && (
                    <details className="skill-row-details">
                      <summary>Details</summary>
                      <p>{skill.purpose}</p>
                    </details>
                  )}
                </div>
                <div className="builtin-skill-command">
                  <span>Built-in · Managed by Matter Workbench</span>
                  {skill.paid_provider_call && <span className="pipeline-state pending">Uses AI</span>}
                  {!skill.paid_provider_call && <span className="pipeline-state present">Local</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function SkillHistorySection({
  archivedCustomSkills,
  previousVersionCustomSkills,
  dismissedIdeas,
  renderManageActions,
}: {
  archivedCustomSkills: ConfigurableSkill[];
  previousVersionCustomSkills: ConfigurableSkill[];
  dismissedIdeas: SkillIdea[];
  renderManageActions: (skill: ConfigurableSkill, actions: LifecycleAction[]) => JSX.Element | null;
}) {
  return (
    <details className="skills-collapsible-section">
      <summary>History</summary>
      <div className="skills-row-list">
        {archivedCustomSkills.length > 0 && (
          <div className="skills-subsection-label">Archived custom skills</div>
        )}
        {archivedCustomSkills.map((skill) => (
          <CustomSkillRow
            key={skill.id}
            skill={skill}
            statusOverride="Archived"
            showCommandInline={false}
            manageActions={renderManageActions(skill, ['restore', 'delete'])}
          />
        ))}
        {previousVersionCustomSkills.length > 0 && (
          <div className="skills-subsection-label">Previous versions</div>
        )}
        {previousVersionCustomSkills.map((skill) => (
          <CustomSkillRow
            key={skill.id}
            skill={skill}
            statusOverride="Previous version"
            showCommandInline={false}
          />
        ))}
        {dismissedIdeas.length > 0 && (
          <div className="skills-subsection-label">Past skill ideas</div>
        )}
        {dismissedIdeas.map((idea) => (
          <SkillIdeaRow key={idea.id} idea={idea} />
        ))}
      </div>
    </details>
  );
}

function CustomSkillRow({
  skill,
  primaryAction,
  manageActions,
  statusOverride,
  showCommandInline = true,
}: {
  skill: ConfigurableSkill;
  primaryAction?: JSX.Element;
  manageActions?: JSX.Element | null;
  statusOverride?: string;
  showCommandInline?: boolean;
}) {
  return (
    <div className="skill-row">
      <div className="skill-row-main">
        <div className="skill-row-title">
          <strong>{skill.title}</strong>
          <span className={`pipeline-state ${customSkillStateClass(skill)}`}>
            {statusOverride || customSkillStateLabel(skill)}
          </span>
        </div>
        <div className="skill-row-meta">
          {showCommandInline && <span>{skill.slash}</span>}
          {skill.runCount !== undefined && (
            <span>{skill.runCount} run{skill.runCount !== 1 ? 's' : ''}</span>
          )}
          {skill.lastRunAt && <span>last {new Date(skill.lastRunAt).toLocaleDateString()}</span>}
          {skill.lifecycle?.statusChangedAt && (
            <span>changed {new Date(skill.lifecycle.statusChangedAt).toLocaleDateString()}</span>
          )}
        </div>
        {(skill.description || !showCommandInline) && (
          <details className="skill-row-details">
            <summary>Details</summary>
            {!showCommandInline && <p>Command: {skill.slash}</p>}
            {skill.description && <p>{skill.description}</p>}
            {skill.lifecycle?.reason && <p>{skill.lifecycle.reason}</p>}
          </details>
        )}
      </div>
      <div className="skill-row-actions">
        {primaryAction}
        {manageActions}
      </div>
    </div>
  );
}

function SkillIdeaRow({ idea, primaryAction }: { idea: SkillIdea; primaryAction?: JSX.Element }) {
  const title = skillIdeaDisplayTitle(idea);
  return (
    <div className="skill-row">
      <div className="skill-row-main">
        <div className="skill-row-title">
          <strong>{title}</strong>
          <span className="pipeline-state pending">{skillIdeaStatusLabel(idea.status)}</span>
        </div>
        <div className="skill-row-meta">
          <span>{new Date(idea.createdAt).toLocaleDateString()}</span>
          {idea.sampleCount !== undefined && <span>{idea.sampleCount} sample{idea.sampleCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>
      {primaryAction && (
        <div className="skill-row-actions">
          {primaryAction}
        </div>
      )}
    </div>
  );
}

function renderManageActions(
  skill: ConfigurableSkill,
  actions: LifecycleAction[],
  { loadingLifecycle, loadingRun, onLifecycleAction }: LifecycleRenderContext,
): JSX.Element | null {
  if (actions.length === 0) return null;
  return (
    <details className="skill-manage-menu">
      <summary>Manage</summary>
      <div>
        {actions.map((action) => (
          <button
            key={action}
            className="run-skill-button secondary"
            type="button"
            onClick={() => onLifecycleAction(skill, action)}
            disabled={Boolean(loadingLifecycle) || Boolean(loadingRun)}
          >
            {loadingLifecycle === `${skill.id}:${action}` ? 'Working…' : lifecycleActionLabel(action)}
          </button>
        ))}
      </div>
    </details>
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

function readSkillsIntroHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SKILLS_INTRO_STORAGE_KEY) === '1';
  } catch (_error) {
    return false;
  }
}

function persistSkillsIntroHidden() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SKILLS_INTRO_STORAGE_KEY, '1');
  } catch (_error) {
    // Ignore private-mode storage failures; the note can reappear next load.
  }
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

function customSkillStateLabel(skill: ConfigurableSkill): string {
  const status = skill.status;
  if (status === 'draft' && String(skill.slash || '').endsWith('_failed_validation')) return 'Failed validation';
  if (status === 'active') return 'Active';
  if (status === 'suspended') return 'Paused';
  if (status === 'archived') return 'Archived';
  if (status === 'disabled') return 'Previous version';
  if (status === 'draft') return 'Draft';
  return 'Custom skill';
}

function customSkillStateClass(skill: ConfigurableSkill): string {
  const status = skill.status;
  if (status === 'active') return 'present';
  if (status === 'draft' && String(skill.slash || '').endsWith('_failed_validation')) return 'failed';
  if (status === 'suspended' || status === 'draft') return 'pending';
  if (status === 'archived' || status === 'disabled') return 'not-run';
  return 'pending';
}
