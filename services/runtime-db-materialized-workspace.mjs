import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  classifyFile,
  FILE_REGISTER_HEADERS,
} from "../shared/matter-contract.mjs";
import { toCsv } from "../shared/csv.mjs";
import { validateRelativePath } from "../shared/safe-paths.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-preparation-read-model.mjs";

export async function materializeRuntimeWorkspacePayloads({
  matterRoot,
  matter,
  workspace,
  readPayloadRow,
}) {
  const materializedPaths = [];
  for (const item of runtimeWorkspaceFilePaths(workspace.tree)) {
    const relativePath = validateRelativePath(item.path);
    const payload = readPayloadRow({ matter, relativePath });
    const absolutePath = path.join(matterRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, payload.bytes);
    materializedPaths.push(relativePath);
  }
  if (!materializedPaths.includes("matter.json")) {
    const bytes = Buffer.from(`${JSON.stringify(runtimeMatterJson(matter), null, 2)}\n`);
    await writeFile(path.join(matterRoot, "matter.json"), bytes);
    materializedPaths.push("matter.json");
  }
  return materializedPaths;
}

export async function synthesizeMissingFileRegisters({
  matterRoot,
  workspace,
  normalizeRelativePath = validateRelativePath,
}) {
  let matterJson;
  try {
    matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  } catch {
    return [];
  }
  const intakes = normalizeMatterJsonIntakes(matterJson);
  if (!intakes.length) return [];
  const fileNodes = runtimeWorkspaceFilePaths(workspace.tree);
  const created = [];

  for (const intake of intakes) {
    const intakeDir = normalizeRelativePath(intake.intakeDir);
    const registerPath = `${intakeDir}/File Register.csv`;
    try {
      await readFile(path.join(matterRoot, ...registerPath.split("/")));
      continue;
    } catch {
      // Missing legacy register: synthesize from runtime DB custody rows below.
    }
    const sourcePrefix = `${intakeDir}/Source Files/`;
    const rows = fileNodes
      .filter((item) => item.path.startsWith(sourcePrefix) && item.fileId)
      .sort((a, b) => a.fileId.localeCompare(b.fileId, undefined, { numeric: true }))
      .map((item) => ({
        file_id: item.fileId,
        intake_id: intake.intakeId,
        source_path: item.path,
        original_path: item.path,
        working_copy_path: item.path,
        category: classifyFile(item.path),
        original_name: item.originalName || path.posix.basename(item.path),
        sha256: item.documentSha || item.sha256,
        size_bytes: String(item.documentSizeBytes || item.size || ""),
        duplicate_of: item.duplicateOf || "",
        status: item.duplicateOf ? "exact-duplicate" : "unique",
        engine_version: "runtime-db-storage-synthetic-register-v1",
        notes: "Synthesized from runtime DB document custody.",
      }));
    if (!rows.length) continue;
    const absoluteRegisterPath = path.join(matterRoot, ...registerPath.split("/"));
    await mkdir(path.dirname(absoluteRegisterPath), { recursive: true });
    await writeFile(absoluteRegisterPath, Buffer.from(toCsv(rows, FILE_REGISTER_HEADERS)));
    created.push(registerPath);
  }

  return created;
}

export async function listRuntimeMatterFiles(root, relativePrefix = "") {
  const rows = [];
  const directory = relativePrefix ? path.join(root, ...relativePrefix.split("/")) : root;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" && relativePrefix) return rows;
    throw error;
  }
  for (const entry of entries) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      rows.push(...await listRuntimeMatterFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) rows.push({ relativePath: normalizeRuntimeObjectKey(relativePath) });
  }
  return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runtimeMatterJson(matter = {}) {
  return {
    matter_name: stringValue(matter.matterName || matter.name),
    client_name: stringValue(matter.clientName),
    opposite_party: stringValue(matter.oppositeParty),
    matter_type: stringValue(matter.matterType),
    jurisdiction: stringValue(matter.jurisdiction),
    brief_description: stringValue(matter.briefDescription),
    intakes: [],
  };
}

function normalizeMatterJsonIntakes(matterJson = {}) {
  const intakes = Array.isArray(matterJson.intakes) ? matterJson.intakes : [];
  return intakes
    .map((intake, index) => ({
      intakeId: stringValue(intake.intake_id || intake.intakeId) || `INTAKE-${String(index + 1).padStart(2, "0")}`,
      intakeDir: stringValue(intake.intake_dir || intake.intakeDir),
    }))
    .filter((intake) => intake.intakeDir);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
