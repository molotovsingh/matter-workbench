import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const costHydratorPath = new URL("../scripts/db-hydrate-local-cost-events.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local cost-event DB hydrator dry-run plans spend rows from provider runs without prompts or outputs", async () => {
  const {
    buildShadowCostEventPlan,
    renderShadowCostEventReport,
  } = await import(costHydratorPath.href);

  const plan = buildShadowCostEventPlan({ providerRunPlan: providerRunPlanFixture() });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.databaseWrites, false);
  assert.deepEqual(plan.totals, {
    costEvents: 2,
    providerRunCostLinks: 2,
    warnings: 0,
  });
  assert.deepEqual(plan.plannedRows, {
    costEvents: 2,
    providerRunCostLinks: 2,
  });
  assert.equal(plan.costEvents[0].scope, "matter");
  assert.equal(plan.costEvents[0].amount, 0.04);
  assert.equal(plan.costEvents[0].currency, "USD");
  assert.equal(plan.costEvents[0].confidence, "actual");
  assert.equal(plan.costEvents[1].scope, "tenant");
  assert.equal(plan.costEvents[1].amount, null);
  assert.equal(plan.costEvents[1].confidence, "unknown");
  assert.doesNotMatch(JSON.stringify(plan), /prompt body|generated legal output|sample markdown body/i);

  const rendered = renderShadowCostEventReport(plan).join("\n");
  assert.match(rendered, /Matter Workbench local cost-event DB hydration/);
  assert.match(rendered, /cost_events: 2/);
  assert.match(rendered, /provider_run_cost_links: 2/);
});

test("local cost-event DB hydrator builds idempotent cost SQL", async () => {
  const { buildLocalCostEventHydrationSql } = await import(costHydratorPath.href);
  const sql = buildLocalCostEventHydrationSql(buildShadowCostEventPlanFixture());

  assert.match(sql, /select set_config\('app\.tenant_id'/i);
  assert.match(sql, /insert into cost_events/i);
  assert.match(sql, /provider_run_id/i);
  assert.match(sql, /on conflict \(id\) do update/i);
  assert.match(sql, /scope, amount, currency, confidence, input_tokens, output_tokens, provider, model/i);
  assert.doesNotMatch(sql, /prompt body|generated legal output|sample markdown body/i);
});

test("local cost-event DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalCostEventHydrationPlan,
    verifyLocalCostEventHydration,
    inspectLocalCostEventHydration,
  } = await import(costHydratorPath.href);
  const calls = [];
  const plan = buildShadowCostEventPlanFixture();

  const applied = applyLocalCostEventHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });
  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.costEvents, 2);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalCostEventHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "cost_events|2",
        "provider_run_cost_links|2",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalCostEventHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([
        { scope: "matter", confidence: "actual", provider: "openrouter", model: "openai/gpt-4.1", count: 1, amount: "0.04" },
        { scope: "tenant", confidence: "unknown", provider: "openai-direct", model: "gpt-5.4", count: 1, amount: null },
      ]),
      stderr: "",
    }),
  });
  assert.equal(inspected.groups.length, 2);
  assert.equal(inspected.totals.costEvents, 2);
  assert.equal(inspected.totals.actualAmount, 0.04);
});

test("package and database docs expose local cost-event shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:costs:hydrate:dry-run"], "node scripts/db-hydrate-local-cost-events.mjs --dry-run");
  assert.equal(pkg.scripts["db:costs:hydrate"], "node scripts/db-hydrate-local-cost-events.mjs --apply");
  assert.equal(pkg.scripts["db:costs:hydrate:verify"], "node scripts/db-hydrate-local-cost-events.mjs --verify");
  assert.equal(pkg.scripts["db:costs:shadow:inspect"], "node scripts/db-hydrate-local-cost-events.mjs --inspect");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:costs:hydrate:dry-run/);
  assert.match(readme, /npm run db:costs:hydrate:verify/);
  assert.match(readme, /npm run db:costs:shadow:inspect/);
});

function buildShadowCostEventPlanFixture() {
  return {
    tenant: { id: "00000000-0000-5000-8000-000000000010" },
    totals: {
      costEvents: 2,
      providerRunCostLinks: 2,
      warnings: 0,
    },
    plannedRows: {
      costEvents: 2,
      providerRunCostLinks: 2,
    },
    costEvents: [
      costEvent("00000000-0000-5000-8000-000000000201", "00000000-0000-5000-8000-000000000101", "matter_alpha", "matter", 0.04, "actual", "openrouter", "openai/gpt-4.1"),
      costEvent("00000000-0000-5000-8000-000000000202", "00000000-0000-5000-8000-000000000102", "", "tenant", null, "unknown", "openai-direct", "gpt-5.4"),
    ],
    warnings: [],
  };
}

function providerRunPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    providerRuns: [
      {
        id: "provider_run_alpha",
        tenantId: "tenant_local_shadow",
        matterId: "matter_alpha",
        provider: "openrouter",
        model: "openai/gpt-4.1",
        costAmount: 0.04,
        costCurrency: "USD",
        costConfidence: "actual",
        inputTokens: 100,
        outputTokens: 20,
        startedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "provider_run_beta",
        tenantId: "tenant_local_shadow",
        matterId: "",
        provider: "openai-direct",
        model: "gpt-5.4",
        costAmount: null,
        costCurrency: "",
        costConfidence: "unknown",
        inputTokens: null,
        outputTokens: null,
        startedAt: "2026-05-01T00:01:00.000Z",
      },
    ],
  };
}

function costEvent(id, providerRunId, matterId, scope, amount, confidence, provider, model) {
  return {
    id,
    tenantId: "00000000-0000-5000-8000-000000000010",
    providerRunId,
    matterId,
    scope,
    amount,
    currency: amount === null ? "" : "USD",
    confidence,
    inputTokens: amount === null ? null : 100,
    outputTokens: amount === null ? null : 20,
    provider,
    model,
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}
