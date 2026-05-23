import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMatterInit } from "../matter-init-engine.mjs";
import { createWorkbenchServer } from "../server.mjs";

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

function lawyerFields(overrides = {}) {
  return {
    event_type: "other",
    legal_relevance: "Supports the client's chronology because the cited source records the event.",
    issue_tags: ["chronology"],
    perspective: "client_favourable",
    ...overrides,
  };
}

function sourceDescriptorFor(packet, overrides = {}) {
  return {
    file_id: packet.file_id,
    sha256: packet.sha256,
    source_path: packet.source_path,
    display_label: "Note recording smoke event, 20 April 2026",
    short_label: "Smoke event note, 20 April 2026",
    document_type: "letter",
    document_date: "2026-04-20",
    date_basis: "body_text",
    parties: {
      from: "",
      to: [],
      cc: [],
      author: "",
      court: "",
      judge: "",
      issuing_party: "Smoke",
      recipient_party: "Opposite",
      deponent: "",
      signatory: "",
    },
    confidence: 0.86,
    needs_review: false,
    evidence: [{
      citation: packet.blocks?.[0]?.citation || `${packet.file_id} p1.b1`,
      reason: "The note text records the smoke event date.",
    }],
    warnings: [],
    ...overrides,
  };
}

test("server API smoke test keeps public routes stable", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-api-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Smoke Matter");
  const commandInteractionLogPath = path.join(tmp, "command-interactions.jsonl");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "note.txt"), "Smoke event on 20 April 2026.");
  await runMatterInit({
    matterRoot,
    dryRun: false,
    metadata: {
      clientName: "Smoke",
      matterName: "Smoke Matter",
      oppositeParty: "Opposite",
      matterType: "Test",
      jurisdiction: "Local",
      briefDescription: "",
    },
  });

  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: mattersHome,
      SKILL_INTERVIEW_PLANNER_ENABLED: "1",
      SKILL_INTERVIEW_PLANNER_PROVIDER: "openrouter",
      OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL: "openai/gpt-4.1",
    },
    host: "127.0.0.1",
    port: 0,
    commandInteractionLogPath,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
    aiProvider: async () => ({
      entries: [{
        date_iso: "2026-04-20",
        date_text: "20 April 2026",
        event: "Smoke event occurred.",
        citation: "FILE-0001 p1.b1",
        needs_review: false,
        confidence: 0.9,
        ...lawyerFields({
          event_type: "other",
          legal_relevance: "Supports the client's chronology because the cited note records the smoke event date.",
          issue_tags: ["chronology"],
        }),
      }],
    }),
    skillRouterProvider: async ({ userRequest }) => (
      /party names|officers|aliases|relationships/i.test(userRequest)
        ? {
            decision: "adjacent_skill",
            recommended_action: "adjacent_skill",
            matched_skill: "",
            confidence: 0.83,
            reason: "No existing skill directly maps formal party names and officers.",
            user_gate_required: false,
            suggested_next_action: "Continue with new skill creation.",
            mece_violation: false,
            legal_setting: {
              jurisdiction: "",
              forum: "",
              case_type: "",
              procedure_stage: "",
              side: "",
              relief_type: "",
            },
            override_requires: [],
          }
        : {
            decision: "modify_existing_skill",
            recommended_action: "modify_existing_skill",
            matched_skill: "/create_listofdates",
            confidence: 0.92,
            reason: "The request overlaps with /create_listofdates.",
            user_gate_required: false,
            suggested_next_action: "Ask for approval to modify /create_listofdates.",
            mece_violation: true,
            legal_setting: {
              jurisdiction: "",
              forum: "",
              case_type: "",
              procedure_stage: "",
              side: "",
              relief_type: "",
            },
            override_requires: ["distinct output contract"],
          }
    ),
    sourceDescriptorProvider: async ({ sources }) => ({
      sources: sources.map((source) => sourceDescriptorFor(source)),
    }),
    skillInterviewPlannerProvider: async ({ userRequest, activeMatter, skillRegistry }) => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: `Plan interview for ${userRequest}.`,
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Draft careful client communication.",
        expectedInputs: "List of Dates and lawyer instructions.",
        expectedOutputArtifact: "30_Drafts/Client Update Email.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "high",
        notes: `Matter: ${activeMatter?.matterName || "none"}. Registry skills: ${skillRegistry.length}.`,
      },
      default_assumptions: ["Client-facing email should not show raw FILE citations by default."],
      questions: [{
        id: "emailGoal",
        label: "What should the email accomplish?",
        help: "Choose the client communication goal.",
        examples: ["reassure client", "explain next steps", "request documents"],
      }],
      open_questions: [],
      risk_flags: ["External-facing draft requires lawyer review."],
    }),
    skillSampleOutputProvider: async ({ idea, matterContext }) => [
      String(idea?.text || "").toLowerCase().includes("party")
        ? "# Party and Officer Map"
        : "# Client Update Email",
      "",
      `Draft for ${matterContext.matter.matter_name}.`,
      "",
      String(idea?.text || "").toLowerCase().includes("party")
        ? "Smoke Client appears as a party through the matter metadata and FILE-0001 p1.b1."
        : `Idea: ${idea.text}.`,
    ].join("\n"),
    configurableSkillAuthoringProvider: async () => ({
      title: "Party and Officer Map",
      slash: "/party_officer_map",
      description: "Identify formal party names, officers, aliases, and relationships from source-backed matter context.",
      target_lane: "20_Workshop",
      output_artifact: "20_Workshop/Party and Officer Map.md",
      matter_required: true,
      paid_provider_call: true,
      source_backed: "required",
      prompt: "Build a source-backed party and officer map for the active matter. Identify each formal party name, officer or representative, alias, relationship, and uncertainty. Every factual row must cite readable source labels and raw FILE-NNNN pX.bY citations. Mark missing or uncertain items clearly.",
      citation_policy: "Every factual party/officer assertion must cite source labels and raw FILE-NNNN pX.bY citations.",
    }),
    configurableSkillRunProvider: async ({ matterContext }) => [
      "# Party and Officer Map",
      "",
      `Matter: ${matterContext.matter.matter_name}.`,
      "",
      "| Name | Role | Evidence |",
      "| --- | --- | --- |",
      "| Smoke | Client | Matter metadata and source context (FILE-0001 p1.b1) |",
    ].join("\n"),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.mattersHome, mattersHome);
    const matters = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(matters.matters, [{ name: "Smoke Matter" }]);
    const switched = await postJson(baseUrl, "/api/switch-matter", { name: "Smoke Matter" });
    assert.equal(switched.folderName, "Smoke Matter");
    const workspace = await getJson(baseUrl, "/api/workspace");
    assert.equal(workspace.metadata.matterName, "Smoke Matter");
    const inactiveLegacyMatter = path.join(mattersHome, "Inactive Legacy Matter");
    const inactiveLegacyDir = path.join(inactiveLegacyMatter, "00_Inbox", "Load_01_Initial");
    await mkdir(path.join(inactiveLegacyDir, "Evidence Files"), { recursive: true });
    await writeFile(path.join(inactiveLegacyMatter, "matter.json"), JSON.stringify({
      matter_name: "Inactive Legacy Matter",
    }, null, 2));
    const inactiveDoctorScan = await postJson(baseUrl, "/api/doctor/scan", { matterName: "Inactive Legacy Matter" });
    assert.equal(inactiveDoctorScan.issues[0].id, "legacy-layout");
    const inactiveMatterStatus = await getJson(baseUrl, `/api/matter-status?matter=${encodeURIComponent("Inactive Legacy Matter")}`);
    assert.equal(inactiveMatterStatus.matterName, "Inactive Legacy Matter");
    const inactiveWorkspace = await getJson(baseUrl, `/api/workspace?matter=${encodeURIComponent("Inactive Legacy Matter")}`);
    assert.equal(inactiveWorkspace.metadata.matterName, "Inactive Legacy Matter");
    const activeAfterInactiveScan = await getJson(baseUrl, "/api/workspace");
    assert.equal(activeAfterInactiveScan.metadata.matterName, "Smoke Matter");
    const extract = await postJson(baseUrl, "/api/extract", { dryRun: false });
    assert.equal(extract.counts.extracted, 1);
    const sourceDescriptors = await postJson(baseUrl, "/api/describe-sources", { dryRun: false });
    assert.equal(sourceDescriptors.counts.descriptors, 1);
    assert.equal(sourceDescriptors.outputPaths.json, "10_Library/Source Index.json");
    assert.equal(sourceDescriptors.sources[0].file_id, "FILE-0001");
    assert.equal(sourceDescriptors.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
    const listOfDates = await postJson(baseUrl, "/api/create-listofdates", { dryRun: false });
    assert.equal(listOfDates.counts.entries, 1);
    assert.equal(listOfDates.entries[0].citation, "FILE-0001 p1.b1");
    assert.equal(listOfDates.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
    const matterStatus = await getJson(baseUrl, "/api/matter-status");
    assert.deepEqual(matterStatus.stages.map((stage) => [stage.slash, stage.state]), [
      ["/matter-init", "present"],
      ["/extract", "present"],
      ["/describe_sources", "present"],
      ["/create_listofdates", "present"],
    ]);
    const prepareMatter = await getJson(baseUrl, "/api/prepare-matter");
    assert.equal(prepareMatter.schema_version, "prepare-matter-plan/v1");
    assert.deepEqual(prepareMatter.stages.map((stage) => [stage.slash, stage.action]), [
      ["/matter-init", "skip_current"],
      ["/extract", "skip_current"],
      ["/describe_sources", "skip_current"],
      ["/create_listofdates", "skip_current"],
    ]);
    assert.equal(prepareMatter.nextStep.state, "complete");
    const sourceRerunAdvice = await getJson(baseUrl, `/api/rerun-advice?skill=${encodeURIComponent("/describe_sources")}`);
    assert.equal(sourceRerunAdvice.shouldConfirm, true);
    assert.equal(sourceRerunAdvice.artifactPath, "10_Library/Source Index.json");
    assert.equal(sourceRerunAdvice.policyPromptVersion, "legal-workbench-policy/v1");
    const listRerunAdvice = await getJson(baseUrl, `/api/rerun-advice?skill=${encodeURIComponent("/create_listofdates")}`);
    assert.equal(listRerunAdvice.shouldConfirm, true);
    assert.equal(listRerunAdvice.artifactPath, "10_Library/List of Dates.md");
    assert.equal(listRerunAdvice.policyPromptVersion, "legal-workbench-policy/v1");
    const skills = await getJson(baseUrl, "/api/skills");
    assert.equal(skills.schema_version, "skill-registry/v1");
    assert.ok(Array.isArray(skills.categories));
    assert.ok(Array.isArray(skills.skills));
    assert.equal(skills.builtins, undefined);
    assert.ok(skills.skills.some((skill) => skill.slash === "/context_preview"));
    assert.ok(skills.skills.some((skill) => skill.slash === "/context_search"));
    assert.ok(skills.skills.some((skill) => skill.slash === "/prepare_matter"));
    assert.ok(skills.skills.some((skill) => skill.slash === "/create_listofdates"));
    assert.ok(skills.skills.some((skill) => skill.slash === "/describe_sources"));
    assert.equal(
      skills.skills.find((skill) => skill.slash === "/create_listofdates").runner_key,
      "/create_listofdates",
    );
    const initialIdeas = await getJson(baseUrl, "/api/skill-ideas");
    assert.equal(initialIdeas.schema_version, "skill-ideas/v1");
    assert.deepEqual(initialIdeas.ideas, []);
    const initialSkillFactoryHealth = await getJson(baseUrl, "/api/skill-factory-health");
    assert.equal(initialSkillFactoryHealth.schema_version, "skill-factory-health/v1");
    assert.equal(initialSkillFactoryHealth.state, "ok");
    assert.equal(initialSkillFactoryHealth.summary.ideas, 0);
    const inactiveMatterIdea = await postJson(baseUrl, "/api/skill-ideas", {
      text: "Create a diagnostic skill idea tied to the inactive matter.",
      matterName: "Inactive Legacy Matter",
    });
    assert.equal(inactiveMatterIdea.idea.matter.matterName, "Inactive Legacy Matter");
    const plannedInterview = await postJson(baseUrl, "/api/skill-ideas/plan-interview", {
      userRequest: "draft a warm client update email",
      skillIdea: {
        type: "skill_idea",
        mode: "new_skill",
        text: "draft a warm client update email",
        idea: "draft a warm client update email",
      },
    });
    assert.equal(plannedInterview.schema_version, "skill-interview-plan/v1");
    assert.equal(plannedInterview.planner.used, true);
    assert.equal(plannedInterview.plan.inferred_design_brief.expectedOutputArtifact, "30_Drafts/Client Update Email.md");
    assert.equal(plannedInterview.plan.questions[0].id, "emailGoal");
    const savedIdea = await postJson(baseUrl, "/api/skill-ideas", {
      text: "create a skill to summarize pleadings",
      designBrief: {
        intendedUser: "Legal team",
        problem: "Summarize pleadings.",
      },
    });
    assert.equal(savedIdea.idea.text, "create a skill to summarize pleadings");
    assert.equal(savedIdea.idea.status, "incomplete");
    assert.equal(savedIdea.idea.matter.matterName, "Smoke Matter");
    assert.equal(savedIdea.idea.matter.folderName, "Smoke Matter");
    assert.equal(savedIdea.idea.designBrief.intendedUser, "Legal team");
    assert.equal(savedIdea.idea.readiness.passedCount, 2);
    const briefIdea = await postJson(baseUrl, `/api/skill-ideas/${encodeURIComponent(savedIdea.idea.id)}/design-brief`, {
      designBrief: {
        intendedUser: "Litigation associate",
        problem: "Prepare issue-wise review notes.",
        expectedInputs: "Pleadings and annexures.",
        expectedOutputArtifact: "20_Workshop/Issue-wise Notes.md",
        targetLane: "20_Workshop",
        paidPosture: "unknown",
        riskLevel: "medium",
        notes: "Design brief only.",
      },
    });
    assert.equal(briefIdea.idea.text, "create a skill to summarize pleadings");
    assert.equal(briefIdea.idea.designBrief.targetLane, "20_Workshop");
    assert.equal(briefIdea.idea.designBrief.riskLevel, "medium");
    assert.equal(briefIdea.idea.readiness.ready, true);
    const markedIdea = await postJson(baseUrl, `/api/skill-ideas/${encodeURIComponent(savedIdea.idea.id)}/status`, {
      status: "ready_for_review",
    });
    assert.equal(markedIdea.idea.status, "ready_for_review");
    assert.equal(markedIdea.idea.designBrief.expectedOutputArtifact, "20_Workshop/Issue-wise Notes.md");
    const sampleResponse = await fetch(`${baseUrl}/api/skill-ideas/sample-output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: {
          id: savedIdea.idea.id,
          text: "draft a warm client update email",
          designBrief: {
            expectedOutputArtifact: "30_Drafts/Client Update Email.md",
          },
        },
      }),
    });
    const sampleOutput = await sampleResponse.json();
    assert.notEqual(sampleResponse.status, 405);
    assert.equal(sampleResponse.ok, true, sampleOutput.error);
    assert.equal(sampleOutput.schema_version, "skill-sample-output/v1");
    assert.equal(sampleOutput.ai_run.task, "skill_sample_output");
    assert.equal(sampleOutput.ai_run.model, "gpt-5.4");
    assert.equal(sampleOutput.ai_run.policyPromptVersion, "legal-workbench-policy/v1");
    assert.match(sampleOutput.sample_markdown, /^# Client Update Email/);
    assert.ok(sampleOutput.warnings.includes("Sample output only. Creating a skill still requires approval and validation."));
    assert.ok(sampleOutput.sample_id);

    const partyIdea = await postJson(baseUrl, "/api/skill-ideas", {
      text: "new skill: discover formal party names, officers, aliases, and relationships",
      designBrief: {
        intendedUser: "Litigation team",
        problem: "Map formal party names and officers.",
        expectedInputs: "Matter context, source labels, pleadings, notices, correspondence, and extracted records.",
        expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Every factual party/officer assertion must cite source labels and raw citations.",
      },
    });
    const partySample = await postJson(baseUrl, "/api/skill-ideas/sample-output", {
      idea: partyIdea.idea,
    });
    assert.match(partySample.sample_markdown, /^# Party and Officer Map/);
    const partySamples = await getJson(baseUrl, `/api/skill-ideas/${encodeURIComponent(partyIdea.idea.id)}/samples`);
    assert.equal(partySamples.schema_version, "skill-samples/v1");
    assert.deepEqual(partySamples.samples.map((sample) => [sample.id, sample.version, sample.state]), [
      [partySample.sample_id, 1, "current"],
    ]);
    assert.equal(partySamples.samples[0].aiRun.model, "gpt-5.4");
    assert.equal(partySamples.samples[0].aiRun.policyPromptVersion, "legal-workbench-policy/v1");
    const missingSamplesResponse = await fetch(`${baseUrl}/api/skill-ideas/${encodeURIComponent("missing_idea")}/samples`);
    const missingSamples = await missingSamplesResponse.json();
    assert.equal(missingSamplesResponse.status, 404);
    assert.match(missingSamples.error, /Skill idea not found/);
    const approvedPartySample = await postJson(
      baseUrl,
      `/api/skill-ideas/${encodeURIComponent(partyIdea.idea.id)}/samples/${encodeURIComponent(partySample.sample_id)}/approve`,
    );
    assert.equal(approvedPartySample.sample.approved, true);
    const partySamplesAfterApproval = await getJson(baseUrl, `/api/skill-ideas/${encodeURIComponent(partyIdea.idea.id)}/samples`);
    assert.equal(partySamplesAfterApproval.samples[0].state, "approved_current");
    const createdCustomSkill = await postJson(baseUrl, `/api/skill-ideas/${encodeURIComponent(partyIdea.idea.id)}/create-skill`);
    assert.equal(createdCustomSkill.skill.status, "active");
    assert.equal(createdCustomSkill.skill.slash, "/party_officer_map");
    assert.equal(createdCustomSkill.skill.outputArtifact, "20_Workshop/Party and Officer Map.md");
    const skillsAfterCustom = await getJson(baseUrl, "/api/skills");
    const customCard = skillsAfterCustom.skills.find((skill) => skill.slash === "/party_officer_map");
    assert.equal(customCard.configurable, true);
    assert.equal(customCard.status, "active");
    const pausedCustomSkill = await postJson(
      baseUrl,
      `/api/configurable-skills/${encodeURIComponent(createdCustomSkill.skill.id)}/lifecycle`,
      { action: "suspend", reason: "Smoke pause" },
    );
    assert.equal(pausedCustomSkill.skill.status, "suspended");
    const skillsAfterPause = await getJson(baseUrl, "/api/skills");
    assert.equal(skillsAfterPause.skills.some((skill) => skill.slash === "/party_officer_map"), false);
    const healthAfterPause = await getJson(baseUrl, "/api/skill-factory-health");
    assert.equal(healthAfterPause.state, "ok");
    const pausedRunResponse = await fetch(`${baseUrl}/api/configurable-skills/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slash: "/party_officer_map" }),
    });
    const pausedRun = await pausedRunResponse.json();
    assert.equal(pausedRunResponse.status, 409);
    assert.match(pausedRun.error, /paused/i);
    const missingLifecycleResponse = await fetch(`${baseUrl}/api/configurable-skills/${encodeURIComponent("extract")}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "suspend" }),
    });
    const missingLifecycle = await missingLifecycleResponse.json();
    assert.equal(missingLifecycleResponse.status, 404);
    assert.match(missingLifecycle.error, /Custom skill not found/);
    const resumedCustomSkill = await postJson(
      baseUrl,
      `/api/configurable-skills/${encodeURIComponent(createdCustomSkill.skill.id)}/lifecycle`,
      { action: "resume" },
    );
    assert.equal(resumedCustomSkill.skill.status, "active");
    const skillFactoryHealth = await getJson(baseUrl, "/api/skill-factory-health");
    assert.equal(skillFactoryHealth.schema_version, "skill-factory-health/v1");
    assert.equal(skillFactoryHealth.state, "ok");
    assert.equal(skillFactoryHealth.summary.activeSkills, 1);
    const emptyCustomRuns = await getJson(baseUrl, "/api/configurable-skills/runs");
    assert.equal(emptyCustomRuns.schema_version, "configurable-skill-runs/v1");
    assert.deepEqual(emptyCustomRuns.runs, []);
    const customRun = await postJson(baseUrl, "/api/configurable-skills/run", {
      slash: "/party_officer_map",
    });
    assert.equal(customRun.state, "written");
    assert.equal(customRun.runRecord.status, "succeeded");
    assert.equal(customRun.runRecord.matterFolder, "Smoke Matter");
    assert.equal(customRun.runRecord.receipt.receiptState, "completed");
    assert.equal(customRun.runRecord.receipt.canOpenOutput, true);
    assert.equal(customRun.outputPaths.markdown, "20_Workshop/Party and Officer Map.md");
    assert.match(customRun.markdown, /FILE-0001 p1\.b1/);
    const customMarkdown = await readFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.md"), "utf8");
    assert.match(customMarkdown, /^# Party and Officer Map/);
    const customRerun = await postJson(baseUrl, "/api/configurable-skills/run", {
      slash: "/party_officer_map",
    });
    assert.equal(customRerun.state, "requires_overwrite");
    assert.equal(customRerun.artifactPath, "20_Workshop/Party and Officer Map.md");
    const cancelledCustomRun = await postJson(baseUrl, "/api/configurable-skills/runs/cancelled", {
      slash: "/party_officer_map",
      artifactPath: customRerun.artifactPath,
    });
    assert.equal(cancelledCustomRun.state, "cancelled");
    assert.equal(cancelledCustomRun.runRecord.status, "cancelled");
    assert.equal(cancelledCustomRun.runRecord.receipt.receiptState, "cancelled");
    const customOverwrite = await postJson(baseUrl, "/api/configurable-skills/run", {
      slash: "/party_officer_map",
      overwrite: true,
    });
    assert.equal(customOverwrite.state, "written");
    assert.equal(customOverwrite.runRecord.overwrite, "approved");
    assert.equal(customOverwrite.runRecord.receipt.receiptState, "completed");
    const customRuns = await getJson(baseUrl, "/api/configurable-skills/runs?slash=/party_officer_map");
    assert.equal(customRuns.runs.length, 3);
    assert.ok(customRuns.runs.every((run) => run.receipt?.receiptState));
    assert.deepEqual(
      [...customRuns.runs.map((run) => run.status)].sort(),
      ["cancelled", "succeeded", "succeeded"],
    );
    assert.doesNotMatch(JSON.stringify(customRuns), /Smoke event on 20 April 2026|OPENAI_API_KEY|\.env/);
    const contextPreview = await getJson(baseUrl, "/api/matter-context");
    assert.equal(contextPreview.schema_version, "matter-context-preview/v1");
    assert.equal(contextPreview.counts.sources, 1);
    assert.equal(contextPreview.counts.evidence_blocks_included, 1);
    assert.ok(contextPreview.top_sources[0].sample_citations.includes("FILE-0001 p1.b1"));
    assert.doesNotMatch(JSON.stringify(contextPreview), /Smoke event on 20 April 2026/);
    const contextSearch = await getJson(baseUrl, `/api/matter-context/search?q=${encodeURIComponent("smoke event")}`);
    assert.equal(contextSearch.schema_version, "matter-context-search/v1");
    assert.equal(contextSearch.counts.matches, 1);
    assert.equal(contextSearch.results[0].citation, "FILE-0001 p1.b1");
    assert.equal(contextSearch.results[0].source_short_label, "Smoke event note, 20 April 2026");
    assert.match(contextSearch.results[0].snippet, /Smoke event/);
    const sourceIndexPath = path.join(matterRoot, "10_Library", "Source Index.json");
    const sourceIndexJson = JSON.parse(await readFile(sourceIndexPath, "utf8"));
    sourceIndexJson.sources[0].confirmed_label = "Confirmed smoke matter source";
    sourceIndexJson.sources[0].label_status = "confirmed";
    sourceIndexJson.sources[0].label_revision = 2;
    await writeFile(sourceIndexPath, `${JSON.stringify(sourceIndexJson, null, 2)}\n`);
    const refreshedListOfDates = await postJson(baseUrl, "/api/create-listofdates/refresh-labels", { dryRun: false });
    assert.equal(refreshedListOfDates.refreshMode, "label_refresh");
    assert.equal(refreshedListOfDates.counts.aiRequests, 0);
    assert.equal(refreshedListOfDates.entries[0].source_label, "Confirmed smoke matter source");
    const skillIntent = await postJson(baseUrl, "/api/skills/check-intent", {
      userRequest: "Create a new list of dates skill",
    });
    assert.equal(skillIntent.decision, "needs_user_approval");
    assert.equal(skillIntent.matched_skill, "/create_listofdates");
    const duplicateChronologyIdea = await postJson(baseUrl, "/api/skill-ideas", {
      text: "new skill: create another chronology from extraction records",
      designBrief: {
        intendedUser: "Litigation team",
        problem: "Create a cited case chronology from extraction records.",
        expectedInputs: "Extraction records and Source Index.",
        expectedOutputArtifact: "10_Library/List of Dates.md",
        targetLane: "10_Library",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "This intentionally overlaps the built-in list of dates skill.",
      },
    });
    const duplicateChronologySample = await postJson(baseUrl, "/api/skill-ideas/sample-output", {
      idea: duplicateChronologyIdea.idea,
    });
    await postJson(
      baseUrl,
      `/api/skill-ideas/${encodeURIComponent(duplicateChronologyIdea.idea.id)}/samples/${encodeURIComponent(duplicateChronologySample.sample_id)}/approve`,
    );
    const duplicateCreateResponse = await fetch(`${baseUrl}/api/skill-ideas/${encodeURIComponent(duplicateChronologyIdea.idea.id)}/create-skill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const duplicateCreatePayload = await duplicateCreateResponse.json();
    assert.equal(duplicateCreateResponse.status, 409);
    assert.match(duplicateCreatePayload.error, /This may already be covered by \/create_listofdates/);
    assert.match(duplicateCreatePayload.error, /separate custom skill/);
    const commandInteraction = await postJson(baseUrl, "/api/command-interactions", {
      typed_input: "Create a new list of dates skill",
      matched_command: "router/check",
      rendered_state: "router/check",
      status: "router_checked",
      matterName: "Inactive Legacy Matter",
      provider_run_invoked: true,
      router_decision: skillIntent,
      terminal_lines: ["[ai-command] needs_user_approval -> /create_listofdates"],
      apiKey: "sk-should-not-be-logged",
      copiedReviewPacket: "full copied packet should not be persisted",
    });
    assert.equal(commandInteraction.logged, true);
    const commandLog = await readFile(commandInteractionLogPath, "utf8");
    const commandLogRecord = JSON.parse(commandLog.trim());
    assert.equal(commandLogRecord.schema_version, "command-interaction-log/v1");
    assert.equal(commandLogRecord.matter.matter_name, "Inactive Legacy Matter");
    assert.equal(commandLogRecord.matter.folder_name, "Inactive Legacy Matter");
    assert.equal(commandLogRecord.matched_command, "router/check");
    assert.equal(commandLogRecord.router_decision.matched_skill, "/create_listofdates");
    assert.equal(commandLogRecord.provider_run_invoked, true);
    assert.doesNotMatch(commandLog, /sk-should-not-be-logged|full copied packet/);
    const doctor = await postJson(baseUrl, "/api/doctor/scan");
    assert.deepEqual(doctor.issues, []);
    const activeConfig = await getJson(baseUrl, "/api/config");
    assert.equal(activeConfig.hasActiveMatter, true);
    assert.equal(activeConfig.activeMatterName, "Smoke Matter");
    const clearedActiveMatter = await postJson(baseUrl, "/api/active-matter/clear");
    assert.deepEqual(clearedActiveMatter, { active: null });
    const mattersAfterClear = await getJson(baseUrl, "/api/matters");
    assert.equal(mattersAfterClear.active, null);
    const workspaceAfterClear = await fetch(`${baseUrl}/api/workspace`);
    const workspaceAfterClearPayload = await workspaceAfterClear.json();
    assert.equal(workspaceAfterClear.status, 409);
    assert.match(workspaceAfterClearPayload.error, /No matter is active/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("create-listofdates API route uses OpenRouter-specific config when selected", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-api-openrouter-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "OpenRouter Matter");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "notice.txt"),
    "Legal notice was issued on 20 April 2026.",
  );
  await runMatterInit({
    matterRoot,
    dryRun: false,
    metadata: {
      clientName: "OpenRouter Client",
      matterName: "OpenRouter Matter",
      oppositeParty: "Opposite",
      matterType: "Test",
      jurisdiction: "Local",
      briefDescription: "",
    },
  });

  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: mattersHome,
      SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-openrouter-route-test",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "qwen/qwen3-source-backed",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS: "1800",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS: "45000",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT: "latency",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_PROMPT_PRICE: "0.2",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_COMPLETION_PRICE: "0.8",
      OPENAI_API_KEY: "sk-openai-should-not-be-used",
      OPENAI_MODEL: "openai-model-should-not-be-used",
      OPENAI_MAX_OUTPUT_TOKENS: "999",
    },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  const realFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint === "https://openrouter.ai/api/v1/chat/completions") {
      requests.push({
        endpoint,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "qwen/qwen3-source-backed",
          provider: "route-test-provider",
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
            cost: 0.0007,
          },
          choices: [{
            message: {
              content: JSON.stringify({
                entries: [{
                  date_iso: "2026-04-20",
                  date_text: "20 April 2026",
                  event: "Legal notice was issued.",
                  citation: "FILE-0001 p1.b1",
                  needs_review: false,
                  confidence: 0.91,
                  ...lawyerFields({
                    event_type: "notice",
                    legal_relevance: "Supports the client's notice chronology because the cited source records the legal notice date.",
                    issue_tags: ["notice"],
                  }),
                }],
              }),
            },
          }],
        }),
      };
    }
    return realFetch(url, init);
  };

  try {
    await postJson(baseUrl, "/api/switch-matter", { name: "OpenRouter Matter" });
    const extract = await postJson(baseUrl, "/api/extract", { dryRun: false });
    assert.equal(extract.counts.extracted, 1);

    const listOfDates = await postJson(baseUrl, "/api/create-listofdates", {
      dryRun: false,
      model: "openai-body-model-should-not-be-used",
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, "Bearer sk-openrouter-route-test");
    assert.notEqual(requests[0].headers.authorization, "Bearer sk-openai-should-not-be-used");
    assert.equal(requests[0].body.model, "qwen/qwen3-source-backed");
    assert.equal(requests[0].body.max_tokens, 1800);
    assert.equal(requests[0].body.provider.require_parameters, true);
    assert.equal(requests[0].body.provider.allow_fallbacks, false);
    assert.equal(requests[0].body.provider.sort, "latency");
    assert.deepEqual(requests[0].body.provider.max_price, {
      prompt: 0.2,
      completion: 0.8,
    });
    assert.equal(listOfDates.counts.entries, 1);
    assert.equal(listOfDates.entries[0].citation, "FILE-0001 p1.b1");
    assert.equal(listOfDates.aiRun.provider, "openrouter");
    assert.equal(listOfDates.aiRun.model, "qwen/qwen3-source-backed");
    assert.equal(listOfDates.aiRun.returnedProvider, "route-test-provider");
    assert.equal(listOfDates.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("create-listofdates API route ignores request-body model overrides", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-api-openai-policy-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "OpenAI Policy Matter");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "notice.txt"),
    "Legal notice was issued on 20 April 2026.",
  );
  await runMatterInit({
    matterRoot,
    dryRun: false,
    metadata: {
      clientName: "OpenAI Policy Client",
      matterName: "OpenAI Policy Matter",
      oppositeParty: "Opposite",
      matterType: "Test",
      jurisdiction: "Local",
      briefDescription: "",
    },
  });

  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: mattersHome,
      OPENAI_API_KEY: "sk-openai-policy-route-test",
      OPENAI_MODEL: "policy-listofdates-route-model",
      OPENAI_MAX_OUTPUT_TOKENS: "2345",
    },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  const realFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint === "https://api.openai.com/v1/responses") {
      requests.push({
        endpoint,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify({
            entries: [{
              date_iso: "2026-04-20",
              date_text: "20 April 2026",
              event: "Legal notice was issued.",
              citation: "FILE-0001 p1.b1",
              needs_review: false,
              confidence: 0.91,
              ...lawyerFields({
                event_type: "notice",
                legal_relevance: "Supports the client's notice chronology because the cited source records the legal notice date.",
                issue_tags: ["notice"],
              }),
            }],
          }),
        }),
      };
    }
    return realFetch(url, init);
  };

  try {
    await postJson(baseUrl, "/api/switch-matter", { name: "OpenAI Policy Matter" });
    const extract = await postJson(baseUrl, "/api/extract", { dryRun: false });
    assert.equal(extract.counts.extracted, 1);

    const listOfDates = await postJson(baseUrl, "/api/create-listofdates", {
      dryRun: false,
      model: "request-body-model-should-not-be-used",
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, "Bearer sk-openai-policy-route-test");
    assert.equal(requests[0].body.model, "policy-listofdates-route-model");
    assert.equal(requests[0].body.max_output_tokens, 2345);
    assert.equal(listOfDates.aiRun.provider, "openai-direct");
    assert.equal(listOfDates.aiRun.model, "policy-listofdates-route-model");
    assert.equal(listOfDates.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("overlap check reads file registers from every intake folder", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-overlap-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Two Intake Matter");
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 02 - Follow Up"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    `file_id,sha256\nFILE-0001,${firstHash}\n`,
  );
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 02 - Follow Up", "File Register.csv"),
    `file_id,sha256\nFILE-0002,${secondHash}\n`,
  );

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const result = await postJson(baseUrl, "/api/matters/check-overlap", {
      hashes: [secondHash],
    });
    assert.deepEqual(result.warnings, [{
      matterName: "Two Intake Matter",
      overlapCount: 1,
      totalIncoming: 1,
      matterTotalFiles: 2,
      overlapPercent: 100,
    }]);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
