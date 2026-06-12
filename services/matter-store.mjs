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
import { currentRequestContext } from "./request-context.mjs";

export function createMatterStore({
  configService,
  initialMatterRoot = null,
  runtimeMatterIndex = null,
  requestContextProvider = currentRequestContext,
} = {}) {
  if (!configService) throw new Error("configService is required");
  const defaultState = {
    matterRoot: initialMatterRoot ? path.resolve(initialMatterRoot) : null,
    activeMatterRecord: null,
  };
  const scopedStates = new Map();

  function hasRuntimeMatterIndex() {
    return Boolean(runtimeMatterIndex?.enabled);
  }

  function hasRuntimeDbStorageMode() {
    return hasRuntimeMatterIndex() && runtimeMatterIndex.storageMode === "postgres";
  }

  function getMattersHome() {
    return configService.getMattersHome();
  }

  function activeState() {
    const context = requestContextProvider?.() || {};
    const username = String(context.user?.username || "").trim().toLowerCase();
    if (!hasRuntimeMatterIndex() && !username) return defaultState;
    const key = username ? `user:${username}` : "anonymous";
    if (!scopedStates.has(key)) {
      scopedStates.set(key, { matterRoot: null, activeMatterRecord: null });
    }
    return scopedStates.get(key);
  }

  function ensureMattersHome() {
    const mattersHome = getMattersHome();
    if (!mattersHome) throw makeHttpError("Matters home is not configured", 409);
    return mattersHome;
  }

  function ensureMatterRoot() {
    const state = activeState();
    if (!state.matterRoot) {
      throw makeHttpError(
        getMattersHome()
          ? "No matter is active — pick one from the sidebar or create a new one."
          : "MATTER_ROOT is not configured",
        409,
      );
    }
    return state.matterRoot;
  }

  function setMatterRoot(nextRoot) {
    const state = activeState();
    state.matterRoot = nextRoot ? path.resolve(nextRoot) : null;
    state.activeMatterRecord = null;
  }

  function clearMatterRoot() {
    const state = activeState();
    state.matterRoot = null;
    state.activeMatterRecord = null;
  }

  function isInsideMattersHome(filePath) {
    return isInsideRoot(getMattersHome(), filePath);
  }

  function activeMatterNameWithinHome() {
    const state = activeState();
    if (hasRuntimeDbStorageMode() && state.activeMatterRecord?.name) return state.activeMatterRecord.name;
    const mattersHome = getMattersHome();
    if (!state.matterRoot || !mattersHome) return null;
    if (!isInsideRoot(mattersHome, state.matterRoot)) return null;
    if (path.dirname(state.matterRoot) !== mattersHome) return null;
    return path.basename(state.matterRoot);
  }

  async function listMattersHomeChildren() {
    if (hasRuntimeMatterIndex()) {
      return (await runtimeMatterIndex.listMatterFolders()).map((matter) => {
        const name = validateMatterName(matter.name || matter.folderName);
        return { ...matter, name };
      });
    }
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
    if (hasRuntimeMatterIndex()) {
      return resolveExistingRuntimeDbMatter(rawName);
    }
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

  async function resolveExistingRuntimeDbMatter(rawName) {
    validateMatterName(rawName);
    const matter = await runtimeMatterIndex.findMatterFolder(rawName);
    if (!matter) throw makeHttpError("Matter not found", 404);

    const name = validateMatterName(matter.name || matter.folderName);
    if (hasRuntimeDbStorageMode()) {
      return {
        ...matter,
        name,
        matterPath: `postgres:${name}`,
        runtimeStorageMode: "postgres",
      };
    }
    const mattersHome = ensureMattersHome();
    const matterPath = path.join(mattersHome, name);
    if (!isInsideRoot(mattersHome, matterPath) || path.dirname(matterPath) !== mattersHome) {
      throw makeHttpError("Invalid matter storage folder from runtime database", 500);
    }

    let targetStat;
    try {
      targetStat = await stat(matterPath);
    } catch (cause) {
      if (cause && cause.code === "ENOENT") {
        throw makeHttpError(`Matter storage folder is missing for runtime DB matter: ${name}`, 409);
      }
      throw cause;
    }
    if (!targetStat.isDirectory()) throw makeHttpError("Matter storage path is not a directory", 409);
    return { ...matter, name, matterPath };
  }

  async function switchMatter(rawName) {
    const resolved = await resolveExistingMatter(rawName);
    const { matterPath } = resolved;
    const state = activeState();
    state.matterRoot = matterPath;
    state.activeMatterRecord = resolved.runtimeStorageMode === "postgres" ? resolved : null;
    return state.matterRoot;
  }

  async function readMatterJson(root = ensureMatterRoot()) {
    const state = activeState();
    if (isRuntimeDbVirtualRoot(root) && state.activeMatterRecord) {
      return matterJsonFromRuntimeMatter(state.activeMatterRecord);
    }
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
    const state = activeState();
    if (isRuntimeDbVirtualRoot(root) && state.activeMatterRecord) {
      return {
        matterName: state.activeMatterRecord.matterName || state.activeMatterRecord.name || "",
        matterType: state.activeMatterRecord.matterType || "",
        clientName: state.activeMatterRecord.clientName || "",
        oppositeParty: state.activeMatterRecord.oppositeParty || "",
        jurisdiction: state.activeMatterRecord.jurisdiction || "",
        briefDescription: state.activeMatterRecord.briefDescription || "",
      };
    }
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

  function isRuntimeDbVirtualRoot(root) {
    return hasRuntimeDbStorageMode() && String(root || "").startsWith("postgres:");
  }

  function matterJsonFromRuntimeMatter(matter = {}) {
    return {
      matter_name: matter.matterName || matter.name || "",
      matter_type: matter.matterType || "",
      client_name: matter.clientName || "",
      opposite_party: matter.oppositeParty || "",
      jurisdiction: matter.jurisdiction || "",
      brief_description: matter.briefDescription || "",
    };
  }

  return {
    activeMatterNameWithinHome,
    clearMatterRoot,
    ensureMatterRoot,
    ensureMattersHome,
    extractRegisterHashes,
    getMatterRoot: () => activeState().matterRoot,
    getActiveMatterRecord: () => activeState().activeMatterRecord,
    getMattersHome,
    hasRuntimeDbStorageMode,
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
