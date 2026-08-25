export async function fetchProviderJson({
  fetchImpl = fetch,
  url,
  init,
  provider,
  timeoutMs,
  apiKey = "",
  maximumResponseBytes = 16 * 1024 * 1024,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("provider fetch implementation is required");
  const milliseconds = positiveInteger(timeoutMs, "timeoutMs");
  const responseLimit = positiveInteger(maximumResponseBytes, "maximumResponseBytes");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const wrapped = providerError(
      error?.name === "AbortError" ? `${provider} request timed out` : `${provider} request failed`,
      error?.name === "AbortError" ? "provider.timeout" : "provider.fetch_failed",
      { retryable: true, billingKnown: false },
    );
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
  const requestId = headerValue(response.headers, "x-request-id")
    || headerValue(response.headers, "request-id")
    || headerValue(response.headers, "x-goog-request-id");
  const text = await readBoundedText(response, response.ok ? responseLimit : Math.min(responseLimit, 64 * 1024), { truncate: !response.ok });
  if (!response.ok) {
    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
    throw providerError(`${provider} returned HTTP ${response.status}${safeProviderDetail(text, apiKey)}`, `provider.http_${response.status}`, {
      retryable,
      billingKnown: false,
      requestId,
      statusCode: response.status,
      retryAfterMs: parseRetryAfterMs(headerValue(response.headers, "retry-after")),
    });
  }
  try {
    return { payload: text ? JSON.parse(text) : {}, requestId, statusCode: response.status };
  } catch {
    throw providerError(`${provider} returned invalid JSON`, "provider.invalid_json", {
      retryable: false,
      billingKnown: false,
      requestId,
      statusCode: response.status,
    });
  }
}

export function providerError(message, code, properties = {}) {
  const error = new Error(String(message || "provider request failed").replace(/[\r\n\t]+/g, " ").slice(0, 500));
  error.code = code;
  Object.assign(error, properties);
  return error;
}

function headerValue(headers, name) {
  try {
    return String(headers?.get?.(name) || "").trim().slice(0, 240);
  } catch {
    return "";
  }
}

async function readBoundedText(response, maximumBytes, { truncate = false } = {}) {
  const declaredBytes = Number(headerValue(response?.headers, "content-length"));
  if (!truncate && Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) throw responseTooLarge(maximumBytes);
  if (response?.body && typeof response.body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maximumBytes - bytes;
      if (buffer.length > remaining) {
        if (!truncate) throw responseTooLarge(maximumBytes);
        if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
        bytes = maximumBytes;
        break;
      }
      chunks.push(buffer);
      bytes += buffer.length;
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  }
  try {
    const text = await response.text();
    if (Buffer.byteLength(text) <= maximumBytes) return text;
    if (!truncate) throw responseTooLarge(maximumBytes);
    return Buffer.from(text).subarray(0, maximumBytes).toString("utf8");
  } catch (error) {
    if (error?.code === "provider.response_too_large") throw error;
    return "";
  }
}

function responseTooLarge(maximumBytes) {
  return providerError(`provider response exceeded ${maximumBytes} bytes`, "provider.response_too_large", {
    retryable: false,
    billingKnown: false,
  });
}

function parseRetryAfterMs(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60 * 60 * 1000, Math.ceil(seconds * 1000));
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(60 * 60 * 1000, timestamp - Date.now())) : 0;
}

function safeProviderDetail(text, apiKey) {
  const sanitized = String(text || "")
    .replaceAll(String(apiKey || "__no_key__"), "[REDACTED]")
    .replace(/(api[_ -]?key|token|authorization)["'\s:=]+[^\s,"'}]+/gi, "$1=[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 200);
  return sanitized ? `: ${sanitized}` : "";
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}
