import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
