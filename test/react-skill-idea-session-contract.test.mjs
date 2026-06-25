import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillIdeaSessionPath = new URL("../react-ui/src/components/command/SkillIdeaSession.tsx", import.meta.url);
const skillIdeaSessionMachinePath = new URL("../react-ui/src/hooks/useSkillIdeaSessionMachine.ts", import.meta.url);
const skillIdeaSessionMachineStatePath = new URL("../react-ui/src/lib/skillIdeaSessionMachine.ts", import.meta.url);
const skillIdeaSessionActionsPath = new URL("../react-ui/src/lib/skillIdeaSessionActions.ts", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);

test("React skill idea session gates ready-for-review on backend readiness", async () => {
  const source = await readFile(skillIdeaSessionMachinePath, "utf8");

  assert.match(source, /if \(!session\.savedIdea\?\.readiness\?\.ready\) \{/);
  assert.match(source, /Complete every readiness item before marking ready for review\./);
  assert.match(source, /const payload = await api\.updateSkillIdeaStatus/);
  assert.match(source, /savedIdea: payload\.idea \|\|/);
});

test("React skill idea session keeps samples tied to the saved design brief and matter", async () => {
  const source = await readFile(skillIdeaSessionMachinePath, "utf8");
  const machineStateSource = await readFile(skillIdeaSessionMachineStatePath, "utf8");
  const actionsSource = await readFile(skillIdeaSessionActionsPath, "utf8");

  assert.match(machineStateSource, /answersDirtySinceSave: boolean/);
  assert.match(machineStateSource, /answersDirtySinceSave: editingSavedIdea \|\| state\.answersDirtySinceSave/);
  assert.match(machineStateSource, /markSkillIdeaSampleStale\(state\.sample\)/);
  assert.match(source, /if \(!savedIdea \|\| !savedIdeaId \|\| session\.answersDirtySinceSave\) \{/);
  assert.match(source, /saving updated idea before sample/);
  assert.match(source, /Save updates and generate a fresh sample before creating the skill\./);
  assert.match(source, /Regenerate the sample after the design brief changes before creating the skill\./);
  assert.match(actionsSource, /generatedSkillIdeaSampleMatterFolder\(result\)/);
  assert.match(actionsSource, /matterName: matterName \|\| undefined/);
  assert.match(source, /const startingMatter = activeMatterRef\.current/);
  assert.match(source, /matterName: startingMatterFolder \|\| startingMatterName/);
  assert.match(source, /ignored sample result after matter changed/);
  assert.match(source, /ignored interview plan after matter changed/);
  assert.match(source, /ignored saved idea after matter changed/);
  assert.match(source, /ignored overlap check after matter changed/);
  assert.match(source, /sampleMatterChanged\(sample\)/);
  assert.match(source, /planSkillIdeaInterview\(\{[\s\S]*matterName: startingMatterName \|\| undefined/);
  assert.match(actionsSource, /createSkillIdea\(\{[\s\S]*matterName: matterName \|\| undefined/);
  assert.match(actionsSource, /skillIdeaTextForSaveWithName\(session\.ideaText, brief, session\.answers\.skillName \|\| ''\)/);
  assert.match(actionsSource, /text: ideaTextForSave/);
  assert.match(actionsSource, /api\.checkIntent\(\{[\s\S]*matterName: matterName \|\| undefined/);
});

test("React empty new-skill interviews synthesize save text and ask for the core job", async () => {
  const source = await readFile(new URL("../react-ui/src/lib/skillIdeaSession.ts", import.meta.url), "utf8");
  const sessionComponentSource = await readFile(skillIdeaSessionPath, "utf8");

  assert.match(source, /export function skillIdeaTextForSave/);
  assert.match(source, /export function skillIdeaTextForSaveWithName/);
  assert.match(source, /export const SKILL_IDEA_NAME_QUESTION/);
  assert.match(source, /What would you like to name this skill\?/);
  assert.match(source, /skillNameSuggestions/);
  assert.match(source, /answers\.problem/);
  assert.match(source, /titleFromIntent\(/);
  assert.match(sessionComponentSource, /currentQuestionExamples/);
  assert.match(sessionComponentSource, /skillNameSuggestions\(session\.ideaText, session\.plannedBrief, session\.answers\)/);
  assert.match(source, /Create a reusable skill to/);
  assert.match(source, /ensureProblemQuestionForEmptyIdea/);
  assert.match(source, /What is the exact skill idea in one sentence\?/);
  assert.match(source, /inferSkillIdeaProblemFromAnswers/);
  assert.match(source, /usableSkillIdeaProblem\(plannedBrief\?\.problem\)/);
  assert.match(source, /const problem = answers\.problem[\s\S]*inferSkillIdeaProblemFromAnswers\(answers, questions\)[\s\S]*\|\| plannedProblem/);
  assert.match(source, /if \(\/\^unknown\\b\/i\.test\(text\)\) return ''/);
  assert.match(source, /if \(\/not \(\?:yet \)\?\(\?:provided\|described\|specified\|known\)\/i\.test\(text\)\) return ''/);
  assert.doesNotMatch(source, /what decision or task\)\\b\.test\(label\)/);
});

test("React blank new-skill sessions show a kickoff question while planner continues in background", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const machineStateSource = await readFile(skillIdeaSessionMachineStatePath, "utf8");
  const sessionSource = await readFile(new URL("../react-ui/src/lib/skillIdeaSession.ts", import.meta.url), "utf8");

  assert.match(sessionSource, /export const SKILL_IDEA_KICKOFF_QUESTIONS/);
  assert.match(sessionSource, /export const SKILL_IDEA_NAME_QUESTION/);
  assert.match(sessionSource, /review limitation risk for a consumer complaint/);
  assert.match(sessionSource, /draft a client update email from the latest matter record/);
  assert.match(machineSource, /const startsWithBlankIdea = !ideaText\.trim\(\)/);
  assert.match(machineStateSource, /phase: startsFromSavedIdea \? 'saved' : startsWithBlankIdea \? 'interviewing' : 'planning'/);
  assert.match(machineStateSource, /questions: startsWithBlankIdea \? \[\.\.\.SKILL_IDEA_KICKOFF_QUESTIONS, SKILL_IDEA_NAME_QUESTION\] : \[\]/);
  assert.match(sessionSource, /appendSkillNameQuestion\(questions, fallbackIdeaText, designBrief\)/);
  assert.match(machineSource, /if \(Object\.keys\(s\.answers\)\.length > 0\) \{/);
  assert.match(machineSource, /return \{[\s\S]*planner: result\.planner,[\s\S]*\}/);
});

test("React saved skill ideas resume without replanning and can route to matter selection", async () => {
  const componentSource = await readFile(skillIdeaSessionPath, "utf8");
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const machineStateSource = await readFile(skillIdeaSessionMachineStatePath, "utf8");
  const appContextSource = await readFile(new URL("../react-ui/src/store/AppContext.tsx", import.meta.url), "utf8");
  const typesSource = await readFile(new URL("../react-ui/src/types/index.ts", import.meta.url), "utf8");

  assert.match(typesSource, /pendingSkillIdeaResume: SkillIdea \| null/);
  assert.match(appContextSource, /SET_PENDING_SKILL_IDEA_RESUME/);
  assert.match(componentSource, /initialIdea\?: SkillIdea \| null/);
  assert.match(componentSource, /hasMatter\) \{[\s\S]*handleGenerateSample/);
  assert.match(componentSource, /handlePickMatterForSample/);
  assert.match(machineSource, /startsFromSavedIdea/);
  assert.match(machineStateSource, /phase: startsFromSavedIdea \? 'saved'/);
  assert.match(machineStateSource, /savedIdeaId: initialIdea\?\.id \|\| null/);
  assert.match(machineSource, /if \(startsFromSavedIdea\) \{/);
  assert.match(machineSource, /function handlePickMatterForSample\(\)/);
  assert.match(machineSource, /Pick a matter to test this saved skill idea, then continue it from Skills\./);
});

test("React skill idea sample warnings hide internal context-limit language", async () => {
  const componentSource = await readFile(skillIdeaSessionPath, "utf8");

  assert.match(componentSource, /visibleSkillSampleWarnings/);
  assert.match(componentSource, /isInternalContextLimitWarning/);
  assert.match(componentSource, /max\(\?:blocks\|charsperblock\|sources\|libraryartifacts\)/i);
  assert.doesNotMatch(componentSource, /session\.sample\.warnings\.map/);
  assert.match(componentSource, /sampleWarnings\.map/);
});

test("React skill idea session explains no-matter saved idea flow before sample generation", async () => {
  const componentSource = await readFile(skillIdeaSessionPath, "utf8");

  assert.match(componentSource, /NO_MATTER_SAMPLE_GUIDANCE_PHASES/);
  assert.match(componentSource, /'ready', 'saved', 'sampled'/);
  assert.match(componentSource, /!hasMatter && NO_MATTER_SAMPLE_GUIDANCE_PHASES\.has\(session\.phase\)/);
  assert.doesNotMatch(componentSource, /!hasMatter && session\.phase !== 'created'/);
  assert.match(componentSource, /You can save this idea now, but pick a matter before generating a sample or creating the skill\./);
});

test("React skill idea session component delegates orchestration to the machine hook", async () => {
  const source = await readFile(skillIdeaSessionPath, "utf8");

  assert.match(source, /useSkillIdeaSessionMachine/);
  assert.doesNotMatch(source, /api\.createSkillIdea/);
  assert.doesNotMatch(source, /api\.generateSampleOutput/);
  assert.doesNotMatch(source, /api\.createSkillFromIdea/);
});

test("React skill idea session keeps planner diagnostics out of the lawyer-facing card", async () => {
  const source = await readFile(skillIdeaSessionPath, "utf8");
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");

  assert.doesNotMatch(source, /session\.planner/);
  assert.doesNotMatch(source, /Interview planned by/);
  assert.doesNotMatch(source, /configured provider/);
  assert.doesNotMatch(source, /session\.riskFlags/);
  assert.match(machineSource, /formatSkillIdeaPlannerTerminalLine/);
});

test("React skill idea machine uses typed transitions and async sequence guards", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const machineStateSource = await readFile(skillIdeaSessionMachineStatePath, "utf8");

  assert.match(machineStateSource, /export type SkillIdeaSessionTransition/);
  assert.match(machineStateSource, /export function reduceSkillIdeaSessionState/);
  assert.match(machineSource, /applyTransition\(\{ type: 'answer_question', answer \}\)/);
  assert.match(machineSource, /const asyncOperationRef = useRef/);
  assert.match(machineSource, /const operation = beginAsyncOperation\('plan'\)/);
  assert.match(machineSource, /const operation = beginAsyncOperation\('save'\)/);
  assert.match(machineSource, /const operation = beginAsyncOperation\('sample'\)/);
  assert.match(machineSource, /const operation = beginAsyncOperation\('create'\)/);
  assert.match(machineSource, /if \(!operation\.isCurrent\(\)\) return;/);
});

test("React skill idea machine delegates persistence details to session actions", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const actionsSource = await readFile(skillIdeaSessionActionsPath, "utf8");

  assert.match(actionsSource, /export async function persistSkillIdeaSession/);
  assert.match(actionsSource, /buildSkillIdeaDesignBrief/);
  assert.match(actionsSource, /skillIdeaTextForSaveWithName/);
  assert.match(actionsSource, /api\.createSkillIdea/);
  assert.match(actionsSource, /api\.updateSkillIdeaBrief/);
  assert.match(machineSource, /persistSkillIdeaSession/);
  assert.doesNotMatch(machineSource, /api\.createSkillIdea/);
  assert.doesNotMatch(machineSource, /api\.updateSkillIdeaBrief/);
});

test("React skill idea machine delegates sample generation details to session actions", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const actionsSource = await readFile(skillIdeaSessionActionsPath, "utf8");

  assert.match(actionsSource, /export async function generateSkillIdeaSessionSample/);
  assert.match(actionsSource, /api\.generateSampleOutput/);
  assert.match(actionsSource, /matterName: matterName \|\| undefined/);
  assert.match(actionsSource, /storedSample\?\.version/);
  assert.match(actionsSource, /generatedSkillIdeaSampleMatterFolder/);
  assert.match(machineSource, /generateSkillIdeaSessionSample/);
  assert.doesNotMatch(machineSource, /api\.generateSampleOutput/);
  assert.doesNotMatch(machineSource, /storedSample\?\.version/);
});

test("React skill idea machine keeps saved idea visible before risky sample provider call", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");

  assert.match(
    machineSource,
    /savedIdea = saved\.savedIdea;[\s\S]*savedIdeaId = saved\.savedIdea\.id;[\s\S]*safeSetSession\(\(s\) => \(\{[\s\S]*savedIdeaId,[\s\S]*savedIdea,[\s\S]*designBrief: savedIdea\?\.designBrief \|\| s\.designBrief,[\s\S]*answersDirtySinceSave: false,[\s\S]*\}\)\);[\s\S]*const generatedSample = await generateSkillIdeaSessionSample/,
  );
});

test("React skill idea machine delegates copy side effects to session actions", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const actionsSource = await readFile(skillIdeaSessionActionsPath, "utf8");

  assert.match(actionsSource, /export async function copySkillIdeaSample/);
  assert.match(actionsSource, /export async function copySkillIdeaSampleVersion/);
  assert.match(actionsSource, /export async function copySkillIdeaReviewPacket/);
  assert.match(actionsSource, /writeClipboardText/);
  assert.match(actionsSource, /api\.getSkillIdeaSamples/);
  assert.match(actionsSource, /api\.getSkills/);
  assert.match(machineSource, /copySkillIdeaSample/);
  assert.match(machineSource, /copySkillIdeaSampleVersion/);
  assert.match(machineSource, /copySkillIdeaReviewPacket/);
  assert.doesNotMatch(machineSource, /writeClipboardText/);
  assert.doesNotMatch(machineSource, /api\.getSkillIdeaSamples/);
  assert.doesNotMatch(machineSource, /api\.getSkills/);
});

test("React skill idea machine delegates approve-overlap-create API calls to session actions", async () => {
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");
  const actionsSource = await readFile(skillIdeaSessionActionsPath, "utf8");

  assert.match(actionsSource, /export async function approveAndCreateSkillFromIdeaSession/);
  assert.match(actionsSource, /api\.approveSkillIdeaSample/);
  assert.match(actionsSource, /api\.checkIntent/);
  assert.match(actionsSource, /api\.createSkillFromIdea/);
  assert.match(actionsSource, /buildSkillCreationOverlapRequest/);
  assert.match(actionsSource, /isBlockingSkillOverlapDecision/);
  assert.match(actionsSource, /isCurrentMatterName/);
  assert.match(machineSource, /approveAndCreateSkillFromIdeaSession/);
  assert.doesNotMatch(machineSource, /api\.approveSkillIdeaSample/);
  assert.doesNotMatch(machineSource, /api\.createSkillFromIdea/);
});

test("React skill idea create action guards stale matter before and after create", async () => {
  const actionsSource = await readFile(skillIdeaSessionActionsPath, "utf8");
  const machineSource = await readFile(skillIdeaSessionMachinePath, "utf8");

  assert.match(
    actionsSource,
    /if \(!isCurrentMatterName\(matterName\)\) return \{ status: 'matter_changed' \};[\s\S]*await api\.approveSkillIdeaSample/,
  );
  assert.match(
    actionsSource,
    /await api\.approveSkillIdeaSample\(ideaId, sample\.id\);[\s\S]*if \(!isCurrentMatterName\(matterName\)\) return \{ status: 'matter_changed' \};[\s\S]*const userRequest = buildSkillCreationOverlapRequest/,
  );
  assert.match(
    actionsSource,
    /const result = await api\.createSkillFromIdea[\s\S]*if \(!isCurrentMatterName\(matterName\)\) return \{ status: 'matter_changed' \};[\s\S]*return \{ status: 'created'/,
  );
  assert.match(machineSource, /BUMP_SKILLS_DATA_REFRESH/);
  assert.match(machineSource, /SET_BREADCRUMBS', payload: 'Skills'/);
});

test("React skill idea created state explains where to run the new skill", async () => {
  const source = await readFile(new URL("../react-ui/src/components/command/SkillIdeaSession.tsx", import.meta.url), "utf8");

  assert.match(source, /It is now in Your Skills/);
  assert.match(source, /Pick any matter and click Run/);
  assert.match(source, /Shortcut: <code>\{session\.createdSkill\.slash\}<\/code>/);
});

test("React API client types skill idea status updates as idea responses", async () => {
  const source = await readFile(apiClientPath, "utf8");

  assert.match(
    source,
    /updateSkillIdeaStatus:[\s\S]*postJson<SkillIdeaCreateResponse>\(`\/api\/skill-ideas\/\$\{ideaId\}\/status`, body\)/,
  );
});
