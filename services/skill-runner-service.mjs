import { deriveNativeSkillRunReceipt } from "../shared/native-skill-run-receipts.mjs";
import { createSkillStageService } from "./skill-stage-service.mjs";

export function createSkillRunnerService({
  jobStatusService,
  runners = {},
  dispatch = null,
  now = () => new Date(),
} = {}) {
  if (!jobStatusService?.createJob || !jobStatusService?.getJob) {
    throw new Error("jobStatusService with createJob/getJob is required");
  }
  const stageService = createSkillStageService({ jobStatusService, now });
  const runnerMap = new Map(Object.entries(runners || {}));

  function resolveRunner(slash) {
    const key = normalizeSlash(slash);
    const runner = runnerMap.get(key);
    if (!runner) throw new Error(`Native skill runner not found: ${key || String(slash || "")}`);
    return { key, runner };
  }

  async function start({ slash, request = {}, idempotencyKey = "", mode = "auto" } = {}) {
    const { key, runner } = resolveRunner(slash);
    if (typeof runner.preflight === "function") {
      const preflight = await runner.preflight({ request });
      if (preflight && preflight.ok === false) {
        return {
          accepted: false,
          reason: preflight.reason || "preflight_not_ready",
          preflight,
        };
      }
    }

    const job = await jobStatusService.createJob({
      kind: runner.kind || kindFromSlash(key),
      label: runner.label || runner.title || key,
      matterName: request.matterName || request.matter || "",
      matterId: request.matterId || "",
      metadata: {
        skill: {
          slash: key,
          skillId: runner.id || kindFromSlash(key),
          idempotencyKey: String(idempotencyKey || "").trim(),
        },
      },
    });

    const payload = {
      runId: job.id,
      slash: key,
      request,
    };

    if (mode === "queued" || (mode === "auto" && typeof dispatch === "function")) {
      if (typeof dispatch !== "function") throw new Error("dispatch is required for queued skill runs");
      await dispatch(payload);
      return { accepted: true, queued: true, runId: job.id, job };
    }

    return execute(payload);
  }

  async function execute({ runId, slash, request = {} } = {}) {
    const { key, runner } = resolveRunner(slash);
    const job = await jobStatusService.getJob(runId);
    try {
      const result = typeof runner.run === "function"
        ? await runner.run({ request, job, stages: stageService, jobStatusService })
        : {};
      const completed = await jobStatusService.completeJob(runId, resultJobPatch(result));
      const receipt = deriveNativeSkillRunReceipt({
        job: completed,
        slash: key,
        skillId: runner.id || kindFromSlash(key),
        skillVersion: runner.version || 1,
        state: result?.state,
        outputPaths: result?.outputPaths,
        outputAvailability: result?.outputAvailability,
        warnings: result?.warnings,
      });
      return { accepted: true, queued: false, runId, result, job: completed, receipt };
    } catch (error) {
      const failed = await jobStatusService.failJob(runId, error);
      const receipt = deriveNativeSkillRunReceipt({
        job: failed,
        slash: key,
        skillId: runner.id || kindFromSlash(key),
        skillVersion: runner.version || 1,
      });
      return { accepted: true, queued: false, runId, error, job: failed, receipt };
    }
  }

  return {
    start,
    execute,
    resolveRunner,
  };
}

function resultJobPatch(result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  return {
    resultState: typeof result.state === "string" ? result.state : undefined,
    summary: summarizeResult(result),
  };
}

function summarizeResult(result = {}) {
  if (typeof result.message === "string") return result.message;
  if (typeof result.reason === "string") return result.reason;
  if (typeof result.summary === "string") return result.summary;
  if (result.outputPaths && typeof result.outputPaths === "object") {
    const paths = Object.values(result.outputPaths).filter((value) => typeof value === "string" && value.trim());
    if (paths.length) return paths.join(", ");
  }
  return "";
}

function normalizeSlash(value) {
  const text = String(value || "").trim();
  return text.startsWith("/") ? text : text ? `/${text}` : "";
}

function kindFromSlash(slash = "") {
  return String(slash || "").replace(/^\/+/, "").replace(/[^a-z0-9_]+/gi, "_").toLowerCase() || "skill";
}
