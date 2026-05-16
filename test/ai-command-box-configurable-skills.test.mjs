import assert from "node:assert/strict";
import test from "node:test";
import { createAiCommandBox } from "../frontend/ai-command-box.js";
import {
  completeReadiness,
  fakeCtx,
  fakeForm,
} from "../test-support/ai-command-box-helpers.mjs";

// Configurable custom skill run and improvement flows.

test("command box runs active configurable slash commands and handles overwrite confirmation", async () => {
  const runCalls = [];
  const cancelCalls = [];
  const openCalls = [];
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "/party_officer_map",
    openFilePreview: (...args) => openCalls.push(args),
  });
  const box = createAiCommandBox(ctx, {
    loadSkillRegistry: async () => ({
      skills: [{
        configurable: true,
        status: "active",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        purpose: "Map formal party names and officers.",
      }],
    }),
    runConfigurableSkill: async (body) => {
      runCalls.push(body);
      if (!body.overwrite) {
        return {
          schema_version: "configurable-skill-run/v1",
          state: "requires_overwrite",
          skill: {
            slash: "/party_officer_map",
            title: "Party and Officer Map",
          },
          artifactPath: "20_Workshop/Party and Officer Map.md",
        };
      }
      return {
        schema_version: "configurable-skill-run/v1",
        state: "written",
        skill: {
          slash: "/party_officer_map",
          title: "Party and Officer Map",
        },
        markdown: "# Party and Officer Map\n\nAyesha appears as client (FILE-0001 p1.b1).",
        outputPaths: {
          markdown: "20_Workshop/Party and Officer Map.md",
          json: "20_Workshop/Party and Officer Map.json",
        },
        aiRun: {
          provider: "openai-direct",
          model: "gpt-5.4",
        },
        runId: "run_party_overwrite",
        runRecord: {
          id: "run_party_overwrite",
          slash: "/party_officer_map",
          title: "Party and Officer Map",
          status: "succeeded",
          matterName: "Demo Matter",
          matterFolder: "Demo Matter",
          startedAt: "2026-05-13T10:03:00.000Z",
          finishedAt: "2026-05-13T10:04:00.000Z",
          outputPaths: {
            markdown: "20_Workshop/Party and Officer Map.md",
            json: "20_Workshop/Party and Officer Map.json",
          },
          aiRun: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
          overwrite: "approved",
        },
      };
    },
    cancelConfigurableSkillRun: async (body) => {
      cancelCalls.push(body);
      return {
        schema_version: "configurable-skill-run/v1",
        state: "cancelled",
        artifactPath: body.artifactPath,
        skill: {
          slash: body.slash,
          title: "Party and Officer Map",
        },
        runId: "run_party_cancelled",
        runRecord: {
          id: "run_party_cancelled",
          slash: body.slash,
          title: "Party and Officer Map",
          status: "cancelled",
          matterName: "Demo Matter",
          matterFolder: "Demo Matter",
          outputPaths: {
            markdown: body.artifactPath,
            json: "20_Workshop/Party and Officer Map.json",
          },
          aiRun: {},
          overwrite: "cancelled",
        },
      };
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(runCalls, [{ slash: "/party_officer_map", overwrite: false }]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Output document already exists/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /This does not replace or edit the skill version/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Run again/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Improve this skill/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/party_officer_map modify/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Output Exists");

  await box.handleCommand({ userRequest: "open output" });
  assert.deepEqual(openCalls, [["20_Workshop/Party and Officer Map.md", "true", "markdown"]]);

  await box.handleCommand({ userRequest: "run again" });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Output document already exists/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Replace output document/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Keep existing output document/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /This does not replace or edit the skill version/i);
  assert.equal(ctx.statusCalls.at(-1).bar, "Replace Output?");

  await box.handleCommand({ userRequest: "keep current" });

  assert.deepEqual(cancelCalls, [{
    slash: "/party_officer_map",
    artifactPath: "20_Workshop/Party and Officer Map.md",
  }]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Run cancelled/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /skill version was not changed/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Copy Run Report/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Run Cancelled");
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Ask about this matter, run a skill, or search documents");

  ctx.elements.aiCommandInput.value = "/party_officer_map";
  await form.submit();
  await box.handleCommand({ userRequest: "run again" });
  await box.handleCommand({ userRequest: "replace output document" });

  assert.deepEqual(runCalls.at(-1), { slash: "/party_officer_map", overwrite: true });
  assert.match(ctx.elements.editorContent.innerHTML, /Party and Officer Map/);
  assert.match(ctx.elements.editorContent.innerHTML, /20_Workshop\/Party and Officer Map\.md/);
  assert.match(ctx.elements.editorContent.innerHTML, /run_party_overwrite/);
  assert.match(ctx.elements.editorContent.innerHTML, /Replaced existing output document/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Looks good/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Improve this skill/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Run again/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Copy Run Report/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Complete");
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Ask about this matter, run a skill, or search documents");
});

test("command box clears stale custom skill run cards on matter switch", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "/party_officer_map" });
  const box = createAiCommandBox(ctx, {
    loadSkillRegistry: async () => ({
      skills: [{
        configurable: true,
        status: "active",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        purpose: "Map formal party names and officers.",
      }],
    }),
    runConfigurableSkill: async () => ({
      schema_version: "configurable-skill-run/v1",
      state: "written",
      skill: {
        slash: "/party_officer_map",
        title: "Party and Officer Map",
      },
      markdown: "# Party and Officer Map\n\nDemo content.",
      outputPaths: {
        markdown: "20_Workshop/Party and Officer Map.md",
        json: "20_Workshop/Party and Officer Map.json",
      },
      aiRun: {
        provider: "openai-direct",
        model: "gpt-5.4",
      },
      runId: "run_party_switch",
      runRecord: {
        id: "run_party_switch",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        status: "succeeded",
        matterName: "Demo Matter",
        matterFolder: "Demo Matter",
        outputPaths: {
          markdown: "20_Workshop/Party and Officer Map.md",
          json: "20_Workshop/Party and Officer Map.json",
        },
        aiRun: {
          provider: "openai-direct",
          model: "gpt-5.4",
        },
        overwrite: "not_needed",
      },
    }),
  });

  box.wire();
  await form.submit();

  assert.match(ctx.elements.aiCommandSession.innerHTML, /Run complete/);
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.equal(ctx.elements.aiCommandCopyReport.hidden, false);

  box.resetForMatterChange();

  assert.equal(ctx.elements.aiCommandSession.hidden, true);
  assert.equal(ctx.elements.aiCommandSession.innerHTML, "");
  assert.equal(ctx.elements.aiCommandCopyReport.hidden, true);
  assert.equal(ctx.elements.aiCommandReportStatus.textContent, "");
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Ask about this matter, run a skill, or search documents");
  assert.equal(ctx.elements.aiCommandSubmit.textContent, "→");
  assert.equal(ctx.elements.aiCommandSubmit.disabled, false);
});

test("command box saves configurable skill improvement ideas without changing the active skill", async () => {
  const runCalls = [];
  const savedIdeas = [];
  const sampleCalls = [];
  const createSkillCalls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "/party_officer_map" });
  const box = createAiCommandBox(ctx, {
    loadSkillRegistry: async () => ({
      skills: [{
        configurable: true,
        status: "active",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        purpose: "Map formal party names and officers.",
      }],
    }),
    runConfigurableSkill: async (body) => {
      runCalls.push(body);
      return {
        schema_version: "configurable-skill-run/v1",
        state: "requires_overwrite",
        skill: {
          slash: "/party_officer_map",
          title: "Party and Officer Map",
        },
        artifactPath: "20_Workshop/Party and Officer Map.md",
      };
    },
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return {
        idea: {
          id: "idea_improve_party_map",
          text: body.text,
          designBrief: body.designBrief,
          status: "incomplete",
          createdAt: "2026-05-14T10:00:00.000Z",
          readiness: completeReadiness(),
        },
      };
    },
    generateSkillIdeaSampleOutput: async (body) => {
      sampleCalls.push(body);
      return {
        schema_version: "skill-sample-output/v1",
        sample_id: "sample_improve_party_map",
        generated_at: "2026-05-14T10:01:00.000Z",
        matter: {
          matter_name: "Demo Matter",
          folder_name: "Demo Matter",
        },
        idea: body.idea,
        feedback: "",
        sample_markdown: "# Party and Officer Map\n\nImproved unresolved aliases cite FILE-0001 p1.b1.",
        ai_run: {
          provider: "openai-direct",
          model: "gpt-5.4",
          task: "skill_sample_output",
        },
        warnings: [],
      };
    },
    approveSkillIdeaSample: async (ideaId, sampleId) => ({
      sample: {
        id: sampleId,
        ideaId,
        approved: true,
        approvedAt: "2026-05-14T10:02:00.000Z",
      },
    }),
    createSkillFromIdea: async (ideaId) => {
      createSkillCalls.push(ideaId);
      return {
        skill: {
          id: "skill_party_v2",
          title: "Party and Officer Map",
          slash: "/party_officer_map",
          status: "active",
          version: 2,
          previousSkillId: "skill_party_v1",
          targetLane: "20_Workshop",
          outputArtifact: "20_Workshop/Party and Officer Map.md",
          modelPolicy: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
        },
      };
    },
  });

  box.wire();
  await form.submit();
  await box.handleCommand({ userRequest: "improve this skill" });

  assert.match(ctx.elements.aiCommandSession.innerHTML, /What should this skill do better/);
  assert.equal(ctx.elements.aiCommandSubmit.textContent, "Save idea");

  await box.handleCommand({ userRequest: "include relationship confidence and unresolved aliases" });

  assert.deepEqual(runCalls, [{ slash: "/party_officer_map", overwrite: false }]);
  assert.equal(savedIdeas.length, 1);
  assert.equal(savedIdeas[0].text, "Improve /party_officer_map: include relationship confidence and unresolved aliases");
  assert.match(savedIdeas[0].designBrief.notes, /Proposal type: Improve existing skill/);
  assert.match(savedIdeas[0].designBrief.notes, /Target skill: \/party_officer_map/);
  assert.match(savedIdeas[0].designBrief.notes, /What should change: include relationship confidence and unresolved aliases/);
  assert.equal(savedIdeas[0].designBrief.expectedOutputArtifact, "20_Workshop/Party and Officer Map.md");
  assert.equal(savedIdeas[0].designBrief.targetLane, "20_Workshop");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Generate sample from this matter/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Target skill: \/party_officer_map/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Ready for Revised Sample");

  await box.handleCommand({ userRequest: "generate sample" });
  await box.handleCommand({ userRequest: "looks right" });

  assert.equal(sampleCalls.length, 1);
  assert.deepEqual(createSkillCalls, ["idea_improve_party_map"]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Skill Ready/);
  assert.match(ctx.elements.editorContent.innerHTML, /Version<\/dt><dd>2/);
});

test("command box supports slash-first configurable skill modification commands", async () => {
  const savedIdeas = [];
  const runCalls = [];
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "/party_officer_map modify include unresolved aliases and confidence",
  });
  const box = createAiCommandBox(ctx, {
    loadSkillRegistry: async () => ({
      skills: [{
        configurable: true,
        status: "active",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        outputs: ["20_Workshop/Party and Officer Map.md"],
      }],
    }),
    runConfigurableSkill: async (body) => {
      runCalls.push(body);
      throw new Error("should not run while saving a modification idea");
    },
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return {
        idea: {
          id: "idea_slash_modify",
          text: body.text,
          designBrief: body.designBrief,
          status: "incomplete",
          createdAt: "2026-05-14T10:00:00.000Z",
        },
      };
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(runCalls, []);
  assert.equal(savedIdeas.length, 1);
  assert.equal(savedIdeas[0].text, "Improve /party_officer_map: include unresolved aliases and confidence");
  assert.match(savedIdeas[0].designBrief.notes, /Target skill: \/party_officer_map/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Generate sample/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Ready for Revised Sample");
});
