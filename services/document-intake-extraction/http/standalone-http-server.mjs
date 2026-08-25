import http from "node:http";

export function createDocumentIntakeExtractionHttpServer({
  handler,
  readinessCheck = async () => ({ ready: true }),
  readinessTimeoutMs = 5_000,
  requestTimeoutMs = 30_000,
  headersTimeoutMs = 10_000,
  maximumRequestsPerSocket = 100,
  createServer = http.createServer,
} = {}) {
  if (typeof handler !== "function") throw new Error("standalone V4 HTTP server requires a handler");
  if (typeof readinessCheck !== "function") throw new Error("readinessCheck must be a function");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://document-intake-extraction.invalid");
      if (request.method === "GET" && url.pathname === "/health/live") return healthResponse(response, 200, "live");
      if (request.method === "GET" && url.pathname === "/health/ready") {
        const readiness = await withTimeout(readinessCheck(), readinessTimeoutMs);
        return healthResponse(response, readiness?.ready === true ? 200 : 503, readiness?.ready === true ? "ready" : "unavailable");
      }
      await handler(request, response);
    } catch {
      if (!response.headersSent) healthResponse(response, 503, "unavailable");
      else response.destroy();
    }
  });
  server.requestTimeout = positiveInteger(requestTimeoutMs, "requestTimeoutMs");
  server.headersTimeout = positiveInteger(headersTimeoutMs, "headersTimeoutMs");
  server.maxRequestsPerSocket = positiveInteger(maximumRequestsPerSocket, "maximumRequestsPerSocket");
  server.keepAliveTimeout = Math.min(5_000, server.requestTimeout);
  return server;
}

export async function listenDocumentIntakeExtractionServer(server, { host = "127.0.0.1", port = 0 } = {}) {
  if (!server?.listen) throw new Error("HTTP server is required");
  const normalizedPort = boundedInteger(port, "port", 0, 65_535);
  await new Promise((resolve, reject) => {
    function onError(error) { cleanup(); reject(error); }
    function onListening() { cleanup(); resolve(); }
    function cleanup() { server.off("error", onError); server.off("listening", onListening); }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(normalizedPort, host);
  });
  const address = server.address();
  return { host, port: typeof address === "object" && address ? address.port : normalizedPort };
}

export async function closeDocumentIntakeExtractionServer(server) {
  if (!server?.close) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function healthResponse(response, statusCode, status) {
  const body = JSON.stringify({ schemaVersion: "document-intake-extraction.health/v1", status });
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function withTimeout(value, timeoutMs) {
  const milliseconds = positiveInteger(timeoutMs, "readinessTimeoutMs");
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("readiness timed out")), milliseconds); timer.unref?.(); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function positiveInteger(value, field) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`); return number; }
function boundedInteger(value, field, minimum, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`); return number; }
