#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { parseCsv } from "../shared/csv.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);

const SOURCE_INDEX_RELATIVE = path.join("10_Library", "Source Index.json");
const LIST_OF_DATES_JSON_RELATIVE = path.join("10_Library", "List of Dates.json");
const LIST_OF_DATES_MARKDOWN_RELATIVE = path.join("10_Library", "List of Dates.md");

export function parseArgs(argv = []) {
  const parsed = {
    dryRun: true,
    json: false,
    mattersHome: defaultMattersHome(),
    verify: false,
    inspect: false,
    matterQuery: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--apply") {
      parsed.dryRun = false;
      parsed.verify = false;
    } else if (arg === "--verify") {
      parsed.dryRun = true;
      parsed.verify = true;
      parsed.inspect = false;
    } else if (arg === "--inspect") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = true;
    } else if (arg === "--matter") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matter requires a value");
      parsed.matterQuery = value;
      i += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export function defaultMattersHome(env = process.env) {
  return path.resolve(
    env.MWB_MATTERS_HOME
    || env.MATTERS_HOME
    || path.join(os.homedir(), "matters-matter-workbench"),
  );
}

export async function collectLocalMatterHydrationReport({ mattersHome = defaultMattersHome() } = {}) {
  return hydrationReportFromPlan(await collectLocalMatterHydrationPlan({ mattersHome }));
}

export async function collectLocalMatterHydrationPlan({ mattersHome = defaultMattersHome() } = {}) {
  const matterRoots = await listMatterRoots(mattersHome);
  const matters = [];

  for (const matterRoot of matterRoots) {
    matters.push(await summarizeMatter(matterRoot));
  }

  const totals = matters.reduce((acc, matter) => {
    acc.matters += 1;
    acc.intakes += matter.intakes.length;
    acc.registeredFiles += matter.counts.registeredFiles;
    acc.extractionRows += matter.counts.extractionRows;
    acc.sourceDescriptors += matter.counts.sourceDescriptors;
    acc.listOfDatesEntries += matter.counts.listOfDatesEntries;
    acc.importWarnings += matter.warnings.length;
    return acc;
  }, emptyTotals());

  const matterArtifacts = matters.reduce((sum, matter) => sum + Number(matter.artifacts.sourceIndex.present) + Number(matter.artifacts.listOfDates.present), 0);
  return {
    mode: "dry-run",
    databaseWrites: false,
    mattersHome,
    tenant: {
      id: deterministicUuid("tenant:local-shadow"),
      name: "Matter Workbench Local Shadow",
      type: "internal_test",
    },
    user: {
      id: deterministicUuid("user:local-shadow"),
      email: "local-shadow@mwb.local",
      name: "Local Shadow User",
    },
    totals,
    plannedRows: {
      tenants: 1,
      users: 1,
      matters: totals.matters,
      matterIntakes: totals.intakes,
      documents: totals.registeredFiles,
      extractionRecords: totals.extractionRows,
      sourceDescriptors: totals.sourceDescriptors,
      matterArtifacts,
      matterImportBatches: totals.matters,
      matterImportItems: totals.registeredFiles,
    },
    matters,
  };
}

export function hydrationReportFromPlan(plan = {}) {
  return {
    mode: plan.mode || "dry-run",
    databaseWrites: Boolean(plan.databaseWrites),
    mattersHome: plan.mattersHome || "",
    totals: plan.totals || emptyTotals(),
    plannedRows: plan.plannedRows || {},
    matters: (plan.matters || []).map((matter) => ({
      name: matter.name,
      folderName: matter.folderName,
      metadata: matter.metadata,
      intakes: matter.intakes,
      counts: matter.counts,
      nextFileNumber: matter.nextFileNumber,
      artifacts: matter.artifacts,
      warnings: matter.warnings,
    })),
  };
}

export function buildLocalMatterHydrationSql(plan = {}) {
  const tenant = plan.tenant || { id: deterministicUuid("tenant:local-shadow"), name: "Matter Workbench Local Shadow", type: "internal_test" };
  const user = plan.user || { id: deterministicUuid("user:local-shadow"), email: "local-shadow@mwb.local", name: "Local Shadow User" };
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenant.id)}, true);`,
    `insert into users (id, email, name, status) values (${sqlString(user.id)}, ${sqlString(user.email)}, ${sqlString(user.name)}, 'active') on conflict (email) do update set name = excluded.name, status = excluded.status;`,
    `insert into tenants (id, name, type, status) values (${sqlString(tenant.id)}, ${sqlString(tenant.name)}, ${sqlString(tenant.type || "internal_test")}, 'active') on conflict (id) do update set name = excluded.name, type = excluded.type, status = excluded.status;`,
    `insert into tenant_memberships (id, tenant_id, user_id, role, status) values (${sqlString(deterministicUuid(`tenant-membership:${tenant.id}:${user.id}`))}, ${sqlString(tenant.id)}, ${sqlString(user.id)}, 'owner', 'active') on conflict (tenant_id, user_id) do update set role = excluded.role, status = excluded.status;`,
  ];

  for (const matter of plan.matters || []) {
    appendMatterSql(lines, { tenant, user, matter });
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalMatterHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying shadow hydration.");
  const sql = buildLocalMatterHydrationSql(plan);
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw new Error(`psql failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  return {
    databaseWrites: true,
    insertedRows: plan?.plannedRows || {},
    stdout: result.stdout || "",
  };
}

export function buildShadowHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Hydration plan is missing tenant.id.");
  const matterIdsSql = sqlUuidArray(plannedMatterIds(plan));
  const countQueries = shadowHydrationCountKeys().map(([key, tableName, matterColumn]) => (
    [
      `select ${sqlString(key)} as key, count(*)::int as count from ${tableName}`,
      "where tenant_id = current_app_tenant_id()",
      `  and ${matterColumn} = any (${matterIdsSql})`,
    ].join("\n")
  ));
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    `${countQueries.join("\nunion all\n")};`,
    "",
  ].join("\n");
}

export function verifyLocalMatterHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying shadow hydration.");
  const sql = buildShadowHydrationCountSql(plan);
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw new Error(`psql failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }

  const counts = parseShadowHydrationCounts(result.stdout || "");
  const expected = expectedShadowHydrationCounts(plan);
  const mismatches = hydrationCountMismatches({ expected, counts });

  return {
    matched: mismatches.length === 0,
    expected,
    counts,
    mismatches,
  };
}

function hydrationCountMismatches({ expected = {}, counts = {} } = {}) {
  const mismatches = [];
  const seen = new Set();
  for (const key of Object.keys(counts)) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) continue;
    seen.add(key);
    if (expected[key] !== counts[key]) {
      mismatches.push({ key, expected: expected[key], actual: counts[key] });
    }
  }
  for (const [key, expectedCount] of Object.entries(expected)) {
    if (seen.has(key)) continue;
    if (expectedCount !== 0) {
      mismatches.push({ key, expected: expectedCount, actual: 0 });
    }
  }
  return mismatches;
}

export function renderHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench shadow hydration verification",
    `matched: ${result.matched ? "yes" : "no"}`,
    "row_counts:",
  ];
  const expected = result.expected || {};
  const counts = result.counts || {};
  for (const key of Object.keys(expected)) {
    lines.push(`  ${key}: expected=${expected[key]} actual=${counts[key] || 0}`);
  }
  if (result.mismatches?.length) {
    lines.push("mismatches:");
    for (const mismatch of result.mismatches) {
      lines.push(`  ${mismatch.key}: expected=${mismatch.expected} actual=${mismatch.actual}`);
    }
  }
  return lines;
}

export function buildShadowMatterInspectionSql({ tenantId, matterQuery = "" } = {}) {
  if (!tenantId) throw new Error("Hydration plan is missing tenant.id.");
  const whereClause = matterQuery
    ? `where m.name ilike '%' || ${sqlString(matterQuery)} || '%'`
    : "";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with matter_rows as (",
    "  select",
    "    m.id::text as matter_id,",
    "    m.name as matter_name,",
    "    coalesce(m.client_name, '') as client_name,",
    "    coalesce(m.opposite_party, '') as opposite_party,",
    "    m.status,",
    "    m.next_file_number,",
    "    count(distinct mi.id)::int as intakes,",
    "    count(distinct d.id)::int as documents,",
    "    count(distinct er.id)::int as extraction_records,",
    "    count(distinct sd.id)::int as source_descriptors,",
    "    count(distinct ma.id)::int as matter_artifacts,",
    "    count(distinct mib.id)::int as matter_import_batches,",
    "    count(distinct mii.id)::int as matter_import_items",
    "  from matters m",
    "  left join matter_intakes mi on mi.matter_id = m.id",
    "  left join documents d on d.matter_id = m.id",
    "  left join extraction_records er on er.matter_id = m.id",
    "  left join source_descriptors sd on sd.matter_id = m.id",
    "  left join matter_artifacts ma on ma.matter_id = m.id",
    "  left join matter_import_batches mib on mib.matter_id = m.id",
    "  left join matter_import_items mii on mii.matter_id = m.id",
    `  ${whereClause}`,
    "  group by m.id, m.name, m.client_name, m.opposite_party, m.status, m.next_file_number",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(matter_rows) order by matter_name), '[]'::jsonb)::text from matter_rows;",
    "",
  ].join("\n");
}

export function inspectLocalMatterHydration({
  databaseUrl,
  plan,
  matterQuery = "",
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting shadow hydration.");
  const tenantId = plan?.tenant?.id;
  const sql = buildShadowMatterInspectionSql({ tenantId, matterQuery });
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw new Error(`psql failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const matters = parsePsqlJsonArray(result.stdout || "").map(normalizeInspectionMatter);
  return {
    tenantId,
    matterQuery,
    matters,
    totals: inspectionTotals(matters),
  };
}

export function renderHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `matter_filter: ${result.matterQuery || "(none)"}`,
    `matters: ${result.matters?.length || 0}`,
    "totals:",
  ];
  const totals = result.totals || {};
  lines.push(`  documents: ${totals.documents || 0}`);
  lines.push(`  extraction_records: ${totals.extractionRecords || 0}`);
  lines.push(`  source_descriptors: ${totals.sourceDescriptors || 0}`);
  lines.push(`  matter_artifacts: ${totals.matterArtifacts || 0}`);
  lines.push(`  matter_import_batches: ${totals.matterImportBatches || 0}`);
  lines.push(`  matter_import_items: ${totals.matterImportItems || 0}`);
  lines.push("matter_summaries:");
  for (const matter of result.matters || []) {
    lines.push([
      `  ${matter.matterName}`,
      `documents=${matter.documents}`,
      `extractions=${matter.extractionRecords}`,
      `source_descriptors=${matter.sourceDescriptors}`,
      `artifacts=${matter.matterArtifacts}`,
      `import_batches=${matter.matterImportBatches}`,
      `import_items=${matter.matterImportItems}`,
      `next_file_number=${matter.nextFileNumber}`,
    ].join(" "));
  }
  if (!result.matters?.length) lines.push("  (none)");
  return lines;
}

export function renderHydrationReport(report = {}) {
  const lines = [
    "Matter Workbench local DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
  ];

  const totals = report.totals || emptyTotals();
  lines.push(`  matters: ${totals.matters || 0}`);
  lines.push(`  intakes: ${totals.intakes || 0}`);
  lines.push(`  registered_files: ${totals.registeredFiles || 0}`);
  lines.push(`  extraction_rows: ${totals.extractionRows || 0}`);
  lines.push(`  source_descriptors: ${totals.sourceDescriptors || 0}`);
  lines.push(`  list_of_dates_entries: ${totals.listOfDatesEntries || 0}`);
  lines.push(`  import_warnings: ${totals.importWarnings || 0}`);
  lines.push("planned_rows:");

  for (const [key, value] of Object.entries(report.plannedRows || {})) {
    lines.push(`  ${toSnakeCase(key)}: ${value}`);
  }

  lines.push("matters:");
  for (const matter of report.matters || []) {
    lines.push([
      `  ${matter.name}`,
      `documents=${matter.counts.registeredFiles}`,
      `extractions=${matter.counts.extractionRows}`,
      `source_descriptors=${matter.counts.sourceDescriptors}`,
      `lod_entries=${matter.counts.listOfDatesEntries}`,
      `next_file_number=${matter.nextFileNumber}`,
      `warnings=${matter.warnings.length}`,
    ].join(" "));
    for (const warning of matter.warnings) {
      lines.push(`    warning: ${warning}`);
    }
  }

  if (report.databaseWrites) {
    lines.push("next: Compare shadow DB row counts against the filesystem dry-run report before any runtime cutover.");
  } else {
    lines.push("next: Apply migrations to an empty Postgres database before any write-side hydration.");
  }
  return lines;
}

function normalizeInspectionMatter(row = {}) {
  return {
    matterId: stringValue(row.matter_id),
    matterName: stringValue(row.matter_name),
    clientName: stringValue(row.client_name),
    oppositeParty: stringValue(row.opposite_party),
    status: stringValue(row.status),
    nextFileNumber: Number(row.next_file_number) || 0,
    intakes: Number(row.intakes) || 0,
    documents: Number(row.documents) || 0,
    extractionRecords: Number(row.extraction_records) || 0,
    sourceDescriptors: Number(row.source_descriptors) || 0,
    matterArtifacts: Number(row.matter_artifacts) || 0,
    matterImportBatches: Number(row.matter_import_batches) || 0,
    matterImportItems: Number(row.matter_import_items) || 0,
  };
}

function inspectionTotals(matters = []) {
  return matters.reduce((acc, matter) => {
    acc.intakes += matter.intakes;
    acc.documents += matter.documents;
    acc.extractionRecords += matter.extractionRecords;
    acc.sourceDescriptors += matter.sourceDescriptors;
    acc.matterArtifacts += matter.matterArtifacts;
    acc.matterImportBatches += matter.matterImportBatches;
    acc.matterImportItems += matter.matterImportItems;
    return acc;
  }, {
    intakes: 0,
    documents: 0,
    extractionRecords: 0,
    sourceDescriptors: 0,
    matterArtifacts: 0,
    matterImportBatches: 0,
    matterImportItems: 0,
  });
}

function parsePsqlJsonArray(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("psql inspection returned no JSON matter summary.");
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("psql inspection returned a non-array matter summary.");
  }
  return parsed;
}

function shadowHydrationCountKeys() {
  return [
    ["matters", "matters", "id"],
    ["matter_intakes", "matter_intakes", "matter_id"],
    ["documents", "documents", "matter_id"],
    ["extraction_records", "extraction_records", "matter_id"],
    ["source_descriptors", "source_descriptors", "matter_id"],
    ["matter_artifacts", "matter_artifacts", "matter_id"],
    ["matter_import_batches", "matter_import_batches", "matter_id"],
    ["matter_import_items", "matter_import_items", "matter_id"],
  ];
}

function plannedMatterIds(plan = {}) {
  return (plan.matters || [])
    .map((matter) => stringValue(matter.id))
    .filter(Boolean);
}

function expectedShadowHydrationCounts(plan = {}) {
  const plannedRows = plan.plannedRows || {};
  return {
    matters: plannedRows.matters || 0,
    matter_intakes: plannedRows.matterIntakes || 0,
    documents: plannedRows.documents || 0,
    extraction_records: plannedRows.extractionRecords || 0,
    source_descriptors: plannedRows.sourceDescriptors || 0,
    matter_artifacts: plannedRows.matterArtifacts || 0,
    matter_import_batches: plannedRows.matterImportBatches || 0,
    matter_import_items: plannedRows.matterImportItems || 0,
  };
}

function parseShadowHydrationCounts(stdout = "") {
  const counts = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) continue;
    const [key, value] = trimmed.split("|");
    const count = Number.parseInt(value, 10);
    if (!key || !Number.isFinite(count)) continue;
    counts[key] = count;
  }
  return counts;
}

async function listMatterRoots(mattersHome) {
  const entries = await readdir(mattersHome, { withFileTypes: true });
  const roots = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(mattersHome, entry.name);
    if (await fileExists(path.join(candidate, "matter.json"))) roots.push(candidate);
  }

  return roots;
}

async function summarizeMatter(matterRoot) {
  const warnings = [];
  const matterJson = await readJson(path.join(matterRoot, "matter.json"), warnings, "matter.json");
  const matterName = stringValue(matterJson.matter_name) || path.basename(matterRoot);
  const intakes = Array.isArray(matterJson.intakes) ? matterJson.intakes : [];
  if (intakes.length === 0) warnings.push("No intakes recorded in matter.json.");

  const matterId = deterministicUuid(`matter:${path.basename(matterRoot)}:${matterName}`);
  const intakeSummaries = [];
  const registerRows = [];
  const extractionRows = [];

  for (const intake of intakes) {
    const intakeDir = stringValue(intake.intake_dir);
    if (!intakeDir) {
      warnings.push(`Intake ${stringValue(intake.intake_id) || "(unknown)"} has no intake_dir.`);
      continue;
    }

    const registerPath = path.join(matterRoot, intakeDir, "File Register.csv");
    const logPath = path.join(matterRoot, intakeDir, "Extraction Log.csv");
    const intakeRegisterRows = await readCsv(registerPath, warnings, `${intakeDir}/File Register.csv`);
    const intakeExtractionRows = await readCsv(logPath, warnings, `${intakeDir}/Extraction Log.csv`);
    const intakeId = deterministicUuid(`intake:${matterId}:${stringValue(intake.intake_id) || intakeDir}`);
    const normalizedRegisterRows = intakeRegisterRows.map((row) => normalizeDocumentRow({ row, matterId, intakeId }));
    const normalizedExtractionRows = intakeExtractionRows.map((row) => normalizeExtractionRow({ row, matterId, intakeId }));
    registerRows.push(...normalizedRegisterRows);
    extractionRows.push(...normalizedExtractionRows);
    intakeSummaries.push({
      id: intakeId,
      intakeId: stringValue(intake.intake_id),
      intakeDir,
      label: stringValue(intake.label),
      receivedDate: validDateOrNull(intake.received_date),
      registeredFiles: intakeRegisterRows.length,
      extractionRows: intakeExtractionRows.length,
    });
  }

  const sourceIndexPath = path.join(matterRoot, SOURCE_INDEX_RELATIVE);
  const sourceIndex = await readOptionalJson(sourceIndexPath, warnings, SOURCE_INDEX_RELATIVE);
  const listOfDatesJsonPath = path.join(matterRoot, LIST_OF_DATES_JSON_RELATIVE);
  const listOfDates = await readOptionalJson(listOfDatesJsonPath, warnings, LIST_OF_DATES_JSON_RELATIVE);

  const sourceDescriptors = sourceIndex ? extractSourceDescriptors(sourceIndex) : [];
  const sourceDescriptorRows = normalizeSourceDescriptorRows({ sourceDescriptors, matterId, documents: registerRows, extractions: extractionRows });
  const listEntries = Array.isArray(listOfDates?.entries) ? listOfDates.entries : [];
  const sourceIndexPresent = Boolean(sourceIndex);
  const listOfDatesPresent = Boolean(listOfDates) || await fileExists(path.join(matterRoot, LIST_OF_DATES_MARKDOWN_RELATIVE));

  return {
    id: matterId,
    name: matterName,
    folderName: path.basename(matterRoot),
    metadata: {
      clientName: stringValue(matterJson.client_name),
      oppositeParty: stringValue(matterJson.opposite_party),
      matterType: stringValue(matterJson.matter_type),
      jurisdiction: stringValue(matterJson.jurisdiction),
    },
    intakes: intakeSummaries,
    counts: {
      registeredFiles: registerRows.length,
      extractionRows: extractionRows.length,
      sourceDescriptors: sourceDescriptors.length,
      listOfDatesEntries: listEntries.length,
    },
    nextFileNumber: nextFileNumber(registerRows),
    documents: registerRows,
    extractions: extractionRows,
    sourceDescriptors: sourceDescriptorRows,
    artifacts: {
      sourceIndex: {
        present: sourceIndexPresent,
        path: sourceIndexPresent ? SOURCE_INDEX_RELATIVE.replaceAll(path.sep, "/") : "",
        generatedAt: timestampOrEmpty(sourceIndex?.generated_at),
        aiRun: normalizeAiRun(sourceIndex?.ai_run),
      },
      listOfDates: {
        present: listOfDatesPresent,
        path: listOfDatesPresent ? LIST_OF_DATES_JSON_RELATIVE.replaceAll(path.sep, "/") : "",
        generatedAt: timestampOrEmpty(listOfDates?.generated_at),
        aiRun: normalizeAiRun(listOfDates?.ai_run),
      },
    },
    warnings,
  };
}

function appendMatterSql(lines, { tenant, user, matter }) {
  lines.push(`insert into matters (id, tenant_id, created_by_user_id, name, client_name, opposite_party, matter_type, jurisdiction, status, next_file_number) values (${sqlString(matter.id)}, ${sqlString(tenant.id)}, ${sqlString(user.id)}, ${sqlString(matter.name)}, ${sqlString(matter.metadata?.clientName)}, ${sqlString(matter.metadata?.oppositeParty)}, ${sqlString(matter.metadata?.matterType)}, ${sqlString(matter.metadata?.jurisdiction)}, 'active', ${sqlInteger(matter.nextFileNumber, 1)}) on conflict (id) do update set name = excluded.name, client_name = excluded.client_name, opposite_party = excluded.opposite_party, matter_type = excluded.matter_type, jurisdiction = excluded.jurisdiction, next_file_number = excluded.next_file_number, status = excluded.status;`);

  const importBatchId = deterministicUuid(`import-batch:${matter.id}`);
  lines.push(`insert into matter_import_batches (id, tenant_id, matter_id, created_by_user_id, source_kind, source_label, source_root_hint, collision_policy, status, idempotency_key, files_expected, files_imported, files_failed, started_at, finished_at) values (${sqlString(importBatchId)}, ${sqlString(tenant.id)}, ${sqlString(matter.id)}, ${sqlString(user.id)}, 'local_folder', ${sqlString(matter.name)}, ${sqlString(matter.folderName)}, 'fail_closed', 'succeeded', ${sqlString(`local-shadow:${matter.folderName}`)}, ${sqlInteger(matter.counts?.registeredFiles, 0)}, ${sqlInteger(matter.counts?.registeredFiles, 0)}, 0, now(), now()) on conflict (tenant_id, idempotency_key) do update set files_expected = excluded.files_expected, files_imported = excluded.files_imported, files_failed = excluded.files_failed, status = excluded.status, finished_at = excluded.finished_at;`);

  for (const intake of matter.intakes || []) {
    lines.push(`insert into matter_intakes (id, tenant_id, matter_id, label, received_at, created_by_user_id) values (${sqlString(intake.id)}, ${sqlString(tenant.id)}, ${sqlString(matter.id)}, ${sqlString(intake.label || intake.intakeId || "Initial")}, ${sqlDateOrNull(intake.receivedDate)}, ${sqlString(user.id)}) on conflict (id) do update set label = excluded.label, received_at = excluded.received_at;`);
  }

  for (const document of matter.documents || []) {
    lines.push(`insert into documents (id, tenant_id, matter_id, intake_id, file_number, file_id, original_name, category, sha256, size_bytes, status) values (${sqlString(document.id)}, ${sqlString(tenant.id)}, ${sqlString(matter.id)}, ${sqlString(document.intakeId)}, ${sqlInteger(document.fileNumber, 1)}, ${sqlString(document.fileId)}, ${sqlString(document.originalName)}, ${sqlString(document.category)}, ${sqlString(document.sha256)}, ${sqlIntegerOrNull(document.sizeBytes)}, ${sqlString(documentStatus(document.status))}) on conflict (matter_id, file_id) do update set original_name = excluded.original_name, category = excluded.category, sha256 = excluded.sha256, size_bytes = excluded.size_bytes, status = excluded.status;`);
    lines.push(`insert into matter_import_items (id, tenant_id, import_batch_id, matter_id, document_id, original_file_id, original_relative_path, source_sha256, target_file_number, target_file_id, status) values (${sqlString(deterministicUuid(`import-item:${importBatchId}:${document.fileId}:${document.sourcePath}`))}, ${sqlString(tenant.id)}, ${sqlString(importBatchId)}, ${sqlString(matter.id)}, ${sqlString(document.id)}, ${sqlString(document.fileId)}, ${sqlString(document.sourcePath || document.originalName)}, ${sqlString(document.sha256)}, ${sqlInteger(document.fileNumber, 1)}, ${sqlString(document.fileId)}, 'imported') on conflict (tenant_id, import_batch_id, original_relative_path) do update set document_id = excluded.document_id, source_sha256 = excluded.source_sha256, target_file_number = excluded.target_file_number, target_file_id = excluded.target_file_id, status = excluded.status;`);
  }

  for (const extraction of matter.extractions || []) {
    const document = (matter.documents || []).find((item) => item.fileId === extraction.fileId);
    if (!document) continue;
    lines.push(`insert into extraction_records (id, tenant_id, matter_id, document_id, status, engine, page_count, ocr_applied, needs_review, content_hash, error_message) values (${sqlString(extraction.id)}, ${sqlString(tenant.id)}, ${sqlString(matter.id)}, ${sqlString(document.id)}, ${sqlString(extractionStatus(extraction.status))}, ${sqlString(extraction.engine || "unknown")}, ${sqlIntegerOrNull(extraction.pageCount)}, ${sqlBoolean(extraction.ocrApplied)}, ${sqlBoolean(extraction.needsReview)}, ${sqlString(extraction.sha256)}, ${sqlString(extraction.notes)}) on conflict (id) do update set status = excluded.status, engine = excluded.engine, page_count = excluded.page_count, ocr_applied = excluded.ocr_applied, needs_review = excluded.needs_review, content_hash = excluded.content_hash, error_message = excluded.error_message;`);
  }

  for (const descriptor of matter.sourceDescriptors || []) {
    lines.push(`insert into source_descriptors (id, tenant_id, matter_id, document_id, extraction_record_id, suggested_label, label_status, label_source, document_type, document_date, needs_review) values (${sqlString(descriptor.id)}, ${sqlString(tenant.id)}, ${sqlString(matter.id)}, ${sqlString(descriptor.documentId)}, ${sqlStringOrNull(descriptor.extractionRecordId)}, ${sqlString(descriptor.suggestedLabel)}, ${sqlString(labelStatus(descriptor.labelStatus))}, 'model', ${sqlString(descriptor.documentType)}, ${sqlDateOrNull(descriptor.documentDate)}, ${sqlBoolean(descriptor.needsReview)}) on conflict (id) do update set suggested_label = excluded.suggested_label, label_status = excluded.label_status, document_type = excluded.document_type, document_date = excluded.document_date, needs_review = excluded.needs_review;`);
  }

  if (matter.artifacts?.sourceIndex?.present) {
    lines.push(matterArtifactSql({ tenantId: tenant.id, matterId: matter.id, id: deterministicUuid(`artifact:${matter.id}:source_index:json`), family: "source_index", format: "json", objectKey: matter.artifacts.sourceIndex.path }));
  }
  if (matter.artifacts?.listOfDates?.present) {
    lines.push(matterArtifactSql({ tenantId: tenant.id, matterId: matter.id, id: deterministicUuid(`artifact:${matter.id}:list_of_dates:json`), family: "list_of_dates", format: "json", objectKey: matter.artifacts.listOfDates.path }));
  }
}

function matterArtifactSql({ tenantId, matterId, id, family, format, objectKey }) {
  return `insert into matter_artifacts (id, tenant_id, matter_id, artifact_family, mode, profile_key, format, object_key, is_current) values (${sqlString(id)}, ${sqlString(tenantId)}, ${sqlString(matterId)}, ${sqlString(family)}, 'default', 'default', ${sqlString(format)}, ${sqlString(objectKey)}, true) on conflict (id) do update set object_key = excluded.object_key, is_current = excluded.is_current;`;
}

function emptyTotals() {
  return {
    matters: 0,
    intakes: 0,
    registeredFiles: 0,
    extractionRows: 0,
    sourceDescriptors: 0,
    listOfDatesEntries: 0,
    importWarnings: 0,
  };
}

async function readJson(filePath, warnings, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    warnings.push(`${label} is unreadable: ${error.message}`);
    return {};
  }
}

async function readOptionalJson(filePath, warnings, label) {
  if (!await fileExists(filePath)) return null;
  return readJson(filePath, warnings, label);
}

async function readCsv(filePath, warnings, label) {
  if (!await fileExists(filePath)) {
    warnings.push(`${label} is missing.`);
    return [];
  }
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch (error) {
    warnings.push(`${label} is unreadable: ${error.message}`);
    return [];
  }
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function extractSourceDescriptors(sourceIndex) {
  for (const key of ["sources", "descriptors", "entries", "documents"]) {
    if (Array.isArray(sourceIndex?.[key])) return sourceIndex[key];
  }
  return [];
}

function normalizeDocumentRow({ row, matterId, intakeId }) {
  const fileId = stringValue(row.file_id);
  return {
    id: deterministicUuid(`document:${matterId}:${fileId}`),
    matterId,
    intakeId,
    fileId,
    fileNumber: fileNumber(fileId),
    sourcePath: stringValue(row.source_path),
    originalPath: stringValue(row.original_path),
    workingCopyPath: stringValue(row.working_copy_path),
    originalName: stringValue(row.original_name) || path.basename(stringValue(row.source_path)),
    category: stringValue(row.category),
    sha256: stringValue(row.sha256),
    sizeBytes: positiveIntegerOrNull(row.size_bytes),
    status: stringValue(row.status),
  };
}

function normalizeExtractionRow({ row, matterId, intakeId }) {
  const fileId = stringValue(row.file_id);
  return {
    id: deterministicUuid(`extraction:${matterId}:${fileId}:${stringValue(row.sha256)}`),
    matterId,
    intakeId,
    fileId,
    sha256: stringValue(row.sha256),
    status: stringValue(row.status),
    engine: stringValue(row.engine),
    pageCount: positiveIntegerOrNull(row.page_count),
    ocrApplied: stringValue(row.ocr_applied).toLowerCase() === "yes" || stringValue(row.ocr_applied).toLowerCase() === "true",
    needsReview: positiveIntegerOrNull(row.needs_review_pages) > 0 || /needs.review/i.test(stringValue(row.notes)),
    notes: stringValue(row.notes),
  };
}

function normalizeAiRun(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const usage = source.usage && typeof source.usage === "object" && !Array.isArray(source.usage) ? source.usage : {};
  return {
    provider: stringValue(source.provider),
    model: stringValue(source.model),
    task: stringValue(source.task),
    policyPromptVersion: stringValue(source.policyPromptVersion),
    policyVersion: stringValue(source.policyVersion),
    promptVersion: stringValue(source.promptVersion),
    returnedModel: stringValue(source.returnedModel),
    returnedProvider: stringValue(source.returnedProvider),
    usage: {
      promptTokens: positiveIntegerOrNull(usage.promptTokens ?? usage.inputTokens),
      completionTokens: positiveIntegerOrNull(usage.completionTokens ?? usage.outputTokens),
      totalTokens: positiveIntegerOrNull(usage.totalTokens),
      cost: numberOrNull(usage.cost ?? usage.costAmount),
    },
  };
}

function normalizeSourceDescriptorRows({ sourceDescriptors, matterId, documents, extractions }) {
  return sourceDescriptors.map((source, index) => {
    const fileId = stringValue(source.file_id) || stringValue(source.source_id);
    const document = documents.find((item) => item.fileId === fileId);
    if (!document) return null;
    const extraction = extractions.find((item) => item.fileId === fileId);
    return {
      id: deterministicUuid(`source-descriptor:${matterId}:${fileId}:${index + 1}`),
      fileId,
      documentId: document.id,
      extractionRecordId: extraction?.id || "",
      suggestedLabel: stringValue(source.source_label) || stringValue(source.suggested_label) || fileId,
      labelStatus: stringValue(source.label_status),
      documentType: stringValue(source.document_type),
      documentDate: validDateOrNull(source.document_date),
      needsReview: Boolean(source.needs_review),
    };
  }).filter(Boolean);
}

function nextFileNumber(registerRows = []) {
  let max = 0;
  for (const row of registerRows) {
    const match = (stringValue(row.file_id) || stringValue(row.fileId)).match(/^FILE-(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function fileNumber(fileId) {
  const match = stringValue(fileId).match(/^FILE-(\d+)$/i);
  return match ? Number(match[1]) : 1;
}

function positiveIntegerOrNull(value) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function timestampOrEmpty(value) {
  const text = stringValue(value);
  if (!text) return "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function validDateOrNull(value) {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function documentStatus(status) {
  const normalized = stringValue(status).toLowerCase();
  if (normalized.includes("duplicate")) return "duplicate";
  if (normalized.includes("unsupported")) return "unsupported";
  if (normalized.includes("failed")) return "failed";
  return "verified";
}

function extractionStatus(status) {
  const normalized = stringValue(status).toLowerCase();
  if (normalized.includes("unsupported")) return "unsupported";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("needs_ocr") || normalized.includes("needs-ocr")) return "needs_ocr";
  return "succeeded";
}

function labelStatus(status) {
  const normalized = stringValue(status).toLowerCase();
  if (["confirmed", "overridden", "needs_review"].includes(normalized)) return normalized;
  return "suggested";
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlUuidArray(values = []) {
  const quoted = values.map(sqlString).join(", ");
  return `array[${quoted}]::uuid[]`;
}

function sqlStringOrNull(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlDateOrNull(value) {
  return value ? sqlString(value) : "null";
}

function sqlInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function sqlIntegerOrNull(value) {
  return value === null || value === undefined ? "null" : sqlInteger(value, 0);
}

function sqlBoolean(value) {
  return value ? "true" : "false";
}

function toSnakeCase(value) {
  return String(value).replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function redactSecret(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const plan = await collectLocalMatterHydrationPlan({ mattersHome: args.mattersHome });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalMatterHydration({ databaseUrl, plan, matterQuery: args.matterQuery });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderHydrationInspection(result)) console.log(line);
    }
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalMatterHydration({ databaseUrl, plan });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderHydrationVerification(result)) console.log(line);
    }
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalMatterHydrationPlan({ databaseUrl, plan });
    const appliedReport = { ...hydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) {
      console.log(JSON.stringify({ ...appliedReport, insertedRows: result.insertedRows }, null, 2));
      return;
    }
    for (const line of renderHydrationReport(appliedReport)) console.log(line);
    console.log("shadow_hydration: applied");
    return;
  }
  const report = hydrationReportFromPlan(plan);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const line of renderHydrationReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
