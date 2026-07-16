import { deriveNativeSkillRunReceipt } from "../shared/native-skill-run-receipts.mjs";
import { createSkillStageService } from "./skill-stage-service.mjs";

export function createSkillRunnerService({
  jobStatusService,
  nativeRunStateService = null,
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

  async function start({ slash, request = {}, idempotencyKey = "", mode = "auto", metadata = {} } = {}) {
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

    const jobMetadata = normalizeJobMetadata(metadata);
    const job = await jobStatusService.createJob({
      kind: runner.kind || kindFromSlash(key),
      label: runner.label || runner.title || key,
      matterName: request.matterName || request.matter || "",
      matterId: request.matterId || "",
      metadata: {
        ...jobMetadata,
        skill: {
          ...(jobMetadata.skill && typeof jobMetadata.skill === "object" && !Array.isArray(jobMetadata.skill) ? jobMetadata.skill : {}),
          slash: key,
          skillId: runner.id || kindFromSlash(key),
          idempotencyKey: String(idempotencyKey || "").trim(),
          stageRetrySupported: Boolean(runner.supportsStageRetry),
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
        ? await runner.run({ request, job, stages: stageService, jobStatusService, runState: nativeRunStateService })
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

  async function retry({ failedRunId, retryStageId = "", request = {}, slash = "", mode = "auto", metadata = {} } = {}) {
    let failedJob;
    try {
      failedJob = await jobStatusService.getJob(failedRunId);
    } catch {
      throw retrySourceNotFoundError(failedRunId);
    }
    if (failedJob.status !== "failed") throw retrySourceNotFailedError(failedJob);
    assertRetryMatterMatches(failedJob, request);
    const key = normalizeSlash(slash || failedJob.metadata?.skill?.slash || failedJob.slash || "");
    const { runner } = resolveRunner(key);
    const stageRetrySupported = Boolean(runner.supportsStageRetry || failedJob.metadata?.skill?.stageRetrySupported === true);
    const stageId = stageRetrySupported ? normalizeStageId(retryStageId || recoveryRetryStageId(failedJob)) : "";
    return start({
      slash: key,
      request: {
        ...request,
        matterName: failedJob.matterName || request.matterName,
        matterId: failedJob.matterId || request.matterId,
        resumeFromRunId: failedJob.id,
        resumeFromStage: stageId,
      },
      mode,
      metadata: {
        ...normalizeJobMetadata(metadata),
        retry: {
          ofRunId: failedJob.id,
          ...(stageId ? { retryStageId: stageId } : {}),
        },
      },
    });
  }

  async function getReceipt({ runId, slash = "" } = {}) {
    const job = await jobStatusService.getJob(runId);
    const key = slash || job.metadata?.skill?.slash || job.slash || "";
    const { runner } = resolveRunner(key);
    return deriveNativeSkillRunReceipt({
      job,
      slash: normalizeSlash(key),
      skillId: runner.id || kindFromSlash(key),
      skillVersion: runner.version || 1,
    });
  }

  return {
    start,
    execute,
    getReceipt,
    retry,
    resolveRunner,
  };
}

function normalizeJobMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata;
}

function resultJobPatch(result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const outputPaths = sanitizeOutputPaths(result.outputPaths || artifactOutputPaths(result));
  const outputAvailability = sanitizeOutputAvailability(result.outputAvailability);
  const warnings = sanitizeWarnings(result.warnings);
  return {
    resultState: typeof result.state === "string" ? result.state : undefined,
    summary: summarizeResult(result),
    ...(Object.keys(outputPaths).length ? { outputPaths } : {}),
    ...(Object.keys(outputAvailability).length ? { outputAvailability } : {}),
    ...(warnings.length ? { warnings } : {}),
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

function artifactOutputPaths(result = {}) {
  const artifactPath = typeof result.artifactPath === "string" ? result.artifactPath.trim() : "";
  return artifactPath ? { markdown: artifactPath } : {};
}

function sanitizeOutputPaths(outputPaths = {}) {
  if (!outputPaths || typeof outputPaths !== "object" || Array.isArray(outputPaths)) return {};
  const safe = {};
  for (const key of ["markdown", "json"]) {
    if (typeof outputPaths[key] === "string" && outputPaths[key].trim()) safe[key] = outputPaths[key].trim();
  }
  return safe;
}

function sanitizeOutputAvailability(outputAvailability = {}) {
  if (!outputAvailability || typeof outputAvailability !== "object" || Array.isArray(outputAvailability)) return {};
  const safe = {};
  for (const key of ["markdown", "json"]) {
    const value = typeof outputAvailability[key] === "string" ? outputAvailability[key].trim() : "";
    if (value) safe[key] = value;
  }
  return safe;
}

function sanitizeWarnings(warnings = []) {
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .filter((warning) => typeof warning === "string" && warning.trim())
    .map((warning) => warning.trim())
    .slice(0, 10);
}

function retrySourceNotFoundError(runId = "") {
  const error = new Error(`Retry source job not found: ${String(runId || "").trim() || "unknown"}`);
  error.statusCode = 404;
  error.code = "native_skill.retry_source_not_found";
  return error;
}

function retrySourceNotFailedError(job = {}) {
  const error = new Error("Only failed native skill jobs can be retried from a stage.");
  error.statusCode = 409;
  error.code = "native_skill.retry_source_not_failed";
  error.jobId = job.id;
  return error;
}

function assertRetryMatterMatches(job = {}, request = {}) {
  const jobMatterId = String(job.matterId || "").trim();
  const requestMatterId = String(request.matterId || "").trim();
  const jobMatterName = String(job.matterName || "").trim();
  const requestMatterName = String(request.matterName || request.matter || "").trim();
  const idMismatch = jobMatterId && requestMatterId && jobMatterId !== requestMatterId;
  const nameMismatch = jobMatterName && requestMatterName && jobMatterName !== requestMatterName;
  if (!idMismatch && !nameMismatch) return;
  const error = new Error("Retry matter does not match the failed native skill job.");
  error.statusCode = 409;
  error.code = "native_skill.retry_matter_mismatch";
  error.jobId = job.id;
  throw error;
}

function recoveryRetryStageId(job = {}) {
  const failed = Array.isArray(job.stages) ? job.stages.find((stage) => stage?.status === "failed") : null;
  return failed?.id || "";
}

function normalizeStageId(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(text) ? text : "";
}

function normalizeSlash(value) {
  const text = String(value || "").trim();
  return text.startsWith("/") ? text : text ? `/${text}` : "";
}

function kindFromSlash(slash = "") {
  return String(slash || "").replace(/^\/+/, "").replace(/[^a-z0-9_]+/gi, "_").toLowerCase() || "skill";
}
