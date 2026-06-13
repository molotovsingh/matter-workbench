#!/usr/bin/env node
import { inflateRawSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyFile } from "../../shared/matter-contract.mjs";

const DEFAULT_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 100 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxCompressionRatio: 100,
};

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("End of central directory not found");
}

function normalizeArchivePath(entryName) {
  if (!entryName || entryName.includes("\0")) return null;
  const slashName = entryName.replaceAll("\\", "/");
  if (slashName.startsWith("/") || /^[a-zA-Z]:\//.test(slashName)) return null;
  const normalized = path.posix.normalize(slashName);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

function parseCentralDirectory(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central directory entry at offset ${offset}`);
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const originalPath = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const isDirectory = originalPath.endsWith("/");
    entries.push({
      originalPath,
      normalizedPath: normalizeArchivePath(originalPath),
      isDirectory,
      encrypted: Boolean(flags & 0x1),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntryData(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid local file header for ${entry.originalPath}`);
  }
  const localNameLength = buffer.readUInt16LE(offset + 26);
  const localExtraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + localNameLength + localExtraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}

function blockedManifest({ zipPath, reason, entries = [] }) {
  return {
    status: "blocked",
    reason,
    sourceArchive: zipPath,
    entries,
  };
}

function compressionRatio(entry) {
  if (entry.uncompressedSize === 0) return 0;
  if (entry.compressedSize === 0) return Number.POSITIVE_INFINITY;
  return entry.uncompressedSize / entry.compressedSize;
}

function markArchiveBlocked(entries) {
  return entries.map((entry) => {
    if (entry.status === "blocked") return entry;
    return { ...entry, status: "not_extracted", reason: "archive-blocked" };
  });
}

function validateEntries({ zipPath, entries, limits }) {
  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length > limits.maxFiles) {
    return blockedManifest({ zipPath, reason: "too-many-files" });
  }

  let totalBytes = 0;
  const seen = new Set();
  const manifestEntries = [];
  for (const entry of files) {
    const category = entry.normalizedPath ? classifyFile(entry.normalizedPath) : "Needs Review";
    const manifestEntry = {
      originalPath: entry.originalPath,
      status: "pending",
      category,
      extractedRelativePath: entry.normalizedPath || "",
      compressedBytes: entry.compressedSize,
      uncompressedBytes: entry.uncompressedSize,
      compressionRatio: compressionRatio(entry),
    };

    if (!entry.normalizedPath) {
      manifestEntries.push({ ...manifestEntry, status: "blocked", reason: "unsafe-path" });
      continue;
    }
    if (seen.has(entry.normalizedPath)) {
      manifestEntries.push({ ...manifestEntry, status: "blocked", reason: "duplicate-path" });
      continue;
    }
    if (entry.encrypted) {
      manifestEntries.push({ ...manifestEntry, status: "blocked", reason: "encrypted-entry" });
      continue;
    }
    if (entry.uncompressedSize > limits.maxFileBytes) {
      manifestEntries.push({ ...manifestEntry, status: "blocked", reason: "file-bytes-exceeded" });
      continue;
    }
    if (manifestEntry.compressionRatio > limits.maxCompressionRatio) {
      manifestEntries.push({ ...manifestEntry, status: "blocked", reason: "suspicious-compression-ratio" });
      continue;
    }

    totalBytes += entry.uncompressedSize;
    seen.add(entry.normalizedPath);
    manifestEntries.push(manifestEntry);
  }

  if (totalBytes > limits.maxTotalBytes) {
    return blockedManifest({ zipPath, reason: "total-bytes-exceeded" });
  }

  const blocked = manifestEntries.filter((entry) => entry.status === "blocked");
  if (blocked.length > 0) {
    return blockedManifest({ zipPath, reason: "blocked-entry", entries: markArchiveBlocked(manifestEntries) });
  }

  return {
    status: "ready",
    sourceArchive: zipPath,
    entries: manifestEntries,
  };
}

export async function expandZipContainer(options) {
  const { zipPath, outputDir } = options;
  if (!zipPath) throw new Error("zipPath is required");
  if (!outputDir) throw new Error("outputDir is required");

  const limits = { ...DEFAULT_LIMITS, ...options };
  const archive = await readFile(zipPath);
  const parsedEntries = parseCentralDirectory(archive);
  const validation = validateEntries({ zipPath, entries: parsedEntries, limits });
  if (validation.status === "blocked") {
    return validation;
  }

  await mkdir(outputDir, { recursive: true });
  const expandedEntries = [];
  const files = parsedEntries.filter((entry) => !entry.isDirectory);
  for (let i = 0; i < files.length; i += 1) {
    const entry = files[i];
    const manifestEntry = validation.entries[i];
    try {
      const data = readEntryData(archive, entry);
      if (data.length > limits.maxFileBytes) {
        expandedEntries.push({ ...manifestEntry, status: "blocked", reason: "file-bytes-exceeded" });
        continue;
      }
      const destination = path.join(outputDir, entry.normalizedPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, data, { flag: "wx" });
      expandedEntries.push({ ...manifestEntry, status: "extracted", extractedBytes: data.length });
    } catch (error) {
      expandedEntries.push({
        ...manifestEntry,
        status: "skipped",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    status: expandedEntries.some((entry) => entry.status !== "extracted") ? "partial" : "expanded",
    sourceArchive: zipPath,
    outputDir,
    entries: expandedEntries,
  };
}

async function main() {
  const [zipPath, outputDir] = process.argv.slice(2);
  const manifest = await expandZipContainer({ zipPath, outputDir });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.status === "blocked") {
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
