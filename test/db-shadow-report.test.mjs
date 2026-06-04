import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportPath = new URL("../scripts/db-shadow-report.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("shadow DB report combines matter and skill verification without leaking the database URL", async () => {
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
          nextFileNumber: 10,
        }],
        totals: {
          documents: 9,
          extractionRecords: 9,
          sourceDescriptors: 9,
          matterArtifacts: 2,
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
  });

  assert.equal(report.matched, true);
  assert.equal(report.matter.verification.matched, true);
  assert.equal(report.skills.verification.matched, true);
  assert.equal(report.matter.inspection.matters[0].matterName, "Atlas Construction vs Diptishree");
  assert.equal(report.skills.inspection.skills[0].slash, "/the_story");
  assert.deepEqual(calls.map((call) => call[0]), ["verifyMatter", "inspectMatter", "verifySkill", "inspectSkill"]);
  assert.doesNotMatch(JSON.stringify(report), /secret|db\.example|matter_workbench_shadow/);

  const rendered = renderShadowDbReport(report).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB report/);
  assert.match(rendered, /matched: yes/);
  assert.match(rendered, /matter_counts: matched/);
  assert.match(rendered, /skill_counts: matched/);
  assert.match(rendered, /Atlas Construction vs Diptishree documents=9 extractions=9 source_descriptors=9 artifacts=2/);
  assert.match(rendered, /\/the_story The Story status=active versions=1 runs=2/);
});

test("package and database docs expose the combined shadow DB report command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:report"], "node scripts/db-shadow-report.mjs");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:shadow:report/);
});
