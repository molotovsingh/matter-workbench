import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportPath = new URL("../scripts/db-shadow-report.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("shadow DB report combines matter, skill, advisory, storage, provider-run, job, cost, and audit verification without leaking the database URL", async () => {
  const {
    buildShadowDbReport,
    renderShadowDbReport,
  } = await import(reportPath.href);
  const calls = [];

  const report = await buildShadowDbReport({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    matterPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { matters: 1 },
    },
    skillPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { configurableSkills: 1 },
    },
    advisoryPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { incidents: 2 },
    },
    storagePlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { storageObjects: 3 },
    },
    providerRunPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { providerRuns: 2 },
    },
    jobPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { processingJobs: 2 },
    },
    costEventPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { costEvents: 2 },
    },
    auditEventPlan: {
      tenant: { id: "tenant_local_shadow" },
      plannedRows: { auditEvents: 2 },
    },
    verifyMatter: ({ databaseUrl, plan }) => {
      calls.push(["verifyMatter", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { matters: 1, documents: 9 },
        counts: { matters: 1, documents: 9 },
        mismatches: [],
      };
    },
    inspectMatter: ({ databaseUrl, plan, matterQuery }) => {
      calls.push(["inspectMatter", databaseUrl, plan.tenant.id, matterQuery]);
      return {
        matters: [{
          matterName: "Atlas Construction vs Diptishree",
          documents: 9,
          extractionRecords: 9,
          sourceDescriptors: 9,
          matterArtifacts: 2,
          matterImportBatches: 1,
          matterImportItems: 9,
          nextFileNumber: 10,
        }],
        totals: {
          documents: 9,
          extractionRecords: 9,
          sourceDescriptors: 9,
          matterArtifacts: 2,
          matterImportBatches: 1,
          matterImportItems: 9,
        },
      };
    },
    verifySkill: ({ databaseUrl, plan }) => {
      calls.push(["verifySkill", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { configurable_skills: 1, configurable_skill_runs: 2 },
        counts: { configurable_skills: 1, configurable_skill_runs: 2 },
        mismatches: [],
      };
    },
    inspectSkill: ({ databaseUrl, plan, slashQuery }) => {
      calls.push(["inspectSkill", databaseUrl, plan.tenant.id, slashQuery]);
      return {
        skills: [{
          slash: "/the_story",
          title: "The Story",
          status: "active",
          versionCount: 1,
          runCount: 2,
        }],
        totals: {
          configurableSkills: 1,
          configurableSkillVersions: 1,
          configurableSkillRuns: 2,
        },
      };
    },
    verifyAdvisory: ({ databaseUrl, plan }) => {
      calls.push(["verifyAdvisory", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { open_local_attention_incidents: 2, latest_advisory_snapshot_matters: 1 },
        counts: { open_local_attention_incidents: 2, latest_advisory_snapshot_matters: 1 },
        mismatches: [],
      };
    },
    inspectAdvisory: ({ databaseUrl, plan }) => {
      calls.push(["inspectAdvisory", databaseUrl, plan.tenant.id]);
      return {
        snapshots: [{
          matterName: "Atlas Construction vs Diptishree",
          blocker: 0,
          warning: 2,
          info: 0,
          incidentCount: 2,
        }],
        totals: {
          blocker: 0,
          warning: 2,
          info: 0,
          incidents: 2,
        },
      };
    },
    verifyStorage: ({ databaseUrl, plan }) => {
      calls.push(["verifyStorage", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { storage_objects: 3, document_blobs: 2 },
        counts: { storage_objects: 3, document_blobs: 2 },
        mismatches: [],
      };
    },
    inspectStorage: ({ databaseUrl, plan }) => {
      calls.push(["inspectStorage", databaseUrl, plan.tenant.id]);
      return {
        roles: [
          { objectRole: "source_original", count: 1 },
          { objectRole: "source_working_copy", count: 1 },
          { objectRole: "matter_artifact", count: 1 },
        ],
        totals: { storageObjects: 3 },
      };
    },
    verifyProviderRuns: ({ databaseUrl, plan }) => {
      calls.push(["verifyProviderRuns", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { provider_runs: 2, skill_sample_ai_run_links: 1 },
        counts: { provider_runs: 2, skill_sample_ai_run_links: 1 },
        mismatches: [],
      };
    },
    inspectProviderRuns: ({ databaseUrl, plan }) => {
      calls.push(["inspectProviderRuns", databaseUrl, plan.tenant.id]);
      return {
        groups: [
          { taskClass: "native_source_skill", provider: "openrouter", model: "openai/gpt-4.1", count: 1 },
          { taskClass: "skill_creation", provider: "openai-direct", model: "gpt-5.4", count: 1 },
        ],
        totals: { providerRuns: 2 },
      };
    },
    verifyJobs: ({ databaseUrl, plan }) => {
      calls.push(["verifyJobs", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { processing_jobs: 2, provider_run_job_links: 2 },
        counts: { processing_jobs: 2, provider_run_job_links: 2 },
        mismatches: [],
      };
    },
    inspectJobs: ({ databaseUrl, plan }) => {
      calls.push(["inspectJobs", databaseUrl, plan.tenant.id]);
      return {
        groups: [
          { kind: "source_labels", status: "succeeded", count: 1 },
          { kind: "custom_skill", status: "running", count: 1 },
        ],
        totals: { processingJobs: 2 },
      };
    },
    verifyCostEvents: ({ databaseUrl, plan }) => {
      calls.push(["verifyCostEvents", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { cost_events: 2, provider_run_cost_links: 2 },
        counts: { cost_events: 2, provider_run_cost_links: 2 },
        mismatches: [],
      };
    },
    inspectCostEvents: ({ databaseUrl, plan }) => {
      calls.push(["inspectCostEvents", databaseUrl, plan.tenant.id]);
      return {
        groups: [
          { scope: "matter", confidence: "actual", provider: "openrouter", model: "openai/gpt-4.1", count: 1, amount: 0.04 },
          { scope: "tenant", confidence: "unknown", provider: "openai-direct", model: "gpt-5.4", count: 1, amount: null },
        ],
        totals: { costEvents: 2, actualAmount: 0.04 },
      };
    },
    verifyAuditEvents: ({ databaseUrl, plan }) => {
      calls.push(["verifyAuditEvents", databaseUrl, plan.tenant.id]);
      return {
        matched: true,
        expected: { audit_events: 2, provider_invoked_audit_events: 1 },
        counts: { audit_events: 2, provider_invoked_audit_events: 1 },
        mismatches: [],
      };
    },
    inspectAuditEvents: ({ databaseUrl, plan }) => {
      calls.push(["inspectAuditEvents", databaseUrl, plan.tenant.id]);
      return {
        groups: [
          { action: "command.sample_generated", providerRunInvoked: true, count: 1 },
          { action: "command.ran", providerRunInvoked: false, count: 1 },
        ],
        totals: { auditEvents: 2, providerInvokedAuditEvents: 1 },
      };
    },
  });

  assert.equal(report.matched, true);
  assert.equal(report.matter.verification.matched, true);
  assert.equal(report.skills.verification.matched, true);
  assert.equal(report.advisory.verification.matched, true);
  assert.equal(report.storage.verification.matched, true);
  assert.equal(report.providerRuns.verification.matched, true);
  assert.equal(report.jobs.verification.matched, true);
  assert.equal(report.costEvents.verification.matched, true);
  assert.equal(report.auditEvents.verification.matched, true);
  assert.equal(report.matter.inspection.matters[0].matterName, "Atlas Construction vs Diptishree");
  assert.equal(report.skills.inspection.skills[0].slash, "/the_story");
  assert.deepEqual(calls.map((call) => call[0]), [
    "verifyMatter",
    "inspectMatter",
    "verifySkill",
    "inspectSkill",
    "verifyAdvisory",
    "inspectAdvisory",
    "verifyStorage",
    "inspectStorage",
    "verifyProviderRuns",
    "inspectProviderRuns",
    "verifyJobs",
    "inspectJobs",
    "verifyCostEvents",
    "inspectCostEvents",
    "verifyAuditEvents",
    "inspectAuditEvents",
  ]);
  assert.doesNotMatch(JSON.stringify(report), /secret|db\.example|matter_workbench_shadow/);

  const rendered = renderShadowDbReport(report).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB report/);
  assert.match(rendered, /matched: yes/);
  assert.match(rendered, /matter_counts: matched/);
  assert.match(rendered, /matter_import_batches: 1/);
  assert.match(rendered, /matter_import_items: 9/);
  assert.match(rendered, /skill_counts: matched/);
  assert.match(rendered, /advisory_counts: matched/);
  assert.match(rendered, /storage_counts: matched/);
  assert.match(rendered, /provider_run_counts: matched/);
  assert.match(rendered, /job_counts: matched/);
  assert.match(rendered, /cost_event_counts: matched/);
  assert.match(rendered, /audit_event_counts: matched/);
  assert.match(rendered, /Atlas Construction vs Diptishree documents=9 extractions=9 source_descriptors=9 artifacts=2 import_batches=1 import_items=9/);
  assert.match(rendered, /\/the_story The Story status=active versions=1 runs=2/);
  assert.match(rendered, /Atlas Construction vs Diptishree blockers=0 warnings=2 info=0 incidents=2/);
  assert.match(rendered, /source_original: 1/);
  assert.match(rendered, /source_working_copy: 1/);
  assert.match(rendered, /native_source_skill openrouter\/openai\/gpt-4.1: 1/);
  assert.match(rendered, /skill_creation openai-direct\/gpt-5.4: 1/);
  assert.match(rendered, /source_labels succeeded: 1/);
  assert.match(rendered, /custom_skill running: 1/);
  assert.match(rendered, /matter actual openrouter\/openai\/gpt-4.1: count=1 amount=0.04/);
  assert.match(rendered, /tenant unknown openai-direct\/gpt-5.4: count=1 amount=/);
  assert.match(rendered, /command\.sample_generated provider_invoked=true: 1/);
  assert.match(rendered, /command\.ran provider_invoked=false: 1/);
});

test("package and database docs expose the combined shadow DB report command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:report"], "node scripts/db-shadow-report.mjs");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:shadow:report/);
});
