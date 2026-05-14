import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  activityPageSummary,
  renderActivityPageHtml,
} from "../frontend/views/activity-page.js";
import {
  formatConfigurableSkillRunReport,
  formatSkillFactoryHealthReport,
  formatSkillIdeaImplementationBrief,
  formatSkillIdeaReviewPacket,
  renderSkillsPageHtml,
  skillsPageSummary,
} from "../frontend/views/skills-page.js";

function registryFixture() {
  return {
    schema_version: "skill-registry/v1",
    skills: [
      {
        id: "extract",
        slash: "/extract",
        title: "Extract",
        purpose: "Convert working-copy documents into extraction records.",
        mode: "deterministic",
        matter_required: true,
        paid_provider_call: false,
        rerun_guarded: false,
        default_lane: "00_Inbox",
        runner_key: "/extract",
        inputs: ["working copy files"],
        outputs: ["extraction-record/v1"],
        upstream: ["/matter-init"],
      },
      {
        id: "create_listofdates",
        slash: "/create_listofdates",
        title: "Create List of Dates",
        purpose: "Build a cited legal chronology.",
        mode: "AI",
        matter_required: true,
        paid_provider_call: true,
        rerun_guarded: true,
        default_lane: "10_Library",
        runner_key: "/create_listofdates",
        inputs: ["extraction-record/v1"],
        outputs: ["10_Library/List of Dates.md", "10_Library/List of Dates.json"],
        upstream: ["/extract"],
      },
    ],
  };
}

test("skills page renders built-in skill governance metadata and matter artifact status", () => {
  const summary = skillsPageSummary(registryFixture(), {
    matterName: "Mehta vs Skyline",
    stages: [
      {
        slash: "/extract",
        present: true,
        artifacts: ["00_Inbox/Intake 01 - Initial/_extracted (10 records)"],
      },
      {
        slash: "/create_listofdates",
        present: true,
        artifacts: ["10_Library/List of Dates.md"],
        aiRun: {
          provider: "openrouter",
          returnedProvider: "Friendli",
          model: "openai/gpt-4.1",
        },
      },
    ],
  });

  assert.equal(summary.builtins.length, 2);
  assert.equal(summary.paidAi.length, 1);
  assert.equal(summary.deterministic.length, 1);

  const html = renderSkillsPageHtml({
    registry: registryFixture(),
    matterStatus: {
      matterName: "Mehta vs Skyline",
      stages: [
        {
          slash: "/extract",
          present: true,
          artifacts: ["00_Inbox/Intake 01 - Initial/_extracted (10 records)"],
        },
        {
          slash: "/create_listofdates",
          present: true,
          artifacts: ["10_Library/List of Dates.md"],
          aiRun: {
            returnedProvider: "Friendli",
            model: "openai/gpt-4.1",
          },
        },
      ],
    },
    skillIdeas: {
      schema_version: "skill-ideas/v1",
      ideas: [
        {
          id: "idea_test_1",
          text: "create a skill to summarize pleadings",
          createdAt: "2026-05-12T10:00:00.000Z",
          updatedAt: "2026-05-12T10:00:00.000Z",
          status: "incomplete",
          matter: {
            matterName: "Mehta vs Skyline",
            folderName: "Mehta vs Skyline",
          },
          designBrief: {
            intendedUser: "Litigation associate",
            problem: "Turn pleadings into issue-wise review notes.",
            expectedInputs: "Pleadings, replies, and annexures.",
            expectedOutputArtifact: "20_Workshop/Issue-wise Pleadings Summary.md",
            targetLane: "20_Workshop",
            paidPosture: "paid",
            riskLevel: "medium",
            notes: "Design only. Not runnable yet.",
          },
          readiness: {
            state: "ready_for_review",
            ready: true,
            passedCount: 8,
            totalCount: 8,
            items: [
              { key: "intendedUser", label: "Intended user present", passed: true },
              { key: "problem", label: "Problem/job present", passed: true },
              { key: "expectedInputs", label: "Expected inputs present", passed: true },
              { key: "expectedOutputArtifact", label: "Expected output artifact present", passed: true },
              { key: "targetLane", label: "Target lane selected", passed: true },
              { key: "paidPosture", label: "Paid/free posture selected", passed: true },
              { key: "riskLevel", label: "Risk level selected", passed: true },
              { key: "notes", label: "Notes or acceptance criteria present", passed: true },
            ],
          },
        },
        {
          id: "idea_test_2",
          text: "new skill bundle exhibits",
          createdAt: "2026-05-12T11:00:00.000Z",
          updatedAt: "2026-05-12T11:05:00.000Z",
          status: "parked",
          matter: {
            matterName: "",
            folderName: "",
          },
        },
      ],
    },
    skillFactoryHealth: {
      schema_version: "skill-factory-health/v1",
      checkedAt: "2026-05-13T18:00:00.000Z",
      state: "ok",
      summary: {
        ideas: 2,
        samples: 1,
        configurableSkills: 0,
        activeSkills: 0,
        errors: 0,
        warnings: 0,
      },
      checks: [
        { id: "sample_links", label: "Samples point to existing ideas", state: "ok" },
        { id: "output_lanes", label: "Configurable skill outputs stay inside allowed lanes", state: "ok" },
      ],
      issues: [],
    },
    activeMatter: { folderName: "Mehta vs Skyline" },
  }, escapeHtml);

  assert.match(html, /Skill Factory Health/);
  assert.match(html, /Read-only check of saved ideas, samples, and stored skill records/);
  assert.match(html, /Stored custom skill records/);
  assert.match(html, /Stored active versions/);
  assert.match(html, /No store integrity issues observed/);
  assert.match(html, /Copy Health Report/);
  assert.match(html, /data-skill-factory-copy-health/);
  assert.match(html, /Saved Ideas/);
  assert.match(html, /create a skill to summarize pleadings/);
  assert.match(html, /new skill bundle exhibits/);
  assert.match(html, /Design brief/);
  assert.match(html, /Not runnable yet/);
  assert.match(html, /data-skill-idea-brief-form/);
  assert.match(html, /Litigation associate/);
  assert.match(html, /Turn pleadings into issue-wise review notes\./);
  assert.match(html, /20_Workshop\/Issue-wise Pleadings Summary\.md/);
  assert.match(html, /value="20_Workshop" selected/);
  assert.match(html, /value="paid" selected/);
  assert.match(html, /value="medium" selected/);
  assert.match(html, /Save design brief/);
  assert.match(html, /Readiness checklist/);
  assert.match(html, /Ready for review/);
  assert.match(html, /Incomplete 0\/8/);
  assert.match(html, /Copy Review Packet/);
  assert.match(html, /data-skill-idea-copy-packet/);
  assert.match(html, /Copy Implementation Brief/);
  assert.match(html, /data-skill-idea-copy-implementation-brief/);
  assert.match(html, /Mark ready for review/);
  assert.match(html, /Park idea/);
  assert.match(html, /Dismiss/);
  assert.match(html, /Parked/);
  assert.match(html, /Built-in Skills/);
  assert.match(html, /Custom Skills/);
  assert.match(html, /Only the latest approved version is shown as runnable/);
  assert.match(html, /Paid AI Skills/);
  assert.match(html, /Deterministic Skills/);
  assert.match(html, /Coming Later: Skill Builder Expansion/);
  assert.match(html, /\/extract/);
  assert.match(html, /\/create_listofdates/);
  assert.match(html, /Paid\/provider-backed/);
  assert.match(html, /Deterministic\/local/);
  assert.match(html, /10_Library\/List of Dates\.md/);
  assert.match(html, /Friendli/);
  assert.match(html, /openai\/gpt-4\.1/);
  assert.doesNotMatch(html, /Create draft skill|Activate draft|API_KEY|\.env|Generate prompt/);
});

test("skills page health report is copyable and excludes secrets", () => {
  const report = formatSkillFactoryHealthReport({
    state: "warning",
    checkedAt: "2026-05-13T18:00:00.000Z",
    summary: {
      ideas: 1,
      samples: 2,
      configurableSkills: 1,
      activeSkills: 1,
      errors: 0,
      warnings: 1,
    },
    checks: [
      { id: "stores_readable", label: "Skill factory stores are readable JSON", state: "ok" },
    ],
    issues: [
      { severity: "warning", code: "active_skill_validation_status", message: "Active skill missing passed validation metadata." },
    ],
  });

  assert.match(report, /^# Skill Factory Health Report/);
  assert.match(report, /State: warning/);
  assert.match(report, /Stored custom skill records: 1/);
  assert.match(report, /Stored active versions: 1/);
  assert.doesNotMatch(report, /Active skills:/);
  assert.match(report, /Active skill missing passed validation metadata/);
  assert.match(report, /read-only health report/i);
  assert.doesNotMatch(report, /API_KEY|\.env|full extraction records|raw source text/i);
});

test("skills page renders active custom skills as active", () => {
  const html = renderSkillsPageHtml({
    registry: {
      schema_version: "skill-registry/v1",
      skills: [
        ...registryFixture().skills,
        {
          schema_version: "configurable-skill/v1",
          id: "skill_party",
          slash: "/party_officer_map",
          title: "Party and Officer Map",
          purpose: "Map formal party names, officers, aliases, and relationships.",
          mode: "AI",
          matter_required: true,
          paid_provider_call: true,
          rerun_guarded: true,
          default_lane: "20_Workshop",
          runner_key: "/party_officer_map",
          inputs: ["matter-context-packet/v1"],
          outputs: ["20_Workshop/Party and Officer Map.md"],
          upstream: ["idea_party", "sample_party"],
          configurable: true,
          status: "active",
        },
      ],
    },
    matterStatus: null,
    skillIdeas: {
      schema_version: "skill-ideas/v1",
      ideas: [
        {
          id: "idea_improve_party",
          text: "Improve /party_officer_map: include relationship confidence and unresolved aliases",
          createdAt: "2026-05-14T10:00:00.000Z",
          updatedAt: "2026-05-14T10:00:00.000Z",
          status: "incomplete",
          matter: {
            matterName: "Ayesha Vs Japan Airlines",
            folderName: "Ayesha Vs Japan Airlines",
          },
          designBrief: {
            intendedUser: "Lawyer improving an active custom skill",
            problem: "Improve Party and Officer Map based on real use.",
            expectedInputs: "Existing active skill /party_officer_map.",
            expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
            targetLane: "20_Workshop",
            paidPosture: "paid",
            riskLevel: "medium",
            notes: [
              "Proposal type: Improve existing skill",
              "Target skill: /party_officer_map",
              "What should change: include relationship confidence and unresolved aliases",
              "What must stay unchanged: Do not change the active skill yet.",
            ].join("\n"),
          },
          readiness: {
            state: "ready_for_review",
            ready: true,
            passedCount: 8,
            totalCount: 8,
            items: [],
          },
        },
        {
          id: "idea_other",
          text: "Improve /statute_section_reading_guide: add deeper rules",
          createdAt: "2026-05-14T09:00:00.000Z",
          updatedAt: "2026-05-14T09:00:00.000Z",
          status: "incomplete",
          matter: {},
          designBrief: {
            notes: "Target skill: /statute_section_reading_guide",
          },
        },
      ],
    },
  }, escapeHtml);
  const customSection = html.slice(
    html.indexOf("<h2>Custom Skills"),
    html.indexOf("<h2>Built-in Skills"),
  );

  assert.match(html, /Custom Skills/);
  assert.match(html, /\/party_officer_map/);
  assert.match(html, /Party and Officer Map/);
  assert.match(html, /Active/);
  assert.match(html, /20_Workshop\/Party and Officer Map\.md/);
  assert.match(customSection, /Suggested improvements/);
  assert.match(customSection, /include relationship confidence and unresolved aliases/);
  assert.match(customSection, /Ayesha Vs Japan Airlines/);
  assert.match(customSection, /href="#skill-idea-idea_improve_party"/);
  assert.match(customSection, /data-skill-idea-copy-packet data-skill-idea-id="idea_improve_party"/);
  assert.match(customSection, /data-skill-idea-status="dismissed"/);
  assert.doesNotMatch(customSection, /add deeper rules/);
  assert.doesNotMatch(html, /Recent runs/);
  assert.doesNotMatch(html, /Copy Latest Run Report/);
  assert.doesNotMatch(html, /Party and Officer Map[\s\S]{0,200}Incomplete/);
});

test("skills page promotes latest duplicate custom skill and keeps older copy in history", () => {
  const configurableSkills = {
    schema_version: "configurable-skills/v1",
    skills: [
      {
        schema_version: "configurable-skill/v1",
        id: "skill_party_1",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        description: "Map formal party names and officers.",
        status: "active",
        version: 1,
        createdAt: "2026-05-14T09:00:00.000Z",
        activatedAt: "2026-05-14T09:00:00.000Z",
        targetLane: "20_Workshop",
        outputArtifact: "20_Workshop/Party and Officer Map.md",
        matterRequired: true,
        paidProviderCall: true,
        sourceBacked: "required",
      },
      {
        schema_version: "configurable-skill/v1",
        id: "skill_party_2",
        slash: "/party_officer_map_2",
        title: "Party and Officer Map",
        description: "Map formal party names, officers, aliases, and confidence.",
        status: "active",
        version: 1,
        createdAt: "2026-05-14T10:00:00.000Z",
        activatedAt: "2026-05-14T10:00:00.000Z",
        targetLane: "20_Workshop",
        outputArtifact: "20_Workshop/Party and Officer Map.md",
        matterRequired: true,
        paidProviderCall: true,
        sourceBacked: "required",
      },
    ],
  };
  const summary = skillsPageSummary(registryFixture(), null, configurableSkills);
  const html = renderSkillsPageHtml({
    registry: registryFixture(),
    configurableSkills,
  }, escapeHtml);
  const customSection = html.slice(
    html.indexOf("<h2>Custom Skills"),
    html.indexOf("<h2>Built-in Skills"),
  );

  assert.equal(summary.custom.length, 1);
  assert.equal(summary.allCustom.length, 2);
  assert.equal(summary.custom[0].slash, "/party_officer_map_2");
  assert.match(customSection, /<div class="skill-slash"><code>\/party_officer_map_2<\/code><\/div>/);
  assert.doesNotMatch(customSection, /<div class="skill-slash"><code>\/party_officer_map<\/code><\/div>/);
  assert.match(customSection, /<strong>v1 - Superseded<\/strong>/);
  assert.match(customSection, /Latest runnable version: <code>\/party_officer_map_2<\/code>/);
});

test("skills page renders custom skill version lineage from configurable store", () => {
  const configurableSkills = {
    schema_version: "configurable-skills/v1",
    skills: [
      {
        schema_version: "configurable-skill/v1",
        id: "skill_party_v1",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        description: "Map formal party names and officers.",
        status: "disabled",
        version: 1,
        familyId: "skill_party_v1",
        replacedBySkillId: "skill_party_v2",
        sourceIdeaId: "idea_party",
        sourceSampleId: "sample_party_v1",
        targetLane: "20_Workshop",
        outputArtifact: "20_Workshop/Party and Officer Map.md",
        matterRequired: true,
        paidProviderCall: true,
        sourceBacked: "required",
      },
      {
        schema_version: "configurable-skill/v1",
        id: "skill_party_v2",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        description: "Map formal party names, officers, aliases, and confidence.",
        status: "active",
        version: 2,
        familyId: "skill_party_v1",
        previousSkillId: "skill_party_v1",
        sourceIdeaId: "idea_party_improve",
        sourceSampleId: "sample_party_v2",
        targetLane: "20_Workshop",
        outputArtifact: "20_Workshop/Party and Officer Map.md",
        matterRequired: true,
        paidProviderCall: true,
        sourceBacked: "required",
      },
    ],
  };
  const summary = skillsPageSummary(registryFixture(), null, configurableSkills);
  const html = renderSkillsPageHtml({
    registry: registryFixture(),
    configurableSkills,
    configurableSkillRuns: {
      schema_version: "configurable-skill-runs/v1",
      runs: [
        {
          id: "run_party_v1",
          skillId: "skill_party_v1",
          slash: "/party_officer_map",
          title: "Party and Officer Map",
          matterName: "Ayesha Vs Japan Airlines",
          matterFolder: "Ayesha Vs Japan Airlines",
          status: "succeeded",
          startedAt: "2026-05-14T09:00:00.000Z",
          outputPaths: {
            markdown: "20_Workshop/Party and Officer Map.md",
          },
        },
        {
          id: "run_party_v2",
          skillId: "skill_party_v2",
          slash: "/party_officer_map",
          title: "Party and Officer Map",
          matterName: "Mehta vs Skyline",
          matterFolder: "Mehta vs Skyline",
          status: "succeeded",
          startedAt: "2026-05-14T11:00:00.000Z",
          outputPaths: {
            markdown: "20_Workshop/Party and Officer Map.md",
          },
        },
      ],
    },
    skillIdeas: {
      schema_version: "skill-ideas/v1",
      ideas: [
        {
          id: "idea_party",
          text: "new skill: discover formal party names, officers, aliases, and relationships",
          matter: {
            matterName: "Ayesha Vs Japan Airlines",
            folderName: "Ayesha Vs Japan Airlines",
          },
          designBrief: {
            problem: "Map formal party names and officers.",
          },
        },
        {
          id: "idea_party_improve",
          text: "Improve /party_officer_map: include relationship confidence and unresolved aliases",
          matter: {
            matterName: "Mehta vs Skyline",
            folderName: "Mehta vs Skyline",
          },
          designBrief: {
            notes: "Target skill: /party_officer_map\nWhat should change: include relationship confidence and unresolved aliases",
          },
        },
      ],
    },
  }, escapeHtml);
  const customSection = html.slice(
    html.indexOf("<h2>Custom Skills"),
    html.indexOf("<h2>Built-in Skills"),
  );

  assert.equal(summary.custom.length, 1);
  assert.equal(summary.allCustom.length, 2);
  assert.deepEqual(summary.custom.map((skill) => [skill.id, skill.status, skill.version]), [
    ["skill_party_v2", "active", 2],
  ]);
  assert.match(customSection, /Active/);
  assert.match(customSection, /Disabled/);
  assert.match(customSection, /<dt>Version<\/dt><dd>v2<\/dd>/);
  assert.match(customSection, /<strong>v1 - Disabled<\/strong>/);
  assert.match(customSection, /<dt>Previous<\/dt><dd>v1 \(disabled\)<\/dd>/);
  assert.doesNotMatch(customSection, /<dt>Replaced by<\/dt><dd>v2 \(active\)<\/dd>/);
  assert.match(customSection, /Version history/);
  assert.match(customSection, /Latest runnable version: <code>\/party_officer_map<\/code>/);
  assert.match(customSection, /\/party_officer_map modify/);
  assert.match(customSection, /include relationship confidence and unresolved aliases/);
  assert.match(customSection, /discover formal party names, officers, aliases, and relationships/);
  assert.match(customSection, /<dt>Latest run<\/dt><dd>Mehta vs Skyline - Succeeded<\/dd>/);
  assert.match(customSection, /<dt>Review matter<\/dt><dd>Mehta vs Skyline<\/dd>/);
  assert.match(customSection, /<dt>Last run<\/dt><dd>Ayesha Vs Japan Airlines - Succeeded<\/dd>/);
  assert.match(customSection, /<dt>Validation<\/dt><dd>Unknown<\/dd>/);
  assert.doesNotMatch(customSection, /Create draft skill|Activate draft|Generate prompt/);
});

test("activity page renders custom skill run receipts separately from skills governance", () => {
  const runs = {
    schema_version: "configurable-skill-runs/v1",
    runs: [
      {
        id: "run_party_1",
        skillId: "skill_party",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        matterName: "Ayesha Vs Japan Airlines",
        matterFolder: "Ayesha Vs Japan Airlines",
        status: "succeeded",
        startedAt: "2026-05-14T10:00:00.000Z",
        finishedAt: "2026-05-14T10:01:00.000Z",
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
      {
        id: "run_party_2",
        skillId: "skill_party",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        matterName: "Mehta vs Skyline",
        matterFolder: "Mehta vs Skyline",
        status: "cancelled",
        startedAt: "2026-05-14T10:03:00.000Z",
        finishedAt: "2026-05-14T10:03:10.000Z",
        outputPaths: {
          markdown: "20_Workshop/Party and Officer Map.md",
          json: "20_Workshop/Party and Officer Map.json",
        },
        overwrite: "cancelled",
      },
    ],
  };
  const summary = activityPageSummary(runs);
  const html = renderActivityPageHtml({
    configurableSkillRuns: runs,
    activeMatter: { folderName: "Ayesha Vs Japan Airlines" },
  }, escapeHtml);

  assert.equal(summary.total, 2);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.cancelled, 1);
  assert.match(html, /Activity/);
  assert.match(html, /Custom Skill Runs/);
  assert.match(html, /Party and Officer Map/);
  assert.match(html, /Ayesha Vs Japan Airlines/);
  assert.match(html, /Mehta vs Skyline/);
  assert.match(html, /Case Analysis \/ Party and Officer Map\.md/);
  assert.match(html, /Replaced existing output document/);
  assert.match(html, /Cancelled - kept existing output document/);
  assert.doesNotMatch(html, />Overwrite</);
  assert.match(html, /Copy report/);
  assert.match(html, /data-configurable-run-copy="run_party_1"/);
  assert.match(html, /Details/);
  assert.match(html, /openai-direct \/ gpt-5\.4/);
  assert.doesNotMatch(html, /API_KEY|\.env|raw source text|# should not appear/i);
});

test("custom skill run report is copyable and excludes work product", () => {
  const report = formatConfigurableSkillRunReport({
    id: "run_party_1",
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    status: "succeeded",
    startedAt: "2026-05-14T10:00:00.000Z",
    finishedAt: "2026-05-14T10:01:00.000Z",
    outputPaths: {
      markdown: "20_Workshop/Party and Officer Map.md",
      json: "20_Workshop/Party and Officer Map.json",
    },
    aiRun: {
      provider: "openai-direct",
      model: "gpt-5.4",
      task: "configurable_skill_run",
    },
    overwrite: "approved",
    warnings: ["bounded context omitted 10 blocks"],
    sampleMarkdown: "# should not appear",
    rawSourceText: "should not appear",
  });

  assert.match(report, /^# Custom Skill Run Report/);
  assert.match(report, /- Status: succeeded/);
  assert.match(report, /- Slash command: \/party_officer_map/);
  assert.match(report, /- Provider\/model: openai-direct \/ gpt-5\.4/);
  assert.match(report, /- Output document: Replaced existing output document/);
  assert.doesNotMatch(report, /- Overwrite:/);
  assert.match(report, /20_Workshop\/Party and Officer Map\.md/);
  assert.match(report, /bounded context omitted 10 blocks/);
  assert.match(report, /does not include raw source text, full extraction records/i);
  assert.doesNotMatch(report, /should not appear|API_KEY|\.env/i);
});

test("skill idea implementation brief classifies client-update email as a new skill", () => {
  const packet = formatSkillIdeaImplementationBrief({
    id: "idea_client_email",
    text: "new skill: draft a warm client update email after reading List of Dates",
    status: "ready_for_review",
    matter: {
      matterName: "Ayesha vs Japan Airlines",
      folderName: "Ayesha Vs Japan Airlines",
    },
    designBrief: {
      intendedUser: "Lawyer preparing client communication",
      problem: "Draft a warm client update email after reading List of Dates.",
      expectedInputs: "10_Library/List of Dates.md, Source Index, matter metadata.",
      expectedOutputArtifact: "30_Drafts/Client Update Email.md",
      targetLane: "30_Drafts",
      paidPosture: "paid",
      riskLevel: "high",
      notes: "Client-facing draft. Do not send automatically.",
    },
  }, registryFixture());

  assert.match(packet, /^# Skill Idea Implementation Brief/);
  assert.match(packet, /- Proposal type: New skill/);
  assert.match(packet, /- Title: Client Update Email/);
  assert.match(packet, /- Proposed slash command: \/client_update_email/);
  assert.match(packet, /- Output artifact: 30_Drafts\/Client Update Email\.md/);
  assert.match(packet, /- Target lane: 30_Drafts/);
  assert.match(packet, /Client-facing draft; lawyer must review before sending/);
  assert.match(packet, /do not expose raw FILE-NNNN pX\.bY citations/i);
  assert.match(packet, /## Acceptance Tests/);
  assert.match(packet, /A client-update idea is classified as a new skill, not a List of Dates modification/);
  assert.match(packet, /## Non-Goals/);
  assert.match(packet, /Do not send email/);
  assert.doesNotMatch(packet, /Target existing skill: \/create_listofdates/);
  assert.doesNotMatch(packet, /API_KEY|OPENAI_API_KEY|MISTRAL_API_KEY|\.env|BEGIN EXTRACTION RECORD|raw document text/i);
});

test("skill idea implementation brief keeps party and officer mapping as a new skill", () => {
  const packet = formatSkillIdeaImplementationBrief({
    id: "idea_party_map",
    text: "new skill: discover formal party names, officers, aliases, and relationships",
    status: "incomplete",
    designBrief: {
      intendedUser: "Paralegal",
      problem: "Discover formal party names, officers, aliases, and relationships.",
      expectedInputs: "Matter context, pleadings, correspondence, and contracts.",
      expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "high",
      notes: "Every identity claim must cite sources.",
    },
  }, registryFixture());

  assert.match(packet, /- Proposal type: New skill/);
  assert.match(packet, /- Title: Party and Officer Map/);
  assert.match(packet, /- Proposed slash command: \/party_officer_map/);
  assert.match(packet, /20_Workshop\/Party and Officer Map\.md/);
  assert.match(packet, /Every formal name, officer, alias, role, and relationship must cite readable source labels plus raw FILE-NNNN pX\.bY citations/);
  assert.match(packet, /A party\/officer-name idea is classified as a new skill, not a List of Dates modification/);
  assert.doesNotMatch(packet, /Proposal type: Improve existing skill/);
  assert.doesNotMatch(packet, /Target existing skill: \/create_listofdates/);
});

test("skill idea implementation brief classifies limitation flags as a list-of-dates modification", () => {
  const packet = formatSkillIdeaImplementationBrief({
    id: "idea_lod_limitation",
    text: "modify skill: make List of Dates also flag limitation issues",
    status: "ready_for_review",
    designBrief: {
      intendedUser: "Litigation associate",
      problem: "Make List of Dates also flag limitation issues.",
      expectedInputs: "Existing Create List of Dates inputs and current source-backed chronology.",
      expectedOutputArtifact: "10_Library/List of Dates.md",
      targetLane: "10_Library",
      paidPosture: "paid",
      riskLevel: "high",
      notes: [
        "Target skill: /create_listofdates.",
        "What should change: add limitation flags.",
        "What must stay unchanged: preserve raw citations and readable source labels.",
      ].join("\n"),
    },
  }, registryFixture());

  assert.match(packet, /- Proposal type: Improve existing skill/);
  assert.match(packet, /- Target existing skill: \/create_listofdates/);
  assert.match(packet, /### What Should Change/);
  assert.match(packet, /Add limitation-aware review signals/);
  assert.match(packet, /### What Must Stay Unchanged/);
  assert.match(packet, /Raw FILE-NNNN pX\.bY citations remain canonical/);
  assert.match(packet, /### Regression Tests Required/);
  assert.match(packet, /A fixture with no limitation issue does not invent one/);
  assert.match(packet, /## Acceptance Tests/);
  assert.match(packet, /Implementation decision is explicit/);
  assert.match(packet, /## Non-Goals/);
  assert.match(packet, /Do not replace the existing target skill output silently/);
  assert.match(packet, /separate review artifact/i);
});

test("skill idea review packet includes governance fields without source text or secrets", () => {
  const packet = formatSkillIdeaReviewPacket({
    id: "idea_test_1",
    text: "can list of dates also flag limitation issues",
    createdAt: "2026-05-12T10:00:00.000Z",
    updatedAt: "2026-05-12T10:00:00.000Z",
    status: "ready_for_review",
    matter: {
      matterName: "Mehta vs Skyline",
      folderName: "Mehta vs Skyline",
    },
    designBrief: {
      intendedUser: "Litigation associate",
      problem: "Explore whether Create List of Dates should flag limitation issues.",
      expectedInputs: "Existing Create List of Dates inputs and source-backed matter artifacts.",
      expectedOutputArtifact: "10_Library/List of Dates.md",
      targetLane: "10_Library",
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: [
        "Target skill: /create_listofdates. Not runnable yet.",
        "Interview answers:",
        "- What should change?: Add limitation flags.",
        "- What must stay unchanged?: Preserve raw citations.",
      ].join("\n"),
    },
    readiness: {
      state: "ready_for_review",
      ready: true,
      passedCount: 8,
      totalCount: 8,
      items: [
        { key: "intendedUser", label: "Intended user present", passed: true },
        { key: "problem", label: "Problem/job present", passed: true },
        { key: "expectedInputs", label: "Expected inputs present", passed: true },
        { key: "expectedOutputArtifact", label: "Expected output artifact present", passed: true },
        { key: "targetLane", label: "Target lane selected", passed: true },
        { key: "paidPosture", label: "Paid/free posture selected", passed: true },
        { key: "riskLevel", label: "Risk level selected", passed: true },
        { key: "notes", label: "Notes or acceptance criteria present", passed: true },
      ],
    },
  }, registryFixture());

  assert.match(packet, /^# Skill Idea Review Packet/);
  assert.match(packet, /- Idea id: idea_test_1/);
  assert.match(packet, /- Status: Ready for review/);
  assert.match(packet, /- Checklist: Complete/);
  assert.match(packet, /- Suggested classification: modification candidate \(\/create_listofdates\)/);
  assert.match(packet, /- Matter: Mehta vs Skyline/);
  assert.match(packet, /- Matter folder: Mehta vs Skyline/);
  assert.match(packet, /## Original User Text/);
  assert.match(packet, /can list of dates also flag limitation issues/);
  assert.match(packet, /- Target lane: 10_Library/);
  assert.match(packet, /- Expected output artifact: 10_Library\/List of Dates\.md/);
  assert.match(packet, /- Risk level: medium/);
  assert.match(packet, /Target skill: \/create_listofdates/);
  assert.match(packet, /- \[x\] Intended user present/);
  assert.match(packet, /Confirm whether this should be free\/local or paid\/provider-backed/);
  assert.match(packet, /This is not a runnable skill\. No prompt, code, or provider call has been generated\./);
  assert.doesNotMatch(packet, /API_KEY|OPENAI_API_KEY|MISTRAL_API_KEY|\.env|BEGIN EXTRACTION RECORD|raw document text/i);
});

test("skill idea review packet does not treat background mentions as modifications", () => {
  const packet = formatSkillIdeaReviewPacket({
    id: "idea_test_2",
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    status: "incomplete",
    designBrief: {
      intendedUser: "Legal team",
      problem: "Summarises the best case pleadings for the lawyer.",
      expectedInputs: "Pleadings, replies, annexures, and source-backed extraction records.",
      expectedOutputArtifact: "20_Workshop/Pleadings Summary.md",
      targetLane: "20_Workshop",
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: "Use List of Dates as optional background context, but create a separate review artifact.",
    },
  }, registryFixture());

  assert.match(packet, /- Status: Incomplete - ready to mark for review/);
  assert.match(packet, /- Checklist: Complete/);
  assert.match(packet, /- Suggested classification: new skill idea/);
  assert.doesNotMatch(packet, /modification candidate|adjacent skill improvement/);
});

test("skills page supports no-matter planning mode without an error", () => {
  const html = renderSkillsPageHtml({
    registry: registryFixture(),
    activeMatter: { folderName: "" },
  }, escapeHtml);

  assert.match(html, /planning mode/i);
  assert.match(html, /No matter is selected/);
  assert.match(html, /No saved skill ideas yet/);
  assert.match(html, /\/extract/);
  assert.doesNotMatch(html, /form-error/);
});
