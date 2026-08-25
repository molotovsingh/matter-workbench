export async function fetchProviderJson({
  fetchImpl = fetch,
  url,
  init,
  provider,
  timeoutMs,
  apiKey = "",
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("provider fetch implementation is required");
  const milliseconds = positiveInteger(timeoutMs, "timeoutMs");
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
  const text = await safeText(response);
  if (!response.ok) {
    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
    throw providerError(`${provider} returned HTTP ${response.status}${safeProviderDetail(text, apiKey)}`, `provider.http_${response.status}`, {
      retryable,
      billingKnown: false,
      requestId,
      statusCode: response.status,
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

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
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
