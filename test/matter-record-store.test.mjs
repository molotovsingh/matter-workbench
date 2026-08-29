import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canUseCachedExtraction } from "../extract-engine.mjs";
import { toCsv } from "../shared/csv.mjs";
import { FILE_REGISTER_HEADERS } from "../shared/matter-contract.mjs";
import { createFilesystemMatterRecordStore } from "../services/matter-record-store/filesystem-matter-record-store.mjs";
import { createV4ExtractionImportService } from "../services/v4-extraction-import-service.mjs";

// The storage port every adapter must satisfy. Each case maps to a MUST or
// MUST NOT in specs/001-v4-record-parity/contracts/matter-record-store.md.
//
// This file is deliberately adapter-agnostic below the fixture boundary: the
// same cases are run against every adapter, so a case cannot exist for one
// arrangement and be quietly absent for the other. That is the executable form
// of the parity claim — see contracts P1-P5.

async function makeMatter(home, name, { intakes = [] } = {}) {
  const root = path.join(home, name);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({ intakes }, null, 2));
  return root;
}

const FILESYSTEM_ADAPTER = {
  name: "filesystem",
  async create() {
    const home = await mkdtemp(path.join(os.tmpdir(), "mrs-fs-"));
    return {
      home,
      store: createFilesystemMatterRecordStore({ mattersHome: home }),
      async addMatter(name, options) { return makeMatter(home, name, options); },
      async cleanup() { await rm(home, { recursive: true, force: true }); },
    };
  },
};

const ADAPTERS = [FILESYSTEM_ADAPTER];

for (const adapter of ADAPTERS) {
  test(`${adapter.name}: resolveMatter returns a handle for an existing matter`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Rekha v Ashvarya Garg");
      const handle = await fixture.store.resolveMatter({ folderName: "Rekha v Ashvarya Garg" });
      assert.ok(handle, "an existing matter must resolve to a handle");
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: resolveMatter returns null when nothing matches`, async () => {
    const fixture = await adapter.create();
    try {
      const handle = await fixture.store.resolveMatter({ folderName: "No Such Matter", slug: "No-Such-Matter" });
      assert.equal(handle, null, "an unknown matter must resolve to null, not throw");
    } finally {
      await fixture.cleanup();
    }
  });

  // Constitution III: decline rather than choose. FR-009.
  test(`${adapter.name}: resolveMatter never treats a path as a matter name`, async () => {
    const fixture = await adapter.create();
    try {
      for (const hostile of ["../escape", "a/b", "..", "/etc"]) {
        const handle = await fixture.store.resolveMatter({ folderName: hostile });
        assert.equal(handle, null, `"${hostile}" must not resolve to a matter`);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: resolveMatter has no side effects`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.store.resolveMatter({ folderName: "Invented Matter" });
      const again = await fixture.store.resolveMatter({ folderName: "Invented Matter" });
      assert.equal(again, null, "resolving must never create the matter it failed to find");
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: readText returns null for an absent file, not an error`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Alpha");
      const handle = await fixture.store.resolveMatter({ folderName: "Alpha" });
      assert.equal(await fixture.store.readText(handle, "_extracted/FILE-0001.json"), null);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: writeText then readText round-trips exactly`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Alpha");
      const handle = await fixture.store.resolveMatter({ folderName: "Alpha" });
      const payload = `{"schema_version":"extraction-record/v1"}\n`;
      await fixture.store.writeText(handle, "_extracted/FILE-0001.json", payload, { mimeType: "application/json" });
      assert.equal(await fixture.store.readText(handle, "_extracted/FILE-0001.json"), payload);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: writeText replaces an existing file completely`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Alpha");
      const handle = await fixture.store.resolveMatter({ folderName: "Alpha" });
      await fixture.store.writeText(handle, "notes.txt", "a much longer original value");
      await fixture.store.writeText(handle, "notes.txt", "short");
      assert.equal(await fixture.store.readText(handle, "notes.txt"), "short", "no residue from the longer value");
    } finally {
      await fixture.cleanup();
    }
  });

  // research R2: the display-oriented reader caps size. Filing must not inherit
  // that cap, or large matters fail for a reason unrelated to filing.
  test(`${adapter.name}: readText applies no size limit`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Alpha");
      const handle = await fixture.store.resolveMatter({ folderName: "Alpha" });
      const large = "x".repeat(3 * 1024 * 1024);
      await fixture.store.writeText(handle, "big.csv", large);
      const read = await fixture.store.readText(handle, "big.csv");
      assert.equal(read?.length, large.length, "a 3 MB matter file must read back whole");
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: reads and writes are confined to the matter`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Alpha");
      await fixture.addMatter("Beta");
      const handle = await fixture.store.resolveMatter({ folderName: "Alpha" });
      for (const escape of ["../Beta/matter.json", "../../etc/passwd", "/etc/passwd"]) {
        await assert.rejects(() => fixture.store.readText(handle, escape), `read of "${escape}" must be an error, not a miss`);
        await assert.rejects(() => fixture.store.writeText(handle, escape, "x"), `write to "${escape}" must be refused`);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${adapter.name}: writeText creates intermediate structure`, async () => {
    const fixture = await adapter.create();
    try {
      await fixture.addMatter("Alpha");
      const handle = await fixture.store.resolveMatter({ folderName: "Alpha" });
      await fixture.store.writeText(handle, "deep/nested/path/file.txt", "ok");
      assert.equal(await fixture.store.readText(handle, "deep/nested/path/file.txt"), "ok");
    } finally {
      await fixture.cleanup();
    }
  });
}

// The property parity testing structurally cannot prove.
//
// Every other assertion here and in v4-record-parity.test.mjs compares the two
// arrangements to each other. If a refactor made BOTH adapters write records the
// extract engine refuses to reuse, every comparison would still pass and the
// whole feature would be worthless: preparation would silently re-read every
// document it was supposed to skip. So this asserts the property absolutely,
// against the real gate preparation uses. FR-008, SC-003.
test("filesystem: a written record is accepted by the extract engine's reuse gate", async () => {
  const fixture = await FILESYSTEM_ADAPTER.create();
  try {
    const intakeDir = "00_Inbox/Intake 01";
    const sha256 = "a".repeat(64);
    await fixture.addMatter("Reuse Matter", { intakes: [{ intake_id: "INTAKE-01", intake_dir: intakeDir }] });
    const handle = await fixture.store.resolveMatter({ folderName: "Reuse Matter" });
    const row = {
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      sha256,
      status: "copied",
      source_path: "in/order.pdf",
      working_copy_path: `${intakeDir}/FILE-0001 order.pdf`,
    };
    await fixture.store.writeText(handle, `${intakeDir}/File Register.csv`, toCsv([row], FILE_REGISTER_HEADERS));

    const service = createV4ExtractionImportService({ store: fixture.store });
    const summary = await service.importExtractionResult({
      matterFolderName: "Reuse Matter",
      intakeId: "INTAKE-V4",
      resultId: "RESULT-1",
      documents: [{
        sha256,
        originalName: "order.pdf",
        pages: [{
          pageNumber: 1,
          outcome: "accepted",
          text: "IN THE COURT\n\nORDER: the application is allowed.",
          provenance: { provider: "gemini", model: "gemini-3.7-flash" },
        }],
      }],
    });
    assert.deepEqual(summary.imported, ["FILE-0001"], "precondition: the document must have been filed");

    const written = JSON.parse(await fixture.store.readText(handle, `${intakeDir}/_extracted/FILE-0001.json`));
    assert.equal(
      canUseCachedExtraction(written, row, { fingerprint: "pdf-ocr-v1" }, { ocrProvider: () => {}, forceRefresh: false }),
      true,
      "preparation must reuse this record rather than silently re-reading the document",
    );
  } finally {
    await fixture.cleanup();
  }
});

// The filesystem adapter alone keeps the two-step resolution: a matter's folder
// name can differ from its display name, so the simplified identifier is matched
// against directory entries. The database arrangement derives its key from the
// name and cannot have that divergence — research R3 records why this asymmetry
// is deliberate rather than a parity break.
test("filesystem: resolveMatter falls back to the simplified identifier", async () => {
  const fixture = await FILESYSTEM_ADAPTER.create();
  try {
    await fixture.addMatter("Rekha-v-Ashvarya-Garg");
    const handle = await fixture.store.resolveMatter({
      folderName: "Rekha v Ashvarya Garg",
      slug: "Rekha-v-Ashvarya-Garg",
    });
    assert.ok(handle, "a display name that does not match the folder must still resolve via the slug");
    await fixture.store.writeText(handle, "probe.txt", "resolved");
    assert.equal(
      await readFile(path.join(fixture.home, "Rekha-v-Ashvarya-Garg", "probe.txt"), "utf8"),
      "resolved",
      "the fallback must resolve to the real folder",
    );
  } finally {
    await fixture.cleanup();
  }
});
