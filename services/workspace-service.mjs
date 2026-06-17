import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { INITIAL_INTAKE_DIR_NAME } from "../shared/matter-contract.mjs";
import { assertInsideRoot, makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import {
  WORKSPACE_PREVIEW_LIMITS,
  classifyWorkspacePreview,
  getWorkspaceRawContentType,
  getWorkspaceTextPreviewLimit,
  isWorkspaceTextPreviewExtension,
} from "../shared/workspace-preview-policy.mjs";
import { isBlockedWorkspacePath } from "./workspace-path-policy.mjs";

const maxTreeDepth = 6;
const maxChildrenPerDirectory = 160;
const {
  maxRawBytes,
  maxEmailPreviewChars,
} = WORKSPACE_PREVIEW_LIMITS;

const hiddenMatterEntries = new Set([
  ".git",
  ".playwright-cli",
  "phase1_legal_workbench",
]);

let mailparserModule = null;

async function loadMailparser() {
  if (!mailparserModule) {
    mailparserModule = await import("mailparser");
  }
  return mailparserModule;
}

export function createWorkspaceService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  function resolveMatterPath(relativePath = "", root = matterStore.ensureMatterRoot()) {
    const resolved = path.resolve(root, relativePath || ".");
    const safePath = assertInsideRoot(root, resolved, "Requested path is outside the matter root");
    const matterRelative = toPosix(path.relative(root, safePath));
    if (isBlockedWorkspacePath(matterRelative)) {
      throw makeHttpError("Requested path is hidden from workspace preview", 403, "workspace.path_hidden");
    }
    return safePath;
  }

  function toMatterRelative(filePath, root = matterStore.ensureMatterRoot()) {
    return toPosix(path.relative(root, filePath));
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

  async function scanMatterTree(directoryPath, depth = 0, scanContext = {}) {
    const matterRoot = scanContext.matterRoot || directoryPath;
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
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
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = toMatterRelative(absolutePath, matterRoot);

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
        const preview = classifyWorkspacePreview({ relativePath, sizeBytes: fileStat.size });
        children.push({
          name: entry.name,
          kind: "file",
          path: relativePath,
          size: fileStat.size,
          previewable: preview.previewable,
          previewKind: preview.previewKind,
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

  async function readWorkspace(root = matterStore.ensureMatterRoot()) {
    const metadata = await matterStore.readMatterMetadata(root);
    const intake = await matterStore.readPrimaryIntake(root);
    const stagedSourceFileNames = intake ? await readStagedSourceFileNames(root, intake) : new Set();
    const treeScan = await scanMatterTree(root, 0, {
      matterRoot: root,
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

  async function readFilePreview(relativePath, root = matterStore.ensureMatterRoot()) {
    const filePath = resolveMatterPath(relativePath, root);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw makeHttpError("Requested path is not a file", 400, "workspace.preview.not_file");

    const extension = path.extname(filePath).toLowerCase();
    if (!isWorkspaceTextPreviewExtension(filePath)) throw makeHttpError("File type is not previewable as text", 415, "workspace.preview.unsupported_type");
    if (extension === ".eml") return readEmailPreview(filePath, root, fileStat.size);
    if (fileStat.size > getWorkspaceTextPreviewLimit(filePath)) throw makeHttpError("File is too large to preview", 413, "workspace.preview.file_too_large");

    return {
      path: toMatterRelative(filePath, root),
      name: path.basename(filePath),
      ext: extension.replace(/^\./, ""),
      content: await readFile(filePath, "utf8"),
    };
  }

  async function readEmailPreview(filePath, root, fileSize) {
    if (fileSize > maxRawBytes) throw makeHttpError("Email file is too large to preview", 413, "workspace.preview.email_too_large");
    const { simpleParser } = await loadMailparser();
    let mail;
    try {
      mail = await simpleParser(createReadStream(filePath), { skipImageLinks: true, skipHtmlToText: false });
    } catch (err) {
      throw makeHttpError(`Email file could not be parsed for preview: ${err.message}`, 415, "workspace.preview.email_parse_failed");
    }

    const sections = [];
    const subject = (mail.subject || "").trim();
    if (subject) sections.push(`Subject: ${subject}`);

    const headerLines = [];
    if (mail.from?.text) headerLines.push(`From: ${mail.from.text}`);
    if (mail.to?.text) headerLines.push(`To: ${mail.to.text}`);
    if (mail.cc?.text) headerLines.push(`Cc: ${mail.cc.text}`);
    if (mail.date) headerLines.push(`Date: ${mail.date.toISOString()}`);
    if (headerLines.length) sections.push(headerLines.join("\n"));

    const bodyText = String(mail.text || "").replace(/\r\n/g, "\n").trim();
    if (bodyText) sections.push(bodyText);

    const attachments = Array.isArray(mail.attachments) ? mail.attachments : [];
    if (attachments.length) {
      const lines = attachments.map((attachment) => {
        const name = attachment.filename || attachment.cid || "(unnamed attachment)";
        const size = typeof attachment.size === "number" ? ` (${attachment.size} bytes)` : "";
        const contentType = attachment.contentType ? ` [${attachment.contentType}]` : "";
        return `- ${name}${size}${contentType}`;
      });
      sections.push(`Attachments:\n${lines.join("\n")}`);
    }

    const content = truncatePreview(sections.filter(Boolean).join("\n\n"));
    return {
      path: toMatterRelative(filePath, root),
      name: path.basename(filePath),
      ext: "eml",
      content: content || "(No email text found.)",
    };
  }

  function truncatePreview(content) {
    const normalized = String(content || "").trim();
    if (normalized.length <= maxEmailPreviewChars) return normalized;
    return `${normalized.slice(0, maxEmailPreviewChars).trimEnd()}\n\n[Preview truncated. Download the original email to inspect the full message and attachments.]`;
  }

  async function getRawFile(relativePath, root = matterStore.ensureMatterRoot()) {
    const filePath = resolveMatterPath(relativePath, root);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw makeHttpError("Requested path is not a file", 400, "workspace.raw.not_file");
    if (fileStat.size > maxRawBytes) throw makeHttpError("File is too large to display inline", 413, "workspace.raw.file_too_large");

    return {
      contentType: getWorkspaceRawContentType(filePath),
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
