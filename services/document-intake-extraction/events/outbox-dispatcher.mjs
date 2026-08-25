import { createHmac } from "node:crypto";

export class OutboxDispatcher {
  constructor({ store, deliver, baseRetryMs = 1_000, maximumRetryMs = 15 * 60 * 1000 } = {}) {
    if (!store?.claim || !store?.markDelivered || !store?.markFailed) throw new Error("outbox dispatcher requires a durable store");
    if (typeof deliver !== "function") throw new Error("outbox dispatcher requires a delivery function");
    this.store = store;
    this.deliver = deliver;
    this.baseRetryMs = positiveInteger(baseRetryMs, "baseRetryMs");
    this.maximumRetryMs = positiveInteger(maximumRetryMs, "maximumRetryMs");
  }

  async drainTenant({ tenantId, workerId = "outbox-dispatcher", maximumEvents = 20, leaseMs = 60_000 } = {}) {
    const claimed = await this.store.claim({ tenantId, workerId, maximumEvents, leaseMs });
    const outcomes = [];
    for (const event of claimed) {
      try {
        await this.deliver(event, { idempotencyKey: event.eventId });
        await this.store.markDelivered({ tenantId, eventId: event.eventId, leaseToken: event.leaseToken });
        outcomes.push({ eventId: event.eventId, status: "delivered", attemptCount: event.attemptCount });
      } catch (error) {
        const terminal = error?.retryable === false;
        const retryAfterMs = retryDelay(event.attemptCount, this.baseRetryMs, this.maximumRetryMs);
        await this.store.markFailed({
          tenantId,
          eventId: event.eventId,
          leaseToken: event.leaseToken,
          errorCode: safeCode(error?.code),
          errorMessage: safeMessage(error),
          retryAfterMs,
          terminal,
        });
        outcomes.push({
          eventId: event.eventId,
          status: terminal ? "dead_letter" : "failed",
          attemptCount: event.attemptCount,
          retryAfterMs: terminal ? null : retryAfterMs,
        });
      }
    }
    return outcomes;
  }
}

export function createHttpEventDelivery({ endpoint, bearerToken, signingKey, keyId, clock = () => new Date(), fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("outbox event delivery requires HTTPS outside local tests");
  }
  const secret = String(bearerToken || "").trim();
  const hmacKey = String(signingKey || "");
  const signingKeyId = String(keyId || "").trim();
  if (!secret && !hmacKey) throw new Error("outbox bearer token or signing key is required");
  if (hmacKey && hmacKey.length < 32) throw new Error("outbox signing key must contain at least 32 characters");
  if (hmacKey && !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(signingKeyId)) throw new Error("outbox signing keyId is invalid");
  const milliseconds = positiveInteger(timeoutMs, "timeoutMs");
  return async function deliverEvent(event, { idempotencyKey } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    const stableIdempotencyKey = String(idempotencyKey || event.eventId);
    const body = JSON.stringify(event.payload);
    const timestamp = clock().toISOString();
    const signature = hmacKey
      ? `sha256=${createHmac("sha256", hmacKey).update(`${timestamp}.${stableIdempotencyKey}.${body}`).digest("hex")}`
      : "";
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
          ...(signature ? {
            "X-Event-Key-Id": signingKeyId,
            "X-Event-Timestamp": timestamp,
            "X-Event-Signature": signature,
          } : {}),
          "Content-Type": "application/json",
          "Idempotency-Key": stableIdempotencyKey,
          "X-Event-Type": event.type,
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      const wrapped = new Error(error?.name === "AbortError" ? "event delivery timed out" : "event delivery failed");
      wrapped.code = error?.name === "AbortError" ? "outbox.timeout" : "outbox.fetch_failed";
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const error = new Error(`event receiver returned HTTP ${response.status}`);
      error.code = `outbox.http_${response.status}`;
      error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
      throw error;
    }
    return { status: response.status };
  };
}

export function retryDelay(attemptCount, baseRetryMs, maximumRetryMs) {
  const exponent = Math.max(0, Math.min(20, Number(attemptCount || 1) - 1));
  return Math.min(maximumRetryMs, baseRetryMs * (2 ** exponent));
}

function safeCode(value) {
  const normalized = String(value || "outbox.delivery_failed");
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(normalized) ? normalized : "outbox.delivery_failed";
}

function safeMessage(error) {
  return String(error?.message || error || "Event delivery failed").replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}
