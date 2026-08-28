import { createPipelineFingerprint, assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";
import { providerCapabilityKey } from "../providers/pinned-provider-adapter.mjs";

// Selective repair as an escalation ladder. Each failed or review-flagged page
// climbs to the next rung: typically same-model page mode first (fixes range
// formatting failures), then a genuinely different provider (fixes pages the
// model cannot read), with review only after the ladder is exhausted. A single
// repairProvider remains supported as a one-rung ladder.
export function createSelectiveRepairRouter({
  repairProvider = null,
  repairProviders = null,
  version = "selective-repair-router/v2",
  maximumAttempts = 2,
  priorityBoost = 20,
  triggerReasons = null,
} = {}) {
  const ladderInput = Array.isArray(repairProviders) && repairProviders.length
    ? repairProviders
    : repairProvider
      ? [repairProvider]
      : [];
  if (!ladderInput.length) throw new Error("selective repair router requires at least one repair provider");
  const ladder = ladderInput.map((entry) => assertPinnedProviderCapability(entry?.capability || entry));
  const ladderKeys = ladder.map((capability) => providerCapabilityKey(capability));
  if (new Set(ladderKeys).size !== ladderKeys.length) throw new Error("repair ladder capabilities must be distinct");
  const attempts = boundedInteger(maximumAttempts, "maximumAttempts", 1, 10);
  const priority = boundedInteger(priorityBoost, "priorityBoost", 0, 100);
  const triggers = triggerReasons ? new Set(triggerReasons.map(String)) : null;

  function nextRung(claimCapability) {
    const key = providerCapabilityKey(claimCapability);
    const index = ladderKeys.indexOf(key);
    if (index === -1) return ladder[0];
    return index + 1 < ladder.length ? ladder[index + 1] : null;
  }

  function buildRoute(claim, capability) {
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
    capability: ladder[0],
    ladder: Object.freeze(ladder.map((capability) => ({ ...capability }))),
    select({ claim, validation } = {}) {
      if (validation?.outcome !== "review_required") return null;
      const reasons = Array.isArray(validation.reasons) ? validation.reasons.map(String) : [];
      if (triggers && !reasons.some((reason) => triggers.has(reason))) return null;
      const capability = nextRung(claim?.capability);
      return capability ? buildRoute(claim, capability) : null;
    },
    // Provider-terminal failover: pages the current provider cannot process at
    // all (provider.* errors) climb to the next rung instead of review. Local
    // worker/scratch failures never cross providers — the next rung would hit
    // the same local fault.
    selectForFailure({ claim, error } = {}) {
      if (!String(error?.code || "").startsWith("provider.")) return null;
      const capability = nextRung(claim?.capability);
      return capability ? buildRoute(claim, capability) : null;
    },
  });
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}
