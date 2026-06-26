import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inventoryPath = new URL("../docs/matter-mutation-inventory.md", import.meta.url);
const matterWorkflowRoutesPath = new URL("../routes/matter-workflow-routes.mjs", import.meta.url);
const appShellRoutesPath = new URL("../routes/app-shell-routes.mjs", import.meta.url);
const skillFactoryRoutesPath = new URL("../routes/skill-factory-routes.mjs", import.meta.url);

const TRACKED_MUTATION_ROUTES = [
  "/api/matters/new",
  "/api/matters/add-files",
  "/api/matter-init",
  "/api/extract",
  "/api/describe-sources",
  "/api/create-listofdates",
  "/api/create-listofdates/refresh-labels",
  "/api/matter-story",
  "/api/doctor/fix",
  "/api/skill-ideas",
  "/api/skill-ideas/sample-output",
  "/api/configurable-skills/run",
  "/api/configurable-skills/runs/cancelled",
];

const IMPORTANT_READ_OR_ACTIVITY_ROUTES = [
  "/api/switch-matter",
  "/api/command-interactions",
  "/api/matter-copilot/answer",
  "/api/matter-copilot/research",
];

test("matter mutation inventory covers current high-impact mutation routes", async () => {
  const inventory = await readFile(inventoryPath, "utf8");
  const routeSources = await readRouteSources();

  for (const route of [...TRACKED_MUTATION_ROUTES, ...IMPORTANT_READ_OR_ACTIVITY_ROUTES]) {
    assert.match(routeSources, new RegExp(escapeRegExp(route)), `route fixture should still contain ${route}`);
    assert.match(inventory, new RegExp(escapeRegExp(route)), `inventory should classify ${route}`);
  }
});

test("matter mutation inventory keeps delete/remove blocked behind Matter Log planning", async () => {
  const inventory = await readFile(inventoryPath, "utf8");

  assert.match(inventory, /Remove from active record/);
  assert.match(inventory, /No source-custody event implementation/);
  assert.match(inventory, /No source-removal write-side tombstone mutation/);
  assert.match(inventory, /No complete unified active source set read\/write model/);
  assert.match(inventory, /No artifact currentness projection/);
  assert.match(inventory, /No restore\/quarantine design/);
  assert.doesNotMatch(inventory, /ordinary file system delete/i);
});

test("matter mutation inventory distinguishes session state from custody mutations", async () => {
  const inventory = await readFile(inventoryPath, "utf8");

  assert.match(inventory, /Switch active matter \/ clear active matter/);
  assert.match(inventory, /UI\/session state/);
  assert.match(inventory, /Selecting a matter is not a matter-record mutation/);
  assert.match(inventory, /Receipts are explicitly not evidence and not matter mutations/);
});

async function readRouteSources() {
  return [
    await readFile(matterWorkflowRoutesPath, "utf8"),
    await readFile(appShellRoutesPath, "utf8"),
    await readFile(skillFactoryRoutesPath, "utf8"),
  ].join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
