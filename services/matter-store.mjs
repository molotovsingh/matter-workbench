import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeMatterMetadata } from "../shared/matter-contract.mjs";
import { isInsideRoot, makeHttpError, toPosix, validateMatterName } from "../shared/safe-paths.mjs";
import {
  listIntakeFolders as listMatterIntakeFolders,
  nextFileIdStart as readNextFileIdStart,
  nextIntakeNumber as readNextIntakeNumber,
  priorHashIndex as readPriorHashIndex,
  registerHashSet,
} from "./matter-store-intakes.mjs";

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

  async function resolveExistingMatter(rawName) {
    const target = matterPathForName(rawName);
    let targetStat;
    try {
      targetStat = await stat(target.matterPath);
    } catch (cause) {
      if (cause && cause.code === "ENOENT") throw makeHttpError("Matter not found", 404);
      throw cause;
    }
    if (!targetStat.isDirectory()) throw makeHttpError("Not a directory", 400);
    return target;
  }

  async function switchMatter(rawName) {
    const { matterPath } = await resolveExistingMatter(rawName);
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
    return listMatterIntakeFolders(root);
  }

  async function nextIntakeNumber(root = ensureMatterRoot()) {
    return readNextIntakeNumber(root);
  }

  async function nextFileIdStart(root = ensureMatterRoot()) {
    return readNextFileIdStart(root);
  }

  async function priorHashIndex(root = ensureMatterRoot()) {
    return readPriorHashIndex(root);
  }

  async function extractRegisterHashes(matterFolderName) {
    if (!getMattersHome()) return new Set();
    const { matterPath } = matterPathForName(matterFolderName);
    return registerHashSet(matterPath);
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
    resolveExistingMatter,
    setMatterRoot,
    switchMatter,
    toMatterRelative,
  };
}
