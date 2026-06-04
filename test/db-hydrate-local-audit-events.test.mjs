import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const auditHydratorPath = new URL("../scripts/db-hydrate-local-audit-events.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local audit-event DB hydrator dry-run plans command events without raw user text", async () => {
  const {
    buildShadowAuditEventPlan,
    renderShadowAuditEventReport,
  } = await import(auditHydratorPath.href);

  const plan = buildShadowAuditEventPlan({
    matterPlan: matterPlanFixture(),
    interactions: interactionFixtures(),
  });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.databaseWrites, false);
  assert.deepEqual(plan.totals, {
    auditEvents: 2,
    matterLinkedAuditEvents: 1,
    providerInvokedAuditEvents: 1,
    warnings: 0,
  });
  assert.equal(plan.auditEvents[0].matterId, "matter_alpha");
  assert.equal(plan.auditEvents[0].action, "command.sample_generated");
  assert.equal(plan.auditEvents[0].metadata.provider_run_invoked, true);
  assert.equal(plan.auditEvents[0].metadata.has_typed_input, true);
  assert.doesNotMatch(JSON.stringify(plan), /sensitive client facts|terminal source text|router reason text|error detail/i);

  const rendered = renderShadowAuditEventReport(plan).join("\n");
  assert.match(rendered, /Matter Workbench local audit-event DB hydration/);
  assert.match(rendered, /audit_events: 2/);
  assert.match(rendered, /provider_invoked_audit_events: 1/);
});

test("local audit-event DB hydrator reads the local command log and skips blank entries", async () => {
  const { collectLocalAuditEventHydrationPlan } = await import(auditHydratorPath.href);
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-audit-hydrate-"));
  await writeFile(path.join(appDir, ".keep"), "", "utf8");
  await writeJsonl(path.join(appDir, ".local", "command-interactions.jsonl"), [
    interactionFixtures()[0],
    { timestamp: "2026-05-01T00:01:00.000Z", matter: { matter_name: "", folder_name: "" } },
  ]);

  const plan = await collectLocalAuditEventHydrationPlan({
    appDir,
    matterPlan: matterPlanFixture(),
  });

  assert.equal(plan.totals.auditEvents, 1);
  assert.equal(plan.totals.matterLinkedAuditEvents, 1);
});

test("local audit-event DB hydrator builds idempotent audit SQL", async () => {
  const { buildLocalAuditEventHydrationSql } = await import(auditHydratorPath.href);
  const sql = buildLocalAuditEventHydrationSql(buildShadowAuditEventPlanFixture());

  assert.match(sql, /select set_config\('app\.tenant_id'/i);
  assert.match(sql, /insert into audit_events/i);
  assert.match(sql, /metadata_json/i);
  assert.match(sql, /on conflict \(id\) do update/i);
  assert.doesNotMatch(sql, /sensitive client facts|terminal source text|router reason text|error detail/i);
});

test("local audit-event DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalAuditEventHydrationPlan,
    verifyLocalAuditEventHydration,
    inspectLocalAuditEventHydration,
  } = await import(auditHydratorPath.href);
  const calls = [];
  const plan = buildShadowAuditEventPlanFixture();

  const applied = applyLocalAuditEventHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });
  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.auditEvents, 2);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalAuditEventHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "audit_events|2",
        "matter_linked_audit_events|1",
        "provider_invoked_audit_events|1",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalAuditEventHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([
        { action: "command.sample_generated", provider_run_invoked: true, count: 1 },
        { action: "command.ran", provider_run_invoked: false, count: 1 },
      ]),
      stderr: "",
    }),
  });
  assert.equal(inspected.groups.length, 2);
  assert.equal(inspected.totals.auditEvents, 2);
  assert.equal(inspected.totals.providerInvokedAuditEvents, 1);
});

test("package and database docs expose local audit-event shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:audit:hydrate:dry-run"], "node scripts/db-hydrate-local-audit-events.mjs --dry-run");
  assert.equal(pkg.scripts["db:audit:hydrate"], "node scripts/db-hydrate-local-audit-events.mjs --apply");
  assert.equal(pkg.scripts["db:audit:hydrate:verify"], "node scripts/db-hydrate-local-audit-events.mjs --verify");
  assert.equal(pkg.scripts["db:audit:shadow:inspect"], "node scripts/db-hydrate-local-audit-events.mjs --inspect");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:audit:hydrate:dry-run/);
  assert.match(readme, /npm run db:audit:hydrate:verify/);
  assert.match(readme, /npm run db:audit:shadow:inspect/);
});

async function writeJsonl(filePath, rows) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function buildShadowAuditEventPlanFixture() {
  return {
    tenant: { id: "00000000-0000-5000-8000-000000000010" },
    totals: {
      auditEvents: 2,
      matterLinkedAuditEvents: 1,
      providerInvokedAuditEvents: 1,
      warnings: 0,
    },
    plannedRows: {
      auditEvents: 2,
      matterLinkedAuditEvents: 1,
      providerInvokedAuditEvents: 1,
    },
    auditEvents: [
      auditEvent("00000000-0000-5000-8000-000000000201", "matter_alpha", "command.sample_generated", true),
      auditEvent("00000000-0000-5000-8000-000000000202", "", "command.ran", false),
    ],
    warnings: [],
  };
}

function matterPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    matters: [{
      id: "matter_alpha",
      matterName: "Alpha Matter",
      folderName: "Alpha Matter",
    }],
  };
}

function interactionFixtures() {
  return [
    {
      timestamp: "2026-05-01T00:00:00.000Z",
      matter: { matter_name: "Alpha Matter", folder_name: "Alpha Matter" },
      typed_input: "sensitive client facts",
      matched_command: "skill_idea/interview",
      rendered_state: "skill_idea/sample_output",
      status: "sample_generated",
      skill_idea_id: "idea_123",
      provider_run_invoked: true,
      planner_source: "model",
      planner_model: "openai-direct / gpt-5.4",
      router_decision: {
        decision: "new_skill_candidate",
        matched_skill: "",
        confidence: 0.8,
        recommended_action: "save idea",
        reason: "router reason text",
      },
      errors: ["error detail"],
      terminal_lines: ["terminal source text"],
    },
    {
      timestamp: "2026-05-01T00:02:00.000Z",
      matter: { matter_name: "", folder_name: "" },
      typed_input: "",
      matched_command: "status",
      rendered_state: "command/status",
      status: "ran",
      provider_run_invoked: false,
    },
    {
      timestamp: "2026-05-01T00:03:00.000Z",
      matter: { matter_name: "", folder_name: "" },
      typed_input: "",
      matched_command: "",
      rendered_state: "",
      status: "",
      provider_run_invoked: false,
    },
  ];
}

function auditEvent(id, matterId, action, providerRunInvoked) {
  return {
    id,
    tenantId: "00000000-0000-5000-8000-000000000010",
    actorType: "system",
    matterId,
    action,
    targetType: "command_interaction",
    targetId: "",
    metadata: { provider_run_invoked: providerRunInvoked },
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}
