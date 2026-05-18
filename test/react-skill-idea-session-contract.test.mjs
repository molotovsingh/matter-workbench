import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillIdeaSessionPath = new URL("../react-ui/src/components/command/SkillIdeaSession.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);

test("React skill idea session gates ready-for-review on backend readiness", async () => {
  const source = await readFile(skillIdeaSessionPath, "utf8");

  assert.match(source, /if \(!session\.savedIdea\?\.readiness\?\.ready\) \{/);
  assert.match(source, /Complete every readiness item before marking ready for review\./);
  assert.match(source, /const payload = await api\.updateSkillIdeaStatus/);
  assert.match(source, /savedIdea: payload\.idea \|\|/);
});

test("React skill idea session keeps samples tied to the saved design brief and matter", async () => {
  const source = await readFile(skillIdeaSessionPath, "utf8");

  assert.match(source, /answersDirtySinceSave: boolean/);
  assert.match(source, /answersDirtySinceSave: editingSavedIdea \|\| s\.answersDirtySinceSave/);
  assert.match(source, /markSkillIdeaSampleStale\(s\.sample\)/);
  assert.match(source, /if \(!savedIdea \|\| !savedIdeaId \|\| session\.answersDirtySinceSave\) \{/);
  assert.match(source, /saving updated idea before sample/);
  assert.match(source, /Save updates and generate a fresh sample before creating the skill\./);
  assert.match(source, /Regenerate the sample after the design brief changes before creating the skill\./);
  assert.match(source, /generatedSampleMatterFolder\(result\)/);
  assert.match(source, /ignored sample result after matter changed/);
  assert.match(source, /planSkillIdeaInterview\(\{[\s\S]*matterName: state\.activeMatter\?\.name/);
  assert.match(source, /createSkillIdea\(\{[\s\S]*matterName: state\.activeMatter\?\.name/);
  assert.match(source, /api\.checkIntent\(\{[\s\S]*matterName: state\.activeMatter\?\.name/);
});

test("React API client types skill idea status updates as idea responses", async () => {
  const source = await readFile(apiClientPath, "utf8");

  assert.match(
    source,
    /updateSkillIdeaStatus:[\s\S]*postJson<SkillIdeaCreateResponse>\(`\/api\/skill-ideas\/\$\{ideaId\}\/status`, body\)/,
  );
});
