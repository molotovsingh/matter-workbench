import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import { expandZipContainer } from "../scripts/experimental/zip-container-intake.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date("2026-01-01T00:00:00Z")) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = (year - 1980) << 9 | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function makeStoredZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const [name, value] = Array.isArray(entry) ? entry : [entry.name, entry.value];
    const nameBytes = Buffer.from(name);
    const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const compressedContent = entry.deflate ? deflateRawSync(content) : content;
    const compressionMethod = entry.deflate ? 8 : 0;
    const flags = entry.encrypted ? 1 : 0;
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedContent.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, compressedContent);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(compressionMethod, 10);
    directory.writeUInt16LE(time, 12);
    directory.writeUInt16LE(day, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressedContent.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes);

    offset += local.length + nameBytes.length + compressedContent.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-zip-intake-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("zip container experiment extracts safe child files and returns an intake manifest", async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, "source-package.zip");
    const outputDir = path.join(dir, "expanded");
    await writeFile(
      zipPath,
      makeStoredZip([
        ["FIR.pdf", "fake pdf bytes"],
        ["emails/notice.eml", "Subject: Notice\r\n\r\nBody"],
      ]),
    );

    const manifest = await expandZipContainer({ zipPath, outputDir });

    assert.equal(manifest.status, "expanded");
    assert.equal(manifest.sourceArchive, zipPath);
    assert.deepEqual(
      manifest.entries.map((entry) => ({
        originalPath: entry.originalPath,
        status: entry.status,
        category: entry.category,
        extractedRelativePath: entry.extractedRelativePath,
      })),
      [
        {
          originalPath: "FIR.pdf",
          status: "extracted",
          category: "PDFs",
          extractedRelativePath: "FIR.pdf",
        },
        {
          originalPath: "emails/notice.eml",
          status: "extracted",
          category: "Emails",
          extractedRelativePath: "emails/notice.eml",
        },
      ],
    );
    assert.equal(await readFile(path.join(outputDir, "FIR.pdf"), "utf8"), "fake pdf bytes");
    assert.equal(await readFile(path.join(outputDir, "emails", "notice.eml"), "utf8"), "Subject: Notice\r\n\r\nBody");
  });
});

test("zip container experiment rejects unsafe archive paths before extraction", async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, "unsafe.zip");
    const outputDir = path.join(dir, "expanded");
    await writeFile(zipPath, makeStoredZip([["../escape.txt", "do not write"]]));

    const manifest = await expandZipContainer({ zipPath, outputDir });

    assert.equal(manifest.status, "blocked");
    assert.equal(manifest.entries[0].status, "blocked");
    assert.equal(manifest.entries[0].reason, "unsafe-path");
    await assert.rejects(() => stat(path.join(dir, "escape.txt")));
  });
});

test("zip container experiment marks safe entries as not extracted when the archive is blocked", async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, "mixed.zip");
    await writeFile(
      zipPath,
      makeStoredZip([
        ["safe.pdf", "safe content"],
        ["../escape.txt", "do not write"],
      ]),
    );

    const manifest = await expandZipContainer({ zipPath, outputDir: path.join(dir, "expanded") });

    assert.equal(manifest.status, "blocked");
    assert.deepEqual(
      manifest.entries.map((entry) => ({
        originalPath: entry.originalPath,
        status: entry.status,
        reason: entry.reason,
      })),
      [
        { originalPath: "safe.pdf", status: "not_extracted", reason: "archive-blocked" },
        { originalPath: "../escape.txt", status: "blocked", reason: "unsafe-path" },
      ],
    );
  });
});

test("zip container experiment enforces file-count and byte limits", async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, "large.zip");
    await writeFile(
      zipPath,
      makeStoredZip([
        ["a.txt", "12345"],
        ["b.txt", "67890"],
      ]),
    );

    const tooManyFiles = await expandZipContainer({
      zipPath,
      outputDir: path.join(dir, "many"),
      maxFiles: 1,
    });
    assert.equal(tooManyFiles.status, "blocked");
    assert.equal(tooManyFiles.reason, "too-many-files");

    const tooManyBytes = await expandZipContainer({
      zipPath,
      outputDir: path.join(dir, "bytes"),
      maxTotalBytes: 9,
    });
    assert.equal(tooManyBytes.status, "blocked");
    assert.equal(tooManyBytes.reason, "total-bytes-exceeded");
  });
});

test("zip container experiment blocks suspicious compression ratio before extraction", async () => {
  await withTempDir(async (dir) => {
    const zipPath = path.join(dir, "compressed.zip");
    await writeFile(
      zipPath,
      makeStoredZip([
        {
          name: "dense.txt",
          value: Buffer.alloc(10000, "a"),
          deflate: true,
        },
      ]),
    );

    const manifest = await expandZipContainer({
      zipPath,
      outputDir: path.join(dir, "expanded"),
      maxCompressionRatio: 2,
    });

    assert.equal(manifest.status, "blocked");
    assert.equal(manifest.reason, "blocked-entry");
    assert.equal(manifest.entries[0].status, "blocked");
    assert.equal(manifest.entries[0].reason, "suspicious-compression-ratio");
  });
});
