import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parseCsv } from "../shared/csv.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

const FILE_ID_RE = /^FILE-\d{4,}$/;

export async function findLocalSourceRegisterRecord(matterRoot, fileId) {
  const normalizedFileId = normalizeFileId(fileId);
  if (!matterRoot || !normalizedFileId) return null;
  const intakes = await listLocalIntakeFolders(matterRoot);
  for (const intake of intakes) {
    const registerPath = path.join(matterRoot, "00_Inbox", intake.name, "File Register.csv");
    let rows;
    try {
      rows = parseCsv(await readFile(registerPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw makeHttpError(
        `File Register.csv could not be read: ${safeErrorMessage(error)}`,
        500,
        "source_removal.file_register_read_failed",
      );
    }
    const row = rows.find((entry) => normalizeFileId(entry.file_id) === normalizedFileId);
    if (row) return { ...row, intake_dir: `00_Inbox/${intake.name}` };
  }
  return null;
}

async function listLocalIntakeFolders(matterRoot) {
  try {
    const entries = await readdir(path.join(matterRoot, "00_Inbox"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^Intake (\d{2,})\b/.test(entry.name))
      .map((entry) => ({ name: entry.name, intakeNumber: Number(entry.name.match(/^Intake (\d{2,})/)?.[1] || 0) }))
      .sort((left, right) => left.intakeNumber - right.intakeNumber);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeFileId(value = "") {
  const text = String(value || "").trim().toUpperCase();
  return FILE_ID_RE.test(text) ? text : "";
}

function safeErrorMessage(error) {
  return String(error?.message || error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 500);
}
