import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storageHydratorPath = new URL("../scripts/db-hydrate-local-storage.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local storage DB hydrator dry-run plans custody rows without reading file bodies", async () => {
  const {
    buildShadowStoragePlan,
    renderShadowStorageReport,
  } = await import(storageHydratorPath.href);

  const plan = buildShadowStoragePlan({
    matterPlan: matterPlanFixture(),
    skillPlan: skillPlanFixture(),
  });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.databaseWrites, false);
  assert.deepEqual(plan.totals, {
    storageObjects: 5,
    documentBlobs: 2,
    extractionPayloads: 1,
    matterArtifacts: 1,
    skillSamples: 1,
    warnings: 0,
  });
  assert.deepEqual(plan.plannedRows, {
    storageObjects: 5,
    documentBlobs: 2,
    extractionStorageLinks: 1,
    matterArtifactStorageLinks: 1,
    skillSampleStorageLinks: 1,
  });
  assert.equal(plan.storageObjects[0].objectRole, "source_original");
  assert.equal(plan.storageObjects[0].objectKey, "Alpha Matter/00_Inbox/Intake 01/Originals/agreement.pdf");
  assert.equal(plan.documentBlobs[0].blobKind, "original");
  assert.equal(plan.extractionLinks[0].objectKey, "Alpha Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json");
  assert.equal(plan.skillSampleLinks[0].objectKey, "local-skill-samples/sample_alpha.md");
  assert.doesNotMatch(JSON.stringify(plan), /source file body|sample markdown body/i);

  const rendered = renderShadowStorageReport(plan).join("\n");
  assert.match(rendered, /Matter Workbench local storage DB hydration/);
  assert.match(rendered, /storage_objects: 5/);
  assert.match(rendered, /document_blobs: 2/);
  assert.match(rendered, /extraction_storage_links: 1/);
  assert.match(rendered, /skill_sample_storage_links: 1/);
});

test("local storage DB hydrator builds idempotent object custody SQL", async () => {
  const {
    buildLocalStorageHydrationSql,
    buildStorageHydrationCountSql,
  } = await import(storageHydratorPath.href);
  const plan = buildShadowStoragePlanFixture();
  const sql = buildLocalStorageHydrationSql(plan);
  const countSql = buildStorageHydrationCountSql(plan);

  assert.match(sql, /select set_config\('app\.tenant_id'/i);
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /on conflict \(tenant_id, object_key\) do update/i);
  assert.match(sql, /insert into document_blobs/i);
  assert.match(sql, /blob_kind, object_key, mime_type, size_bytes, sha256, state, storage_object_id/i);
  assert.match(sql, /update extraction_records[\s\S]*set storage_object_id/i);
  assert.match(sql, /update matter_artifacts[\s\S]*set storage_object_id/i);
  assert.match(sql, /update skill_samples[\s\S]*set storage_object_id/i);
  assert.match(sql, /update skill_samples[\s\S]*where id = 'sample_alpha'/i);
  assert.doesNotMatch(sql, /where id = 'sample_alpha'::uuid/i);
  assert.match(countSql, /skill_sample_storage_links[\s\S]*ARRAY\['sample_alpha'\]::text\[\]/i);
  assert.doesNotMatch(sql, /sample markdown body/i);
});

test("local storage DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalStorageHydrationPlan,
    verifyLocalStorageHydration,
    inspectLocalStorageHydration,
  } = await import(storageHydratorPath.href);
  const calls = [];
  const plan = buildShadowStoragePlanFixture();

  const applied = applyLocalStorageHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });
  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.storageObjects, 5);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalStorageHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "storage_objects|5",
        "document_blobs|2",
        "extraction_storage_links|1",
        "matter_artifact_storage_links|1",
        "skill_sample_storage_links|1",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalStorageHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([
        { object_role: "source_original", count: 1 },
        { object_role: "source_working_copy", count: 1 },
        { object_role: "matter_artifact", count: 1 },
      ]),
      stderr: "",
    }),
  });
  assert.equal(inspected.roles.length, 3);
  assert.equal(inspected.totals.storageObjects, 3);
});

test("package and database docs expose local storage shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:storage:hydrate:dry-run"], "node scripts/db-hydrate-local-storage.mjs --dry-run");
  assert.equal(pkg.scripts["db:storage:hydrate"], "node scripts/db-hydrate-local-storage.mjs --apply");
  assert.equal(pkg.scripts["db:storage:hydrate:verify"], "node scripts/db-hydrate-local-storage.mjs --verify");
  assert.equal(pkg.scripts["db:storage:shadow:inspect"], "node scripts/db-hydrate-local-storage.mjs --inspect");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:storage:hydrate:dry-run/);
  assert.match(readme, /npm run db:storage:hydrate:verify/);
  assert.match(readme, /npm run db:storage:shadow:inspect/);
});

function buildShadowStoragePlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    totals: {
      storageObjects: 5,
      documentBlobs: 2,
      extractionPayloads: 1,
      matterArtifacts: 1,
      skillSamples: 1,
      warnings: 0,
    },
    plannedRows: {
      storageObjects: 5,
      documentBlobs: 2,
      extractionStorageLinks: 1,
      matterArtifactStorageLinks: 1,
      skillSampleStorageLinks: 1,
    },
    storageObjects: [
      storageObject("storage_original", "matter_alpha", "Alpha Matter/original.pdf", "source_original"),
      storageObject("storage_working", "matter_alpha", "Alpha Matter/working.pdf", "source_working_copy"),
      storageObject("storage_extraction", "matter_alpha", "Alpha Matter/extracted.json", "extraction_payload"),
      storageObject("storage_artifact", "matter_alpha", "Alpha Matter/10_Library/Source Index.json", "matter_artifact"),
      storageObject("storage_sample", "", "local-skill-samples/sample_alpha.md", "skill_sample"),
    ],
    documentBlobs: [{
      id: "blob_original",
      tenantId: "tenant_local_shadow",
      matterId: "matter_alpha",
      documentId: "document_alpha",
      storageObjectId: "storage_original",
      blobKind: "original",
      objectKey: "Alpha Matter/original.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
      sha256: "sha-alpha",
      state: "verified",
    }, {
      id: "blob_working",
      tenantId: "tenant_local_shadow",
      matterId: "matter_alpha",
      documentId: "document_alpha",
      storageObjectId: "storage_working",
      blobKind: "normalized_working_copy",
      objectKey: "Alpha Matter/working.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
      sha256: "sha-alpha",
      state: "verified",
    }],
    extractionLinks: [{ id: "extraction_alpha", storageObjectId: "storage_extraction", objectKey: "Alpha Matter/extracted.json" }],
    matterArtifactLinks: [{ id: "artifact_alpha", storageObjectId: "storage_artifact", objectKey: "Alpha Matter/10_Library/Source Index.json" }],
    skillSampleLinks: [{ id: "sample_alpha", storageObjectId: "storage_sample", objectKey: "local-skill-samples/sample_alpha.md" }],
    warnings: [],
  };
}

function matterPlanFixture() {
  return {
    tenant: { id: "tenant_local_shadow" },
    matters: [{
      id: "matter_alpha",
      name: "Alpha Matter",
      folderName: "Alpha Matter",
      intakes: [{ intakeId: "INTAKE-01", intakeDir: "00_Inbox/Intake 01" }],
      documents: [{
        id: "document_alpha",
        matterId: "matter_alpha",
        intakeId: "intake_alpha",
        fileId: "FILE-0001",
        sourcePath: "00_Inbox/Intake 01/Source Files/agreement.pdf",
        originalPath: "00_Inbox/Intake 01/Originals/agreement.pdf",
        workingCopyPath: "00_Inbox/Intake 01/By Type/PDFs/FILE-0001__agreement.pdf",
        originalName: "agreement.pdf",
        category: "PDFs",
        sha256: "sha-alpha",
        sizeBytes: 1200,
      }],
      extractions: [{
        id: "extraction_alpha",
        fileId: "FILE-0001",
        intakeId: "INTAKE-01",
        status: "extracted",
      }],
      artifacts: {
        sourceIndex: { present: true, path: "10_Library/Source Index.json" },
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
      matterId: "",
      sampleMarkdownObjectKey: "local-skill-samples/sample_alpha.md",
      sampleHash: "sample-hash-alpha",
    }],
  };
}

function storageObject(id, matterId, objectKey, objectRole) {
  return {
    id,
    tenantId: "tenant_local_shadow",
    matterId,
    objectKey,
    bucket: "local-shadow",
    storageProvider: "local-filesystem",
    objectRole,
    state: "verified",
    mimeType: "",
    sizeBytes: null,
    sha256: "",
    idempotencyKey: `local-shadow:${objectKey}`,
  };
}
