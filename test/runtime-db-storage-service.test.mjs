import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, writeFile } from "node:fs/promises";
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

test("runtime DB storage service projects Matter Workbench story metadata into workspace", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence([], [
      {
        matter,
        objects: [storageRow("DB Matter/20_Workshop/The Story.md", "matter_artifact", "text/markdown", 30, true)],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({
        matter_name: "Legal Caption",
        client_name: "Client A",
        opposite_party: "Other Side",
        matter_type: "Consumer",
        jurisdiction: "India",
        brief_description: "Matter Workbench story.",
        original_intake_note: "Initial intake note.",
        brief_description_source: {
          author: "MW",
          type: "matter_workbench_story",
          based_on: "Current List of Dates",
          basis_artifact: "10_Library/List of Dates.md",
        },
      }), "application/json"),
    ]),
  });

  const workspace = await service.readWorkspace(matter);
  assert.equal(workspace.metadata.briefDescription, "Matter Workbench story.");
  assert.equal(workspace.metadata.originalIntakeNote, "Initial intake note.");
  assert.equal(workspace.metadata.briefDescriptionSource.author, "MW");
  assert.equal(workspace.metadata.briefDescriptionSource.basedOn, "Current List of Dates");
  assert.equal(workspace.metadata.briefDescriptionSource.basisArtifact, "10_Library/List of Dates.md");
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

test("runtime DB storage service exposes stable query parse and failure codes", async () => {
  const failed = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: () => ({
      status: 1,
      stdout: "",
      stderr: "could not connect postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    }),
  });
  await assert.rejects(
    () => failed.readWorkspace(matter),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.storage.query_failed");
      assert.doesNotMatch(error.message, /secret/);
      assert.match(error.message, /\*\*\*/);
      return true;
    },
  );

  const noJson = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: () => ({ status: 0, stdout: "NOTICE: no rows", stderr: "" }),
  });
  await assert.rejects(
    () => noJson.readWorkspace(matter),
    (error) => error.statusCode === 503 && error.code === "runtime_db.storage.no_json",
  );

  const invalidJson = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: () => ({ status: 0, stdout: "{", stderr: "" }),
  });
  await assert.rejects(
    () => invalidJson.readWorkspace(matter),
    (error) => error.statusCode === 503 && error.code === "runtime_db.storage.invalid_json",
  );
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

  const advice = await service.readRerunAdvice("describe-sources", matter);
  assert.equal(advice.skill, "/describe_sources");
  assert.equal(advice.state, "current");
  await assert.rejects(
    () => service.readRerunAdvice("/unknown", matter),
    (error) => error.statusCode === 400 && error.code === "rerun_advice.unsupported_skill",
  );
  assert.equal(plan.stages.every((stage) => stage.state === "current"), true);
});

test("runtime DB storage service can include Matter Story after current List of Dates", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "matter_artifact", "text/csv", 30, true),
          storageRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "extraction_payload", "application/json", 20, true, {
            updatedAt: "2026-06-20T09:00:00.000Z",
          }),
          storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", 17, true, {
            updatedAt: "2026-06-20T09:30:00.000Z",
          }),
          storageRow("DB Matter/10_Library/List of Dates.md", "matter_artifact", "text/markdown", 30, true, {
            updatedAt: "2026-06-20T11:00:00.000Z",
          }),
          storageRow("DB Matter/20_Workshop/The Story.md", "matter_artifact", "text/markdown", 30, true, {
            updatedAt: "2026-06-20T10:00:00.000Z",
          }),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({
        matter_name: "Legal Caption",
        client_name: "Client A",
        opposite_party: "Other Side",
        matter_type: "Consumer",
        jurisdiction: "India",
        brief_description: "Existing MW story.",
        brief_description_source: { author: "MW", type: "matter_workbench_story" },
      }), "application/json"),
    ]),
  });

  const plan = await service.readPrepareMatterPlan(matter, { includeDisputeStory: true });
  const storyStage = plan.stages.find((stage) => stage.slash === "/the_story");
  assert.equal(storyStage.state, "stale");
  assert.equal(storyStage.action, "confirm_paid_run");
  assert.equal(plan.nextStep.slash, "/the_story");
  assert.equal(plan.downstream.disputeStory.artifacts[0], "20_Workshop/The Story.md");
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


test("runtime DB storage service does not expose materialized workspace bridges", () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], { matter, objects: [] }),
  });

  assert.equal(Object.hasOwn(service, "runMaterializedMatterWrite"), false);
  assert.equal(Object.hasOwn(service, "runMaterializedMatterRead"), false);
});

test("runtime DB storage service reads synthesized matter.json metadata directly from DB custody", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {}),
  });

  assert.deepEqual(await service.readMatterJson(matter), {
    matter_name: "Legal Caption",
    client_name: "Client A",
    opposite_party: "Other Side",
    matter_type: "Consumer",
    jurisdiction: "India",
    brief_description: "",
    intakes: [],
  });
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

test("runtime DB storage service parameterizes large upload payload bytes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-large-upload-"));
  const uploadedFile = path.join(tmp, "large-notice.pdf");
  await writeFile(uploadedFile, Buffer.alloc(12, 7));
  const spawnCalls = [];
  const pgQueries = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(spawnCalls, [{}]),
    runtimeUploadParameterizedThresholdBytes: 1,
    createPgClient: () => fakePgClient(pgQueries),
  });

  await service.createMatterFromUploadedFiles({
    name: "DB Large Upload Matter",
    metadata: { matterName: "DB Large Upload Matter" },
    files: [{ index: 0, tempPath: uploadedFile, filename: "large-notice.pdf", bytes: 12 }],
    relativePaths: ["large-notice.pdf"],
  });

  assert.equal(spawnCalls.length, 1);
  assert.doesNotMatch(spawnCalls.map((call) => call.input || "").join("\n"), /decode\('/i);
  assert.equal(pgQueries[0].text, "begin");
  assert.equal(pgQueries.at(-1).text, "commit");
  assert.ok(pgQueries.some((query) => /insert into storage_objects/i.test(query.text || "")));
  const payloadQueries = pgQueries.filter((query) => /insert into storage_object_payloads/i.test(query.text || ""));
  assert.ok(payloadQueries.length > 0);
  assert.equal(payloadQueries.every((query) => Buffer.isBuffer(query.values?.[3])), true);
  assert.equal(payloadQueries.some((query) => query.values?.[3].length === 12), true);
  assert.doesNotMatch(JSON.stringify(pgQueries.map((query) => query.text)), /secret/);
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

test("runtime DB storage service exposes stable runtime upload error codes", async () => {
  const collisionService = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence([], [{ id: "existing-matter-id" }]),
  });
  await assert.rejects(
    () => collisionService.createMatterFromUploadedFiles({
      name: "DB Upload Matter",
      metadata: { matterName: "DB Upload Matter" },
      files: [{ index: 0, tempPath: "/tmp/not-read.txt", filename: "not-read.txt", bytes: 1 }],
      relativePaths: ["not-read.txt"],
    }),
    (error) => error.statusCode === 409
      && error.code === "runtime_db.upload.matter_exists"
      && /DB Upload Matter/.test(error.message),
  );

  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence([], [{}]),
  });
  await assert.rejects(
    () => service.addUploadedFilesToMatter({
      matter: { name: "DB Matter" },
      files: [{ index: 0, tempPath: "/tmp/not-read.txt", filename: "not-read.txt", bytes: 1 }],
      relativePaths: ["not-read.txt"],
    }),
    (error) => error.statusCode === 400
      && error.code === "runtime_db.upload.matter_id_required",
  );

  await assert.rejects(
    () => service.addUploadedFilesToMatter({
      matter,
      files: [{ index: 0, tempPath: "/tmp/not-read.txt", filename: "not-read.txt", bytes: 1 }],
      relativePaths: ["not-read.txt"],
    }),
    (error) => error.statusCode === 404
      && error.code === "runtime_db.upload.matter_not_found"
      && /DB Matter/.test(error.message),
  );
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

test("runtime DB storage service serializes add-files manifest merges for one matter", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-queued-add-upload-"));
  const firstFile = path.join(tmp, "first.pdf");
  const secondFile = path.join(tmp, "second.pdf");
  await writeFile(firstFile, "%PDF-1.7 first supplemental affidavit");
  await writeFile(secondFile, "%PDF-1.7 second supplemental affidavit");
  const calls = [];
  let allocationCount = 0;
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: (_command, _args, options = {}) => {
      const input = options.input || "";
      let kind = "other";
      let payload = {};
      if (/from matters[\s\S]*for update/i.test(input)) {
        allocationCount += 1;
        kind = `allocation-${allocationCount}`;
        payload = {
          matter: { ...matter, nextFileNumber: allocationCount + 2 },
          nextIntakeNumber: allocationCount + 1,
          fileIdStart: allocationCount + 2,
          intakeDbId: `${allocationCount}`.padStart(8, "0") + "-2222-4222-8222-222222222222",
          uploadSessionId: `${allocationCount}`.padStart(8, "0") + "-3333-4333-8333-333333333333",
          receivedDate: "2026-06-08",
        };
      } else if (/object_rows/i.test(input)) {
        kind = "workspace-read";
        payload = {
          matter,
          objects: [
            storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 20, true),
          ],
        };
      } else if (/payload_rows/i.test(input) && /matter\.json/i.test(input)) {
        kind = "payload-read";
        payload = payloadRow("DB Matter/matter.json", JSON.stringify({ matterName: "Legal Caption", intakes: [] }), "application/json");
      } else if (/insert into storage_objects/i.test(input)) {
        kind = "persist";
      }
      calls.push(kind);
      return {
        status: 0,
        stdout: `${JSON.stringify(payload)}\n`,
        stderr: "",
      };
    },
  });

  await Promise.all([
    service.addUploadedFilesToMatter({
      matter,
      label: "First Follow Up",
      files: [{ index: 0, tempPath: firstFile, filename: "first.pdf", bytes: 35 }],
      relativePaths: ["supplement/first.pdf"],
    }),
    service.addUploadedFilesToMatter({
      matter,
      label: "Second Follow Up",
      files: [{ index: 0, tempPath: secondFile, filename: "second.pdf", bytes: 36 }],
      relativePaths: ["supplement/second.pdf"],
    }),
  ]);

  const firstPersist = calls.indexOf("persist");
  const secondAllocation = calls.indexOf("allocation-2");
  assert.ok(firstPersist >= 0, "first add-files call should persist before the second starts");
  assert.ok(secondAllocation > firstPersist, `expected second allocation after first persist; calls: ${calls.join(", ")}`);
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

test("runtime DB storage service initializes matter artifacts directly from DB custody", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/Source Files/facts.txt", "source_working_copy", "text/plain", 82, true),
        ],
      },
      {},
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/Source Files/facts.txt", "Agreement signed on 20 April 2026.", "text/plain"),
      {},
    ]),
  });

  const result = await service.initializeMatter(matter, {
    metadata: { matterName: "Legal Caption", clientName: "Client A" },
    receivedDate: "2026-06-19",
  });

  assert.equal(result.operationResult.matterRoot, "postgres:DB Matter");
  assert.equal(result.operationResult.counts.scannedFiles, 1);
  assert.equal(result.operationResult.counts.uniqueFiles, 1);
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [
    "00_Inbox/Intake 01 - Initial/Originals/facts.txt",
    "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    "00_Inbox/Intake 01 - Initial/Intake Log.csv",
    "00_Inbox/Intake 01 - Initial/File Register.csv",
    "matter.json",
  ]);
  const sql = calls.at(-1).input;
  assert.match(sql, /00_Inbox\/Intake 01 - Initial\/Originals\/facts\.txt/);
  assert.match(sql, /00_Inbox\/Intake 01 - Initial\/By Type\/Text Notes\/FILE-0001__facts\.txt/);
  assert.match(sql, /matter\.json/);
});

test("runtime DB storage service extracts documents directly from DB custody", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 80, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/File Register.csv", "matter_artifact", "text/csv", 120, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt", "source_working_copy", "text/plain", 82, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({
        matter_name: "Legal Caption",
        client_name: "Client A",
        intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
      }), "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/File Register.csv", [
        "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status",
        "FILE-0001,INTAKE-01,source/facts.txt,,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,facts.txt,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,82,,unique",
        "",
      ].join("\n"), "text/csv"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt", "Agreement signed on 20 April 2026.\n\nNotice followed on 1 May 2026.", "text/plain"),
      {},
      {},
    ]),
  });

  const result = await service.extractDocuments(matter, { forceRefresh: true });

  assert.equal(result.operationResult.matterRoot, "postgres:DB Matter");
  assert.equal(result.operationResult.counts.extracted, 1);
  assert.equal(result.operationResult.counts.failed, 0);
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [
    "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json",
    "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.txt",
    "00_Inbox/Intake 01 - Initial/Extraction Log.csv",
  ]);
  const sql = calls.at(-1).input;
  assert.match(sql, /_extracted\/FILE-0001\.json/);
  assert.match(sql, /_extracted\/FILE-0001\.txt/);
  assert.match(sql, /Extraction Log\.csv/);
});

test("runtime DB storage service describes sources directly from DB custody", async () => {
  const extractionRecord = {
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    engine: "text-extract@test",
    page_count: 1,
    warnings: [],
    pages: [{
      page: 1,
      confidence_avg: 0.98,
      needs_review: false,
      blocks: [{ id: "p1.b1", type: "paragraph", text: "The agreement was signed on 20 April 2026." }],
    }],
  };
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 80, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", "extraction_payload", "application/json", 500, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matter_name: "Legal Caption", client_name: "Client A" }), "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", JSON.stringify(extractionRecord), "application/json"),
      {},
    ]),
  });

  const result = await service.describeSources(matter, {
    generatedAt: "2026-06-19T00:00:00.000Z",
    sourceDescriptorProvider: async ({ sources }) => ({
      sources: sources.map((source) => ({
        file_id: source.file_id,
        sha256: source.sha256,
        source_path: source.source_path,
        display_label: "Agreement note dated 20 April 2026",
        short_label: "Agreement note",
        document_type: "agreement",
        document_date: "2026-04-20",
        date_basis: "body_text",
        parties: {
          from: "",
          to: [],
          cc: [],
          author: "",
          court: "",
          judge: "",
          issuing_party: "Runtime Client",
          recipient_party: "Other Side",
          deponent: "",
          signatory: "Runtime Client",
        },
        confidence: 0.9,
        needs_review: false,
        evidence: [{ citation: source.blocks[0].citation, reason: "The source text states the agreement date." }],
        warnings: [],
      })),
    }),
  });

  assert.equal(result.operationResult.matterRoot, "postgres:DB Matter");
  assert.equal(result.operationResult.artifact.sources[0].display_label, "Agreement note dated 20 April 2026");
  assert.deepEqual(result.persisted.map((item) => item.relativePath), ["10_Library/Source Index.json"]);
  assert.match(calls.at(-1).input, /10_Library\/Source Index\.json/);
});

test("runtime DB storage service creates List of Dates directly from DB custody", async () => {
  const extractionRecord = {
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    engine: "text-extract@test",
    page_count: 1,
    warnings: [],
    pages: [{
      page: 1,
      confidence_avg: 0.98,
      needs_review: false,
      blocks: [{ id: "p1.b1", type: "paragraph", text: "The agreement was signed on 20 April 2026." }],
    }],
  };
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 80, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/File Register.csv", "matter_artifact", "text/csv", 120, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", "extraction_payload", "application/json", 500, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matter_name: "Legal Caption", client_name: "Client A" }), "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", JSON.stringify(extractionRecord), "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/File Register.csv", [
        "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status",
        "FILE-0001,INTAKE-01,source/facts.txt,,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,facts.txt,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,42,,unique",
        "",
      ].join("\n"), "text/csv"),
      {},
    ]),
  });

  const result = await service.createListOfDates(matter, {
    generatedAt: "2026-06-19T00:00:00.000Z",
    aiProvider: async ({ chunk }) => ({
      entries: [{
        date_iso: "2026-04-20",
        date_text: "20 April 2026",
        event: "The agreement was signed.",
        event_type: "agreement",
        legal_relevance: "Supports the contract chronology.",
        issue_tags: ["agreement"],
        perspective: "client_favourable",
        citation: chunk[0].citation,
        needs_review: false,
        confidence: 0.9,
      }],
    }),
  });

  assert.equal(result.operationResult.matterRoot, "postgres:DB Matter");
  assert.equal(result.operationResult.counts.entries, 1);
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [
    "10_Library/List of Dates.json",
    "10_Library/List of Dates.csv",
    "10_Library/List of Dates.md",
  ]);
  assert.match(calls.at(-1).input, /10_Library\/List of Dates\.json/);
  assert.match(calls.at(-1).input, /10_Library\/List of Dates\.csv/);
  assert.match(calls.at(-1).input, /10_Library\/List of Dates\.md/);
});

test("runtime DB storage service creates two-pass List of Dates directly from DB custody", async () => {
  const extractionRecord = {
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    engine: "text-extract@test",
    page_count: 1,
    warnings: [],
    pages: [{
      page: 1,
      confidence_avg: 0.98,
      needs_review: false,
      blocks: [{ id: "p1.b1", type: "paragraph", text: "The agreement was signed on 20 April 2026." }],
    }],
  };
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", 80, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/File Register.csv", "matter_artifact", "text/csv", 120, true),
          storageRow("DB Matter/00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", "extraction_payload", "application/json", 500, true),
        ],
      },
      payloadRow("DB Matter/matter.json", JSON.stringify({ matter_name: "Legal Caption", client_name: "Client A" }), "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", JSON.stringify(extractionRecord), "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01 - Initial/File Register.csv", [
        "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status",
        "FILE-0001,INTAKE-01,source/facts.txt,,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,facts.txt,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,42,,unique",
        "",
      ].join("\n"), "text/csv"),
      {},
      {},
      {},
    ]),
  });

  const result = await service.createListOfDates(matter, {
    twoPass: true,
    generatedAt: "2026-06-19T00:00:00.000Z",
    pass1Provider: async ({ chunk }) => ({
      candidates: [{
        date_iso: "2026-04-20",
        date_text: "20 April 2026",
        event_candidate: "The agreement was signed.",
        legal_materiality: "Supports the contract chronology.",
        citation: chunk[0].citation,
        source_excerpt: chunk[0].text,
        candidate_type: "agreement",
        party_posture: "helps_client",
        confidence: 0.9,
      }],
    }),
    pass2Provider: async ({ candidates }) => ({
      entries: [{
        date_iso: "2026-04-20",
        date_text: "20 April 2026",
        event: "The agreement was signed.",
        event_type: "agreement",
        legal_relevance: "Supports the contract chronology.",
        issue_tags: ["agreement"],
        perspective: "client_favourable",
        citation: candidates[0].citation,
        needs_review: false,
        confidence: 0.9,
      }],
    }),
  });

  assert.equal(result.operationResult.generationMode, "two_pass");
  assert.equal(result.operationResult.counts.acceptedCandidates, 1);
  assert.equal(result.operationResult.counts.entries, 1);
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [
    "10_Library/List of Dates Candidates.json",
    "10_Library/List of Dates.json",
    "10_Library/List of Dates.csv",
    "10_Library/List of Dates.md",
  ]);
  assert.match(calls.at(-2).input, /10_Library\/List of Dates Candidates\.json/);
  assert.match(calls.at(-1).input, /10_Library\/List of Dates\.json/);
  assert.match(calls.at(-1).input, /10_Library\/List of Dates\.csv/);
  assert.match(calls.at(-1).input, /10_Library\/List of Dates\.md/);
});

test("runtime DB storage service reads and persists matter.json directly in DB custody", async () => {
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      payloadRow("DB Matter/matter.json", JSON.stringify({
        matter_name: "Legal Caption",
        intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
      }), "application/json"),
      {},
    ]),
  });

  const matterJson = await service.readMatterJson(matter);
  const persisted = await service.persistMatterJson(matter, {
    ...matterJson,
    brief_description: "Runtime story description.",
  });

  assert.equal(matterJson.matter_name, "Legal Caption");
  assert.deepEqual(matterJson.intakes, [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }]);
  assert.deepEqual(persisted.map((item) => item.relativePath), ["matter.json"]);
  assert.match(calls.at(-1).input, /insert into storage_objects/i);
  assert.match(calls.at(-1).input, /matter\.json/);
});

test("runtime DB storage service synthesizes matter.json metadata when DB custody has no matter artifact", async () => {
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn([], {}),
  });

  const matterJson = await service.readMatterJson(matter);

  assert.deepEqual(matterJson, {
    matter_name: "Legal Caption",
    client_name: "Client A",
    opposite_party: "Other Side",
    matter_type: "Consumer",
    jurisdiction: "India",
    brief_description: "",
    intakes: [],
  });
});

test("runtime DB storage service refreshes List of Dates labels directly in DB custody", async () => {
  const matterJson = {
    matter_name: "Legal Caption",
    client_name: "Client A",
  };
  const listJson = {
    schema_version: "list-of-dates/v1",
    engine_version: "create-listofdates-v1-ai",
    source_record_count: 1,
    source_snapshot: [{
      file_id: "FILE-0001",
      source_id: "FILE-0001",
      content_hash: "hash-source",
      document_type: "agreement",
      document_date: "2026-04-20",
      needs_review: false,
      source_label: "Old label",
      source_short_label: "Old",
    }],
    entries: [{
      date_iso: "2026-04-20",
      date_text: "20 April 2026",
      event: "Agreement was signed.",
      event_type: "agreement",
      legal_relevance: "Supports the chronology.",
      issue_tags: ["agreement"],
      perspective: "client_favourable",
      citation: "FILE-0001 p1.b1",
      source_file_id: "FILE-0001",
      source_id: "FILE-0001",
      content_hash: "hash-source",
      source_label: "Old label",
      source_short_label: "Old",
      file_id: "FILE-0001",
      source_path: "source/agreement.pdf",
      page: 1,
      block_id: "p1.b1",
      needs_review: false,
      confidence: 0.9,
    }],
  };
  const sourceIndex = {
    schema_version: "source-index/v1",
    sources: [{
      file_id: "FILE-0001",
      source_id: "FILE-0001",
      content_hash: "hash-source",
      display_label: "Agreement note dated 20 April 2026",
      short_label: "Agreement note",
      document_type: "agreement",
      document_date: "2026-04-20",
      needs_review: false,
      label_status: "suggested",
      label_revision: 2,
    }],
  };
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      payloadRow("DB Matter/matter.json", JSON.stringify(matterJson), "application/json"),
      payloadRow("DB Matter/10_Library/List of Dates.json", JSON.stringify(listJson), "application/json"),
      payloadRow("DB Matter/10_Library/Source Index.json", JSON.stringify(sourceIndex), "application/json"),
      {},
    ]),
  });

  const result = await service.refreshListOfDatesSourceLabels(matter, { generatedAt: "2026-06-19T00:00:00.000Z" });

  assert.equal(result.operationResult.refreshMode, "label_refresh");
  assert.equal(result.operationResult.counts.refreshedEntries, 1);
  assert.equal(result.operationResult.entries[0].source_label, "Agreement note dated 20 April 2026");
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [
    "10_Library/List of Dates.json",
    "10_Library/List of Dates.csv",
    "10_Library/List of Dates.md",
  ]);
  const sql = calls.at(-1).input;
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /10_Library\/List of Dates\.json/);
  assert.match(sql, /10_Library\/List of Dates\.csv/);
  assert.match(sql, /10_Library\/List of Dates\.md/);
});

test("runtime DB storage service scans legacy layout directly from DB payload custody", async () => {
  const matterJson = JSON.stringify({
    matter_name: "Legal Caption",
    phase_1_intake: {
      load_id: "INTAKE-01",
      load_dir: "00_Inbox/Load_01_Initial",
    },
  });
  const fileRegister = [
    "raw_file_id,load_id,preserved_path,arranged_path,source_sha256",
    "FILE-0001,INTAKE-01,raw_source_files/agreement.pdf,arranged_files/documents_pdf/agreement.pdf,sha-source",
  ].join("\n");
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence([], [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", matterJson.length, true),
          storageRow("DB Matter/00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv", "matter_artifact", "text/csv", fileRegister.length, true),
          storageRow("DB Matter/00_Inbox/Load_01_Initial/arranged_files/documents_pdf/agreement.pdf", "source_working_copy", "application/pdf", 120, true),
        ],
      },
      payloadRow("DB Matter/00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv", fileRegister, "text/csv"),
      payloadRow("DB Matter/matter.json", matterJson, "application/json"),
    ]),
  });

  const scan = await service.readDoctorScan(matter);

  assert.equal(scan.issues.length, 1);
  assert.equal(scan.issues[0].id, "legacy-layout");
  assert.equal(scan.issues[0].evidence.legacyLoadDir, "Load_01_Initial");
  assert.equal(scan.issues[0].evidence.hasLegacyNormalizationCsv, true);
  assert.equal(scan.issues[0].evidence.hasLegacyMatterJsonKey, true);
  assert.deepEqual(scan.issues[0].evidence.legacyCsvColumns.slice(0, 2), ["raw_file_id", "load_id"]);
  assert.match(scan.issues[0].description, /Load_01_Initial/);
});

test("runtime DB storage service fixes legacy layout directly from DB payload custody", async () => {
  const matterJson = JSON.stringify({
    matter_name: "Legal Caption",
    phase_1_intake: {
      load_id: "INTAKE-01",
      load_dir: "00_Inbox/Load_01_Initial",
      raw_source_dir: "00_Inbox/Load_01_Initial/raw_source_files",
      arranged_dir: "00_Inbox/Load_01_Initial/arranged_files",
      normalization_log: "00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv",
      duplicate_files: 0,
    },
  }, null, 2);
  const fileRegister = [
    "raw_file_id,load_id,preserved_path,arranged_path,source_sha256",
    "FILE-0001,INTAKE-01,00_Inbox/Load_01_Initial/raw_source_files/agreement.pdf,00_Inbox/Load_01_Initial/arranged_files/documents_pdf/agreement.pdf,sha-source",
  ].join("\n");
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_artifact", "application/json", matterJson.length, true),
          storageRow("DB Matter/00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv", "matter_artifact", "text/csv", fileRegister.length, true),
          storageRow("DB Matter/00_Inbox/Load_01_Initial/raw_source_files/agreement.pdf", "source_original", "application/pdf", 8, true),
          storageRow("DB Matter/00_Inbox/Load_01_Initial/arranged_files/documents_pdf/agreement.pdf", "source_working_copy", "application/pdf", 8, true),
        ],
      },
      payloadRow("DB Matter/00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv", fileRegister, "text/csv"),
      payloadRow("DB Matter/matter.json", matterJson, "application/json"),
      payloadRow("DB Matter/00_Inbox/Load_01_Initial/arranged_files/documents_pdf/agreement.pdf", "%PDF new", "application/pdf"),
      payloadRow("DB Matter/00_Inbox/Load_01_Initial/raw_source_files/agreement.pdf", "%PDF raw", "application/pdf"),
      {},
      {},
    ]),
  });

  const result = await service.fixDoctorIssues(matter, ["legacy-layout"], {
    generatedAt: "2026-06-19T09:00:00.000Z",
  });

  assert.equal(result.operationResult.applied.length, 1);
  assert.equal(result.operationResult.applied[0].backupDir, ".doctor-backups/2026-06-19T09-00-00-000Z");
  assert.deepEqual(result.operationResult.failed, []);
  assert.deepEqual(result.operationResult.remaining, []);
  assert.deepEqual(result.persisted.map((item) => item.relativePath), [
    ".doctor-backups/2026-06-19T09-00-00-000Z/matter.json",
    ".doctor-backups/2026-06-19T09-00-00-000Z/Load_01_Initial__Inbox_Normalization_Log.csv",
    "00_Inbox/Intake 01 - Initial/By Type/PDFs/agreement.pdf",
    "00_Inbox/Intake 01 - Initial/Originals/agreement.pdf",
    "00_Inbox/Intake 01 - Initial/File Register.csv",
    "matter.json",
  ]);
  assert.deepEqual(result.deleted.map((item) => item.relativePath), [
    "00_Inbox/Load_01_Initial/arranged_files/documents_pdf/agreement.pdf",
    "00_Inbox/Load_01_Initial/raw_source_files/agreement.pdf",
    "00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv",
  ]);
  const persistSql = calls.at(-2).input;
  assert.match(persistSql, /00_Inbox\/Intake 01 - Initial\/File Register\.csv/);
  assert.match(persistSql, /00_Inbox\/Intake 01 - Initial\/By Type\/PDFs\/agreement\.pdf/);
  const deleteSql = calls.at(-1).input;
  assert.match(deleteSql, /deleted_pending/);
  assert.match(deleteSql, /00_Inbox\/Load_01_Initial\/Inbox_Normalization_Log\.csv/);
});

test("runtime DB storage service builds matter context packets directly from DB payload custody", async () => {
  const matterJson = JSON.stringify({
    matter_name: "Legal Caption",
    client_name: "Client A",
    opposite_party: "Other Side",
    matter_type: "Consumer",
    jurisdiction: "India",
    intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01" }],
  });
  const fileRegister = [
    "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status",
    "FILE-0001,INTAKE-01,00_Inbox/Intake 01/Source Files/agreement.pdf,00_Inbox/Intake 01/Originals/agreement.pdf,00_Inbox/Intake 01/Source Files/agreement.pdf,pdf,agreement.pdf,sha-source,120,,unique",
  ].join("\n");
  const sourceIndex = JSON.stringify({
    schema_version: "source-index/v1",
    sources: [{
      file_id: "FILE-0001",
      sha256: "sha-source",
      source_path: "00_Inbox/Intake 01/Source Files/agreement.pdf",
      display_label: "Agreement dated 1 Jan",
      short_label: "Agreement",
    }],
  });
  const extractionRecord = JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: "sha-source",
    source_path: "00_Inbox/Intake 01/Source Files/agreement.pdf",
    engine: "test-extract",
    pages: [{
      page: 1,
      confidence_avg: 0.98,
      blocks: [{ id: "p1.b1", type: "text", text: "The agreement requires payment on 1 January." }],
    }],
  });
  const calls = [];
  const service = createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      {
        matter,
        objects: [
          storageRow("DB Matter/matter.json", "matter_metadata", "application/json", matterJson.length, true),
          storageRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "matter_artifact", "text/csv", fileRegister.length, true),
          storageRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "extraction_payload", "application/json", extractionRecord.length, true),
          storageRow("DB Matter/10_Library/Source Index.json", "matter_artifact", "application/json", sourceIndex.length, true),
        ],
      },
      payloadRow("DB Matter/matter.json", matterJson, "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01/File Register.csv", fileRegister, "text/csv"),
      payloadRow("DB Matter/10_Library/Source Index.json", sourceIndex, "application/json"),
      payloadRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", extractionRecord, "application/json"),
      payloadRow("DB Matter/10_Library/Source Index.json", sourceIndex, "application/json"),
    ]),
  });

  const packet = await service.readMatterContextPacket(matter, { generatedAt: "2026-06-19T00:00:00.000Z" });

  assert.equal(packet.schema_version, "matter-context-packet/v1");
  assert.equal(packet.matter.folder_name, "DB Matter");
  assert.equal(packet.matter.matter_name, "Legal Caption");
  assert.equal(packet.sources[0].source_label, "Agreement dated 1 Jan");
  assert.equal(packet.evidence_blocks[0].citation, "FILE-0001 p1.b1");
  assert.match(packet.evidence_blocks[0].text, /requires payment/);
  assert.equal(packet.library_artifacts[0].kind, "source_index");
  assert.equal(calls.length, 6);
  assert.doesNotMatch(calls.map((call) => call.input || "").join("\n"), /mwb-runtime-db-/);
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

function fakePgClient(queries) {
  return {
    connect: async () => {},
    query: async (text, values) => {
      queries.push({ text, values });
      return { rows: [] };
    },
    end: async () => {},
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
