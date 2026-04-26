import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { INITIAL_INTAKE_DIR_NAME } from "../shared/matter-contract.mjs";
import { assertInsideRoot, makeHttpError, toPosix } from "../shared/safe-paths.mjs";

const maxTreeDepth = 6;
const maxChildrenPerDirectory = 160;
const maxPreviewBytes = 512 * 1024;
const maxRawBytes = 50 * 1024 * 1024;

const hiddenMatterEntries = new Set([
  ".git",
  ".playwright-cli",
  "phase1_legal_workbench",
]);

const previewExtensions = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".txt",
]);

const embeddableExtensions = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
]);

const rawContentTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".csv", "text/csv; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
]);

export function createWorkspaceService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  function resolveMatterPath(relativePath = "") {
    const root = matterStore.ensureMatterRoot();
    const resolved = path.resolve(root, relativePath || ".");
    return assertInsideRoot(root, resolved, "Requested path is outside the matter root");
  }

  function toMatterRelative(filePath) {
    return toPosix(path.relative(matterStore.ensureMatterRoot(), filePath));
  }

  function isVisibleMatterEntry(entry, depth, scanContext = {}) {
    const name = entry.name;
    if (name.startsWith(".")) return false;
    if (depth === 0 && hiddenMatterEntries.has(name)) return false;
    if (
      depth === 0
      && entry.isFile()
      && name !== "matter.json"
      && scanContext.hideStagedRootSourceFiles
      && scanContext.stagedSourceFileNames.has(name)
    ) {
      return false;
    }
    return true;
  }

  async function readStagedSourceFileNames(root, intake) {
    const sourceDir = path.join(root, "00_Inbox", intake?.intake_dir ? path.basename(intake.intake_dir) : INITIAL_INTAKE_DIR_NAME, "Source Files");
    const names = new Set(
      (intake?.loose_root_source_files || [])
        .map((file) => path.basename(file.source_path || ""))
        .filter(Boolean),
    );

    try {
      const entries = await readdir(sourceDir, { withFileTypes: true });
      entries
        .filter((entry) => entry.isFile())
        .forEach((entry) => names.add(entry.name));
    } catch {
      // Missing source dir is fine before intake exists.
    }
    return names;
  }

  async function scanMatterTree(root, depth = 0, scanContext = {}) {
    const directoryEntries = await readdir(root, { withFileTypes: true });
    const visibleEntries = directoryEntries
      .filter((entry) => isVisibleMatterEntry(entry, depth, scanContext))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const children = [];
    let fileCount = 0;
    let directoryCount = 0;

    for (const entry of visibleEntries.slice(0, maxChildrenPerDirectory)) {
      const absolutePath = path.join(root, entry.name);
      const relativePath = toMatterRelative(absolutePath);

      if (entry.isDirectory()) {
        directoryCount += 1;
        const childNode = {
          name: entry.name,
          kind: "directory",
          path: relativePath,
          children: [],
        };
        if (depth < maxTreeDepth) {
          const childScan = await scanMatterTree(absolutePath, depth + 1, scanContext);
          childNode.children = childScan.children;
          fileCount += childScan.fileCount;
          directoryCount += childScan.directoryCount;
          if (childScan.truncated) childNode.truncated = true;
        }
        children.push(childNode);
        continue;
      }

      if (entry.isFile()) {
        fileCount += 1;
        const fileStat = await stat(absolutePath);
        const ext = path.extname(entry.name).toLowerCase();
        const isText = previewExtensions.has(ext) && fileStat.size <= maxPreviewBytes;
        const isEmbeddable = embeddableExtensions.has(ext) && fileStat.size <= maxRawBytes;
        children.push({
          name: entry.name,
          kind: "file",
          path: relativePath,
          size: fileStat.size,
          previewable: isText || isEmbeddable,
          previewKind: isText ? "text" : isEmbeddable ? (ext === ".pdf" ? "pdf" : "image") : null,
        });
      }
    }

    return {
      children,
      fileCount,
      directoryCount,
      truncated: visibleEntries.length > maxChildrenPerDirectory,
    };
  }

  async function readWorkspace() {
    const root = matterStore.ensureMatterRoot();
    const metadata = await matterStore.readMatterMetadata(root);
    const intake = await matterStore.readPrimaryIntake(root);
    const stagedSourceFileNames = intake ? await readStagedSourceFileNames(root, intake) : new Set();
    const treeScan = await scanMatterTree(root, 0, {
      hideStagedRootSourceFiles: Boolean(intake),
      stagedSourceFileNames,
    });

    return {
      folderName: path.basename(root),
      inputLabel: root,
      metadata,
      fileCount: treeScan.fileCount,
      directoryCount: treeScan.directoryCount,
      tree: {
        name: path.basename(root),
        kind: "directory",
        path: "",
        children: treeScan.children,
        truncated: treeScan.truncated,
      },
    };
  }

  async function readFilePreview(relativePath) {
    const filePath = resolveMatterPath(relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw makeHttpError("Requested path is not a file", 400);

    const extension = path.extname(filePath).toLowerCase();
    if (!previewExtensions.has(extension)) throw makeHttpError("File type is not previewable as text", 415);
    if (fileStat.size > maxPreviewBytes) throw makeHttpError("File is too large to preview", 413);

    return {
      path: toMatterRelative(filePath),
      name: path.basename(filePath),
      content: await readFile(filePath, "utf8"),
    };
  }

  async function getRawFile(relativePath) {
    const filePath = resolveMatterPath(relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw makeHttpError("Requested path is not a file", 400);
    if (fileStat.size > maxRawBytes) throw makeHttpError("File is too large to display inline", 413);

    const extension = path.extname(filePath).toLowerCase();
    return {
      contentType: rawContentTypes.get(extension) || "application/octet-stream",
      filePath,
      fileSize: fileStat.size,
      safeFilename: path.basename(filePath).replace(/[\r\n"]/g, "_"),
      stream: createReadStream(filePath),
    };
  }

  return {
    getRawFile,
    readFilePreview,
    readWorkspace,
    resolveMatterPath,
  };
}
