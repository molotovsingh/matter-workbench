import { getJson, postJson } from "./frontend/api-client.js";
import { createMutableState } from "./frontend/state.js";
import { createStatusController } from "./frontend/status.js";
import { createWorkspaceView } from "./frontend/workspace-view.js";
import { createMatterScreens } from "./frontend/matter-screens.js";
import { wireAppEvents } from "./frontend/event-wiring.js";
import { createMatterOverview } from "./frontend/views/matter-overview.js";
import { createMatterInitSkill } from "./frontend/skills/matter-init.js";
import { createExtractSkill } from "./frontend/skills/extract.js";
import { createListOfDatesSkill } from "./frontend/skills/create-listofdates.js";
import { createDoctorSkill } from "./frontend/skills/doctor.js";
import { escapeHtml, matterFromWorkspace } from "./frontend/dom-utils.js";

const elements = {
  terminalOutput: document.getElementById("terminalOutput"),
  editorContent: document.getElementById("editorContent"),
  statusBarRight: document.getElementById("statusBarRight"),
  workspaceTree: document.getElementById("workspaceTree"),
  refreshExplorerButton: document.getElementById("refreshExplorer"),
  addFilesButton: document.getElementById("addFilesButton"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  mattersPicker: document.getElementById("mattersPicker"),
  mattersList: document.getElementById("mattersList"),
  newMatterButton: document.getElementById("newMatterButton"),
  activityExplorer: document.getElementById("activityExplorer"),
  activitySettings: document.getElementById("activitySettings"),
  slashSkillButtons: document.querySelectorAll("[data-skill]"),
};

const initialMattersState = { enabled: false, mattersHome: null, active: null, matters: [] };
const mattersStore = createMutableState(initialMattersState);
let mattersState = mattersStore.get();

function createInitialActiveMatter() {
  return {
    folderName: "",
    inputLabel: "",
    fileCount: 0,
    directoryCount: 0,
    tree: null,
    metadata: {
      clientName: "",
      matterName: "",
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
      briefDescription: "",
    },
  };
}

const activeMatterStore = createMutableState(createInitialActiveMatter());
let activeMatter = activeMatterStore.get();

const ctx = {
  elements,
  getActiveMatter: () => activeMatter,
  getMattersState: () => mattersState,
};

const { setStatus } = createStatusController(elements);
ctx.setStatus = setStatus;

const workspaceView = createWorkspaceView(ctx);
ctx.openFilePreview = workspaceView.openFilePreview;
ctx.renderWorkspaceTree = workspaceView.renderWorkspaceTree;

const matterScreens = createMatterScreens(ctx);
ctx.goToExplorer = matterScreens.goToExplorer;
ctx.renderBlankLanding = matterScreens.renderBlankLanding;
ctx.renderFirstRun = matterScreens.renderFirstRun;
ctx.renderMattersList = matterScreens.renderMattersList;
ctx.renderSettings = matterScreens.renderSettings;
ctx.setActivityActive = matterScreens.setActivityActive;

const matterInitSkill = createMatterInitSkill(ctx);
const extractSkill = createExtractSkill(ctx);
const listOfDatesSkill = createListOfDatesSkill(ctx);
const doctorSkill = createDoctorSkill(ctx);
const skills = {
  runCreateListOfDates: listOfDatesSkill.runCreateListOfDates,
  runDoctor: doctorSkill.runDoctor,
  runExtract: extractSkill.runExtract,
  runMatterInit: matterInitSkill.runMatterInit,
};
const matterOverview = createMatterOverview(ctx, skills);
ctx.renderSkillOverview = matterOverview.renderSkillOverview;

function clearActiveMatter() {
  activeMatter = activeMatterStore.set(createInitialActiveMatter());
  return activeMatter;
}

function mergeActiveMatterState(patch) {
  activeMatter = activeMatterStore.merge(patch);
  return activeMatter;
}

function setActiveMatter(nextMatter, options = {}) {
  activeMatter = activeMatterStore.merge(nextMatter);
  if (elements.addFilesButton) elements.addFilesButton.hidden = !activeMatter.folderName;
  elements.breadcrumbs.textContent = activeMatter.folderName
    ? `${activeMatter.folderName} > overview`
    : "workbench";
  if (!options.preserveStatus) {
    setStatus({
      bar: "Matter Loaded",
      terminal: [
        `[folder] loaded ${activeMatter.inputLabel}`,
        `[folder] visible scan: ${activeMatter.fileCount} files, ${activeMatter.directoryCount} folders`,
      ],
    });
  }
  ctx.renderWorkspaceTree(activeMatter);
  if (!options.preserveEditor) ctx.renderSkillOverview();
}

async function refreshWorkspace(options = {}) {
  if (!options.silent) {
    elements.statusBarRight.innerHTML = "<span>Refreshing Explorer</span>";
  }

  try {
    const workspace = await getJson("/api/workspace");
    setActiveMatter(matterFromWorkspace(workspace), {
      preserveStatus: options.preserveStatus,
      preserveEditor: options.preserveEditor,
    });
    if (!options.preserveStatus) {
      setStatus({
        mood: "idle",
        card: `<strong>Explorer refreshed</strong><br />${workspace.fileCount} files and ${workspace.directoryCount} folders loaded from disk.`,
        bar: "Explorer Ready",
        terminal: [
          `[explorer] loaded ${workspace.inputLabel}`,
          `[explorer] indexed ${workspace.fileCount} files and ${workspace.directoryCount} folders`,
        ],
      });
    }
    return workspace;
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Explorer unavailable</strong><br />${escapeHtml(error.message)}`,
      bar: "Explorer Failed",
      terminal: `[explorer] failed: ${error.message}`,
    });
    ctx.renderWorkspaceTree();
    return null;
  }
}

async function loadMattersList() {
  try {
    mattersState = mattersStore.set(await getJson("/api/matters"));
  } catch {
    mattersState = mattersStore.set(initialMattersState);
  }
  ctx.renderMattersList();
}

async function switchToMatter(name) {
  setStatus({
    mood: "idle",
    card: `<strong>Switching matter</strong><br />Loading <code>${escapeHtml(name)}</code>...`,
    bar: "Switching Matter",
    terminal: `[matters] switching to ${name}`,
  });
  try {
    const payload = await postJson("/api/switch-matter", { name });
    mattersState = mattersStore.merge({ active: name });
    ctx.renderMattersList();
    setActiveMatter(matterFromWorkspace(payload));
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Switch failed</strong><br />${escapeHtml(error.message)}`,
      bar: "Switch Failed",
      terminal: `[matters] switch failed: ${error.message}`,
    });
  }
}

Object.assign(ctx, {
  bootstrap: () => bootstrap(),
  clearActiveMatter,
  loadMattersList,
  mergeActiveMatterState,
  refreshWorkspace,
  setActiveMatter,
  switchToMatter,
});

async function bootstrap() {
  let config;
  try {
    config = await getJson("/api/config");
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Server unreachable</strong><br />${escapeHtml(error.message)}`,
      bar: "Server Failed",
      terminal: `[bootstrap] ${error.message}`,
    });
    return;
  }
  if (!config.mattersHome) {
    ctx.renderFirstRun(config.defaultMattersHome);
    return;
  }
  await loadMattersList();
  if (config.hasActiveMatter) {
    await refreshWorkspace({ silent: true });
    return;
  }
  if (mattersState.matters.length === 1) {
    await switchToMatter(mattersState.matters[0].name);
    return;
  }
  ctx.renderBlankLanding();
}

wireAppEvents(ctx, skills);
ctx.renderWorkspaceTree();
bootstrap();
