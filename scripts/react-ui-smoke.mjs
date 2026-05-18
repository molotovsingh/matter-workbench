#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  BUILTIN_SKILL_COMMAND_ALIASES,
  BUILTIN_SKILL_COMMANDS,
} from "../shared/builtin-skill-commands.mjs";
import { LIST_OF_DATES_DEPENDENCY_STATES } from "../shared/listofdates-dependency-states.mjs";
import { PREPARATION_STAGE_ACTIONS } from "../shared/preparation-stage-actions.mjs";
import { RERUN_ADVICE_STATES } from "../shared/rerun-advice-states.mjs";
import {
  SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS,
  SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS,
  SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS,
} from "../shared/skill-creation-overlap-policy.mjs";
import { SKILL_IDEA_INPUT_PATTERNS } from "../shared/skill-idea-input.mjs";
import { SKILL_IDEA_SESSION_COMMAND_SETS } from "../shared/skill-idea-session-commands.mjs";
import {
  LEGACY_SKILL_IDEA_STATUS_MAP,
  SKILL_IDEA_STATUS,
  SKILL_IDEA_STATUS_VALUES,
} from "../shared/skill-idea-statuses.mjs";
import {
  SKILL_SAMPLE_STATE,
  SKILL_SAMPLE_STATE_VALUES,
} from "../shared/skill-sample-states.mjs";

const backendBase = normalizeBaseUrl(process.env.MWB_BACKEND_URL || "http://127.0.0.1:4191");
const uiUrl = process.env.MWB_UI_URL || "http://127.0.0.1:5173/react/";
const reactNativeCommandsPath = new URL("../react-ui/src/lib/nativeCommands.ts", import.meta.url);
const reactNativeCommandAliasesPath = new URL("../react-ui/src/lib/nativeCommandAliases.ts", import.meta.url);
const reactListOfDatesDependencyStatePath = new URL("../react-ui/src/lib/listOfDatesDependencyState.ts", import.meta.url);
const reactPreparationStageActionsPath = new URL("../react-ui/src/lib/preparationStageActions.ts", import.meta.url);
const reactRerunAdviceStatePath = new URL("../react-ui/src/lib/rerunAdviceState.ts", import.meta.url);
const reactSkillCreationOverlapPath = new URL("../react-ui/src/lib/skillCreationOverlap.ts", import.meta.url);
const reactSkillIdeaInputPath = new URL("../react-ui/src/lib/skillIdeaInput.ts", import.meta.url);
const reactSkillIdeaSessionPath = new URL("../react-ui/src/lib/skillIdeaSession.ts", import.meta.url);
const reactSkillIdeaSessionCommandsPath = new URL("../react-ui/src/lib/skillIdeaSessionCommands.ts", import.meta.url);
const reactSkillIdeaStatusesPath = new URL("../react-ui/src/lib/skillIdeaStatuses.ts", import.meta.url);
const reactSkillSampleStatesPath = new URL("../react-ui/src/lib/skillSampleStates.ts", import.meta.url);

const checks = [];
let configPayload = null;

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function pass(label, detail = "") {
  checks.push({ ok: true, label, detail });
}

function fail(label, detail) {
  checks.push({ ok: false, label, detail });
}

function assert(condition, label, detail) {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { response, text };
}

async function fetchJson(pathname) {
  const url = `${backendBase}${pathname}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`${pathname} returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${text.slice(0, 240)}`);
  }
  return body;
}

async function run() {
  try {
    const reactNativeCommands = await readReactNativeCommands();
    assert(
      sameStringSet(reactNativeCommands, BUILTIN_SKILL_COMMANDS),
      "React native command registry matches shared backend built-ins",
      commandSetDiffDetail(reactNativeCommands, BUILTIN_SKILL_COMMANDS),
    );
  } catch (error) {
    fail("React native command registry is readable", error.message);
  }

  try {
    const reactAliases = await readReactNativeCommandAliases();
    assert(
      sameTupleEntries(reactAliases, BUILTIN_SKILL_COMMAND_ALIASES),
      "React native command aliases match shared backend aliases",
      tupleDiffDetail(reactAliases, BUILTIN_SKILL_COMMAND_ALIASES),
    );
  } catch (error) {
    fail("React native command aliases are readable", error.message);
  }

  try {
    const reactStates = await readReactListOfDatesDependencyStates();
    assert(
      sameObjectEntries(reactStates, LIST_OF_DATES_DEPENDENCY_STATES),
      "React List of Dates dependency states match shared contract",
      objectDiffDetail(reactStates, LIST_OF_DATES_DEPENDENCY_STATES),
    );
  } catch (error) {
    fail("React List of Dates dependency states are readable", error.message);
  }

  try {
    const reactStates = await readReactRerunAdviceStates();
    assert(
      sameObjectEntries(reactStates, RERUN_ADVICE_STATES),
      "React rerun advice states match shared contract",
      objectDiffDetail(reactStates, RERUN_ADVICE_STATES),
    );
  } catch (error) {
    fail("React rerun advice states are readable", error.message);
  }

  try {
    const reactActions = await readReactPreparationStageActions();
    assert(
      sameObjectEntries(reactActions, PREPARATION_STAGE_ACTIONS),
      "React preparation stage actions match shared contract",
      objectDiffDetail(reactActions, PREPARATION_STAGE_ACTIONS),
    );
  } catch (error) {
    fail("React preparation stage actions are readable", error.message);
  }

  try {
    const overlapPolicy = await readReactSkillCreationOverlapPolicy();
    assert(
      overlapPolicy.overrideMinChars === SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS,
      "React skill-overlap override threshold matches shared contract",
      `React=${overlapPolicy.overrideMinChars} shared=${SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS}`,
    );
    assert(
      sameStringSet(overlapPolicy.blockingDecisions, SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS),
      "React skill-overlap blocking decisions match shared contract",
      commandSetDiffDetail(overlapPolicy.blockingDecisions, SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS),
    );
    assert(
      sameStringSet(overlapPolicy.blockingRecommendedActions, SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS),
      "React skill-overlap blocking actions match shared contract",
      commandSetDiffDetail(overlapPolicy.blockingRecommendedActions, SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS),
    );
  } catch (error) {
    fail("React skill-overlap policy is readable", error.message);
  }

  try {
    const patterns = await readReactSkillIdeaInputPatterns();
    assert(
      sameStringSet(patterns, SKILL_IDEA_INPUT_PATTERNS),
      "React skill-idea input patterns match shared contract",
      commandSetDiffDetail(patterns, SKILL_IDEA_INPUT_PATTERNS),
    );
  } catch (error) {
    fail("React skill-idea input contract is readable", error.message);
  }

  try {
    const commandSets = await readReactSkillIdeaSessionCommandSets();
    assert(
      sameObjectArrays(commandSets, SKILL_IDEA_SESSION_COMMAND_SETS),
      "React skill-idea session commands match shared contract",
      objectArrayDiffDetail(commandSets, SKILL_IDEA_SESSION_COMMAND_SETS),
    );
  } catch (error) {
    fail("React skill-idea session command contract is readable", error.message);
  }

  try {
    const sessionHelpers = await readReactSkillIdeaSessionHelpers();
    assert(
      sessionHelpers.matterGuardUsesFolderName,
      "React skill-idea sample gate requires a selected matter",
      sessionHelpers.matterGuardUsesFolderName ? "folderName guard present" : "missing folderName guard",
    );
  } catch (error) {
    fail("React skill-idea session helper contract is readable", error.message);
  }

  try {
    const statuses = await readReactSkillIdeaStatuses();
    assert(
      sameObjectEntries(statuses.status, SKILL_IDEA_STATUS),
      "React skill-idea statuses match shared contract",
      objectDiffDetail(statuses.status, SKILL_IDEA_STATUS),
    );
    assert(
      sameStringSet(statuses.values, SKILL_IDEA_STATUS_VALUES),
      "React skill-idea status values match shared contract",
      commandSetDiffDetail(statuses.values, SKILL_IDEA_STATUS_VALUES),
    );
    assert(
      sameObjectEntries(statuses.legacyMap, LEGACY_SKILL_IDEA_STATUS_MAP),
      "React legacy skill-idea statuses match shared contract",
      objectDiffDetail(statuses.legacyMap, LEGACY_SKILL_IDEA_STATUS_MAP),
    );
  } catch (error) {
    fail("React skill-idea status contract is readable", error.message);
  }

  try {
    const sampleStates = await readReactSkillSampleStates();
    assert(
      sameObjectEntries(sampleStates.state, SKILL_SAMPLE_STATE),
      "React skill sample states match shared contract",
      objectDiffDetail(sampleStates.state, SKILL_SAMPLE_STATE),
    );
    assert(
      sameStringSet(sampleStates.values, SKILL_SAMPLE_STATE_VALUES),
      "React skill sample state values match shared contract",
      commandSetDiffDetail(sampleStates.values, SKILL_SAMPLE_STATE_VALUES),
    );
  } catch (error) {
    fail("React skill sample state contract is readable", error.message);
  }

  try {
    const { response, text } = await fetchText(uiUrl);
    assert(response.ok, "React UI HTML is reachable", `${response.status} ${response.headers.get("content-type") || ""}`);
    assert(text.includes("<title>Matter Workbench</title>"), "React UI serves Matter Workbench HTML");
    assert(
      text.includes('id="root"') && (text.includes("/react/src/main.tsx") || text.includes("/react/assets/")),
      "React UI has a mount point and script",
    );
  } catch (error) {
    fail("React UI is reachable", error.message);
  }

  try {
    const config = await fetchJson("/api/config");
    configPayload = config;
    assert(typeof config === "object" && config !== null, "Config API returns an object");
    assert(typeof config.mattersHome === "string" && config.mattersHome.length > 0, "Config exposes matters home");
    assert(typeof config.hasActiveMatter === "boolean", "Config exposes active-matter state");
  } catch (error) {
    fail("Config API contract", error.message);
  }

  try {
    const matters = await fetchJson("/api/matters");
    assert(Array.isArray(matters.matters), "Matters API returns matters array", `${matters.matters?.length ?? 0} matters`);
    assert(
      matters.matters.every((matter) => matter && typeof matter.name === "string"),
      "Matters API entries expose names",
    );
  } catch (error) {
    fail("Matters API contract", error.message);
  }

  try {
    const skills = await fetchJson("/api/skills");
    const skillList = Array.isArray(skills.skills) ? skills.skills : [];
    const slashes = new Set(skillList.map((skill) => skill?.slash).filter(Boolean));
    assert(Array.isArray(skills.skills), "Skills API returns flat skills array", `${skillList.length} skills`);
    assert(skillList.every((skill) => typeof skill?.slash === "string" && typeof skill?.title === "string"), "Skill cards expose slash and title");
    const missingReactBuiltins = BUILTIN_SKILL_COMMANDS.filter((slash) => !slashes.has(slash));
    assert(
      missingReactBuiltins.length === 0,
      "Skills API includes React-routed native commands",
      missingReactBuiltins.length > 0 ? `missing: ${missingReactBuiltins.join(", ")}` : `${BUILTIN_SKILL_COMMANDS.length} commands`,
    );
    assert(slashes.has("/describe_sources"), "Source Labels native skill is present");
    assert(slashes.has("/create_listofdates"), "List of Dates native skill is present");
  } catch (error) {
    fail("Skills API contract", error.message);
  }

  try {
    const aiSettings = await fetchJson("/api/ai-settings");
    const tasks = Array.isArray(aiSettings.aiTasks) ? aiSettings.aiTasks : [];
    assert(typeof aiSettings.apiKeyConfigured === "boolean", "AI settings expose API-key readiness");
    assert(Array.isArray(aiSettings.aiTasks), "AI settings expose aiTasks array", `${tasks.length} tasks`);
    assert(
      tasks.every((task) => typeof task?.label === "string" && typeof task?.provider === "string" && typeof task?.ready === "boolean"),
      "AI task rows expose label, provider, and readiness",
    );
  } catch (error) {
    fail("AI settings API contract", error.message);
  }

  try {
    const customSkills = await fetchJson("/api/configurable-skills");
    const skillList = Array.isArray(customSkills.skills) ? customSkills.skills : [];
    assert(Array.isArray(customSkills.skills), "Custom skills API exposes skills array", `${skillList.length} custom skills`);
    assert(
      skillList.every((skill) => typeof skill?.slash === "string" && typeof skill?.title === "string" && typeof skill?.status === "string"),
      "Custom skill cards expose slash, title, and status",
    );
  } catch (error) {
    fail("Custom skills API contract", error.message);
  }

  try {
    const ideas = await fetchJson("/api/skill-ideas");
    const ideaList = Array.isArray(ideas.ideas) ? ideas.ideas : [];
    assert(Array.isArray(ideas.ideas), "Skill ideas API exposes ideas array", `${ideaList.length} ideas`);
    assert(
      ideaList.every((idea) => typeof idea?.id === "string" && typeof idea?.text === "string" && typeof idea?.status === "string"),
      "Skill idea cards expose id, text, and status",
    );
  } catch (error) {
    fail("Skill ideas API contract", error.message);
  }

  try {
    const health = await fetchJson("/api/skill-factory-health");
    const checks = Array.isArray(health.checks) ? health.checks : [];
    assert(typeof health.state === "string", "Skill factory health exposes state", health.state);
    assert(
      checks.every((check) => typeof check?.id === "string" && typeof check?.label === "string" && typeof check?.state === "string"),
      "Skill factory health exposes check rows",
      `${checks.length} checks`,
    );
  } catch (error) {
    fail("Skill factory health API contract", error.message);
  }

  try {
    const runs = await fetchJson("/api/configurable-skills/runs?limit=5");
    const runList = Array.isArray(runs.runs) ? runs.runs : [];
    assert(Array.isArray(runs.runs), "Custom skill runs API exposes runs array", `${runList.length} runs`);
    assert(
      runList.every((run) => typeof run?.id === "string" && typeof run?.status === "string"),
      "Custom skill run rows expose id and status",
    );
  } catch (error) {
    fail("Custom skill runs API contract", error.message);
  }

  if (configPayload?.hasActiveMatter) {
    try {
      const workspace = await fetchJson("/api/workspace");
      assert(typeof workspace.folderName === "string", "Workspace API exposes folder name", workspace.folderName);
      assert(workspace.tree && workspace.tree.kind === "directory", "Workspace API exposes a directory tree");
      assert(Array.isArray(workspace.tree?.children), "Workspace API exposes tree children", `${workspace.tree?.children?.length ?? 0} root nodes`);
    } catch (error) {
      fail("Workspace API contract", error.message);
    }
  } else {
    pass("Workspace API skipped without an active matter");
  }

  if (configPayload?.hasActiveMatter) {
    try {
      const attention = await fetchJson("/api/matter-attention");
      assert(Array.isArray(attention.items), "Matter attention API exposes items array", `${attention.items?.length ?? 0} items`);
    } catch (error) {
      fail("Matter attention API contract", error.message);
    }
  } else {
    pass("Matter attention API skipped without an active matter");
  }

  if (configPayload?.hasActiveMatter) {
    try {
      const prepareMatter = await fetchJson("/api/prepare-matter");
      const stages = Array.isArray(prepareMatter.stages) ? prepareMatter.stages : [];
      assert(Array.isArray(prepareMatter.stages), "Prepare Matter API exposes stage rows", `${stages.length} stages`);
      assert(
        stages.every((stage) => typeof stage?.state === "string" && typeof stage?.action === "string"),
        "Prepare Matter stages expose state and action",
      );
      assert(
        !prepareMatter.nextStep || typeof prepareMatter.nextStep.state === "string",
        "Prepare Matter next step exposes state when present",
      );
    } catch (error) {
      fail("Prepare Matter API contract", error.message);
    }
  } else {
    pass("Prepare Matter API skipped without an active matter");
  }

  if (configPayload?.hasActiveMatter) {
    try {
      const rerunAdvice = await fetchJson(`/api/rerun-advice?skill=${encodeURIComponent("/describe_sources")}`);
      assert(typeof rerunAdvice.state === "string", "Rerun advice exposes state", rerunAdvice.state);
      assert(typeof rerunAdvice.shouldConfirm === "boolean", "Rerun advice exposes confirmation flag");
      assert(
        !rerunAdvice.artifactPath || typeof rerunAdvice.artifactPath === "string",
        "Rerun advice artifact path is optional text",
      );
      assert(
        !rerunAdvice.dependencyState || typeof rerunAdvice.dependencyState === "string",
        "Rerun advice dependency state is optional text",
      );
    } catch (error) {
      fail("Rerun advice API contract", error.message);
    }
  } else {
    pass("Rerun advice API skipped without an active matter");
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    const marker = check.ok ? "OK" : "FAIL";
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`${marker} ${check.label}${detail}`);
  }

  if (failed.length > 0) {
    console.error(`\nReact UI smoke failed: ${failed.length}/${checks.length} checks failed.`);
    process.exit(1);
  }

  console.log(`\nReact UI smoke passed: ${checks.length}/${checks.length} checks passed.`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function readReactNativeCommands() {
  const source = await readFile(reactNativeCommandsPath, "utf8");
  const commands = [...source.matchAll(/\bcommand:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  return [...new Set(commands)].sort();
}

async function readReactNativeCommandAliases() {
  const source = await readFile(reactNativeCommandAliasesPath, "utf8");
  return [...source.matchAll(/\[\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\]/g)]
    .map((match) => [match[1], match[2]])
    .sort(([leftAlias], [rightAlias]) => leftAlias.localeCompare(rightAlias));
}

async function readReactListOfDatesDependencyStates() {
  const source = await readFile(reactListOfDatesDependencyStatePath, "utf8");
  return Object.fromEntries([...source.matchAll(/\b([A-Z_]+):\s*['"]([^'"]+)['"]/g)].map((match) => [match[1], match[2]]));
}

async function readReactRerunAdviceStates() {
  const source = await readFile(reactRerunAdviceStatePath, "utf8");
  return Object.fromEntries([...source.matchAll(/\b([A-Z_]+):\s*['"]([^'"]+)['"]/g)].map((match) => [match[1], match[2]]));
}

async function readReactPreparationStageActions() {
  const source = await readFile(reactPreparationStageActionsPath, "utf8");
  return Object.fromEntries([...source.matchAll(/\b([A-Z_]+):\s*['"]([^'"]+)['"]/g)].map((match) => [match[1], match[2]]));
}

async function readReactSkillCreationOverlapPolicy() {
  const source = await readFile(reactSkillCreationOverlapPath, "utf8");
  return {
    overrideMinChars: Number(source.match(/SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS\s*=\s*(\d+)/)?.[1] || NaN),
    blockingDecisions: readStringArray(source, "SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS"),
    blockingRecommendedActions: readStringArray(source, "SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS"),
  };
}

async function readReactSkillIdeaInputPatterns() {
  const source = await readFile(reactSkillIdeaInputPath, "utf8");
  const match = source.match(/SKILL_IDEA_INPUT_PATTERNS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const body = match?.[1] || "";
  return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((value) => value[1]).sort();
}

async function readReactSkillIdeaSessionCommandSets() {
  const source = await readFile(reactSkillIdeaSessionCommandsPath, "utf8");
  const match = source.match(/SKILL_IDEA_SESSION_COMMAND_SETS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  const body = match?.[1] || "";
  return Object.fromEntries([...body.matchAll(/\b(\w+):\s*\[([^\]]*)\]/g)].map((entry) => [
    entry[1],
    [...entry[2].matchAll(/['"]([^'"]+)['"]/g)].map((value) => value[1]).sort(),
  ]));
}

async function readReactSkillIdeaSessionHelpers() {
  const source = await readFile(reactSkillIdeaSessionPath, "utf8");
  return {
    matterGuardUsesFolderName: /function\s+hasSkillIdeaTestMatter[\s\S]*activeMatter\?\.folderName/.test(source),
  };
}

async function readReactSkillIdeaStatuses() {
  const source = await readFile(reactSkillIdeaStatusesPath, "utf8");
  const statusMatch = source.match(/SKILL_IDEA_STATUS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  const legacyMatch = source.match(/LEGACY_SKILL_IDEA_STATUS_MAP\s*=\s*\{([\s\S]*?)\}\s*as const/);
  const status = Object.fromEntries([...String(statusMatch?.[1] || "").matchAll(/\b([A-Z_]+):\s*['"]([^'"]+)['"]/g)].map((match) => [match[1], match[2]]));
  return {
    status,
    values: Object.values(status).sort(),
    legacyMap: Object.fromEntries([...String(legacyMatch?.[1] || "").matchAll(/\b([a-z_]+):\s*SKILL_IDEA_STATUS\.([A-Z_]+)/g)].map((match) => [
      match[1],
      SKILL_IDEA_STATUS[match[2]],
    ])),
  };
}

async function readReactSkillSampleStates() {
  const source = await readFile(reactSkillSampleStatesPath, "utf8");
  const stateMatch = source.match(/SKILL_SAMPLE_STATE\s*=\s*\{([\s\S]*?)\}\s*as const/);
  const state = Object.fromEntries([...String(stateMatch?.[1] || "").matchAll(/\b([A-Z_]+):\s*['"]([^'"]+)['"]/g)].map((match) => [match[1], match[2]]));
  return {
    state,
    values: Object.values(state).sort(),
  };
}

function readStringArray(source, exportName) {
  const start = source.indexOf(exportName);
  if (start < 0) return [];
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  const body = open >= 0 && close > open ? source.slice(open + 1, close) : "";
  return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]).sort();
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function commandSetDiffDetail(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const missingFromReact = right.filter((value) => !leftSet.has(value));
  const extraInReact = left.filter((value) => !rightSet.has(value));
  if (missingFromReact.length || extraInReact.length) {
    return [
      missingFromReact.length ? `missing in React: ${missingFromReact.join(", ")}` : "",
      extraInReact.length ? `extra in React: ${extraInReact.join(", ")}` : "",
    ].filter(Boolean).join("; ");
  }
  return `${right.length} commands`;
}

function sameObjectEntries(left, right) {
  const leftEntries = Object.entries(left).sort();
  const rightEntries = Object.entries(right).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function sameObjectArrays(left, right) {
  return JSON.stringify(sortObjectArrays(left)) === JSON.stringify(sortObjectArrays(right));
}

function sortObjectArrays(value) {
  return Object.fromEntries(Object.entries(value).sort().map(([key, entries]) => [
    key,
    [...entries].sort(),
  ]));
}

function objectArrayDiffDetail(left, right) {
  const normalizedLeft = sortObjectArrays(left);
  const normalizedRight = sortObjectArrays(right);
  if (JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)) {
    return `${Object.keys(normalizedRight).length} command sets`;
  }
  return `React=${JSON.stringify(normalizedLeft)} shared=${JSON.stringify(normalizedRight)}`;
}

function sameTupleEntries(left, right) {
  const leftEntries = left.map(([alias, command]) => [alias, command]).sort();
  const rightEntries = right.map(([alias, command]) => [alias, command]).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function tupleDiffDetail(left, right) {
  const format = (entry) => `${entry[0]}=>${entry[1]}`;
  const leftSet = new Set(left.map(format));
  const rightSet = new Set(right.map(format));
  const missingFromReact = right.map(format).filter((value) => !leftSet.has(value));
  const extraInReact = left.map(format).filter((value) => !rightSet.has(value));
  if (missingFromReact.length || extraInReact.length) {
    return [
      missingFromReact.length ? `missing in React: ${missingFromReact.join(", ")}` : "",
      extraInReact.length ? `extra in React: ${extraInReact.join(", ")}` : "",
    ].filter(Boolean).join("; ");
  }
  return `${right.length} aliases`;
}

function objectDiffDetail(left, right) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const diffs = keys
    .filter((key) => left[key] !== right[key])
    .map((key) => `${key}: React=${left[key] || "missing"} shared=${right[key] || "missing"}`);
  return diffs.length ? diffs.join("; ") : `${keys.length} states`;
}
