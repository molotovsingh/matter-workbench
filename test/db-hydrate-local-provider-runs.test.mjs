import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerHydratorPath = new URL("../scripts/db-hydrate-local-provider-runs.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local provider-run DB hydrator dry-run plans AI run rows without prompt or output bodies", async () => {
  const {
    buildShadowProviderRunPlan,
    renderShadowProviderRunReport,
  } = await import(providerHydratorPath.href);

  const plan = buildShadowProviderRunPlan({
    matterPlan: matterPlanFixture(),
    skillPlan: skillPlanFixture(),
  });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.databaseWrites, false);
  assert.deepEqual(plan.totals, {
    providerRuns: 3,
    matterArtifactLinks: 1,
    skillSampleLinks: 1,
    configurableSkillRunLinks: 1,
    warnings: 0,
  });
  assert.deepEqual(plan.plannedRows, {
    providerRuns: 3,
    matterArtifactProviderLinks: 1,
    skillSampleAiRunLinks: 1,
    configurableSkillRunProviderLinks: 1,
  });
  assert.equal(plan.providerRuns[0].taskClass, "native_source_skill");
  assert.equal(plan.providerRuns[0].provider, "openrouter");
  assert.equal(plan.providerRuns[0].model, "openai/gpt-4.1");
  assert.equal(plan.providerRuns[0].inputTokens, 100);
  assert.equal(plan.providerRuns[0].outputTokens, 20);
  assert.equal(plan.providerRuns[0].costAmount, 0.04);
  assert.equal(plan.providerRuns[1].costAmount, null);
  assert.equal(plan.providerRuns[1].costConfidence, "unknown");
  assert.equal(plan.skillSampleLinks[0].sampleId, "sample_alpha");
  assert.equal(plan.configurableSkillRunLinks[0].runId, "00000000-0000-5000-8000-000000000014");
  assert.doesNotMatch(JSON.stringify(plan), /generated legal output|prompt body|sample markdown body/i);

  const rendered = renderShadowProviderRunReport(plan).join("\n");
  assert.match(rendered, /Matter Workbench local provider-run DB hydration/);
  assert.match(rendered, /provider_runs: 3/);
  assert.match(rendered, /skill_sample_ai_run_links: 1/);
  assert.match(rendered, /configurable_skill_run_provider_links: 1/);
});

test("local provider-run DB hydrator builds idempotent provider and link SQL", async () => {
  const { buildLocalProviderRunHydrationSql } = await import(providerHydratorPath.href);
  const sql = buildLocalProviderRunHydrationSql(buildShadowProviderRunPlanFixture());

  assert.match(sql, /select set_config\('app\.tenant_id'/i);
  assert.match(sql, /insert into provider_runs/i);
  assert.match(sql, /output_artifact_id/i);
  assert.match(sql, /on conflict \(id\) do update/i);
  assert.doesNotMatch(sql, /update matter_artifacts[\s\S]*set provider_run_id/i);
  assert.match(sql, /update skill_samples[\s\S]*set ai_run_id/i);
  assert.match(sql, /where id = 'sample_alpha'/i);
  assert.doesNotMatch(sql, /where id = 'sample_alpha'::uuid/i);
  assert.match(sql, /update configurable_skill_runs[\s\S]*set provider_run_id/i);
  assert.doesNotMatch(sql, /prompt body|generated legal output|sample markdown body/i);
});

test("local provider-run DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalProviderRunHydrationPlan,
    verifyLocalProviderRunHydration,
    inspectLocalProviderRunHydration,
  } = await import(providerHydratorPath.href);
  const calls = [];
  const plan = buildShadowProviderRunPlanFixture();

  const applied = applyLocalProviderRunHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });
  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.providerRuns, 3);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalProviderRunHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "provider_runs|3",
        "matter_artifact_provider_links|1",
        "skill_sample_ai_run_links|1",
        "configurable_skill_run_provider_links|1",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalProviderRunHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([
        { task_class: "native_source_skill", provider: "openrouter", model: "openai/gpt-4.1", count: 1 },
        { task_class: "skill_creation", provider: "openai-direct", model: "gpt-5.4", count: 1 },
      ]),
      stderr: "",
    }),
  });
  assert.equal(inspected.groups.length, 2);
  assert.equal(inspected.totals.providerRuns, 2);
});

test("package and database docs expose local provider-run shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:provider-runs:hydrate:dry-run"], "node scripts/db-hydrate-local-provider-runs.mjs --dry-run");
  assert.equal(pkg.scripts["db:provider-runs:hydrate"], "node scripts/db-hydrate-local-provider-runs.mjs --apply");
  assert.equal(pkg.scripts["db:provider-runs:hydrate:verify"], "node scripts/db-hydrate-local-provider-runs.mjs --verify");
  assert.equal(pkg.scripts["db:provider-runs:shadow:inspect"], "node scripts/db-hydrate-local-provider-runs.mjs --inspect");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:provider-runs:hydrate:dry-run/);
  assert.match(readme, /npm run db:provider-runs:hydrate:verify/);
  assert.match(readme, /npm run db:provider-runs:shadow:inspect/);
});

function buildShadowProviderRunPlanFixture() {
  return {
    tenant: { id: "00000000-0000-5000-8000-000000000010" },
    totals: {
      providerRuns: 3,
      matterArtifactLinks: 1,
      skillSampleLinks: 1,
      configurableSkillRunLinks: 1,
      warnings: 0,
    },
    plannedRows: {
      providerRuns: 3,
      matterArtifactProviderLinks: 1,
      skillSampleAiRunLinks: 1,
      configurableSkillRunProviderLinks: 1,
    },
    providerRuns: [
      {
        ...providerRun("00000000-0000-5000-8000-000000000101", "matter_alpha", "native_source_skill", "openrouter", "openai/gpt-4.1"),
        outputArtifactId: "00000000-0000-5000-8000-000000000201",
      },
      providerRun("00000000-0000-5000-8000-000000000102", "matter_alpha", "skill_creation", "openai-direct", "gpt-5.4"),
      providerRun("00000000-0000-5000-8000-000000000103", "matter_alpha", "skill_execution", "openai-direct", "gpt-5.4"),
    ],
    matterArtifactLinks: [{ artifactId: "00000000-0000-5000-8000-000000000201", providerRunId: "00000000-0000-5000-8000-000000000101" }],
    skillSampleLinks: [{ sampleId: "sample_alpha", providerRunId: "00000000-0000-5000-8000-000000000102" }],
    configurableSkillRunLinks: [{ runId: "00000000-0000-5000-8000-000000000014", providerRunId: "00000000-0000-5000-8000-000000000103" }],
    warnings: [],
  };
}

function matterPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    matters: [{
      id: "matter_alpha",
      folderName: "Alpha Matter",
      artifacts: {
        sourceIndex: {
          present: true,
          path: "10_Library/Source Index.json",
          generatedAt: "2026-05-01T00:00:00.000Z",
          aiRun: {
            provider: "openrouter",
            model: "openai/gpt-4.1",
            task: "source_description",
            policyPromptVersion: "legal-workbench-policy/v1",
            policyVersion: "model-policy/v1-current",
            usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cost: 0.04 },
          },
        },
        listOfDates: { present: false, path: "" },
      },
    }],
  };
}

function skillPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    samples: [{
      id: "sample_alpha",
      matterId: "matter_alpha",
      createdAt: "2026-05-01T00:01:00.000Z",
      aiRun: {
        provider: "openai-direct",
        model: "gpt-5.4",
        task: "skill_sample_output",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
      sampleMarkdown: "sample markdown body",
    }],
    runs: [{
      id: "00000000-0000-5000-8000-000000000014",
      localId: "run_alpha",
      matterId: "matter_alpha",
      status: "succeeded",
      startedAt: "2026-05-01T00:02:00.000Z",
      finishedAt: "2026-05-01T00:03:00.000Z",
      aiRun: {
        provider: "openai-direct",
        model: "gpt-5.4",
        task: "configurable_skill_run",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
    }],
  };
}

function providerRun(id, matterId, taskClass, provider, model) {
  return {
    id,
    tenantId: "00000000-0000-5000-8000-000000000010",
    matterId,
    taskClass,
    provider,
    model,
    policyPromptVersion: "legal-workbench-policy/v1",
    promptVersion: "model-policy/v1-current",
    status: "succeeded",
    errorCode: "",
    errorMessage: "",
    usageJson: {},
    inputTokens: null,
    outputTokens: null,
    costAmount: null,
    costCurrency: "",
    costConfidence: "unknown",
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:00:00.000Z",
  };
}
