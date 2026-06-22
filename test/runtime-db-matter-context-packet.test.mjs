import assert from "node:assert/strict";
import test from "node:test";

import { readTrustedSourceDescriptors } from "../services/runtime-db-matter-context-packet.mjs";

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
