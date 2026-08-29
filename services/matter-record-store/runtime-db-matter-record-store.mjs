// Runtime-database adapter for the matter record store.
//
// Satisfies the same contract as the filesystem adapter, so the filing rules
// above it are identical under both arrangements. Contract:
// specs/001-v4-record-parity/contracts/matter-record-store.md
//
// Two decisions here are deliberate and load-bearing. Both are recorded in
// specs/001-v4-record-parity/research.md; they look like omissions otherwise.

export function createRuntimeDbMatterRecordStore({ storage, matterIndex } = {}) {
  if (!storage?.readMatterText || !storage?.persistTextArtifacts) {
    throw new Error("runtime db matter record store requires a storage service with readMatterText and persistTextArtifacts");
  }
  if (typeof matterIndex?.findMatterFolder !== "function") {
    throw new Error("runtime db matter record store requires a matter index with findMatterFolder");
  }

  return Object.freeze({
    /**
     * Resolve by name only, through the matter index.
     *
     * The index lookup is not optional bookkeeping: matter payloads are scoped
     * by matter id in SQL, so a descriptor carrying only a name reads nothing
     * and silently resolves to "no such matter". A fake storage keyed by name
     * cannot expose that, which is why the real-database test exists.
     *
     * The filesystem adapter has a second step that matches a simplified
     * identifier against directory entries. That exists because a matter's
     * folder name can differ from its display name — a filesystem-only
     * condition. Here identity comes from the index, so there is nothing to
     * recover from; mirroring the fallback would import its first-match
     * ambiguity for no gain (research R3).
     */
    async resolveMatter({ folderName } = {}) {
      const name = String(folderName || "").trim();
      if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
      let row = null;
      try {
        row = await matterIndex.findMatterFolder(name);
      } catch {
        return null;
      }
      if (!row?.id) return null;
      const matter = {
        id: row.id,
        name: row.name || name,
        folderName: row.name || name,
        matterName: row.matterName || row.name || name,
      };
      // Identity comes from the index; AUTHORIZATION does not. The index answers
      // "which matter is called this", which is not the same question as "may
      // this caller write to it". Confirm the matter is readable through the
      // tenant-scoped storage before handing back a handle, so a matter
      // belonging to another tenant declines rather than resolving (FR-014).
      // Filing needs the manifest regardless, so this costs nothing extra.
      try {
        const manifest = await storage.readMatterText(matter, "matter.json");
        if (manifest === null) return null;
      } catch {
        return null;
      }
      return matter;
    },

    async readText(matter, relativePath) {
      assertConfined(relativePath);
      return storage.readMatterText(matter, relativePath);
    },

    /**
     * One file per call.
     *
     * persistTextArtifacts accepts an array and compiles it into a single
     * statement, so a batch either lands entirely or not at all. The
     * filesystem arrangement writes each file individually, leaving earlier
     * documents filed when a later one fails. Both are defensible, but they
     * are different, and the difference is observable in the matter record
     * after a mid-batch failure. Parity requires the filesystem's granularity,
     * so this deliberately gives up the batching the API offers (research R4).
     */
    async writeText(matter, relativePath, text, { role, mimeType } = {}) {
      assertConfined(relativePath);
      await storage.persistTextArtifacts(matter, [{
        relativePath,
        text: String(text ?? ""),
        ...(role ? { objectRole: role } : {}),
        ...(mimeType ? { mimeType } : {}),
      }]);
    },
  });
}

function assertConfined(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    const error = new Error("path is outside the matter");
    error.code = "matter_record_store.path_invalid";
    throw error;
  }
}
