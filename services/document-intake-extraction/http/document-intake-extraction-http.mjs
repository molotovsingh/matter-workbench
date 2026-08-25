import { CONTRACT_VERSIONS } from "../../../packages/extraction-contracts/index.mjs";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function createDocumentIntakeExtractionHttpHandler({
  service,
  authenticate,
  authorizeMatter = ({ principal, tenantId }) => principal.tenantId === tenantId,
  maximumBodyBytes = 1024 * 1024,
} = {}) {
  if (!service?.createIntake || !service?.commitFileCustody || !service?.commitBatchCustody) {
    throw new Error("V4 HTTP handler requires the document intake/extraction service");
  }
  if (typeof authenticate !== "function") throw new Error("V4 HTTP handler requires authenticate");

  return async function handleDocumentIntakeExtractionRequest(request, response) {
    setSecurityHeaders(response);
    try {
      const principal = await authenticate(request);
      if (!principal?.tenantId) throw httpError("Authentication required", "api.unauthorized", 401);
      const url = new URL(request.url || "/", "http://document-intake-extraction.invalid");
      const segments = url.pathname.split("/").filter(Boolean).map(decodePathSegment);
      if (request.method === "POST" && sameSegments(segments, ["v1", "intakes"])) {
        const body = await readJsonBody(request, maximumBodyBytes);
        const matterId = cleanId(body.matterId, "matterId");
        await requireMatterAccess({ authorizeMatter, principal, tenantId: principal.tenantId, matterId, action: "intake.create" });
        const idempotencyKey = cleanHeader(request.headers["idempotency-key"]);
        if (!idempotencyKey) throw httpError("Idempotency-Key header is required", "api.idempotency_key_required", 400);
        const intake = await service.createIntake({
          schemaVersion: CONTRACT_VERSIONS.createIntakeCommand,
          tenantId: principal.tenantId,
          matterId,
          idempotencyKey,
          clientRequestId: cleanHeader(request.headers["x-client-request-id"]),
          files: body.files,
        });
        return sendJson(response, intake.idempotent ? 200 : 201, "intake.created", { intake });
      }

      const fileCommit = matchSegments(segments, ["v1", "intakes", ":intakeId", "files", ":fileId", "custody-commit"]);
      if (request.method === "POST" && fileCommit) {
        const intake = await requireAuthorizedIntake(service, fileCommit.intakeId, principal, authorizeMatter, "intake.file.commit");
        const body = await readJsonBody(request, maximumBodyBytes);
        const receipt = await service.commitFileCustody({
          tenantId: principal.tenantId,
          intakeId: intake.intakeId,
          fileId: fileCommit.fileId,
          uploadToken: cleanId(body.uploadToken, "uploadToken"),
        });
        return sendJson(response, 200, "intake.file.custody_committed", { receipt });
      }

      const batchCommit = matchSegments(segments, ["v1", "intakes", ":intakeId", "custody-commit"]);
      if (request.method === "POST" && batchCommit) {
        await requireAuthorizedIntake(service, batchCommit.intakeId, principal, authorizeMatter, "intake.custody.commit");
        const intake = await service.commitBatchCustody({ tenantId: principal.tenantId, intakeId: batchCommit.intakeId });
        return sendJson(response, 200, "intake.custody_committed", { intake });
      }

      const intakeRead = matchSegments(segments, ["v1", "intakes", ":intakeId"]);
      if (request.method === "GET" && intakeRead) {
        const intake = await requireAuthorizedIntake(service, intakeRead.intakeId, principal, authorizeMatter, "intake.read");
        return sendJson(response, 200, "intake.read", { intake });
      }

      const resultRead = matchSegments(segments, ["v1", "results", ":resultId"]);
      if (request.method === "GET" && resultRead) {
        const result = await service.getResult({ tenantId: principal.tenantId, resultId: resultRead.resultId });
        await requireMatterAccess({
          authorizeMatter,
          principal,
          tenantId: result.tenantId,
          matterId: result.matterId,
          action: "result.read",
        });
        return sendJson(response, 200, "extraction.result.read", { result });
      }

      throw httpError("V4 endpoint not found", "api.not_found", 404);
    } catch (error) {
      const normalized = normalizeHttpError(error);
      return sendJson(response, normalized.status, "error", {
        error: { code: normalized.code, message: normalized.message },
      });
    }
  };
}

async function requireAuthorizedIntake(service, intakeId, principal, authorizeMatter, action) {
  const intake = await service.getIntake({ tenantId: principal.tenantId, intakeId });
  await requireMatterAccess({ authorizeMatter, principal, tenantId: intake.tenantId, matterId: intake.matterId, action });
  return intake;
}

async function requireMatterAccess({ authorizeMatter, principal, tenantId, matterId, action }) {
  const allowed = principal.tenantId === tenantId && await authorizeMatter({ principal, tenantId, matterId, action });
  if (!allowed) throw httpError("Resource not found", "api.not_found", 404);
}

async function readJsonBody(request, maximumBodyBytes) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBodyBytes) throw httpError("JSON request body is too large", "api.body_too_large", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
    return parsed;
  } catch {
    throw httpError("Malformed JSON request body", "api.invalid_json", 400);
  }
}

function sendJson(response, status, type, fields = {}) {
  const body = JSON.stringify({
    schemaVersion: CONTRACT_VERSIONS.apiResponse,
    ok: status < 400,
    type,
    ...fields,
  });
  response.statusCode = status;
  response.setHeader("Content-Type", JSON_CONTENT_TYPE);
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function matchSegments(actual, pattern) {
  if (actual.length !== pattern.length) return null;
  const captures = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    if (expected.startsWith(":")) captures[expected.slice(1)] = cleanId(actual[index], expected.slice(1));
    else if (actual[index] !== expected) return null;
  }
  return captures;
}

function sameSegments(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError("Request path is malformed", "api.path_invalid", 400);
  }
}

function cleanId(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,239}$/.test(normalized)) {
    throw httpError(`${field} is invalid`, "api.identifier_invalid", 400);
  }
  return normalized;
}

function cleanHeader(value) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return String(normalized || "").replace(/[\r\n\u0000]/g, "").trim().slice(0, 240);
}

function normalizeHttpError(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) return error;
  const code = String(error?.code || "api.internal_error");
  if (code === "intake.not_found" || code === "intake.result_not_found" || code === "intake.file_not_found") {
    return httpError("Resource not found", "api.not_found", 404);
  }
  if (code === "intake.files_incomplete" || code.endsWith("_conflict") || code.includes("committed")) {
    return httpError("The intake state conflicts with this request", code, 409);
  }
  if (code.startsWith("inspection.")) {
    return httpError("Document inspection failed", code, 400);
  }
  if (code.startsWith("contract.") || code.startsWith("object.")) {
    return httpError(safeClientMessage(error?.message), code, 400);
  }
  return httpError("Document intake service could not complete the request", "api.internal_error", 500);
}

function safeClientMessage(message) {
  return String(message || "Invalid document intake request").replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function httpError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
