import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const policyPath = new URL("../docs/release-policy.md", import.meta.url);
const maintenanceLogPath = new URL("../docs/releases/maintenance-checkpoints.md", import.meta.url);
const docsReadmePath = new URL("../docs/README.md", import.meta.url);

test("release policy documents tiered release classes and maintenance log", async () => {
  const policy = await readFile(policyPath, "utf8");
  const maintenanceLog = await readFile(maintenanceLogPath, "utf8");
  const docsReadme = await readFile(docsReadmePath, "utf8");

  assert.match(policy, /Tier 1 — Official Tester Release/);
  assert.match(policy, /Tier 2 — Deployed Maintenance Checkpoint/);
  assert.match(policy, /Tier 3 — Main-Only Refactor \/ Unreleased Code/);
  assert.match(policy, /Tier 4 — Docs-Only \/ Policy \/ Planning Change/);
  assert.match(policy, /Do not use `release:position-check` as a Tier 2 checker/);
  assert.match(policy, /Maintenance checkpoints do not consume beta numbers/);
  assert.match(policy, /When unsure between Tier 1 and Tier 2, choose Tier 1/);

  assert.match(maintenanceLog, /Status: Tier 2 deployment log/);
  assert.match(maintenanceLog, /Base official release:/);
  assert.match(maintenanceLog, /Deployed commit:/);
  assert.match(maintenanceLog, /Rollback:/);
  assert.match(docsReadme, /Maintenance Checkpoints/);
});
