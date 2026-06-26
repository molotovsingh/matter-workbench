import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeDbMatterContextPacket,
  readTrustedSourceDescriptors,
} from "../services/runtime-db-matter-context-packet.mjs";
import { buildRuntimeWorkspaceTree } from "../services/runtime-db-workspace-read-model.mjs";

test("runtime DB matter context trusts only current source descriptors", () => {
  const warnings = [];
  const registerByFileId = new Map([
    ["FILE-0001", {
      file_id: "FILE-0001",
      sha256: "hash-1",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/notice.pdf",
      working_copy_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__notice.pdf",
    }],
    ["FILE-0002", {
      file_id: "FILE-0002",
      sha256: "hash-2",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/agreement.pdf",
      working_copy_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__agreement.pdf",
    }],
  ]);
  const artifact = {
    schema_version: "source-index/v1",
    sources: [
      {
        file_id: "FILE-0001",
        sha256: "hash-1",
        source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__notice.pdf",
        display_label: "Demand notice dated 1 January 2026",
        short_label: "Demand notice",
      },
      {
        file_id: "FILE-0002",
        sha256: "stale-hash",
        source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__agreement.pdf",
        display_label: "Agreement",
      },
      {
        file_id: "FILE-0003",
        sha256: "hash-3",
        source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0003__missing.pdf",
        display_label: "Missing register row",
      },
      {
        file_id: "FILE-0002",
        sha256: "hash-2",
        source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__agreement.pdf",
        display_label: "FILE-0002 agreement",
      },
    ],
  };

  const descriptors = readTrustedSourceDescriptors({
    readText: (relativePath) => relativePath === "10_Library/Source Index.json" ? JSON.stringify(artifact) : null,
    registerByFileId,
    warnings,
  });

  assert.deepEqual([...descriptors.keys()], ["FILE-0001"]);
  assert.equal(descriptors.get("FILE-0001").display_label, "Demand notice dated 1 January 2026");
  assert.match(warnings.join("\n"), /FILE-0002: sha256 does not match current register/);
  assert.match(warnings.join("\n"), /FILE-0003: file_id is not in current registers/);
  assert.match(warnings.join("\n"), /human label contains a FILE-NNNN identifier/);
});

test("runtime DB matter context filters inactive register rows from active packet", () => {
  const payloads = new Map([
    ["matter.json", JSON.stringify({
      matter_name: "Runtime Matter",
      intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
    })],
    ["00_Inbox/Intake 01 - Initial/File Register.csv", [
      "file_id,intake_id,source_path,working_copy_path,category,original_name,sha256,status",
      "FILE-0001,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__active.txt,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__active.txt,Text Notes,active.txt,hash-1,unique",
      "FILE-0002,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0002__removed.txt,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0002__removed.txt,Text Notes,removed.txt,hash-2,removed_from_active_record",
    ].join("\n")],
    ["00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json", JSON.stringify({
      schema_version: "extraction-record/v1",
      file_id: "FILE-0001",
      sha256: "hash-1",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__active.txt",
      pages: [{ page: 1, blocks: [{ id: "p1.b1", text: "Active text." }] }],
    })],
    ["00_Inbox/Intake 01 - Initial/_extracted/FILE-0002.json", JSON.stringify({
      schema_version: "extraction-record/v1",
      file_id: "FILE-0002",
      sha256: "hash-2",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0002__removed.txt",
      pages: [{ page: 1, blocks: [{ id: "p1.b1", text: "Removed text." }] }],
    })],
  ]);
  const workspace = {
    tree: buildRuntimeWorkspaceTree({
      matter: { name: "Runtime Matter" },
      objects: [...payloads.keys()].map((relativePath) => ({
        objectKey: `Runtime Matter/${relativePath}`,
        objectRole: relativePath.includes("_extracted") ? "extraction_payload" : "matter_artifact",
        hasPayload: true,
        sizeBytes: Buffer.byteLength(payloads.get(relativePath) || ""),
      })),
    }).root,
  };

  const packet = buildRuntimeDbMatterContextPacket({
    matter: { id: "11111111-1111-4111-8111-111111111111", name: "Runtime Matter" },
    workspace,
    readPayloadRow: ({ relativePath }) => ({ bytes: Buffer.from(payloads.get(relativePath) || ""), sizeBytes: Buffer.byteLength(payloads.get(relativePath) || "") }),
  });

  assert.deepEqual(packet.file_registers[0].rows.map((row) => row.file_id), ["FILE-0001"]);
  assert.deepEqual(packet.sources.map((source) => source.file_id), ["FILE-0001"]);
  assert.doesNotMatch(JSON.stringify(packet), /Removed text/);
  assert.match(packet.warnings.join("\n"), /Suppressed FILE-0002 from active source set/);
});

test("runtime DB matter context rejects malformed source index payloads", () => {
  const warnings = [];
  const descriptors = readTrustedSourceDescriptors({
    readText: () => JSON.stringify({ schema_version: "source-index/v0", sources: [] }),
    registerByFileId: new Map(),
    warnings,
  });

  assert.equal(descriptors.size, 0);
  assert.deepEqual(warnings, ["Skipped 10_Library/Source Index.json: unrecognized source index schema"]);
});
