#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { configError, redactV4DatabaseText } from "./v4-db-operator-config.mjs";
import { inspectCurrentV4Posture, readinessPostureFingerprint } from "./v4-db-readiness.mjs";

export async function runV4DbActivation({
  action,
  readinessPath = "",
  runtimeEnvPath = path.join(os.homedir(), ".config", "matter-workbench", "runtime.env"),
  env = process.env,
  currentPostureFingerprint = "",
  inspect = inspectCurrentV4Posture,
  restart = restartWorkbench,
  dryRun = false,
} = {}) {
  if (!['activate', 'disable'].includes(action)) throw configError("action must be activate or disable", "v4_db.action_invalid");
  let readiness = null;
  if (action === "activate") {
    if (String(env.MWB_V4_AUTO_MIGRATE) !== "0") throw configError("MWB_V4_AUTO_MIGRATE must be 0 before activation", "v4_db.auto_migrate_invalid");
    readiness = await requiredReadiness(readinessPath);
    if (readiness.schemaVersion !== "v4-db-readiness/v1" || readiness.success !== true || readiness.activationReady !== true) {
      throw configError("readiness evidence did not pass", "v4_db.readiness_failed");
    }
    const fingerprint = currentPostureFingerprint || readinessPostureFingerprint(await inspect({ env }));
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || readiness.postureFingerprint !== fingerprint) {
      throw configError("readiness evidence no longer matches current posture", "v4_db.readiness_stale");
    }
  }

  const original = await readFile(runtimeEnvPath, "utf8");
  const updated = updateRuntimeEnv(original, action);
  const changed = updated !== original;
  if (!dryRun && changed) {
    const metadata = await stat(runtimeEnvPath);
    const temporary = `${runtimeEnvPath}.${process.pid}.tmp`;
    await writeFile(temporary, updated, { mode: metadata.mode });
    await chmod(temporary, metadata.mode);
    await rename(temporary, runtimeEnvPath);
    await restart();
  }
  return {
    schemaVersion: "v4-db-activation/v1", success: true, action, changed, dryRun: Boolean(dryRun),
    restarted: Boolean(!dryRun && changed), databaseChanged: false,
    readinessFingerprint: readiness?.postureFingerprint || "",
  };
}

export function updateRuntimeEnv(source, action) {
  const lines = String(source).split("\n");
  const indexes = lines.map((line, index) => (/^MWB_V4_INTAKE=/.test(line) ? index : -1)).filter((index) => index >= 0);
  if (indexes.length > 1) throw configError("runtime env contains duplicate MWB_V4_INTAKE entries", "v4_db.flag_duplicate");
  if (action === "disable") {
    if (!indexes.length) return String(source);
    lines.splice(indexes[0], 1);
    return lines.join("\n");
  }
  if (indexes.length) lines[indexes[0]] = "MWB_V4_INTAKE=1";
  else {
    if (lines.at(-1) !== "") lines.push("");
    lines.splice(lines.length - 1, 0, "MWB_V4_INTAKE=1");
  }
  return lines.join("\n");
}

async function requiredReadiness(file) {
  if (!file) throw configError("readiness record is required", "v4_db.readiness_missing");
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { throw configError("readiness record is missing or invalid", "v4_db.readiness_missing"); }
}
async function restartWorkbench() {
  const result = spawnSync("systemctl", ["--user", "restart", "matter-workbench-runtime"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw configError("Matter Workbench restart failed after flag edit", "v4_db.restart_failed");
}
function parseArgs(argv) { const r={action:argv[0]}; for(let i=1;i<argv.length;i+=1){if(argv[i]==="--readiness"&&argv[i+1])r.readinessPath=path.resolve(argv[++i]);else if(argv[i]==="--runtime-env"&&argv[i+1])r.runtimeEnvPath=path.resolve(argv[++i]);else if(argv[i]==="--dry-run")r.dryRun=true;else throw new Error(`Unknown or incomplete option: ${argv[i]}`);}return r; }
if (import.meta.url === `file://${process.argv[1]}`) runV4DbActivation(parseArgs(process.argv.slice(2))).then((r)=>console.log(JSON.stringify(r,null,2))).catch((e)=>{console.error(`${e.code||"v4_db.activation_failed"}: ${redactV4DatabaseText(e.message)}`);process.exitCode=1;});
