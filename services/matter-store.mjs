import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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

const MATTER_LIFECYCLE_SCHEMA_VERSION = "matter-lifecycle/v1";
const MATTER_LIFECYCLE_RELATIVE_PATH = path.join(".matter-workbench", "matter-lifecycle.json");
const MATTER_ACTIVE_STATUS = "active";
const MATTER_ARCHIVED_STATUS = "archived";

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
    if (!mattersHome) {
      throw makeHttpError("Matters home is not configured", 409, "matter_store.matters_home_not_configured");
    }
    return mattersHome;
  }

  function ensureMatterRoot() {
    const state = activeState();
    if (!state.matterRoot) {
      const hasMattersHome = Boolean(getMattersHome());
      throw makeHttpError(
        hasMattersHome
          ? "No matter is active — pick one from the sidebar or create a new one."
          : "MATTER_ROOT is not configured",
        409,
        hasMattersHome ? "matter_store.no_active_matter" : "matter_store.matter_root_not_configured",
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

  async function listMattersHomeChildren({ includeArchived = false } = {}) {
    if (hasRuntimeMatterIndex()) {
      return (await runtimeMatterIndex.listMatterFolders({ includeArchived })).map((matter) => {
        const name = validateMatterName(matter.name || matter.folderName);
        return presentMatterListItem({ ...matter, name });
      });
    }
    const mattersHome = getMattersHome();
    if (!mattersHome) return [];
    try {
      const entries = await readdir(mattersHome, { withFileTypes: true });
      const matters = await Promise.all(entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) => {
          const matterPath = path.join(mattersHome, entry.name);
          const lifecycle = await readLocalMatterLifecycle(matterPath);
          if (lifecycle.status === MATTER_ARCHIVED_STATUS && !includeArchived) return null;
          return presentMatterListItem({ name: entry.name, ...lifecycle });
        }));
      return matters
        .filter(Boolean)
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
      throw makeHttpError("Invalid matter name", 400, "matter_store.invalid_matter_name");
    }
    return { name, matterPath: resolved };
  }

  async function resolveExistingMatter(rawName, { includeArchived = false } = {}) {
    if (hasRuntimeMatterIndex()) {
      return resolveExistingRuntimeDbMatter(rawName, { includeArchived });
    }
    const target = matterPathForName(rawName);
    let targetStat;
    try {
      targetStat = await stat(target.matterPath);
    } catch (cause) {
      if (cause && cause.code === "ENOENT") throw makeHttpError("Matter not found", 404, "matter_store.not_found");
      throw cause;
    }
    if (!targetStat.isDirectory()) throw makeHttpError("Not a directory", 400, "matter_store.not_directory");
    const lifecycle = await readLocalMatterLifecycle(target.matterPath);
    if (lifecycle.status === MATTER_ARCHIVED_STATUS && !includeArchived) {
      throw makeHttpError("Matter is archived. Reopen it before working in it.", 409, "matter_store.archived");
    }
    return { ...target, ...lifecycle };
  }

  async function resolveExistingRuntimeDbMatter(rawName, { includeArchived = false } = {}) {
    validateMatterName(rawName);
    const matter = await runtimeMatterIndex.findMatterFolder(rawName, { includeArchived });
    if (!matter) throw makeHttpError("Matter not found", 404, "matter_store.not_found");

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
      throw makeHttpError(
        "Invalid matter storage folder from runtime database",
        500,
        "matter_store.runtime_storage_folder_invalid",
      );
    }

    let targetStat;
    try {
      targetStat = await stat(matterPath);
    } catch (cause) {
      if (cause && cause.code === "ENOENT") {
        throw makeHttpError(
          `Matter storage folder is missing for runtime DB matter: ${name}`,
          409,
          "matter_store.runtime_storage_folder_missing",
        );
      }
      throw cause;
    }
    if (!targetStat.isDirectory()) {
      throw makeHttpError(
        "Matter storage path is not a directory",
        409,
        "matter_store.runtime_storage_path_not_directory",
      );
    }
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

  async function archiveMatter(rawName) {
    if (hasRuntimeMatterIndex()) {
      const archived = presentMatterListItem(await runtimeMatterIndex.archiveMatter(rawName));
      if (activeMatterNameWithinHome() === archived.name) clearMatterRoot();
      return archived;
    }
    const resolved = await resolveExistingMatter(rawName);
    const archivedAt = new Date().toISOString();
    await writeLocalMatterLifecycle(resolved.matterPath, {
      status: MATTER_ARCHIVED_STATUS,
      archivedAt,
      reopenedAt: "",
    });
    if (activeMatterNameWithinHome() === resolved.name) clearMatterRoot();
    return { name: resolved.name, status: MATTER_ARCHIVED_STATUS, archivedAt };
  }

  async function reopenMatter(rawName) {
    if (hasRuntimeMatterIndex()) {
      return presentMatterListItem(await runtimeMatterIndex.reopenMatter(rawName));
    }
    const resolved = await resolveExistingMatter(rawName, { includeArchived: true });
    await writeLocalMatterLifecycle(resolved.matterPath, {
      status: MATTER_ACTIVE_STATUS,
      archivedAt: "",
      reopenedAt: new Date().toISOString(),
    });
    return { name: resolved.name };
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
        originalIntakeNote: state.activeMatterRecord.originalIntakeNote || "",
        briefDescriptionSource: state.activeMatterRecord.briefDescriptionSource || null,
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
        originalIntakeNote: raw.original_intake_note || "",
        briefDescriptionSource: raw.brief_description_source || null,
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
    archiveMatter,
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
    reopenMatter,
    resolveExistingMatter,
    setMatterRoot,
    switchMatter,
    toMatterRelative,
  };
}

async function readLocalMatterLifecycle(matterPath) {
  try {
    const parsed = JSON.parse(await readFile(path.join(matterPath, MATTER_LIFECYCLE_RELATIVE_PATH), "utf8"));
    const status = parsed?.status === MATTER_ARCHIVED_STATUS ? MATTER_ARCHIVED_STATUS : MATTER_ACTIVE_STATUS;
    return {
      status,
      archivedAt: typeof parsed?.archived_at === "string" ? parsed.archived_at : typeof parsed?.archivedAt === "string" ? parsed.archivedAt : "",
      reopenedAt: typeof parsed?.reopened_at === "string" ? parsed.reopened_at : typeof parsed?.reopenedAt === "string" ? parsed.reopenedAt : "",
    };
  } catch (cause) {
    if (cause?.code && cause.code !== "ENOENT") {
      return { status: MATTER_ACTIVE_STATUS, archivedAt: "", reopenedAt: "", lifecycleUnreadable: true };
    }
    return { status: MATTER_ACTIVE_STATUS, archivedAt: "", reopenedAt: "" };
  }
}

async function writeLocalMatterLifecycle(matterPath, lifecycle) {
  const dir = path.join(matterPath, ".matter-workbench");
  await mkdir(dir, { recursive: true });
  const target = path.join(matterPath, MATTER_LIFECYCLE_RELATIVE_PATH);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const body = {
    schema_version: MATTER_LIFECYCLE_SCHEMA_VERSION,
    status: lifecycle.status === MATTER_ARCHIVED_STATUS ? MATTER_ARCHIVED_STATUS : MATTER_ACTIVE_STATUS,
    archived_at: lifecycle.archivedAt || "",
    reopened_at: lifecycle.reopenedAt || "",
    note: "Matter lifecycle marker only. Archiving does not delete source files or generated artifacts.",
  };
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

function presentMatterListItem(matter = {}) {
  const item = {
    ...matter,
    name: validateMatterName(matter.name || matter.folderName),
  };
  const isArchived = item.status === MATTER_ARCHIVED_STATUS;
  if (!isArchived) delete item.status;
  if (item.archived_at && !item.archivedAt) item.archivedAt = item.archived_at;
  if (!isArchived || !item.archivedAt) delete item.archivedAt;
  delete item.archived_at;
  delete item.reopenedAt;
  delete item.reopened_at;
  if (!item.lifecycleUnreadable) delete item.lifecycleUnreadable;
  return item;
}
