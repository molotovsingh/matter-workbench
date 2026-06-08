import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dead matter-contract metadata adapter stays removed", () => {
  assert.doesNotMatch(read("shared/matter-contract.mjs"), /metadataToMatterJsonFields/);
});

test("matter copilot providers expose only the default provider factory", () => {
  const source = read("services/matter-copilot-providers.mjs");

  assert.doesNotMatch(source, /export function createOpenAiMatterCopilotProvider/);
  assert.doesNotMatch(source, /export function createOpenRouterMatterCopilotProvider/);
  assert.match(source, /export function createDefaultMatterCopilotProvider/);
});

test("agreed one-line passthrough modules stay removed", () => {
  assert.equal(existsSync(new URL("../path-utils.mjs", import.meta.url)), false);
  assert.equal(existsSync(new URL("../frontend/listofdates-dependency-state.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../frontend/skill-idea-session-commands.js", import.meta.url)), false);
});

test("intentional ignored async failures are named instead of bare catch callbacks", () => {
  const files = [
    "services/configurable-skills-service.mjs",
    "frontend/command-report-controller.js",
    "services/json-store-persistence.mjs",
    "services/command-interaction-log-service.mjs",
    "shared/atomic-file.mjs",
  ];

  for (const file of files) {
    assert.doesNotMatch(read(file), /\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/, file);
  }
});

test("reviewed magic numbers have names", () => {
  assert.match(read("services/configurable-skill-definition.mjs"), /MAX_SLASH_ALLOCATION_ATTEMPTS/);
  assert.match(read("services/matter-copilot-service.mjs"), /FULL_SNIPPET_OVERLAP_SCORE/);
});

test("legacy UI fallback stays retired from product docs and server config", () => {
  assert.doesNotMatch(read("server.mjs"), /MWB_UI_SHELL/);
  assert.doesNotMatch(read("package.json"), /start:legacy|MWB_UI_SHELL/);
  assert.doesNotMatch(read("README.md"), /MWB_UI_SHELL=legacy/);
  assert.doesNotMatch(read("docs/releases/v1.0.0-beta.2.md"), /MWB_UI_SHELL=legacy|legacy shell fallback/i);
  assert.doesNotMatch(read("FOR_AKSINGH.md"), /legacy shell flag/i);
  assert.doesNotMatch(read("FOR_AKSINGH.md"), /- `frontend\/matter-screens\.js`/);
  assert.doesNotMatch(read("FOR_AKSINGH.md"), /- `frontend\/state\.js`/);
  assert.doesNotMatch(read("FOR_AKSINGH.md"), /- `frontend\/event-wiring\.js`/);
});

test("retired root legacy shell files stay deleted", () => {
  assert.equal(existsSync(new URL("../index.html", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../styles.css", import.meta.url)), false);
});

test("unimported legacy UX entrypoints stay deleted", () => {
  assert.equal(existsSync(new URL("../frontend/event-wiring.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../frontend/state.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../frontend/matter-screens.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../frontend/views/settings-page.js", import.meta.url)), false);
});

test("retired legacy workflow modules stay deleted", () => {
  const retiredWorkflowModules = [
    "frontend/skills/context-preview.js",
    "frontend/skills/context-search.js",
    "frontend/skills/create-listofdates.js",
    "frontend/skills/describe-sources.js",
    "frontend/skills/doctor.js",
    "frontend/skills/extract.js",
    "frontend/skills/matter-init.js",
    "frontend/skills/prepare-matter.js",
    "frontend/views/add-files.js",
    "frontend/views/extract-result.js",
  ];

  for (const retired of retiredWorkflowModules) {
    assert.equal(existsSync(new URL(`../${retired}`, import.meta.url)), false, retired);
  }
});

test("retired legacy UX entrypoints are not imported by product code", () => {
  const retiredEntrypoints = [
    "app.js",
    "frontend/ai-command-box.js",
    "frontend/event-wiring.js",
    "frontend/matter-screens.js",
    "frontend/state.js",
    "frontend/views/skills-page.js",
  ];
  const productRoots = ["react-ui", "routes", "services", "shared", "scripts"];

  for (const file of listSourceFiles(productRoots)) {
    const source = read(file);
    for (const retired of retiredEntrypoints) {
      const retiredWithoutExtension = retired.replace(/\.js$/, "");
      const escaped = escapeRegex(retiredWithoutExtension);
      assert.doesNotMatch(source, new RegExp(`from ['"][^'"]*${escaped}(?:\\.js)?['"]`), `${file} imports ${retired}`);
      assert.doesNotMatch(source, new RegExp(`import\\(['"][^'"]*${escaped}(?:\\.js)?['"]\\)`), `${file} imports ${retired}`);
    }
  }
});

test("large-file technical debt report records the completed List of Dates engine split", () => {
  const report = read("docs/technical-debt-large-files-review.md");

  assert.doesNotMatch(report, /\| `create-listofdates-engine\.mjs` \| 1,497 \| Split later \|/);
  assert.match(report, /List of Dates engine decomposition is complete/);
});

test("List of Dates root engine stays orchestration-sized after decomposition", () => {
  const source = read("create-listofdates-engine.mjs");
  const lineCount = source.trimEnd().split(/\r?\n/).length;

  assert.ok(lineCount <= 250, `create-listofdates-engine.mjs grew to ${lineCount} lines`);
  assert.match(source, /from "\.\/listofdates\/artifacts\.mjs"/);
  assert.match(source, /from "\.\/listofdates\/run-config\.mjs"/);
  assert.match(source, /from "\.\/listofdates\/two-pass-runner\.mjs"/);
  assert.match(source, /from "\.\/listofdates\/source-records\.mjs"/);
  assert.doesNotMatch(source, /LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT|CANDIDATE_SCHEMA|writeCandidateLedger/);
});

test("critical intake and extraction artifacts use atomic writes", () => {
  for (const file of ["matter-init-engine.mjs", "extract-engine.mjs"]) {
    const source = read(file);
    assert.match(source, /writeFileAtomic/, `${file} should import and use writeFileAtomic`);
    assert.doesNotMatch(source, /import\s*\{[^}]*\bwriteFile\b[^}]*\}\s*from\s*"node:fs\/promises"/, `${file} should not import direct writeFile`);
    assert.doesNotMatch(source, /\bawait\s+writeFile\(/, `${file} should not directly write critical artifacts`);
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listSourceFiles(roots) {
  const files = [];
  for (const root of roots) walk(root, files);
  return files.filter((file) => /\.(mjs|js|ts|tsx)$/.test(file));
}

function walk(relativeDir, files) {
  const absoluteDir = new URL(`../${relativeDir}`, import.meta.url);
  if (!existsSync(absoluteDir)) return;
  for (const entry of readdirSync(absoluteDir)) {
    if (entry === "node_modules" || entry === "react-dist") continue;
    const relativePath = path.posix.join(relativeDir, entry);
    const absolutePath = new URL(`../${relativePath}`, import.meta.url);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      walk(relativePath, files);
    } else {
      files.push(relativePath);
    }
  }
}
