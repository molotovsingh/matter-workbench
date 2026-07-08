import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const jobHydratorPath = new URL("../scripts/db-hydrate-local-jobs.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local job DB hydrator dry-run creates processing jobs only from provider-run evidence", async () => {
  const {
    buildShadowJobPlan,
    renderShadowJobReport,
  } = await import(jobHydratorPath.href);

  const plan = buildShadowJobPlan({
    matterPlan: matterPlanFixture(),
    providerRunPlan: providerRunPlanFixture(),
  });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.databaseWrites, false);
  assert.deepEqual(plan.totals, {
    processingJobs: 4,
    providerRunJobLinks: 4,
    warnings: 0,
  });
  assert.deepEqual(plan.plannedRows, {
    processingJobs: 4,
    providerRunJobLinks: 4,
  });
  assert.equal(plan.processingJobs[0].kind, "source_labels");
  assert.equal(plan.processingJobs[1].kind, "list_of_dates");
  assert.equal(plan.processingJobs[2].kind, "custom_skill");
  assert.equal(plan.processingJobs[3].status, "running");
  assert.equal(plan.providerRunJobLinks[0].providerRunId, "provider_source");
  assert.doesNotMatch(JSON.stringify(plan), /prompt body|generated legal output|bounded packet/i);

  const rendered = renderShadowJobReport(plan).join("\n");
  assert.match(rendered, /Matter Workbench local job DB hydration/);
  assert.match(rendered, /processing_jobs: 4/);
  assert.match(rendered, /provider_run_job_links: 4/);
});

test("local job DB hydrator skips provider runs without a hosted job kind instead of inventing outbox events", async () => {
  const { buildShadowJobPlan } = await import(jobHydratorPath.href);
  const plan = buildShadowJobPlan({
    matterPlan: matterPlanFixture(),
    providerRunPlan: {
      tenant: { id: "tenant_local_shadow" },
      providerRuns: [{
        id: "provider_copilot",
        tenantId: "tenant_local_shadow",
        matterId: "matter_alpha",
        taskClass: "copilot",
        status: "succeeded",
      }],
    },
  });

  assert.equal(plan.totals.processingJobs, 0);
  assert.equal(plan.totals.warnings, 1);
  assert.match(plan.warnings[0], /No processing job kind for provider run provider_copilot/);
});

test("local job DB hydrator builds idempotent processing-job SQL and links provider runs", async () => {
  const { buildLocalJobHydrationSql } = await import(jobHydratorPath.href);
  const sql = buildLocalJobHydrationSql(buildShadowJobPlanFixture());

  assert.match(sql, /select set_config\('app\.tenant_id'/i);
  assert.match(sql, /insert into processing_jobs/i);
  assert.match(sql, /on conflict \(id\) do update/i);
  assert.match(sql, /update provider_runs[\s\S]*set job_id/i);
  assert.doesNotMatch(sql, /insert into job_outbox/i);
  assert.doesNotMatch(sql, /prompt body|generated legal output|bounded packet/i);
});

test("local job DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalJobHydrationPlan,
    verifyLocalJobHydration,
    inspectLocalJobHydration,
  } = await import(jobHydratorPath.href);
  const calls = [];
  const plan = buildShadowJobPlanFixture();

  const applied = applyLocalJobHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });
  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.processingJobs, 4);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalJobHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "processing_jobs|4",
        "provider_run_job_links|4",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalJobHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([
        { kind: "source_labels", status: "succeeded", count: 1 },
        { kind: "custom_skill", status: "running", count: 1 },
      ]),
      stderr: "",
    }),
  });
  assert.equal(inspected.groups.length, 2);
  assert.equal(inspected.totals.processingJobs, 2);
});

test("package and database docs expose local job shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:jobs:hydrate:dry-run"], "node scripts/db-hydrate-local-jobs.mjs --dry-run");
  assert.equal(pkg.scripts["db:jobs:hydrate"], "node scripts/db-hydrate-local-jobs.mjs --apply");
  assert.equal(pkg.scripts["db:jobs:hydrate:verify"], "node scripts/db-hydrate-local-jobs.mjs --verify");
  assert.equal(pkg.scripts["db:jobs:shadow:inspect"], "node scripts/db-hydrate-local-jobs.mjs --inspect");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:jobs:hydrate:dry-run/);
  assert.match(readme, /npm run db:jobs:hydrate:verify/);
  assert.match(readme, /npm run db:jobs:shadow:inspect/);
});

function buildShadowJobPlanFixture() {
  return {
    tenant: { id: "00000000-0000-5000-8000-000000000010" },
    totals: {
      processingJobs: 4,
      providerRunJobLinks: 4,
      warnings: 0,
    },
    plannedRows: {
      processingJobs: 4,
      providerRunJobLinks: 4,
    },
    processingJobs: [
      processingJob("00000000-0000-5000-8000-000000000201", "provider_source", "source_labels", "succeeded"),
      processingJob("00000000-0000-5000-8000-000000000202", "provider_lod", "list_of_dates", "succeeded"),
      processingJob("00000000-0000-5000-8000-000000000203", "provider_skill", "custom_skill", "failed"),
      processingJob("00000000-0000-5000-8000-000000000204", "provider_running", "custom_skill", "running"),
    ],
    providerRunJobLinks: [
      { providerRunId: "provider_source", jobId: "00000000-0000-5000-8000-000000000201" },
      { providerRunId: "provider_lod", jobId: "00000000-0000-5000-8000-000000000202" },
      { providerRunId: "provider_skill", jobId: "00000000-0000-5000-8000-000000000203" },
      { providerRunId: "provider_running", jobId: "00000000-0000-5000-8000-000000000204" },
    ],
    warnings: [],
  };
}

function matterPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    matters: [{
      id: "matter_alpha",
      artifacts: {
        sourceIndex: { present: true, path: "10_Library/Source Index.json" },
        listOfDates: { present: true, path: "10_Library/Case Timeline.json" },
      },
    }],
  };
}

function providerRunPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    providerRuns: [
      providerRun("provider_source", "native_source_skill", "succeeded", nativeArtifactId("matter_alpha", "source_index")),
      providerRun("provider_lod", "native_source_skill", "succeeded", nativeArtifactId("matter_alpha", "list_of_dates")),
      providerRun("provider_skill", "skill_execution", "failed", ""),
      providerRun("provider_running", "skill_creation", "started", ""),
    ],
  };
}

function providerRun(id, taskClass, status, outputArtifactId) {
  return {
    id,
    tenantId: "tenant_local_shadow",
    matterId: "matter_alpha",
    taskClass,
    status,
    outputArtifactId,
    errorCode: status === "failed" ? "provider_failed" : "",
    errorMessage: status === "failed" ? "provider failed" : "",
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: status === "started" ? "" : "2026-05-01T00:01:00.000Z",
  };
}

function processingJob(id, providerRunId, kind, status) {
  return {
    id,
    tenantId: "00000000-0000-5000-8000-000000000010",
    matterId: "matter_alpha",
    kind,
    status,
    idempotencyKey: `local-shadow:provider-run:${providerRunId}`,
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: status === "running" ? "" : "2026-05-01T00:01:00.000Z",
    errorCode: status === "failed" ? "provider_failed" : "",
    errorMessage: status === "failed" ? "provider failed" : "",
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}

function nativeArtifactId(matterId, family) {
  return deterministicUuid(`artifact:${matterId}:${family}:json`);
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
