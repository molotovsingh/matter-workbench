#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { BUILTIN_SKILL_COMMANDS } from "../shared/builtin-skill-commands.mjs";

const backendBase = normalizeBaseUrl(process.env.MWB_BACKEND_URL || "http://127.0.0.1:4191");
const uiUrl = process.env.MWB_UI_URL || "http://127.0.0.1:5173/react/";
const reactNativeCommandsPath = new URL("../react-ui/src/lib/nativeCommands.ts", import.meta.url);

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
