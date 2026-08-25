import { createPipelineFingerprint, assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";
import { providerCapabilityKey } from "../providers/pinned-provider-adapter.mjs";

export function createSelectiveRepairRouter({
  repairProvider,
  version = "selective-repair-router/v1",
  maximumAttempts = 2,
  priorityBoost = 20,
  triggerReasons = null,
} = {}) {
  const capability = assertPinnedProviderCapability(repairProvider?.capability || repairProvider);
  const attempts = boundedInteger(maximumAttempts, "maximumAttempts", 1, 10);
  const priority = boundedInteger(priorityBoost, "priorityBoost", 0, 100);
  const triggers = triggerReasons ? new Set(triggerReasons.map(String)) : null;
  function buildRoute(claim) {
    return {
      fingerprint: createPipelineFingerprint({
        sourceSha256: claim.sourceSha256,
        pageNumber: claim.pageNumber,
        dedupScope: claim.tenantId,
        provider: capability.provider,
        model: capability.model,
        adapterVersion: capability.adapterVersion,
        routingPolicy: version,
        validator: claim.validatorVersion,
      }),
      capability,
      routingPolicy: version,
      validatorVersion: claim.validatorVersion,
      maximumAttempts: attempts,
      priorityBoost: priority,
      weight: Number(claim.weight || 1),
    };
  }
  return Object.freeze({
    version,
    capability,
    select({ claim, validation } = {}) {
      if (validation?.outcome !== "review_required") return null;
      if (providerCapabilityKey(claim?.capability) === providerCapabilityKey(capability)) return null;
      const reasons = Array.isArray(validation.reasons) ? validation.reasons.map(String) : [];
      if (triggers && !reasons.some((reason) => triggers.has(reason))) return null;
      return buildRoute(claim);
    },
    // Provider-terminal failover: pages the primary provider cannot process at
    // all (provider.* errors) route to the repair capability instead of
    // review_required. Local worker/scratch failures never cross providers —
    // the repair lane would hit the same local fault.
    selectForFailure({ claim, error } = {}) {
      if (!String(error?.code || "").startsWith("provider.")) return null;
      if (providerCapabilityKey(claim?.capability) === providerCapabilityKey(capability)) return null;
      return buildRoute(claim);
    },
  });
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}
