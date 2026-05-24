import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const skillsPagePath = new URL("../react-ui/src/views/SkillsPage.tsx", import.meta.url);

test("React custom skill lifecycle controls are scoped to custom skills", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const commandSource = await readFile(commandPanelPath, "utf8");
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(apiSource, /updateConfigurableSkillLifecycle/);
  assert.match(apiSource, /\/api\/configurable-skills\/\$\{encodeURIComponent\(skillId\)\}\/lifecycle/);

  assert.match(commandSource, /status !== 'active'/);
  assert.match(commandSource, /customSkill: true/);

  assert.match(skillsSource, /Pause/);
  assert.match(skillsSource, /Resume/);
  assert.match(skillsSource, /Archive/);
  assert.match(skillsSource, /Restore to paused/);
  assert.match(skillsSource, /Delete/);
  assert.match(skillsSource, /skill\.status === 'active' \|\| skill\.status === 'suspended'/);
  assert.match(skillsSource, /draftCustomSkills/);
  assert.match(skillsSource, /Draft custom skills/);
  assert.match(skillsSource, /previousVersionCustomSkills/);
  assert.match(skillsSource, /Previous versions/);
  assert.match(skillsSource, /Archived custom skills/);
  assert.match(skillsSource, /const builtinRegistrySkills = registrySkills\.filter\(\(skill\) => !skill\.configurable\);/);
  assert.match(skillsSource, /groupByCategory\(builtinRegistrySkills\)/);
  assert.doesNotMatch(skillsSource, /groupByCategory\(registrySkills\)/);
  assert.match(skillsSource, /Built-in · Managed by Matter Workbench/);
  assert.doesNotMatch(skillsSource, /updateConfigurableSkillLifecycle\([^)]*skill\.slash/);
});

test("React custom skill lifecycle actions do not race custom skill runs", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(
    skillsSource,
    /disabled=\{loadingRun === skill\.id \|\| Boolean\(loadingLifecycle\)\}/,
    "Run should be disabled while any lifecycle action is in flight.",
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

  assert.match(skillsSource, /Your Skills/);
  assert.match(skillsSource, /Skills in Progress/);
  assert.match(skillsSource, /Built-in Workflows/);
  assert.match(skillsSource, /History/);

  assert.match(skillsSource, /<details className="skills-collapsible-section">[\s\S]*Built-in Workflows/);
  assert.doesNotMatch(skillsSource, /<details className="skills-collapsible-section" open>[\s\S]*Built-in Workflows/);
  assert.match(skillsSource, /<details className="skills-collapsible-section">[\s\S]*History/);
  assert.doesNotMatch(skillsSource, /<details className="skills-collapsible-section" open>[\s\S]*History/);
});

test("React Skills page keeps load failures local and retryable", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(skillsSource, /const loadSkillData = useCallback/);
  assert.match(skillsSource, /setLoadError\(''\)/);
  assert.match(skillsSource, /Try again/);
  assert.doesNotMatch(skillsSource, /\[skills\] load failed/);
});

test("React Skills page keeps custom lifecycle controls out of built-ins", async () => {
  const skillsSource = await readFile(skillsPagePath, "utf8");
  const builtInSection = skillsSource.slice(
    skillsSource.indexOf("function BuiltInWorkflowsSection"),
    skillsSource.indexOf("function SkillHistorySection"),
  );

  assert.match(skillsSource, /renderManageActions\(skill, \['suspend', 'archive', 'delete'\]\)/);
  assert.match(skillsSource, /renderManageActions\(skill, \['archive', 'delete'\]\)/);
  assert.match(skillsSource, /Built-in · Managed by Matter Workbench/);
  assert.doesNotMatch(builtInSection, /handleLifecycleAction/);
  assert.doesNotMatch(builtInSection, /renderManageActions/);
});
