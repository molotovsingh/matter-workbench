import { randomUUID } from "node:crypto";

import { assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";
import { providerCapabilityKey } from "../providers/pinned-provider-adapter.mjs";

export function createCertifiedProviderAdmissionController({ certification, concurrencyByCapability = {}, clock, permitFactory } = {}) {
  if (certification?.schemaVersion !== "document-intake-extraction.provider-quota-certification/v1" || certification.certified !== true) {
    throw admissionError("provider quota certification is required before live admission", "provider_admission.certification_required");
  }
  const capabilities = certification.lanes.map((lane) => {
    if (!lane.certified || !(lane.certifiedPageOperationsPerSecond > 0)) {
      throw admissionError("every admitted provider lane must be certified", "provider_admission.lane_not_certified");
    }
    const key = providerCapabilityKey(lane.capability);
    const concurrency = concurrencyByCapability[key] || concurrencyByCapability[lane.capability.provider];
    if (!concurrency) throw admissionError(`concurrency configuration is missing for ${lane.capability.provider}/${lane.capability.model}`, "provider_admission.concurrency_missing");
    return {
      capability: lane.capability,
      maximumConcurrent: concurrency.maximumConcurrent,
      minimumConcurrent: concurrency.minimumConcurrent,
      pageOperationsPerSecond: lane.certifiedPageOperationsPerSecond,
      burstPageOperations: concurrency.burstPageOperations ?? lane.certifiedPageOperationsPerSecond,
    };
  });
  return new AdaptiveProviderAdmissionController({ capabilities, clock, permitFactory });
}

export class AdaptiveProviderAdmissionController {
  constructor({ capabilities = [], clock = () => new Date(), permitFactory = () => randomUUID(), additiveIncreaseEvery = 20 } = {}) {
    this.clock = clock;
    this.permitFactory = permitFactory;
    this.additiveIncreaseEvery = boundedInteger(additiveIncreaseEvery, "additiveIncreaseEvery", 1, 10_000);
    this.states = new Map();
    this.permits = new Map();
    for (const entry of capabilities) {
      const capability = assertPinnedProviderCapability(entry.capability || entry);
      const key = providerCapabilityKey(capability);
      if (this.states.has(key)) throw new Error(`duplicate admission capability ${capability.provider}/${capability.model}`);
      const maximumConcurrent = boundedInteger(entry.maximumConcurrent, "maximumConcurrent", 1, 100_000);
      const minimumConcurrent = boundedInteger(entry.minimumConcurrent ?? 1, "minimumConcurrent", 1, maximumConcurrent);
      const pageOperationsPerSecond = positiveNumber(entry.pageOperationsPerSecond, "pageOperationsPerSecond");
      const burstPageOperations = positiveNumber(entry.burstPageOperations ?? pageOperationsPerSecond, "burstPageOperations");
      this.states.set(key, {
        capability,
        maximumConcurrent,
        minimumConcurrent,
        concurrencyLimit: maximumConcurrent,
        pageOperationsPerSecond,
        burstPageOperations,
        tokens: burstPageOperations,
        lastRefillMs: this.clock().getTime(),
        cooldownUntilMs: 0,
        inflight: 0,
        consecutiveSuccesses: 0,
        admitted: 0,
        deferred: 0,
        throttles: 0,
        failures: 0,
      });
    }
  }

  acquire(capabilityInput, { weight = 1 } = {}) {
    const state = this.requireState(capabilityInput);
    const nowMs = this.clock().getTime();
    refill(state, nowMs);
    const pageWeight = positiveNumber(weight, "weight");
    if (nowMs < state.cooldownUntilMs) return deferred(state, "provider_cooldown", state.cooldownUntilMs - nowMs);
    if (state.inflight >= state.concurrencyLimit) return deferred(state, "provider_concurrency_exhausted", 0);
    if (state.tokens < pageWeight) {
      const retryAfterMs = Math.ceil(((pageWeight - state.tokens) / state.pageOperationsPerSecond) * 1000);
      return deferred(state, "provider_rate_exhausted", retryAfterMs);
    }
    state.tokens -= pageWeight;
    state.inflight += 1;
    state.admitted += 1;
    const permitId = String(this.permitFactory());
    if (!permitId || this.permits.has(permitId)) throw admissionError("provider admission permit collision", "provider_admission.permit_collision");
    const permit = { permitId, capabilityKey: providerCapabilityKey(state.capability), weight: pageWeight, acquiredAtMs: nowMs };
    this.permits.set(permitId, permit);
    return { admitted: true, permit: Object.freeze({ ...permit }), retryAfterMs: 0 };
  }

  cancel(permitInput) {
    const { permit, state } = this.consumePermit(permitInput);
    refill(state, this.clock().getTime());
    state.tokens = Math.min(state.burstPageOperations, state.tokens + permit.weight);
    state.inflight = Math.max(0, state.inflight - 1);
    return this.snapshot(state.capability);
  }

  complete(permitInput, { outcome = "success", retryAfterMs = 0 } = {}) {
    const { state } = this.consumePermit(permitInput);
    const nowMs = this.clock().getTime();
    refill(state, nowMs);
    state.inflight = Math.max(0, state.inflight - 1);
    if (outcome === "throttled") {
      state.throttles += 1;
      state.consecutiveSuccesses = 0;
      state.concurrencyLimit = Math.max(state.minimumConcurrent, Math.floor(state.concurrencyLimit / 2));
      state.cooldownUntilMs = Math.max(state.cooldownUntilMs, nowMs + Math.max(1_000, nonNegativeNumber(retryAfterMs, "retryAfterMs", 0)));
    } else if (outcome === "success") {
      state.consecutiveSuccesses += 1;
      if (state.consecutiveSuccesses >= this.additiveIncreaseEvery && state.concurrencyLimit < state.maximumConcurrent) {
        state.concurrencyLimit += 1;
        state.consecutiveSuccesses = 0;
      }
    } else {
      state.failures += 1;
      state.consecutiveSuccesses = 0;
    }
    return this.snapshot(state.capability);
  }

  snapshot(capabilityInput = null) {
    if (capabilityInput) return stateSnapshot(this.requireState(capabilityInput), this.clock().getTime());
    return Array.from(this.states.values(), (state) => stateSnapshot(state, this.clock().getTime()));
  }

  requireState(capabilityInput) {
    const capability = assertPinnedProviderCapability(capabilityInput);
    const state = this.states.get(providerCapabilityKey(capability));
    if (!state) throw admissionError("provider capability is not certified for admission", "provider_admission.capability_unknown");
    return state;
  }

  consumePermit(input) {
    const permitId = String(input?.permitId || "");
    const permit = this.permits.get(permitId);
    if (!permit) throw admissionError("provider admission permit is missing or already consumed", "provider_admission.permit_invalid");
    this.permits.delete(permitId);
    const state = this.states.get(permit.capabilityKey);
    if (!state) throw admissionError("provider admission state is missing", "provider_admission.capability_unknown");
    return { permit, state };
  }
}

function deferred(state, reason, retryAfterMs) {
  state.deferred += 1;
  return { admitted: false, reason, retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) };
}

function refill(state, nowMs) {
  const elapsedMs = Math.max(0, nowMs - state.lastRefillMs);
  state.tokens = Math.min(state.burstPageOperations, state.tokens + (elapsedMs / 1000) * state.pageOperationsPerSecond);
  state.lastRefillMs = nowMs;
}

function stateSnapshot(state, nowMs) {
  refill(state, nowMs);
  return {
    capability: { ...state.capability },
    maximumConcurrent: state.maximumConcurrent,
    concurrencyLimit: state.concurrencyLimit,
    inflight: state.inflight,
    availablePageOperations: state.tokens,
    pageOperationsPerSecond: state.pageOperationsPerSecond,
    cooldownRemainingMs: Math.max(0, state.cooldownUntilMs - nowMs),
    admitted: state.admitted,
    deferred: state.deferred,
    throttles: state.throttles,
    failures: state.failures,
  };
}

function admissionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function nonNegativeNumber(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}
