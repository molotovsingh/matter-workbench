import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";
import { runWithRequestContext, runtimeDbUserFromRequestContext } from "../services/request-context.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";
const matter = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DB Matter",
  matterName: "Legal Caption",
  clientName: "Client A",
  oppositeParty: "Other Side",
  matterType: "Consumer",
  jurisdiction: "India",
};

test("runtime DB storage service builds workspace tree from storage payload metadata", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {
      matter,
      objects: [
        storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 30, true),
        storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", 17, true),
        storageRow("DB Matter/00_Inbox/Intake 01/Originals/agreement.pdf", "source_original", "application/pdf", 1200, true),
      ],
    }),
  });

  const workspace = await service.readWorkspace(matter);

  assert.equal(workspace.folderName, "DB Matter");
  assert.equal(workspace.inputLabel, "postgres:DB Matter");
  assert.equal(workspace.metadata.matterName, "Legal Caption");
  assert.equal(workspace.fileCount, 3);
  assert.equal(workspace.directoryCount, 4);
  assert.deepEqual(workspace.tree.children.map((child) => child.name), ["00_Inbox", "10_Library"]);
  assert.equal(workspace.tree.children[1].children[0].name, "List of Dates.md");
  assert.equal(workspace.tree.children[1].children[0].previewKind, "text");
  assertSafeRuntimeRoleGuard(calls[0].input);
  assert.match(calls[0].input, /set_config\('app\.tenant_id'/i);
  assert.match(calls[0].input, /storage_object_payloads/i);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);
});

test("runtime DB storage service gives psql enough buffer for DB-backed payloads", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: `${JSON.stringify({ matter, objects: [] })}\n`,
        stderr: "",
      };
    },
  });

  await service.readWorkspace(matter);

  assert.ok(calls[0].options.maxBuffer >= 64 * 1024 * 1024);
  assert.equal(calls[0].options.encoding, "utf8");
});

test("runtime DB storage service previews text from payload bytes", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], payloadRow("DB Matter/10_Library/List of Dates.md", "# List of Dates")),
  });

  const preview = await service.readFilePreview("10_Library/List of Dates.md", matter);

  assert.equal(preview.path, "10_Library/List of Dates.md");
  assert.equal(preview.name, "List of Dates.md");
  assert.equal(preview.ext, "md");
  assert.equal(preview.content, "# List of Dates");
});

test("runtime DB storage service treats large EML payloads as text-previewable source records", async () => {
  const largeEmail = [
    "From: client@example.com",
    "To: lawyer@example.com",
    "Subject: Large calculation service",
    "",
    "Calculation row 1, row 2, row 3.\n".repeat(20000),
  ].join("\n");
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      matter,
      objects: [
        storageRow("DB Matter/10_Library/Large Service Email.eml", "matter_artifact", "message/rfc822", Buffer.byteLength(largeEmail), true),
      ],
    }),
  });

  const workspace = await service.readWorkspace(matter);
  const library = workspace.tree.children.find((node) => node.path === "10_Library");
  const email = library.children.find((node) => node.name === "Large Service Email.eml");

  assert.equal(email.previewable, true);
  assert.equal(email.previewKind, "text");
});

test("runtime DB storage service streams raw payload bytes with content metadata", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], payloadRow("DB Matter/00_Inbox/Intake 01/Originals/agreement.pdf", "%PDF-1.7", "application/pdf")),
  });

  const raw = await service.getRawFile("00_Inbox/Intake 01/Originals/agreement.pdf", matter);
  const chunks = [];
  for await (const chunk of raw.stream) chunks.push(chunk);

  assert.equal(raw.contentType, "application/pdf");
  assert.equal(raw.fileSize, 8);
  assert.equal(raw.safeFilename, "agreement.pdf");
  assert.equal(Buffer.concat(chunks).toString("utf8"), "%PDF-1.7");
});

test("runtime DB storage service fails closed when payload row is missing", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      objectKey: "DB Matter/10_Library/List of Dates.md",
      mimeType: "text/markdown",
      sizeBytes: 12,
      payloadBase64: "",
      hasPayload: false,
    }),
  });

  await assert.rejects(
    () => service.readFilePreview("10_Library/List of Dates.md", matter),
    (error) => error.statusCode === 409
      && error.code === "runtime_db.read.payload_missing"
      && /payload is missing/i.test(error.message),
  );
});

test("runtime DB storage service exposes stable read-side error codes", async () => {
  const missingPayloadService = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {}),
  });
  await assert.rejects(
    () => missingPayloadService.readFilePreview("10_Library/Missing.md", matter),
    (error) => error.statusCode === 404
      && error.code === "runtime_db.read.file_not_found"
      && /10_Library\/Missing\.md/.test(error.message),
  );

  await assert.rejects(
    () => missingPayloadService.readFilePreview("../secret.txt", matter),
    (error) => error.statusCode === 400
      && error.code === "runtime_db.read.path_outside_matter",
  );

  await assert.rejects(
    () => missingPayloadService.readFilePreview("", matter),
    (error) => error.statusCode === 400
      && error.code === "runtime_db.read.path_required",
  );

  const missingMatterService = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], { matter: {}, objects: [] }),
  });
  await assert.rejects(
    () => missingMatterService.readWorkspace(matter),
    (error) => error.statusCode === 404
      && error.code === "runtime_db.read.matter_not_found"
      && /DB Matter/.test(error.message),
  );
});

test("runtime DB storage service derives matter status and preparation plan from DB payload objects", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      matter,
      objects: [
        storageRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "matter_artifact", "text/csv", 30, true),
        storageRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "extraction_payload", "application/json", 20, true),
        storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", 17, true),
        storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 30, true),
      ],
    }),
  });

  const status = await service.readMatterStatus(matter);
  assert.equal(status.matterName, "DB Matter");
  assert.equal(status.stages.find((stage) => stage.slash === "/matter-init").present, true);
  assert.equal(status.stages.find((stage) => stage.slash === "/extract").present, true);
  assert.equal(status.stages.find((stage) => stage.slash === "/describe_sources").present, true);
  assert.equal(status.stages.find((stage) => stage.slash === "/create_listofdates").present, true);
  assert.equal(status.stages.find((stage) => stage.slash === "/describe_sources").rerunAdvice.state, "current");
  assert.equal(status.stages.find((stage) => stage.slash === "/create_listofdates").rerunAdvice.state, "current");

  const plan = await service.readPrepareMatterPlan(matter);
  assert.equal(plan.schema_version, "prepare-matter-plan/v1");
  assert.equal(plan.nextStep.state, "complete");
  assert.equal(plan.stages.every((stage) => stage.state === "current"), true);
});

test("runtime DB storage service marks source labels stale when extraction payloads are newer", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      matter,
      objects: [
        storageRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "matter_artifact", "text/csv", 30, true, {
          sha256: "1".repeat(64),
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
        storageRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "extraction_payload", "application/json", 20, true, {
          sha256: "2".repeat(64),
          updatedAt: "2026-06-07T11:00:00.000Z",
        }),
        storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", 17, true, {
          sha256: "3".repeat(64),
          updatedAt: "2026-06-07T10:00:00.000Z",
        }),
      ],
    }),
  });

  const status = await service.readMatterStatus(matter);
  const sourceStage = status.stages.find((stage) => stage.slash === "/describe_sources");
  assert.equal(sourceStage.present, true);
  assert.equal(sourceStage.rerunAdvice.state, "stale");
  assert.equal(sourceStage.rerunAdvice.shouldConfirm, false);
  assert.equal(sourceStage.rerunAdvice.newestInputPath, "00_Inbox/Intake 01/_extracted/FILE-0001.json");

  const plan = await service.readPrepareMatterPlan(matter);
  const sourcePlanStage = plan.stages.find((stage) => stage.slash === "/describe_sources");
  assert.equal(sourcePlanStage.state, "stale");
  assert.equal(sourcePlanStage.action, "confirm_paid_run");
});

test("runtime DB storage service marks List of Dates stale when Source Index is newer", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      matter,
      objects: [
        storageRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "matter_artifact", "text/csv", 30, true, {
          sha256: "1".repeat(64),
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
        storageRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "extraction_payload", "application/json", 20, true, {
          sha256: "2".repeat(64),
          updatedAt: "2026-06-07T09:30:00.000Z",
        }),
        storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", 17, true, {
          sha256: "3".repeat(64),
          updatedAt: "2026-06-07T11:00:00.000Z",
        }),
        storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 30, true, {
          sha256: "4".repeat(64),
          updatedAt: "2026-06-07T10:00:00.000Z",
        }),
      ],
    }),
  });

  const status = await service.readMatterStatus(matter);
  const listStage = status.stages.find((stage) => stage.slash === "/create_listofdates");
  assert.equal(listStage.present, true);
  assert.equal(listStage.rerunAdvice.state, "stale");
  assert.equal(listStage.rerunAdvice.shouldConfirm, false);
  assert.equal(listStage.rerunAdvice.newestInputPath, "10_Library/Source Index.json");

  const plan = await service.readPrepareMatterPlan(matter);
  const listPlanStage = plan.stages.find((stage) => stage.slash === "/create_listofdates");
  assert.equal(listPlanStage.state, "stale");
  assert.equal(listPlanStage.action, "confirm_paid_run");
});

test("runtime DB storage service sends added files through extraction before regenerating chronology", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      matter,
      objects: [
        storageRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "matter_artifact", "text/csv", 30, true, {
          sha256: "1".repeat(64),
          updatedAt: "2026-06-07T09:00:00.000Z",
        }),
        storageRow("DB Matter/00_Inbox/Intake 01/By Type/PDFs/FILE-0001__old.pdf", "source_working_copy", "application/pdf", 20, true, {
          fileId: "FILE-0001",
          documentSha: "2".repeat(64),
          updatedAt: "2026-06-07T09:05:00.000Z",
        }),
        storageRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "extraction_payload", "application/json", 20, true, {
          sha256: "3".repeat(64),
          updatedAt: "2026-06-07T09:30:00.000Z",
        }),
        storageRow("DB Matter/00_Inbox/Intake 02/By Type/PDFs/FILE-0002__new.pdf", "source_working_copy", "application/pdf", 20, true, {
          fileId: "FILE-0002",
          documentSha: "4".repeat(64),
          updatedAt: "2026-06-07T13:00:00.000Z",
        }),
        storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", 17, true, {
          sha256: "5".repeat(64),
          updatedAt: "2026-06-07T11:00:00.000Z",
        }),
        storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 30, true, {
          sha256: "6".repeat(64),
          updatedAt: "2026-06-07T12:00:00.000Z",
        }),
      ],
    }),
  });

  const plan = await service.readPrepareMatterPlan(matter);

  const extractStage = plan.stages.find((stage) => stage.slash === "/extract");
  assert.equal(extractStage.state, "stale");
  assert.equal(extractStage.action, "run");
  assert.equal(extractStage.rerunAdvice.newestInputPath, "00_Inbox/Intake 02/By Type/PDFs/FILE-0002__new.pdf");
  assert.equal(plan.nextStep.slash, "/extract");
});

test("runtime DB storage service reads latest advisory snapshot from Postgres", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {
      schema_version: "matter-attention/v1",
      generated_at: "2026-06-06T00:00:00.000Z",
      matterName: "Legal Caption",
      matterRoot: "postgres:DB Matter",
      summary: { total: 1, blocker: 0, warning: 1, info: 0, state: "attention_needed" },
      items: [{ id: "ocr-warning", severity: "warning", title: "OCR text needs review" }],
    }),
  });

  const attention = await service.readMatterAttention(matter);

  assert.equal(attention.schema_version, "matter-attention/v1");
  assert.equal(attention.summary.warning, 1);
  assert.equal(attention.items[0].title, "OCR text needs review");
});

test("runtime DB storage service materializes DB payloads and persists workflow artifacts", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-"));
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption" }), "application/json"),
      {},
    ]),
  });

  const result = await service.runMaterializedMatterWrite(matter, async ({ matterRoot }) => {
    const matterJson = await readFile(path.join(matterRoot, "matter.json"), "utf8");
    assert.match(matterJson, /Legal Caption/);
    await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
    await writeFile(path.join(matterRoot, "10_Library", "New Artifact.md"), "# New Artifact\n");
    return { ok: true };
  });

  assert.deepEqual(result.operationResult, { ok: true });
  assert.deepEqual(result.persisted.map((item) => item.relativePath), ["10_Library/New Artifact.md"]);
  const persistSql = calls.at(-1).input;
  assertTransactionWrapped(persistSql);
  assert.match(persistSql, /insert into storage_objects/i);
  assert.match(persistSql, /insert into storage_object_payloads/i);
  assert.match(persistSql, /insert into matter_artifacts/i);
  assert.match(persistSql, /storage_object_id/i);
  assert.match(persistSql, /DB Matter\/10_Library\/New Artifact\.md/);
  assert.match(persistSql, /matter_artifact/);
  assert.doesNotMatch(persistSql, /secret/);
});

test("runtime DB storage service synthesizes a missing file register from DB custody before write operations", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-register-"));
  const calls = [];
  const intakeDir = "00_Inbox/Intake 01 - Initial";
  const sourcePath = `${intakeDir}/Source Files/KKT 10.pdf`;
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
          storageRow(`DB Matter/${sourcePath}`, "source_working_copy", "application/pdf", 5201011, true, {
            fileId: "FILE-0001",
            originalName: "KKT 10.pdf",
            sha256: "3d3b57112347ad8388808a7129673a321c3deeef5ac9968c3ae230735dcaeb5e",
          }),
        ],
      },
      payloadRow(`DB Matter/${sourcePath}`, "%PDF-1.7", "application/pdf"),
      payloadRow("DB Matter/matter.json", JSON.stringify({
        matter_name: "Legal Caption",
        intakes: [{
          intake_id: "INTAKE-01",
          intake_dir: intakeDir,
          label: "Initial",
          received_date: "2026-06-11",
        }],
      }), "application/json"),
      {},
    ]),
  });

  const result = await service.runMaterializedMatterWrite(matter, async ({ matterRoot }) => {
    const register = await readFile(path.join(matterRoot, intakeDir, "File Register.csv"), "utf8");
    assert.match(register, /FILE-0001/);
    assert.match(register, /PDFs/);
    assert.match(register, /KKT 10\.pdf/);
    assert.match(register, new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return { sawRegister: true };
  });

  assert.deepEqual(result.operationResult, { sawRegister: true });
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [`${intakeDir}/File Register.csv`]);
  const persistSql = calls.at(-1).input;
  assert.match(persistSql, /DB Matter\/00_Inbox\/Intake 01 - Initial\/File Register\.csv/);
  assert.match(persistSql, /matter_artifact/);
  assert.doesNotMatch(persistSql, /secret/);
});

test("runtime DB storage service synthesizes duplicate source rows from DB custody", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-duplicate-register-"));
  const calls = [];
  const intakeDir = "00_Inbox/Intake 01 - Initial";
  const firstSourcePath = `${intakeDir}/Source Files/notice-a.txt`;
  const duplicateSourcePath = `${intakeDir}/Source Files/notice-b.txt`;
  const duplicateHash = "3d3b57112347ad8388808a7129673a321c3deeef5ac9968c3ae230735dcaeb5e";
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
          storageRow(`DB Matter/${firstSourcePath}`, "source_working_copy", "text/plain", 37, true, {
            fileId: "FILE-0001",
            originalName: "notice-a.txt",
            sha256: duplicateHash,
          }),
          storageRow(`DB Matter/${duplicateSourcePath}`, "source_working_copy", "text/plain", 37, true, {
            fileId: "FILE-0002",
            originalName: "notice-b.txt",
            sha256: duplicateHash,
            duplicate_of: "FILE-0001",
          }),
        ],
      },
      payloadRow(`DB Matter/${firstSourcePath}`, "Same notice served on 1 January 2026.", "text/plain"),
      payloadRow(`DB Matter/${duplicateSourcePath}`, "Same notice served on 1 January 2026.", "text/plain"),
      payloadRow("DB Matter/matter.json", JSON.stringify({
        matter_name: "Legal Caption",
        intakes: [{
          intake_id: "INTAKE-01",
          intake_dir: intakeDir,
          label: "Initial",
          received_date: "2026-06-11",
        }],
      }), "application/json"),
      {},
    ]),
  });

  await service.runMaterializedMatterWrite(matter, async ({ matterRoot }) => {
    const register = await readFile(path.join(matterRoot, intakeDir, "File Register.csv"), "utf8");
    assert.match(register, /FILE-0002/);
    assert.match(register, /FILE-0001/);
    assert.match(register, /exact-duplicate/);
    return { sawRegister: true };
  });

  const persistSql = calls.at(-1).input;
  assert.match(persistSql, /DB Matter\/00_Inbox\/Intake 01 - Initial\/File Register\.csv/);
  assert.doesNotMatch(persistSql, /secret/);
});

test("runtime DB storage service tombstones materialized artifacts deleted by a workflow", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-delete-"));
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
          storageRow("DB Matter/10_Library/Old Artifact.md", "matter_artifact", "text/markdown", 16, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption" }), "application/json"),
      payloadRow("DB Matter/10_Library/Old Artifact.md", "# Old Artifact\n"),
      {},
    ]),
  });

  const result = await service.runMaterializedMatterWrite(matter, async ({ matterRoot }) => {
    await unlink(path.join(matterRoot, "10_Library", "Old Artifact.md"));
    return { removed: true };
  });

  assert.deepEqual(result.operationResult, { removed: true });
  assert.deepEqual(result.deleted.map((item) => item.relativePath), ["10_Library/Old Artifact.md"]);
  const tombstoneSql = calls.at(-1).input;
  assertTransactionWrapped(tombstoneSql);
  assert.match(tombstoneSql, /update storage_objects/i);
  assert.match(tombstoneSql, /state\s*=\s*'deleted_pending'/i);
  assert.match(tombstoneSql, /deleted_at\s*=\s*now\(\)/i);
  assert.match(tombstoneSql, /DB Matter\/10_Library\/Old Artifact\.md/);
  assert.match(tombstoneSql, /update extraction_records\nset superseded_at = now\(\)/i);
  assert.match(tombstoneSql, /update source_descriptors\nset superseded_at = now\(\), updated_at = now\(\)/i);
  assert.equal((tombstoneSql.match(/superseded_at is null/gi) || []).length, 2);
  assert.doesNotMatch(tombstoneSql, /insert into storage_object_payloads/i);
  assert.doesNotMatch(tombstoneSql, /secret/);
});

test("runtime DB storage service records materialized extraction payloads", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-extract-"));
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption" }), "application/json"),
      {},
    ]),
  });

  const result = await service.runMaterializedMatterWrite(matter, async ({ matterRoot }) => {
    await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
    await writeFile(
      path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"),
      JSON.stringify({ file_id: "FILE-0001", status: "extracted", engine: "mistral-ocr", pages: [{ page: 1, text: "ok" }] }),
    );
    return { ok: true };
  });

  assert.deepEqual(result.persisted.map((item) => item.relativePath), ["00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json"]);
  const persistSql = calls.at(-1).input;
  assert.match(persistSql, /insert into storage_objects/i);
  assert.match(persistSql, /insert into extraction_records/i);
  assert.match(persistSql, /FILE-0001/);
  assert.match(persistSql, /storage_object_id/i);
  assert.doesNotMatch(persistSql, /secret/);
});

test("runtime DB storage service records materialized source descriptors", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-source-descriptors-"));
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption" }), "application/json"),
      {},
    ]),
  });

  await service.runMaterializedMatterWrite(matter, async ({ matterRoot }) => {
    await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
    await writeFile(
      path.join(matterRoot, "10_Library", "Source Index.json"),
      JSON.stringify({
        schema_version: "source-index/v1",
        sources: [{
          file_id: "FILE-0001",
          source_label: "Agreement dated 1 June 2014",
          label_status: "suggested",
          document_type: "agreement",
          document_date: "2014-06-01",
          needs_review: false,
        }],
      }),
    );
    return { ok: true };
  });

  const persistSql = calls.at(-1).input;
  assert.match(persistSql, /insert into matter_artifacts/i);
  assert.match(persistSql, /insert into source_descriptors/i);
  assert.match(persistSql, /Agreement dated 1 June 2014/);
  assert.match(persistSql, /FILE-0001/);
  assert.doesNotMatch(persistSql, /secret/);
});

test("runtime DB storage service creates matter upload custody rows with payload bytes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-create-upload-"));
  const uploadedFile = path.join(tmp, "notice.txt");
  await writeFile(uploadedFile, "Notice served on 1 January 2026.");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [{}, {}]),
  });

  const created = await service.createMatterFromUploadedFiles({
    name: "DB Upload Matter",
    metadata: {
      matterName: "DB Upload Matter",
      clientName: "Runtime Client",
      oppositeParty: "Runtime Opposite",
      matterType: "Consumer",
      jurisdiction: "Delhi",
      briefDescription: "Created through runtime DB upload.",
    },
    files: [{ index: 0, tempPath: uploadedFile, filename: "notice.txt", bytes: 31 }],
    relativePaths: ["evidence/notice.txt"],
  });

  assert.equal(created.name, "DB Upload Matter");
  assert.equal(created.clientName, "Runtime Client");
  const sql = calls.map((call) => call.input || "").join("\n");
  assertTransactionWrapped(calls[1].input);
  assert.match(sql, /insert into matters/i);
  assert.match(sql, /insert into matter_intakes/i);
  assert.match(sql, /insert into upload_sessions/i);
  assert.match(sql, /insert into matter_import_batches/i);
  assert.match(sql, /insert into documents/i);
  assert.match(sql, /insert into document_blobs/i);
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /insert into storage_object_payloads/i);
  assert.match(sql, /document_id/i);
  assert.match(sql, /DB Upload Matter\/matter\.json/);
  assert.match(sql, /DB Upload Matter\/00_Inbox\/Intake 01 - Initial\/File Register\.csv/);
  assert.match(sql, /DB Upload Matter\/00_Inbox\/Intake 01 - Initial\/Intake Log\.csv/);
  assert.match(sql, /DB Upload Matter\/00_Inbox\/Intake 01 - Initial\/Originals\/evidence\/notice\.txt/);
  assert.match(sql, /DB Upload Matter\/00_Inbox\/Intake 01 - Initial\/By Type\/Text Notes\/FILE-0001__notice\.txt/);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB storage service creates lawyer-captioned matters under safe storage names", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-captioned-upload-"));
  const uploadedFile = path.join(tmp, "fir.txt");
  await writeFile(uploadedFile, "FIR placeholder.");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [{}, {}]),
  });

  const created = await service.createMatterFromUploadedFiles({
    name: "State/Rajesh Mehra",
    metadata: {
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
    },
    files: [{ index: 0, tempPath: uploadedFile, filename: "fir.txt", bytes: 16 }],
    relativePaths: ["FIR.txt"],
  });

  assert.equal(created.name, "State - Rajesh Mehra");
  assert.equal(created.matterName, "State/Rajesh Mehra");
  const sql = calls.map((call) => call.input || "").join("\n");
  assert.match(sql, /State - Rajesh Mehra\/matter\.json/);
  assert.doesNotMatch(sql, /State\/Rajesh Mehra\/matter\.json/);
});

test("runtime DB storage service preserves duplicate source identity in document custody", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-duplicate-upload-"));
  const firstFile = path.join(tmp, "notice-a.txt");
  const secondFile = path.join(tmp, "notice-b.txt");
  await writeFile(firstFile, "Same notice served on 1 January 2026.");
  await writeFile(secondFile, "Same notice served on 1 January 2026.");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [{}, {}]),
  });

  await service.createMatterFromUploadedFiles({
    name: "DB Duplicate Matter",
    metadata: { matterName: "DB Duplicate Matter" },
    files: [
      { index: 0, tempPath: firstFile, filename: "notice-a.txt", bytes: 37 },
      { index: 1, tempPath: secondFile, filename: "notice-b.txt", bytes: 37 },
    ],
    relativePaths: ["evidence/notice-a.txt", "evidence/notice-b.txt"],
  });

  const sql = calls.map((call) => call.input || "").join("\n");
  assert.match(sql, /duplicate_of_document_id/i);
  assert.match(sql, /FILE-0002[\s\S]+FILE-0001/i);
  assert.match(sql, /duplicate_of_document_id = excluded\.duplicate_of_document_id/i);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB storage service stamps uploaded matters with the current private beta user", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-owned-upload-"));
  const uploadedFile = path.join(tmp, "notice.txt");
  await writeFile(uploadedFile, "Notice served on 1 January 2026.");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [{}, {}]),
  });

  let actor;
  await runWithRequestContext({
    authenticated: true,
    user: { username: "shivangi@lawzeus.com", displayName: "Shivangi", role: "tester" },
  }, async () => {
    actor = runtimeDbUserFromRequestContext();
    await service.createMatterFromUploadedFiles({
      name: "Shivangi Matter",
      metadata: { matterName: "Shivangi Matter" },
      files: [{ index: 0, tempPath: uploadedFile, filename: "notice.txt", bytes: 31 }],
      relativePaths: ["evidence/notice.txt"],
    });
  });

  const sql = calls.map((call) => call.input || "").join("\n");
  assert.match(sql, /insert into users/i);
  assert.match(sql, /insert into tenant_memberships/i);
  assert.match(sql, /insert into matter_memberships/i);
  assert.match(sql, /created_by_user_id/i);
  assert.match(sql, new RegExp(actor.id, "i"));
  assert.match(sql, /shivangi@lawzeus\.com/i);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB storage service appends uploaded files to a new intake with payload bytes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-add-upload-"));
  const uploadedFile = path.join(tmp, "affidavit.pdf");
  await writeFile(uploadedFile, "%PDF-1.7 supplemental affidavit");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, input: options.input });
      const input = options.input || "";
      let payload = {};
      if (/from matters[\s\S]*for update/i.test(input)) {
        payload = {
        matter: { ...matter, nextFileNumber: 3 },
        nextIntakeNumber: 2,
        fileIdStart: 3,
        intakeDbId: "22222222-2222-4222-8222-222222222222",
        uploadSessionId: "33333333-3333-4333-8333-333333333333",
        receivedDate: "2026-06-08",
        };
      } else if (/object_rows/i.test(input)) {
        payload = {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
          storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 15, true),
        ],
        };
      } else if (/payload_rows/i.test(input) && /matter\.json/i.test(input)) {
        payload = payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption", intakes: [] }), "application/json");
      } else if (/payload_rows/i.test(input) && /List of Dates\.md/i.test(input)) {
        payload = payloadRow("DB Matter/10_Library/List of Dates.md", "# Old Dates\n");
      }
      return {
        status: 0,
        stdout: `${JSON.stringify(payload)}\n`,
        stderr: "",
      };
    },
  });

  const intakeAdded = await service.addUploadedFilesToMatter({
    matter,
    label: "Follow Up",
    files: [{ index: 0, tempPath: uploadedFile, filename: "affidavit.pdf", bytes: 29 }],
    relativePaths: ["supplement/affidavit.pdf"],
  });

  assert.equal(intakeAdded.intakeId, "INTAKE-02");
  assert.equal(intakeAdded.label, "Follow Up");
  assert.equal(intakeAdded.scanned, 1);
  assert.equal(intakeAdded.unique, 1);
  const sql = calls.map((call) => call.input || "").join("\n");
  const writeSql = calls.at(-1).input;
  assertTransactionWrapped(writeSql);
  assert.match(sql, /max\s*\(/i);
  assert.match(sql, /insert into matter_intakes/i);
  assert.match(sql, /insert into upload_sessions/i);
  assert.match(sql, /insert into matter_import_batches/i);
  assert.match(writeSql, /'zip_upload'/i);
  assert.doesNotMatch(writeSql, /'multipart_upload'/i);
  assert.match(sql, /insert into matter_import_items/i);
  assert.match(sql, /insert into documents/i);
  assert.match(sql, /insert into document_blobs/i);
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /insert into storage_object_payloads/i);
  assert.match(sql, /document_id/i);
  assert.match(writeSql, /DB Matter\/matter\.json/);
  assert.match(sql, /DB Matter\/00_Inbox\/Intake 02 - \d{4}-\d{2}-\d{2} Follow Up\/File Register\.csv/);
  assert.match(sql, /DB Matter\/00_Inbox\/Intake 02 - \d{4}-\d{2}-\d{2} Follow Up\/Originals\/supplement\/affidavit\.pdf/);
  assert.match(sql, /DB Matter\/00_Inbox\/Intake 02 - \d{4}-\d{2}-\d{2} Follow Up\/By Type\/PDFs\/FILE-0003__affidavit\.pdf/);
  assert.doesNotMatch(writeSql, /DB Matter\/10_Library\/List of Dates\.md/);
  assert.match(calls[0].input, /next_file_number\s*=\s*coalesce\(m\.next_file_number,\s*1\)\s*\+\s*1/i);
  assert.doesNotMatch(writeSql, /next_file_number\s*=\s*greatest/i);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB storage service rejects duplicate add-files paths before DB allocation", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [{}]),
  });

  await assert.rejects(
    () => service.addUploadedFilesToMatter({
      matter,
      files: [
        { index: 0, tempPath: "/tmp/first.txt", filename: "first.txt", bytes: 1 },
        { index: 1, tempPath: "/tmp/second.txt", filename: "second.txt", bytes: 1 },
      ],
      relativePaths: ["Evidence/notice.pdf", "evidence/notice.pdf"],
    }),
    (error) => error.statusCode === 400 && error.code === "upload.duplicate_paths",
  );
  assert.equal(calls.length, 0);
});

test("runtime DB storage service reserves add-files allocation under a matter row lock", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-locked-add-upload-"));
  const uploadedFile = path.join(tmp, "affidavit.pdf");
  await writeFile(uploadedFile, "%PDF-1.7 supplemental affidavit");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter: { ...matter, nextFileNumber: 3 },
        nextIntakeNumber: 2,
        fileIdStart: 3,
        intakeDbId: "22222222-2222-4222-8222-222222222222",
        uploadSessionId: "33333333-3333-4333-8333-333333333333",
        receivedDate: "2026-06-08",
      },
      { matter, objects: [] },
      {},
    ]),
  });

  await service.addUploadedFilesToMatter({
    matter,
    label: "Follow Up",
    files: [{ index: 0, tempPath: uploadedFile, filename: "affidavit.pdf", bytes: 29 }],
    relativePaths: ["supplement/affidavit.pdf"],
  });

  assert.equal(calls.length, 3);
  assertTransactionWrapped(calls[0].input);
  assert.match(calls[0].input, /from matters[\s\S]*for update/i);
  assert.match(calls[0].input, /update matters[\s\S]*next_file_number\s*=\s*coalesce\(m\.next_file_number,\s*1\)\s*\+\s*1/i);
  assert.match(calls[0].input, /insert into matter_intakes/i);
  assert.doesNotMatch(calls[2].input, /next_file_number\s*=\s*greatest/i);
  assert.match(calls[2].input, /'zip_upload'/i);
  assert.doesNotMatch(calls[2].input, /'multipart_upload'/i);
});

test("runtime DB storage service checks upload overlap from document hashes", async () => {
  const duplicateHash = "a".repeat(64);
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {
      warnings: [{
        matterName: "DB Matter",
        overlapCount: 1,
        totalIncoming: 3,
        matterTotalFiles: 3,
        overlapPercent: 67,
      }],
    }),
  });

  const result = await service.checkUploadedFileOverlap([
    duplicateHash,
    duplicateHash,
    "b".repeat(64),
  ]);

  assert.deepEqual(result.warnings, [{
    matterName: "DB Matter",
    overlapCount: 1,
    totalIncoming: 3,
    matterTotalFiles: 3,
    overlapPercent: 67,
  }]);
  const sql = calls.map((call) => call.input || "").join("\n");
  assert.equal((sql.match(new RegExp(duplicateHash, "g")) || []).length, 2);
  assert.match(sql, /from documents d/i);
  assert.match(sql, /from matters m/i);
  assert.match(sql, /d\.sha256/i);
  assert.match(sql, /deleted_pending/i);
  assert.doesNotMatch(sql, /File Register/i);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB storage service materializes DB payloads for read-only operations without persisting", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-read-"));
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption" }), "application/json"),
    ]),
  });

  const result = await service.runMaterializedMatterRead(matter, async ({ matterRoot }) => {
    const matterJson = await readFile(path.join(matterRoot, "matter.json"), "utf8");
    return JSON.parse(matterJson);
  });

  assert.deepEqual(result, { matterName: "Legal Caption" });
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls.map((call) => call.input || "").join("\n"), /insert into storage_objects/i);
});

test("runtime DB storage service keeps materialized read files alive until async operation finishes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-read-async-"));
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence([], [
      {
        matter,
        objects: [
          storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 8, true),
        ],
      },
      payloadRow("DB Matter/10_Library/List of Dates.md", "# Dates\n"),
    ]),
  });

  const result = await service.runMaterializedMatterRead(matter, async ({ matterRoot }) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return readFile(path.join(matterRoot, "10_Library", "List of Dates.md"), "utf8");
  });

  assert.equal(result, "# Dates\n");
});

test("runtime DB storage service rejects DB object keys that escape the matter root", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-path-escape-"));
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence([], [
      {
        matter,
        objects: [
          storageRow("DB Matter/../escaped.txt", "matter_artifact", "text/plain", 7, true),
        ],
      },
      payloadRow("DB Matter/../escaped.txt", "escaped", "text/plain"),
    ]),
  });

  await assert.rejects(
    () => service.runMaterializedMatterRead(matter, async () => ({ ok: true })),
    /invalid path|outside the matter root/i,
  );
});

test("runtime DB storage service synthesizes matter.json when DB storage has no matter artifact", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-materialize-synthetic-matter-"));
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    tempRoot: tmp,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 15, true),
        ],
      },
      payloadRow("DB Matter/10_Library/List of Dates.md", "# Dates\n"),
    ]),
  });

  const result = await service.runMaterializedMatterRead(matter, async ({ matterRoot }) => {
    const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
    const listOfDates = await readFile(path.join(matterRoot, "10_Library", "List of Dates.md"), "utf8");
    return { matterJson, listOfDates };
  });

  assert.deepEqual(result.matterJson, {
    matter_name: "Legal Caption",
    client_name: "Client A",
    opposite_party: "Other Side",
    matter_type: "Consumer",
    jurisdiction: "India",
    brief_description: "",
    intakes: [],
  });
  assert.equal(result.listOfDates, "# Dates\n");
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls.map((call) => call.input || "").join("\n"), /insert into storage_objects/i);
});

function storageRow(objectKey, objectRole, mimeType, sizeBytes, hasPayload, extras = {}) {
  return {
    objectKey,
    objectRole,
    mimeType,
    sizeBytes,
    hasPayload,
    ...extras,
  };
}

function payloadRow(objectKey, text, mimeType = "text/markdown") {
  const bytes = Buffer.from(text);
  return {
    objectKey,
    mimeType,
    sizeBytes: bytes.length,
    payloadBase64: bytes.toString("base64"),
    hasPayload: true,
  };
}

function jsonSpawn(calls, payload) {
  return (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    return {
      status: 0,
      stdout: `${JSON.stringify(payload)}\n`,
      stderr: "",
    };
  };
}

function jsonSpawnSequence(calls, payloads) {
  let index = 0;
  return (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return {
      status: 0,
      stdout: `${JSON.stringify(payload)}\n`,
      stderr: "",
    };
  };
}

function assertSafeRuntimeRoleGuard(sql) {
  assert.match(sql, /pg_roles/i);
  assert.match(sql, /rolsuper/i);
  assert.match(sql, /rolbypassrls/i);
  assert.match(sql, /current_user/i);
}

function assertTransactionWrapped(sql) {
  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /\bcommit;\s*$/i);
  assertSafeRuntimeRoleGuard(sql);
}
