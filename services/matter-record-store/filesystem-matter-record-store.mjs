import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../../shared/atomic-file.mjs";

// Filesystem adapter for the matter record store.
//
// This is the REFERENCE arrangement. Its behaviour was moved here unchanged
// from v4-extraction-import-service.mjs so that filing rules and storage access
// could be separated without altering either. Parity for every other adapter is
// defined against what this one does — including where it is imperfect, which
// is why the two-step matter resolution below is preserved rather than tidied.
//
// Contract: specs/001-v4-record-parity/contracts/matter-record-store.md

export function createFilesystemMatterRecordStore({ mattersHome } = {}) {
  if (!String(mattersHome || "").trim()) throw new Error("filesystem matter record store requires mattersHome");
  const home = path.resolve(mattersHome);

  return Object.freeze({
    /**
     * Exact folder name first, then the simplified identifier matched against
     * directory entries. The second step exists because a matter's folder name
     * can differ from its display name; slugification is lossy, so it is matched
     * forward over candidates rather than inverted.
     */
    async resolveMatter({ folderName, slug } = {}) {
      const exact = String(folderName || "").trim();
      if (exact && !exact.includes("/") && !exact.includes("\\") && !exact.includes("..")) {
        const candidate = path.join(home, exact);
        if (await isMatterRoot(candidate)) return candidate;
      }
      const wanted = String(slug || "").trim();
      if (!wanted) return null;
      let entries = [];
      try {
        entries = await readdir(home, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (slugifyMatterName(entry.name) !== wanted) continue;
        const candidate = path.join(home, entry.name);
        if (await isMatterRoot(candidate)) return candidate;
      }
      return null;
    },

    /** Absent is null. Unreadable is an error. A path escaping the matter is an error. */
    async readText(handle, relativePath) {
      const target = confine(handle, relativePath);
      try {
        return await readFile(target, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },

    /** One file per call. Atomic, so a reader never sees a partial write. */
    async writeText(handle, relativePath, text) {
      const target = confine(handle, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFileAtomic(target, String(text ?? ""));
    },
  });
}

// Exported for the database adapter, which must simplify names identically for
// any comparison to mean the same thing. Kept in sync with
// react-ui/src/api/v4Intake.ts v4MatterIdFromName.
export function slugifyMatterName(matterName) {
  const sanitized = String(matterName)
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 240);
  return sanitized || "matter";
}

async function isMatterRoot(candidate) {
  try {
    await stat(path.join(candidate, "matter.json"));
    return true;
  } catch {
    return false;
  }
}

function confine(handle, relativePath) {
  const root = String(handle || "");
  if (!root) throw storeError("a matter handle is required", "matter_record_store.handle_required");
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw storeError("path is outside the matter", "matter_record_store.path_invalid");
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw storeError("path is outside the matter", "matter_record_store.path_invalid");
  }
  return target;
}

function storeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
