import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const timingPath = new URL("../react-ui/src/lib/preparationTiming.ts", import.meta.url);
const overviewPath = new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url);
const runnerPath = new URL("../react-ui/src/lib/autoPreparationRunner.ts", import.meta.url);
const observerPath = new URL("../react-ui/src/hooks/useBackendPreparationJobs.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("preparation timing formats live and completed durations consistently", async () => {
  const {
    elapsedMsBetween,
    formatPreparationDuration,
    preparationRunElapsedMs,
    preparationStepElapsedMs,
  } = await importTiming();

  const start = "2026-08-23T06:00:00.000Z";
  const finish = "2026-08-23T07:02:03.900Z";
  const now = Date.parse("2026-08-23T06:01:08.800Z");

  assert.equal(elapsedMsBetween(start, undefined, now), 68_800);
  assert.equal(preparationRunElapsedMs({ startedAt: start }, now), 68_800);
  assert.equal(preparationRunElapsedMs({ startedAt: start, finishedAt: finish }, now), 3_723_900);
  assert.equal(formatPreparationDuration(8_999), "8s");
  assert.equal(formatPreparationDuration(68_800), "1m 08s");
  assert.equal(formatPreparationDuration(3_723_900), "1h 02m 03s");
  assert.equal(elapsedMsBetween("not-a-date", undefined, now), null);

  assert.equal(preparationStepElapsedMs({
    id: "extract",
    label: "Reading documents",
    state: "running",
    startedAt: start,
    durationMs: 0,
  }, now), 68_800);
  assert.equal(preparationStepElapsedMs({
    id: "extract",
    label: "Reading documents",
    state: "done",
    startedAt: start,
    finishedAt: finish,
    durationMs: 12_345,
  }, now), 12_345);
});

test("Matter Preparation exposes a live overall clock and per-stage elapsed times", async () => {
  const [overview, runner, observer, types] = await Promise.all([
    readFile(overviewPath, "utf8"),
    readFile(runnerPath, "utf8"),
    readFile(observerPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);

  assert.match(overview, /usePreparationClock\(preparationRun\)/);
  assert.match(overview, /PREPARATION_CLOCK_TICK_MS/);
  assert.match(overview, /Matter preparation timing/);
  assert.match(overview, /Total preparation time/);
  assert.match(overview, /preparationStepElapsedMs\(step, nowMs\)/);
  assert.match(overview, /step\.state === 'running' \? 'elapsed' : 'total'/);

  assert.match(types, /interface PreparationProgressStep[\s\S]*startedAt\?: string;[\s\S]*finishedAt\?: string;[\s\S]*durationMs\?: number;/);
  assert.match(runner, /const startingNow = step\.state !== 'running'/);
  assert.match(runner, /const finishingNow = step\.state === 'running'/);
  assert.match(runner, /elapsedMsBetween\(step\.startedAt, nowIso, nowMs\)/);

  assert.match(observer, /preparationJobsForActiveChain\(jobs, activeJob\)/);
  assert.match(observer, /job\?\.progress\?\.preparationChainId/);
  assert.match(observer, /job\.createdAt \|\| job\.startedAt/);
  assert.match(observer, /backendJobTiming\(job\)/);
});

async function importTiming() {
  const source = await readFile(timingPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`);
}
