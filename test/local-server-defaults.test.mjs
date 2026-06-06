import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runModeAAcceptance } from "../scripts/v1-beta-mode-a-acceptance.mjs";
import {
  DEFAULT_WORKBENCH_BASE_URL,
  DEFAULT_WORKBENCH_HOST,
  DEFAULT_WORKBENCH_PORT,
} from "../shared/local-server-defaults.mjs";
import { createWorkbenchServer } from "../server.mjs";

test("local server and smoke defaults share one workbench URL", async () => {
  assert.equal(DEFAULT_WORKBENCH_HOST, "127.0.0.1");
  assert.equal(DEFAULT_WORKBENCH_PORT, 4173);
  assert.equal(DEFAULT_WORKBENCH_BASE_URL, "http://127.0.0.1:4173");

  const app = await createWorkbenchServer({ env: {}, port: undefined });

  assert.equal(app.host, DEFAULT_WORKBENCH_HOST);
  assert.equal(app.port, DEFAULT_WORKBENCH_PORT);
});

test("React smoke script reads the shared local server default instead of hard-coding a port", async () => {
  const source = await readFile(new URL("../scripts/react-ui-smoke.mjs", import.meta.url), "utf8");

  assert.match(source, /DEFAULT_WORKBENCH_BASE_URL/);
  assert.doesNotMatch(source, /MWB_BACKEND_URL \|\| "http:\/\/127\.0\.0\.1:4191"/);
  assert.doesNotMatch(source, /MWB_UI_URL \|\| "http:\/\/127\.0\.0\.1:4191\//);
});

test("React smoke script accepts runtime DB matter custody without a filesystem matters home", async () => {
  const source = await readFile(new URL("../scripts/react-ui-smoke.mjs", import.meta.url), "utf8");

  assert.match(source, /function configHasMatterCustody/);
  assert.match(source, /config\?\.mattersHome === null/);
  assert.doesNotMatch(source, /typeof config\.mattersHome === "string" && config\.mattersHome\.length > 0, "Config exposes matters home"/);
});

test("Mode A acceptance script uses the shared local server default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-mode-a-default-"));
  const manifestPath = path.join(root, "reset-manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    schema_version: "v1-beta-mode-a-reset-manifest/v1",
    mattersHome: root,
    matters: [],
  }));

  const report = await runModeAAcceptance({ manifest: manifestPath });

  assert.equal(report.baseUrl, DEFAULT_WORKBENCH_BASE_URL);
});

test("Mode A acceptance script source does not hard-code the old beta port default", async () => {
  const source = await readFile(new URL("../scripts/v1-beta-mode-a-acceptance.mjs", import.meta.url), "utf8");

  assert.match(source, /DEFAULT_WORKBENCH_BASE_URL/);
  assert.doesNotMatch(source, /baseUrl:\s*"http:\/\/127\.0\.0\.1:4191"/);
  assert.doesNotMatch(source, /Default: http:\/\/127\.0\.0\.1:4191/);
});
