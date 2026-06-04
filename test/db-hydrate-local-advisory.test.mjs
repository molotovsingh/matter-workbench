import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const advisoryHydratorPath = new URL("../scripts/db-hydrate-local-advisory.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local advisory DB hydrator dry-run maps attention items to canonical incident rows and snapshots", async () => {
  const {
    buildShadowAdvisoryPlan,
    renderShadowAdvisoryReport,
  } = await import(advisoryHydratorPath.href);

  const plan = buildShadowAdvisoryPlan({
    matterPlan: {
      tenant: { id: "tenant_local_shadow" },
      matters: [
        { id: "matter_atlas", name: "Atlas Matter", folderName: "Atlas Matter" },
      ],
    },
    attentionReport: {
      schema_version: "matter-attention-report/v1",
      generated_at: "2026-05-25T00:00:00.000Z",
      matters: [
        {
          matterName: "Atlas Matter",
          summary: { total: 2, blocker: 1, warning: 1, info: 0, state: "blocked" },
          items: [
            {
              id: "extraction-warning",
              severity: "warning",
              category: "extraction",
              code: "ocr_needs_review",
              title: "OCR text needs review",
              detail: "2 file(s) need review.",
              action: "Compare OCR text against scans.",
              evidence: [{ path: "00_Inbox/Extraction Log.csv", row: "FILE-0001" }],
              occurredAt: "2026-05-25T00:00:00.000Z",
            },
            {
              id: "source-label-blocker",
              severity: "blocker",
              category: "source_labels",
              code: "source_index_missing",
              title: "Source Index is missing",
              action: "Generate source labels.",
              evidence: [],
            },
          ],
        },
        {
          matterName: "Unmirrored Matter",
          summary: { total: 1, blocker: 0, warning: 1, info: 0, state: "attention_needed" },
          items: [{ id: "ignored", severity: "warning", category: "matter", code: "ignored", title: "Ignored" }],
        },
      ],
    },
  });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.databaseWrites, false);
  assert.equal(plan.plannedRows.incidents, 2);
  assert.equal(plan.plannedRows.preparationAdvisorySnapshots, 1);
  assert.equal(plan.totals.matters, 1);
  assert.equal(plan.totals.items, 2);
  assert.equal(plan.totals.blocker, 1);
  assert.equal(plan.totals.warning, 1);
  assert.match(plan.warnings[0], /Unmirrored Matter/);
  assert.equal(plan.matters[0].items[0].sourceType, "manual");
  assert.equal(plan.matters[0].items[0].category, "extraction");
  assert.equal(plan.matters[0].items[0].evidenceRef, "local-attention:extraction-warning 00_Inbox/Extraction Log.csv FILE-0001");

  const rendered = renderShadowAdvisoryReport(plan).join("\n");
  assert.match(rendered, /Matter Workbench local advisory DB hydration/);
  assert.match(rendered, /incidents: 2/);
  assert.match(rendered, /preparation_advisory_snapshots: 1/);
  assert.match(rendered, /Atlas Matter items=2 blockers=1 warnings=1 info=0/);
});

test("local advisory DB hydrator builds idempotent incident and append-only snapshot SQL", async () => {
  const {
    buildLocalAdvisoryHydrationSql,
  } = await import(advisoryHydratorPath.href);

  const sql = buildLocalAdvisoryHydrationSql({
    tenant: { id: "tenant_local_shadow" },
    matters: [{
      id: "matter_atlas",
      name: "Atlas Matter",
      summary: { total: 1, blocker: 0, warning: 1, info: 0, state: "attention_needed" },
      items: [{
        sourceId: "00000000-0000-5000-8000-000000000001",
        sourceType: "manual",
        category: "extraction",
        severity: "warning",
        code: "ocr_needs_review",
        title: "OCR text needs review",
        detail: "2 file(s) need review.",
        evidenceRef: "local-attention:extraction-warning FILE-0001",
      }],
    }],
  });

  assert.match(sql, /select set_config\('app\.tenant_id'/i);
  assert.match(sql, /upsert_incident\(/i);
  assert.match(sql, /source_type = 'manual'/i);
  assert.match(sql, /evidence_ref like 'local-attention:%'/i);
  assert.match(sql, /source_id <> all \(ARRAY\[/i);
  assert.match(sql, /create_preparation_advisory_snapshot\(/i);
  assert.doesNotMatch(sql, /2 file\(s\) need review\.[\s\S]*2 file\(s\) need review\./);
});

test("local advisory DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalAdvisoryHydrationPlan,
    verifyLocalAdvisoryHydration,
    inspectLocalAdvisoryHydration,
  } = await import(advisoryHydratorPath.href);
  const calls = [];
  const plan = minimalPlan();

  const applied = applyLocalAdvisoryHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });
  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.incidents, 1);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalAdvisoryHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "open_local_attention_incidents|1",
        "latest_advisory_snapshot_matters|1",
        "latest_snapshot_blockers|0",
        "latest_snapshot_warnings|1",
        "latest_snapshot_info|0",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalAdvisoryHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([{
        matter_name: "Atlas Matter",
        blocker_count: 0,
        warning_count: 1,
        info_count: 0,
        incident_count: 1,
        created_at: "2026-05-25T00:00:00.000Z",
      }]),
      stderr: "",
    }),
  });
  assert.equal(inspected.snapshots.length, 1);
  assert.equal(inspected.snapshots[0].matterName, "Atlas Matter");
  assert.equal(inspected.totals.warning, 1);
});

test("package and database docs expose local advisory shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:advisory:hydrate:dry-run"], "node scripts/db-hydrate-local-advisory.mjs --dry-run");
  assert.equal(pkg.scripts["db:advisory:hydrate"], "node scripts/db-hydrate-local-advisory.mjs --apply");
  assert.equal(pkg.scripts["db:advisory:hydrate:verify"], "node scripts/db-hydrate-local-advisory.mjs --verify");
  assert.equal(pkg.scripts["db:advisory:shadow:inspect"], "node scripts/db-hydrate-local-advisory.mjs --inspect");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:advisory:hydrate:dry-run/);
  assert.match(readme, /npm run db:advisory:hydrate:verify/);
  assert.match(readme, /npm run db:advisory:shadow:inspect/);
});

function minimalPlan() {
  return {
    tenant: { id: "tenant_local_shadow" },
    totals: {
      matters: 1,
      items: 1,
      blocker: 0,
      warning: 1,
      info: 0,
    },
    plannedRows: {
      incidents: 1,
      preparationAdvisorySnapshots: 1,
    },
    matters: [{
      id: "matter_atlas",
      name: "Atlas Matter",
      summary: { total: 1, blocker: 0, warning: 1, info: 0, state: "attention_needed" },
      items: [{
        sourceId: "00000000-0000-5000-8000-000000000001",
        sourceType: "manual",
        category: "extraction",
        severity: "warning",
        code: "ocr_needs_review",
        title: "OCR text needs review",
        detail: "2 file(s) need review.",
        evidenceRef: "local-attention:extraction-warning FILE-0001",
      }],
    }],
  };
}
