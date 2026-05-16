import {
  buildMatterContextPacket,
  MATTER_CONTEXT_PACKET_SCHEMA_VERSION,
} from "./matter-context-packet.mjs";
import {
  summarizeMatterContextPacket,
  MATTER_CONTEXT_PREVIEW_SCHEMA_VERSION,
} from "./matter-context-preview.mjs";
import {
  MATTER_CONTEXT_SEARCH_SCHEMA_VERSION,
  searchMatterContextPacket,
} from "./matter-context-search.mjs";

export {
  buildMatterContextPacket,
  MATTER_CONTEXT_PACKET_SCHEMA_VERSION,
  MATTER_CONTEXT_PREVIEW_SCHEMA_VERSION,
  MATTER_CONTEXT_SEARCH_SCHEMA_VERSION,
  searchMatterContextPacket,
  summarizeMatterContextPacket,
};

export function createMatterContextService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readMatterContextPreview(root = matterStore.ensureMatterRoot()) {
    const packet = await buildMatterContextPacket(root);
    return summarizeMatterContextPacket(packet);
  }

  async function searchMatterContext({
    root = matterStore.ensureMatterRoot(),
    query = "",
    maxResults,
    snippetChars,
  } = {}) {
    const packet = await buildMatterContextPacket(root);
    return searchMatterContextPacket(packet, query, { maxResults, snippetChars });
  }

  return { readMatterContextPreview, searchMatterContext };
}
