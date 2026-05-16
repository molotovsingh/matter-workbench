import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../shared/csv.mjs";

export async function listIntakeFolders(root) {
  const inboxPath = path.join(root, "00_Inbox");
  try {
    const entries = await readdir(inboxPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^Intake (\d{2,})\b/.test(entry.name))
      .map((entry) => {
        const match = entry.name.match(/^Intake (\d{2,})/);
        return { name: entry.name, intakeNumber: parseInt(match[1], 10) };
      })
      .sort((a, b) => a.intakeNumber - b.intakeNumber);
  } catch {
    return [];
  }
}

export async function nextIntakeNumber(root) {
  const folders = await listIntakeFolders(root);
  if (!folders.length) return 1;
  return folders[folders.length - 1].intakeNumber + 1;
}

export async function nextFileIdStart(root) {
  let max = 0;
  for (const row of await readAllFileRegisterRows(root)) {
    const match = (row.file_id || "").match(/FILE-(\d+)/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max + 1;
}

export async function priorHashIndex(root) {
  const index = new Map();
  for (const row of await readAllFileRegisterRows(root)) {
    if (!row.sha256 || !row.file_id) continue;
    if (row.status === "duplicate-of-prior-intake") continue;
    if (!index.has(row.sha256)) index.set(row.sha256, row.file_id);
  }
  return index;
}

export async function registerHashSet(root) {
  const hashes = new Set();
  for (const row of await readAllFileRegisterRows(root)) {
    if (row.sha256) hashes.add(row.sha256);
  }
  return hashes;
}

async function readAllFileRegisterRows(root) {
  const rows = [];
  for (const folder of await listIntakeFolders(root)) {
    try {
      rows.push(...parseCsv(await readFile(fileRegisterPath(root, folder.name), "utf8")));
    } catch {
      // Missing or malformed historical registers should not block matter-level operations.
    }
  }
  return rows;
}

function fileRegisterPath(root, intakeFolderName) {
  return path.join(root, "00_Inbox", intakeFolderName, "File Register.csv");
}
