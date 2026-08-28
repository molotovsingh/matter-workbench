import {
  CONTRACT_VERSIONS,
  assertPinnedProviderCapability,
  normalizeProviderResult,
} from "../../../packages/extraction-contracts/index.mjs";

export function createPinnedProviderAdapter({ provider, model, adapterVersion, extractPage } = {}) {
  const capability = assertPinnedProviderCapability({ provider, model, adapterVersion });
  if (typeof extractPage !== "function") throw new Error("pinned provider adapter requires extractPage");
  return Object.freeze({
    capability,
    async extractPage(input = {}) {
      const output = await extractPage({ ...input, capability });
      return normalizeProviderResult({
        schemaVersion: CONTRACT_VERSIONS.providerResult,
        ...output,
      }, { pageNumber: input.pageNumber });
    },
  });
}

export function createStaticCapabilityRouter(providerAdapter, { version = "static-capability-router/v1" } = {}) {
  if (!providerAdapter?.capability || typeof providerAdapter.extractPage !== "function") {
    throw new Error("static capability router requires a provider adapter");
  }
  return Object.freeze({
    version,
    select() {
      return providerAdapter.capability;
    },
  });
}

export function providerCapabilityKey(capability = {}) {
  const pinned = assertPinnedProviderCapability(capability);
  return `${pinned.provider}\u0000${pinned.model}\u0000${pinned.adapterVersion}`;
}
