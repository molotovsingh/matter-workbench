import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const commandSuggestionsHookPath = new URL("../react-ui/src/hooks/useCommandSuggestions.ts", import.meta.url);
const skillsPagePath = new URL("../react-ui/src/views/SkillsPage.tsx", import.meta.url);

test("React custom skill lifecycle controls are scoped to custom skills", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const commandSuggestionsSource = await readFile(commandSuggestionsHookPath, "utf8");
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(apiSource, /updateConfigurableSkillLifecycle/);
  assert.match(apiSource, /\/api\/configurable-skills\/\$\{encodeURIComponent\(skillId\)\}\/lifecycle/);

  assert.match(commandSuggestionsSource, /status !== 'active'/);
  assert.match(commandSuggestionsSource, /customSkill: true/);

  assert.match(skillsSource, /Pause/);
  assert.match(skillsSource, /Resume/);
  assert.match(skillsSource, /Archive/);
  assert.match(skillsSource, /Restore to paused/);
  assert.match(skillsSource, /Delete/);
  assert.match(skillsSource, /skill\.status === 'active' \|\| skill\.status === 'suspended'/);
  assert.match(skillsSource, /draftCustomSkills/);
  assert.match(skillsSource, /Draft custom workflows/);
  assert.match(skillsSource, /previousVersionCustomSkills/);
  assert.match(skillsSource, /Previous versions/);
  assert.match(skillsSource, /Archived custom skills/);
  assert.match(skillsSource, /const builtinRegistrySkills = registrySkills\.filter\(\(skill\) => !skill\.configurable\);/);
  assert.match(skillsSource, /skills=\{builtinRegistrySkills\}/);
  assert.match(skillsSource, /onRunWorkflow=\{onCommand\}/);
  assert.doesNotMatch(skillsSource, /groupByCategory\(registrySkills\)/);
  assert.match(skillsSource, /<span role="columnheader">Shortcut<\/span>/);
  assert.match(skillsSource, /<code>\{skill\.slash\}<\/code>/);
  assert.doesNotMatch(skillsSource, /updateConfigurableSkillLifecycle\([^)]*skill\.slash/);
});

test("React custom skill lifecycle actions do not race custom skill runs", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(
    skillsSource,
    /disabled=\{loadingRun === skill\.id \|\| Boolean\(loadingLifecycle\)\}/,
    "Run should be disabled only while a run or lifecycle action is in flight; no-matter opens the matter chooser.",
  );
  assert.match(
    skillsSource,
    /disabled=\{Boolean\(loadingLifecycle\) \|\| Boolean\(loadingRun\)\}/,
    "Lifecycle actions should be disabled while any custom skill run is in flight.",
  );
});

test("React custom skill run loading state clears after stale matter switches", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(
    skillsSource,
    /finally \{\s*setLoadingRun\(null\);\s*\}/,
    "A stale matter switch should suppress result text, but should not leave the Skills page stuck in Running state.",
  );
});

test("React Skills page uses an action-first MECE layout", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /SKILLS_INTRO_STORAGE_KEY = 'mwb\.skillsIntro\.hidden\.v1'/);
  assert.match(skillsSource, /window\.localStorage\.getItem\(SKILLS_INTRO_STORAGE_KEY\) === '1'/);
  assert.match(skillsSource, /window\.localStorage\.setItem\(SKILLS_INTRO_STORAGE_KEY, '1'\)/);
  assert.match(skillsSource, /setIntroHidden\(true\)/);
  assert.match(skillsSource, /New to skills\?/);
  assert.match(skillsSource, /A skill is a repeatable work routine/);
  assert.match(skillsSource, /Built-in skills/);
  assert.match(skillsSource, /Your skills/);
  assert.match(skillsSource, /Not a skill/);
  assert.match(skillsSource, /Hide this note/);

  assert.match(skillsSource, /<YourSkillsSection/);
  assert.match(skillsSource, /<SkillsInProgressSection/);
  assert.match(skillsSource, /<BuiltInWorkflowsSection/);
  assert.match(skillsSource, /<SkillHistorySection/);

  assert.match(skillsSource, /Run or build legal workflows/);
  assert.match(skillsSource, /shortcut is shown so the Matter Assistant command rail becomes faster over time/);
  assert.match(skillsSource, /Your Skills/);
  assert.match(skillsSource, /Workflows in progress/);
  assert.match(skillsSource, /Choose a workflow/);
  assert.match(skillsSource, /History/);

  assert.match(skillsSource, /className="skills-action-table"/);
  assert.match(skillsSource, /<span role="columnheader">Workflow<\/span>/);
  assert.match(skillsSource, /<span role="columnheader">Use it for<\/span>/);
  assert.match(skillsSource, /<span role="columnheader">Action<\/span>/);
  assert.match(skillsSource, /Click an action, or use the shortcut in Matter Assistant once familiar/);
  assert.match(skillsSource, /builtinWorkflowTitle\(skill\)/);
  assert.match(skillsSource, /builtinWorkflowActionLabel\(skill\)/);
  assert.match(skillsSource, /builtinWorkflowPurpose\(skill\)/);
  assert.match(skillsSource, /Set up the matter/);
  assert.match(skillsSource, /Create document index/);
  assert.doesNotMatch(skillsSource, /<span>\{skill\.category \|\| 'Built-in workflow'\}<\/span>/);
  assert.match(skillsSource, /<details className="skills-collapsible-section">[\s\S]*History/);
  assert.doesNotMatch(skillsSource, /<details className="skills-collapsible-section" open>[\s\S]*History/);
});

test("React Skills page and command rail refresh after Skill Factory creates a skill", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");
  const commandSource = await readFile(commandPanelPath, "utf8");

  assert.match(skillsSource, /state\.skillsDataRefreshSeq/);
  assert.match(skillsSource, /\[loadSkillData, state\.skillsDataRefreshSeq\]/);
  assert.match(commandSource, /state\.skillsDataRefreshSeq/);
  assert.match(commandSource, /void loadCommandSuggestions\(\);[\s\S]*\}, \[loadCommandSuggestions, state\.skillsDataRefreshSeq\]\)/);
});

test("React Skills page keeps load failures local and retryable", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /const loadSkillData = useCallback/);
  assert.match(skillsSource, /setLoadError\(''\)/);
  assert.match(skillsSource, /Try again/);
  assert.doesNotMatch(skillsSource, /\[skills\] load failed/);
});

test("React Skills page lets saved skill ideas continue instead of rendering inert drafts", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");
  const commandSource = await readFile(commandPanelPath, "utf8");

  assert.match(skillsSource, /function handleContinueIdea\(idea: SkillIdea\)/);
  assert.match(skillsSource, /status !== SKILL_IDEA_STATUS\.DISMISSED && status !== SKILL_IDEA_STATUS\.CREATED && status !== SKILL_IDEA_STATUS\.PARKED/);
  assert.match(skillsSource, /Past skill ideas/);
  assert.match(skillsSource, /SET_PENDING_SKILL_IDEA_RESUME/);
  assert.match(skillsSource, /Choose a matter for \$\{action\.label\}\. Matter Workbench will continue after you select it\./);
  assert.match(skillsSource, /hasActiveMatter \? 'Continue setup' : 'Choose matter'/);
  assert.match(skillsSource, /Draft workflow ideas/);
  assert.match(skillsSource, /function handleParkIdea\(idea: SkillIdea\)/);
  assert.match(skillsSource, /api\.updateSkillIdeaStatus\(idea\.id, \{ status: SKILL_IDEA_STATUS\.PARKED \}\)/);
  assert.match(skillsSource, /loadingIdeaStatus === idea\.id \? 'Saving…' : 'Save for later'/);
  assert.match(commandSource, /state\.pendingSkillIdeaResume/);
  assert.match(commandSource, /setResumedSkillIdea\(idea\)/);
  assert.match(commandSource, /initialIdea=\{resumedSkillIdea\}/);
  assert.match(commandSource, /SET_PENDING_SKILL_IDEA_RESUME', payload: null/);
});

test("React Skills page keeps custom lifecycle controls out of built-ins", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");
  const builtInSection = skillsSource.slice(
    skillsSource.indexOf("function BuiltInWorkflowsSection"),
    skillsSource.indexOf("function SkillHistorySection"),
  );

  assert.match(skillsSource, /renderManageActions\(skill, \['suspend', 'archive', 'delete'\]\)/);
  assert.match(skillsSource, /renderManageActions\(skill, \['archive', 'delete'\]\)/);
  assert.doesNotMatch(skillsSource, /<span className="pipeline-state present">Built-in<\/span>/);
  assert.doesNotMatch(builtInSection, /handleLifecycleAction/);
  assert.doesNotMatch(builtInSection, /renderManageActions/);
});

test("React Skills page offers an enabled matter chooser until a matter is selected", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /hasActiveMatter=\{Boolean\(state\.activeMatter\)\}/);
  assert.match(skillsSource, /function openMatterChooserForSkills\(action: PendingSkillsMatterAction\)/);
  assert.match(skillsSource, /SET_PENDING_SKILLS_MATTER_ACTION', payload: action/);
  assert.match(skillsSource, /SET_VIEW', payload: 'find-matter'/);
  assert.match(skillsSource, /kind: 'custom-skill', label: skill\.title \|\| skill\.slash, slash: skill\.slash/);
  assert.match(skillsSource, /kind: 'native-workflow', label: builtinWorkflowTitle\(skill\), command: skill\.slash/);
  assert.match(skillsSource, /kind: 'skill-idea', label: skillIdeaDisplayTitle\(idea\), idea/);
  assert.match(skillsSource, /onClick=\{\(\) => \(hasActiveMatter \? onRunSkill\(skill\) : onChooseMatter\(skill\)\)\}/);
  assert.match(skillsSource, /onClick=\{\(\) => \(hasActiveMatter \|\| skill\.matter_required === false \? onRunWorkflow\(skill\.slash\) : onChooseMatter\(skill\)\)\}/);
  assert.match(skillsSource, /!hasActiveMatter[\s\S]*\? 'Choose matter'[\s\S]*loadingRun === skill\.id[\s\S]*\? 'Running…'[\s\S]*: 'Run'/);
  assert.match(skillsSource, /!hasActiveMatter && skill\.matter_required !== false \? 'Choose matter' : builtinWorkflowActionLabel\(skill\)/);
  assert.doesNotMatch(skillsSource, /disabled=\{!hasActiveMatter/);
  assert.doesNotMatch(skillsSource, /Pick matter first/);
});

test("React App resumes the intended Skills action after matter selection", async () => {
  const appSource = await readFile(appPath, "utf8");

  assert.match(appSource, /const pendingSkillsAction = state\.pendingSkillsMatterAction/);
  assert.match(appSource, /SET_PENDING_SKILLS_MATTER_ACTION', payload: null/);
  assert.match(appSource, /pendingSkillsAction\.kind === 'native-workflow'/);
  assert.match(appSource, /resolveNativeCommand\(pendingSkillsAction\.command\)/);
  assert.match(appSource, /runMatterStoryFromCommand\(name\)/);
  assert.match(appSource, /pendingSkillsAction\.kind === 'custom-skill'/);
  assert.match(appSource, /runConfigurableSkillFromCommand\(\{[\s\S]*slash: pendingSkillsAction\.slash,[\s\S]*matterName: name/);
  assert.match(appSource, /pendingSkillsAction\.kind === 'skill-idea'/);
  assert.match(appSource, /SET_PENDING_SKILL_IDEA_RESUME', payload: pendingSkillsAction\.idea/);
});

test("React Skills page offers in-place overwrite confirmation for existing custom skill output", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /const \[pendingOverwrite, setPendingOverwrite\] = useState/);
  assert.match(skillsSource, /result\.state === 'requires_overwrite'[\s\S]*setPendingOverwrite\(\{ skillId: skill\.id, matterName, artifactPath: result\.artifactPath/);
  assert.match(skillsSource, /const isOverwritePending = pendingOverwrite\?\.skillId === skill\.id && pendingOverwrite\?\.matterName === activeMatterName/);
  assert.match(skillsSource, /api\.runConfigurableSkill\(\{ slash: skill\.slash, overwrite: isOverwritePending, matterName \}\)/);
  assert.match(skillsSource, /isOverwritePending[\s\S]*\? 'Run anyway \/ overwrite'[\s\S]*: 'Run'/);
  assert.match(skillsSource, /setPendingOverwrite\(null\)/);
});

test("React Skills page keeps technical custom skill slugs out of in-progress row summaries", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /showCommandInline\?: boolean/);
  assert.match(skillsSource, /showCommandInline=\{false\}/);
  assert.match(skillsSource, /Command: \{skill\.slash\}/);
  assert.match(skillsSource, /\{showCommandInline && <span>\{skill\.slash\}<\/span>\}/);
});

test("React Skills page labels failed-validation drafts distinctly", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /endsWith\('_failed_validation'\)[\s\S]*return 'Failed validation'/);
  assert.match(skillsSource, /endsWith\('_failed_validation'\)[\s\S]*return 'failed'/);
});
