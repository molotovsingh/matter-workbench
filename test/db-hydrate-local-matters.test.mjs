import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { toCsv } from "../shared/csv.mjs";

const hydratorPath = new URL("../scripts/db-hydrate-local-matters.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local matter DB hydrator dry-run reports control-plane rows without database writes", async () => {
  const mattersHome = await mkdtemp(path.join(os.tmpdir(), "mwb-db-hydrate-"));

  try {
    await writeMatter({
      mattersHome,
      folderName: "Alpha vs Beta",
      matterJson: {
        matter_name: "Alpha vs Beta",
        client_name: "Alpha",
        opposite_party: "Beta",
        matter_type: "Consumer Dispute",
        jurisdiction: "India",
        intakes: [{
          intake_id: "INTAKE-01",
          intake_dir: "00_Inbox/Intake 01 - Initial",
          label: "Initial",
          received_date: "2026-05-20",
          file_register: "00_Inbox/Intake 01 - Initial/File Register.csv",
        }],
      },
      registerRows: [
        {
          file_id: "FILE-0001",
          intake_id: "INTAKE-01",
          source_path: "00_Inbox/Intake 01 - Initial/Source Files/agreement.pdf",
          original_name: "agreement.pdf",
          category: "PDFs",
          sha256: "sha-alpha-1",
          size_bytes: "1200",
          status: "unique",
        },
        {
          file_id: "FILE-0002",
          intake_id: "INTAKE-01",
          source_path: "00_Inbox/Intake 01 - Initial/Source Files/email.eml",
          original_name: "email.eml",
          category: "Emails",
          sha256: "sha-alpha-2",
          size_bytes: "800",
          status: "unique",
        },
      ],
      extractionRows: [
        {
          file_id: "FILE-0001",
          intake_id: "INTAKE-01",
          source_path: "00_Inbox/Intake 01 - Initial/Source Files/agreement.pdf",
          sha256: "sha-alpha-1",
          status: "extracted",
          engine: "gemini-ocr:gemini-2.5-pro",
          page_count: "3",
          ocr_applied: "yes",
          needs_review_pages: "0",
        },
      ],
      sourceIndex: {
        schema_version: "source-index/v1",
        sources: [
          {
            file_id: "FILE-0001",
            source_label: "Agreement dated 20 May 2026",
            label_status: "suggested",
            document_date: "2026-05-20",
            needs_review: false,
          },
        ],
      },
      listOfDates: {
        schema_version: "list-of-dates/v1",
        entries: [
          { date_iso: "2026-05-20", event: "Agreement signed", citation: "FILE-0001 p1.b1" },
          { date_iso: "2026-05-21", event: "Email sent", citation: "FILE-0002 p1.b1" },
        ],
      },
    });

    await writeMatter({
      mattersHome,
      folderName: "Gamma vs Delta",
      matterJson: {
        matter_name: "Gamma vs Delta",
        client_name: "Gamma",
        opposite_party: "Delta",
        intakes: [],
      },
      registerRows: [],
      extractionRows: [],
    });

    const { collectLocalMatterHydrationReport, renderHydrationReport } = await import(hydratorPath.href);
    const report = await collectLocalMatterHydrationReport({ mattersHome });

    assert.equal(report.mode, "dry-run");
    assert.equal(report.databaseWrites, false);
    assert.equal(report.mattersHome, mattersHome);
    assert.deepEqual(report.totals, {
      matters: 2,
      intakes: 1,
      registeredFiles: 2,
      extractionRows: 1,
      sourceDescriptors: 1,
      listOfDatesEntries: 2,
      importWarnings: 1,
    });
    assert.deepEqual(report.plannedRows, {
      tenants: 1,
      users: 1,
      matters: 2,
      matterIntakes: 1,
      documents: 2,
      extractionRecords: 1,
      sourceDescriptors: 1,
      matterArtifacts: 2,
      matterImportBatches: 2,
      matterImportItems: 2,
    });
    assert.equal(report.matters[0].name, "Alpha vs Beta");
    assert.equal(report.matters[0].nextFileNumber, 3);
    assert.equal(report.matters[0].artifacts.sourceIndex.present, true);
    assert.equal(report.matters[0].artifacts.listOfDates.present, true);
    assert.deepEqual(report.matters[0].warnings, []);
    assert.deepEqual(report.matters[1].warnings, ["No intakes recorded in matter.json."]);

    const rendered = renderHydrationReport(report).join("\n");
    assert.match(rendered, /mode: dry-run/);
    assert.match(rendered, /database_writes: no/);
    assert.match(rendered, /Alpha vs Beta\s+documents=2\s+extractions=1\s+source_descriptors=1\s+lod_entries=2\s+next_file_number=3/);
    assert.match(rendered, /Gamma vs Delta\s+documents=0\s+extractions=0\s+source_descriptors=0\s+lod_entries=0\s+next_file_number=1/);
  } finally {
    await rm(mattersHome, { recursive: true, force: true });
  }
});

test("local matter DB hydrator builds idempotent tenant-scoped write SQL", async () => {
  const mattersHome = await mkdtemp(path.join(os.tmpdir(), "mwb-db-hydrate-sql-"));

  try {
    await writeMatter({
      mattersHome,
      folderName: "Alpha vs Beta",
      matterJson: {
        matter_name: "Alpha vs Beta",
        client_name: "Alpha",
        opposite_party: "Beta",
        matter_type: "Consumer Dispute",
        jurisdiction: "India",
        intakes: [{
          intake_id: "INTAKE-01",
          intake_dir: "00_Inbox/Intake 01 - Initial",
          label: "Initial",
          received_date: "2026-05-20",
        }],
      },
      registerRows: [{
        file_id: "FILE-0001",
        intake_id: "INTAKE-01",
        source_path: "00_Inbox/Intake 01 - Initial/Source Files/agreement.pdf",
        original_name: "agreement.pdf",
        category: "PDFs",
        sha256: "sha-alpha-1",
        size_bytes: "1200",
        status: "unique",
      }],
      extractionRows: [{
        file_id: "FILE-0001",
        intake_id: "INTAKE-01",
        source_path: "00_Inbox/Intake 01 - Initial/Source Files/agreement.pdf",
        sha256: "sha-alpha-1",
        status: "cached",
        engine: "gemini-ocr:gemini-2.5-pro",
        page_count: "3",
        ocr_applied: "yes",
        needs_review_pages: "0",
      }],
      sourceIndex: {
        sources: [{
          file_id: "FILE-0001",
          source_label: "Agreement dated 20 May 2026",
          source_short_label: "Agreement",
          label_status: "suggested",
          document_type: "agreement",
          document_date: "2026-05-20",
          needs_review: false,
        }],
      },
      listOfDates: {
        entries: [{ date_iso: "2026-05-20", event: "Agreement signed", citation: "FILE-0001 p1.b1" }],
      },
    });

    const {
      buildLocalMatterHydrationSql,
      collectLocalMatterHydrationPlan,
    } = await import(hydratorPath.href);
    const plan = await collectLocalMatterHydrationPlan({ mattersHome });
    const sql = buildLocalMatterHydrationSql(plan);

    assert.match(sql, /begin;/i);
    assert.match(sql, /select set_config\('app\.tenant_id'/i);
    assert.match(sql, /insert into tenants/i);
    assert.match(sql, /on conflict \(id\) do update/i);
    assert.match(sql, /insert into matters/i);
    assert.match(sql, /insert into documents/i);
    assert.match(sql, /insert into extraction_records/i);
    assert.match(sql, /insert into source_descriptors/i);
    assert.match(sql, /insert into matter_import_batches/i);
    assert.match(sql, /insert into matter_import_items/i);
    assert.match(sql, /commit;/i);
    assert.doesNotMatch(sql, /Source Files\/agreement\.pdf[\s\S]*<</);
    assert.doesNotMatch(sql, /Agreement signed[\s\S]*Agreement signed/);
  } finally {
    await rm(mattersHome, { recursive: true, force: true });
  }
});

test("local matter DB hydrator apply mode uses psql and reports inserted row counts", async () => {
  const { applyLocalMatterHydrationPlan, renderHydrationReport } = await import(hydratorPath.href);
  const calls = [];

  const result = applyLocalMatterHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan: {
      tenant: { id: "00000000-0000-5000-8000-000000000001" },
      plannedRows: {
        tenants: 1,
        users: 1,
        matters: 1,
        matterIntakes: 1,
        documents: 1,
        extractionRecords: 1,
        sourceDescriptors: 1,
        matterArtifacts: 2,
        matterImportBatches: 1,
        matterImportItems: 1,
      },
      matters: [],
    },
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "INSERT 0 1\n", stderr: "" };
    },
  });

  assert.equal(result.databaseWrites, true);
  assert.equal(result.insertedRows.documents, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /psql$/);
  assert.ok(calls[0].args.includes("-v"));
  assert.ok(calls[0].args.includes("ON_ERROR_STOP=1"));
  assert.match(calls[0].input, /select set_config\('app\.tenant_id'/i);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const rendered = renderHydrationReport({
    mode: "apply",
    databaseWrites: true,
    totals: {},
    plannedRows: {},
    matters: [],
  }).join("\n");
  assert.match(rendered, /mode: apply/);
  assert.match(rendered, /database_writes: yes/);
  assert.doesNotMatch(rendered, /Apply migrations to an empty Postgres database/);
});

test("local matter DB hydrator verifies shadow row counts against local metadata", async () => {
  const {
    verifyLocalMatterHydration,
  } = await import(hydratorPath.href);
  const calls = [];
  const plan = {
    tenant: { id: "00000000-0000-5000-8000-000000000001" },
    plannedRows: {
      tenants: 1,
      users: 1,
      matters: 2,
      matterIntakes: 3,
      documents: 5,
      extractionRecords: 4,
      sourceDescriptors: 2,
      matterArtifacts: 2,
      matterImportBatches: 2,
      matterImportItems: 5,
    },
    matters: [
      { id: "11111111-1111-5111-8111-111111111111" },
      { id: "22222222-2222-5222-8222-222222222222" },
    ],
  };

  const ok = verifyLocalMatterHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return {
        status: 0,
        stdout: [
          "tenants|1",
          "users|1",
          "matters|2",
          "matter_intakes|3",
          "documents|5",
          "extraction_records|4",
          "source_descriptors|2",
          "matter_artifacts|2",
          "matter_import_batches|2",
          "matter_import_items|5",
          "",
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.equal(ok.matched, true);
  assert.deepEqual(ok.mismatches, []);
  assert.equal(ok.counts.documents, 5);
  assert.match(calls[0].command, /psql$/);
  assert.match(calls[0].input, /set_config\('app\.tenant_id'/);
  assert.match(calls[0].input, /where tenant_id = current_app_tenant_id\(\)/i);
  assert.match(calls[0].input, /matter_id = any \(array\['/i);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const mismatch = verifyLocalMatterHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: "documents|4\nmatters|2\n",
      stderr: "",
    }),
  });

  assert.equal(mismatch.matched, false);
  assert.deepEqual(mismatch.mismatches, [
    { key: "documents", expected: 5, actual: 4 },
    { key: "matter_intakes", expected: 3, actual: 0 },
    { key: "extraction_records", expected: 4, actual: 0 },
    { key: "source_descriptors", expected: 2, actual: 0 },
    { key: "matter_artifacts", expected: 2, actual: 0 },
    { key: "matter_import_batches", expected: 2, actual: 0 },
    { key: "matter_import_items", expected: 5, actual: 0 },
  ]);
});

test("local matter DB hydrator inspects shadow matter summaries without leaking secrets", async () => {
  const {
    inspectLocalMatterHydration,
    renderHydrationInspection,
  } = await import(hydratorPath.href);
  const calls = [];
  const plan = {
    tenant: { id: "00000000-0000-5000-8000-000000000001" },
  };

  const result = inspectLocalMatterHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    matterQuery: "Atlas",
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            matter_id: "11111111-1111-5111-8111-111111111111",
            matter_name: "Atlas Construction vs Diptishree",
            client_name: "Diptishree",
            opposite_party: "Atlas Construction",
            status: "active",
            next_file_number: 58,
            intakes: 1,
            documents: 57,
            extraction_records: 57,
            source_descriptors: 57,
            matter_artifacts: 2,
            matter_import_batches: 1,
            matter_import_items: 57,
          },
        ]),
        stderr: "",
      };
    },
  });

  assert.equal(result.tenantId, plan.tenant.id);
  assert.equal(result.matterQuery, "Atlas");
  assert.equal(result.matters.length, 1);
  assert.equal(result.totals.documents, 57);
  assert.equal(result.totals.matterArtifacts, 2);
  assert.equal(result.totals.matterImportBatches, 1);
  assert.equal(result.totals.matterImportItems, 57);
  assert.match(calls[0].command, /psql$/);
  assert.match(calls[0].input, /^select set_config\('app\.tenant_id'/);
  assert.match(calls[0].input, /set_config\('app\.tenant_id'/);
  assert.match(calls[0].input, /matter_import_batches/);
  assert.match(calls[0].input, /matter_import_items/);
  assert.match(calls[0].input, /Atlas/);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const rendered = renderHydrationInspection(result).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB inspection/);
  assert.match(rendered, /matter_filter: Atlas/);
  assert.match(rendered, /matter_import_batches: 1/);
  assert.match(rendered, /matter_import_items: 57/);
  assert.match(rendered, /Atlas Construction vs Diptishree documents=57 extractions=57 source_descriptors=57 artifacts=2/);
});

test("package and database docs expose the local matter hydration dry-run command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:hydrate:dry-run"], "node scripts/db-hydrate-local-matters.mjs --dry-run");
  assert.equal(pkg.scripts["db:hydrate"], "node scripts/db-hydrate-local-matters.mjs --apply");
  assert.equal(pkg.scripts["db:hydrate:verify"], "node scripts/db-hydrate-local-matters.mjs --verify");
  assert.equal(pkg.scripts["db:shadow:inspect"], "node scripts/db-hydrate-local-matters.mjs --inspect");
  assert.match(await readFile(dbReadmePath, "utf8"), /npm run db:hydrate:dry-run/);
  assert.match(await readFile(dbReadmePath, "utf8"), /npm run db:hydrate/);
  assert.match(await readFile(dbReadmePath, "utf8"), /npm run db:hydrate:verify/);
  assert.match(await readFile(dbReadmePath, "utf8"), /npm run db:shadow:inspect/);
});

async function writeMatter({
  mattersHome,
  folderName,
  matterJson,
  registerRows,
  extractionRows,
  sourceIndex = null,
  listOfDates = null,
}) {
  const matterRoot = path.join(mattersHome, folderName);
  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  await mkdir(intakeDir, { recursive: true });
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify(matterJson, null, 2)}\n`);
  await writeFile(path.join(intakeDir, "File Register.csv"), toCsv(registerRows, [
    "file_id",
    "intake_id",
    "source_path",
    "original_name",
    "category",
    "sha256",
    "size_bytes",
    "status",
  ]));
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), toCsv(extractionRows, [
    "file_id",
    "intake_id",
    "source_path",
    "sha256",
    "status",
    "engine",
    "page_count",
    "ocr_applied",
    "needs_review_pages",
  ]));
  if (sourceIndex) {
    await writeFile(path.join(matterRoot, "10_Library", "Source Index.json"), `${JSON.stringify(sourceIndex, null, 2)}\n`);
  }
  if (listOfDates) {
    await writeFile(path.join(matterRoot, "10_Library", "Case Timeline.json"), `${JSON.stringify(listOfDates, null, 2)}\n`);
    await writeFile(path.join(matterRoot, "10_Library", "Case Timeline.md"), "# List of Dates\n");
  }
}
