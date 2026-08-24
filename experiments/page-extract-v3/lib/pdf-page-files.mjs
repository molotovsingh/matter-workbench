import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { atomicWriteJson, readJsonIfExists } from "./util.mjs";

const execFile = promisify(execFileCallback);
const PREPARED_SCHEMA = "page-extract-v3/pdf-pages-v1";

export async function preparePdfPageFiles({
  sourcePath,
  outDir,
  pageCount,
  pdfSeparateCommand = "pdfseparate",
  execFileImpl = execFile,
} = {}) {
  if (!sourcePath || !outDir) throw new Error("source path and output directory are required");
  const count = Math.max(1, Math.trunc(Number(pageCount) || 0));
  const target = path.resolve(outDir);
  const markerPath = path.join(target, "prepared.json");
  const existing = await readJsonIfExists(markerPath);
  if (existing?.schemaVersion === PREPARED_SCHEMA && existing.pageCount === count) {
    const files = await validatePreparedFiles(target, count);
    if (files) return { pageCount: count, pages: files, resumed: true };
  }

  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  try {
    await execFileImpl(pdfSeparateCommand, [
      "-f", "1",
      "-l", String(count),
      sourcePath,
      path.join(temporary, "raw-%d.pdf"),
    ], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180_000,
    });
    const pages = [];
    for (let page = 1; page <= count; page += 1) {
      const raw = path.join(temporary, `raw-${page}.pdf`);
      const finalName = pageFileName(page);
      const finalPath = path.join(temporary, finalName);
      await rename(raw, finalPath);
      const details = await stat(finalPath);
      pages.push({ page, file: finalName, bytes: details.size });
    }
    await atomicWriteJson(path.join(temporary, "prepared.json"), {
      schemaVersion: PREPARED_SCHEMA,
      pageCount: count,
      pages,
    });
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
    return {
      pageCount: count,
      pages: pages.map((page) => ({ ...page, filePath: path.join(target, page.file) })),
      resumed: false,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function combinePageUnits({
  units,
  outFile,
  pdfUniteCommand = "pdfunite",
  execFileImpl = execFile,
} = {}) {
  const values = Array.from(units || []);
  if (!values.length) throw new Error("at least one page unit is required");
  const target = path.resolve(outFile);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp.pdf`;
  await rm(temporary, { force: true });
  try {
    if (values.length === 1) {
      await copyFile(values[0].filePath, temporary);
    } else {
      await execFileImpl(pdfUniteCommand, [...values.map((unit) => unit.filePath), temporary], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
      });
    }
    await rename(temporary, target);
    const details = await stat(target);
    return { filePath: target, bytes: details.size, pageCount: values.length };
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function pageFileName(page) {
  return `page-${String(Number(page)).padStart(4, "0")}.pdf`;
}

async function validatePreparedFiles(root, count) {
  const pages = [];
  try {
    for (let page = 1; page <= count; page += 1) {
      const file = pageFileName(page);
      const filePath = path.join(root, file);
      const details = await stat(filePath);
      pages.push({ page, file, filePath, bytes: details.size });
    }
    return pages;
  } catch {
    return null;
  }
}
