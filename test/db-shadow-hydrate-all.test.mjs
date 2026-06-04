import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pipelinePath = new URL("../scripts/db-shadow-hydrate-all.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("shadow hydration pipeline dry-run executes every planner in dependency order without a database URL", async () => {
  const {
    parseArgs,
    runShadowHydrationPipeline,
    renderShadowHydrationPipelineResult,
  } = await import(pipelinePath.href);
  const calls = [];

  const result = runShadowHydrationPipeline({
    args: parseArgs(["--dry-run"]),
    spawn: fakeSpawn(calls),
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.script), [
    "db:hydrate:dry-run",
    "db:skills:hydrate:dry-run",
    "db:advisory:hydrate:dry-run",
    "db:storage:hydrate:dry-run",
    "db:provider-runs:hydrate:dry-run",
    "db:jobs:hydrate:dry-run",
    "db:costs:hydrate:dry-run",
    "db:audit:hydrate:dry-run",
  ]);
  assert.equal(calls.every((call) => !("MWB_DATABASE_URL" in call.env)), true);

  const rendered = renderShadowHydrationPipelineResult(result).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB hydration pipeline/);
  assert.match(rendered, /mode: dry-run/);
  assert.match(rendered, /db:jobs:hydrate:dry-run: ok/);
});

test("shadow hydration pipeline apply runs write steps then the combined report without leaking secrets", async () => {
  const { parseArgs, runShadowHydrationPipeline } = await import(pipelinePath.href);
  const calls = [];

  const result = runShadowHydrationPipeline({
    args: parseArgs(["--apply"]),
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    spawn: fakeSpawn(calls),
  });

  assert.equal(result.mode, "apply");
  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.script), [
    "db:hydrate",
    "db:skills:hydrate",
    "db:advisory:hydrate",
    "db:storage:hydrate",
    "db:provider-runs:hydrate",
    "db:jobs:hydrate",
    "db:costs:hydrate",
    "db:audit:hydrate",
    "db:shadow:report",
  ]);
  assert.equal(calls.every((call) => call.env.MWB_DATABASE_URL === "postgres://mwb_user:secret@db.example/matter_workbench_shadow"), true);
  assert.doesNotMatch(JSON.stringify(result), /secret|db\.example|matter_workbench_shadow/);
});

test("shadow hydration pipeline verify runs count checks then the combined report", async () => {
  const { parseArgs, runShadowHydrationPipeline } = await import(pipelinePath.href);
  const calls = [];

  const result = runShadowHydrationPipeline({
    args: parseArgs(["--verify"]),
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    spawn: fakeSpawn(calls),
  });

  assert.equal(result.mode, "verify");
  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.script), [
    "db:hydrate:verify",
    "db:skills:hydrate:verify",
    "db:advisory:hydrate:verify",
    "db:storage:hydrate:verify",
    "db:provider-runs:hydrate:verify",
    "db:jobs:hydrate:verify",
    "db:costs:hydrate:verify",
    "db:audit:hydrate:verify",
    "db:shadow:report",
  ]);
});

test("shadow hydration pipeline stops at the first failed step", async () => {
  const { parseArgs, runShadowHydrationPipeline } = await import(pipelinePath.href);
  const calls = [];

  const result = runShadowHydrationPipeline({
    args: parseArgs(["--verify"]),
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    spawn: fakeSpawn(calls, { failScript: "db:provider-runs:hydrate:verify" }),
  });

  assert.equal(result.success, false);
  assert.equal(result.failedStep.script, "db:provider-runs:hydrate:verify");
  assert.deepEqual(calls.map((call) => call.script), [
    "db:hydrate:verify",
    "db:skills:hydrate:verify",
    "db:advisory:hydrate:verify",
    "db:storage:hydrate:verify",
    "db:provider-runs:hydrate:verify",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("package and database docs expose all-shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:shadow:hydrate:dry-run"], "node scripts/db-shadow-hydrate-all.mjs --dry-run");
  assert.equal(pkg.scripts["db:shadow:hydrate"], "node scripts/db-shadow-hydrate-all.mjs --apply");
  assert.equal(pkg.scripts["db:shadow:hydrate:verify"], "node scripts/db-shadow-hydrate-all.mjs --verify");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:shadow:hydrate:dry-run/);
  assert.match(readme, /npm run db:shadow:hydrate:verify/);
});

function fakeSpawn(calls, { failScript = "" } = {}) {
  return (command, args, options = {}) => {
    const scriptIndex = args.indexOf("run") + 1;
    const script = args[scriptIndex];
    calls.push({ command, args, script, env: options.env || {} });
    if (script === failScript) {
      return { status: 1, stdout: "", stderr: "failed with secret" };
    }
    return { status: 0, stdout: `${script}: ok\n`, stderr: "" };
  };
}
