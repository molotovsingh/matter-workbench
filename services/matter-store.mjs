import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../shared/csv.mjs";
import { INITIAL_INTAKE_DIR_NAME, normalizeMatterMetadata } from "../shared/matter-contract.mjs";
import { isInsideRoot, makeHttpError, toPosix, validateMatterName } from "../shared/safe-paths.mjs";

export function createMatterStore({ configService, initialMatterRoot = null } = {}) {
  if (!configService) throw new Error("configService is required");
  let matterRoot = initialMatterRoot ? path.resolve(initialMatterRoot) : null;

  function getMattersHome() {
    return configService.getMattersHome();
  }

  function ensureMattersHome() {
    const mattersHome = getMattersHome();
    if (!mattersHome) throw makeHttpError("Matters home is not configured", 409);
    return mattersHome;
  }

  function ensureMatterRoot() {
    if (!matterRoot) {
      throw makeHttpError(
        getMattersHome()
          ? "No matter is active — pick one from the sidebar or create a new one."
          : "MATTER_ROOT is not configured",
        409,
      );
    }
    return matterRoot;
  }

  function setMatterRoot(nextRoot) {
    matterRoot = nextRoot ? path.resolve(nextRoot) : null;
  }

  function clearMatterRoot() {
    matterRoot = null;
  }

  function isInsideMattersHome(filePath) {
    return isInsideRoot(getMattersHome(), filePath);
  }

  function activeMatterNameWithinHome() {
    const mattersHome = getMattersHome();
    if (!matterRoot || !mattersHome) return null;
    if (!isInsideRoot(mattersHome, matterRoot)) return null;
    if (path.dirname(matterRoot) !== mattersHome) return null;
    return path.basename(matterRoot);
  }

  async function listMattersHomeChildren() {
    const mattersHome = getMattersHome();
    if (!mattersHome) return [];
    try {
      const entries = await readdir(mattersHome, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => ({ name: entry.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  function matterPathForName(rawName) {
    const name = validateMatterName(rawName);
    const mattersHome = ensureMattersHome();
    const resolved = path.join(mattersHome, name);
    if (!isInsideRoot(mattersHome, resolved) || path.dirname(resolved) !== mattersHome) {
      throw makeHttpError("Invalid matter name", 400);
    }
    return { name, matterPath: resolved };
  }

  async function switchMatter(rawName) {
    const { matterPath } = matterPathForName(rawName);
    let targetStat;
    try {
      targetStat = await stat(matterPath);
    } catch (cause) {
      if (cause && cause.code === "ENOENT") throw makeHttpError("Matter not found", 404);
      throw cause;
    }
    if (!targetStat.isDirectory()) throw makeHttpError("Not a directory", 400);
    matterRoot = matterPath;
    return matterRoot;
  }

  async function readMatterJson(root = ensureMatterRoot()) {
    return JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
  }

  async function readMatterMetadata(root = ensureMatterRoot()) {
    try {
      const rawMatter = await readMatterJson(root);
      return normalizeMatterMetadata(rawMatter);
    } catch {
      return normalizeMatterMetadata({}, path.basename(root));
    }
  }

  async function readExistingMatterMetadata(root = ensureMatterRoot()) {
    try {
      const raw = await readMatterJson(root);
      return {
        matterName: raw.matter_name || "",
        matterType: raw.matter_type || "",
        clientName: raw.client_name || "",
        oppositeParty: raw.opposite_party || "",
        jurisdiction: raw.jurisdiction || "",
        briefDescription: raw.brief_description || "",
      };
    } catch {
      return {};
    }
  }

  async function readPrimaryIntake(root = ensureMatterRoot()) {
    try {
      const rawMatter = await readMatterJson(root);
      if (rawMatter.phase_1_intake) return rawMatter.phase_1_intake;
      if (Array.isArray(rawMatter.intakes) && rawMatter.intakes.length) return rawMatter.intakes[0];
      return null;
    } catch {
      return null;
    }
  }

  async function listIntakeFolders(root = ensureMatterRoot()) {
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

  async function nextIntakeNumber(root = ensureMatterRoot()) {
    const folders = await listIntakeFolders(root);
    if (!folders.length) return 1;
    return folders[folders.length - 1].intakeNumber + 1;
  }

  async function nextFileIdStart(root = ensureMatterRoot()) {
    const folders = await listIntakeFolders(root);
    let max = 0;
    for (const folder of folders) {
      const registerPath = path.join(root, "00_Inbox", folder.name, "File Register.csv");
      try {
        const rows = parseCsv(await readFile(registerPath, "utf8"));
        for (const row of rows) {
          const match = (row.file_id || "").match(/FILE-(\d+)/);
          if (match) max = Math.max(max, parseInt(match[1], 10));
        }
      } catch {
        // ignore missing or malformed historical registers
      }
    }
    return max + 1;
  }

  async function priorHashIndex(root = ensureMatterRoot()) {
    const folders = await listIntakeFolders(root);
    const index = new Map();
    for (const folder of folders) {
      const registerPath = path.join(root, "00_Inbox", folder.name, "File Register.csv");
      try {
        const rows = parseCsv(await readFile(registerPath, "utf8"));
        for (const row of rows) {
          if (!row.sha256 || !row.file_id) continue;
          if (row.status === "duplicate-of-prior-intake") continue;
          if (!index.has(row.sha256)) index.set(row.sha256, row.file_id);
        }
      } catch {
        // ignore missing or malformed historical registers
      }
    }
    return index;
  }

  async function extractRegisterHashes(matterFolderName) {
    const mattersHome = getMattersHome();
    if (!mattersHome) return new Set();
    const registerPath = path.join(mattersHome, matterFolderName, "00_Inbox", INITIAL_INTAKE_DIR_NAME, "File Register.csv");
    try {
      const rows = parseCsv(await readFile(registerPath, "utf8"));
      return new Set(rows.map((row) => row.sha256).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function toMatterRelative(filePath) {
    return toPosix(path.relative(ensureMatterRoot(), filePath));
  }

  return {
    activeMatterNameWithinHome,
    clearMatterRoot,
    ensureMatterRoot,
    ensureMattersHome,
    extractRegisterHashes,
    getMatterRoot: () => matterRoot,
    getMattersHome,
    isInsideMattersHome,
    listIntakeFolders,
    listMattersHomeChildren,
    matterPathForName,
    nextFileIdStart,
    nextIntakeNumber,
    priorHashIndex,
    readExistingMatterMetadata,
    readMatterJson,
    readMatterMetadata,
    readPrimaryIntake,
    setMatterRoot,
    switchMatter,
    toMatterRelative,
  };
}
