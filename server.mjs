import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMatterInit } from "./matter-init-engine.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const matterRoot = process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null;
const port = Number(process.env.PORT || 4173);
const maxTreeDepth = 6;
const maxChildrenPerDirectory = 160;
const maxPreviewBytes = 512 * 1024;
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

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function ensureMatterRoot() {
  if (!matterRoot) {
    const error = new Error("MATTER_ROOT is not configured");
    error.statusCode = 409;
    throw error;
  }
  return matterRoot;
}

function isInsideMatterRoot(filePath) {
  const root = ensureMatterRoot();
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function resolveMatterPath(relativePath = "") {
  const root = ensureMatterRoot();
  const resolved = path.resolve(root, relativePath);
  if (!isInsideMatterRoot(resolved)) {
    const error = new Error("Requested path is outside the matter root");
    error.statusCode = 403;
    throw error;
  }
  return resolved;
}

function toMatterRelative(filePath) {
  return toPosix(path.relative(ensureMatterRoot(), filePath));
}

function isVisibleMatterEntry(name, depth) {
  if (name.startsWith(".")) return false;
  if (depth === 0 && hiddenMatterEntries.has(name)) return false;
  return true;
}

function normalizeMatterMetadata(rawMatter) {
  return {
    clientName: rawMatter.client_name || "",
    matterName: rawMatter.matter_name || "",
    oppositeParty: rawMatter.opposite_party || "",
    matterType: rawMatter.matter_type || "",
    jurisdiction: rawMatter.jurisdiction || "",
    briefDescription: rawMatter.brief_description || "",
  };
}

async function readMatterMetadata() {
  const root = ensureMatterRoot();
  try {
    const rawMatter = JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
    return normalizeMatterMetadata(rawMatter);
  } catch {
    return {
      clientName: "",
      matterName: path.basename(root),
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
      briefDescription: "",
    };
  }
}

async function scanMatterTree(root, depth = 0) {
  const directoryEntries = await readdir(root, { withFileTypes: true });
  const visibleEntries = directoryEntries
    .filter((entry) => isVisibleMatterEntry(entry.name, depth))
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
        const childScan = await scanMatterTree(absolutePath, depth + 1);
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
      children.push({
        name: entry.name,
        kind: "file",
        path: relativePath,
        size: fileStat.size,
        previewable: previewExtensions.has(path.extname(entry.name).toLowerCase())
          && fileStat.size <= maxPreviewBytes,
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
  const root = ensureMatterRoot();
  const metadata = await readMatterMetadata();
  const treeScan = await scanMatterTree(root);

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

async function serveWorkspace(response) {
  sendJson(response, 200, await readWorkspace());
}

async function serveFilePreview(url, response) {
  const relativePath = url.searchParams.get("path") || "";
  const filePath = resolveMatterPath(relativePath);
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    sendJson(response, 400, { error: "Requested path is not a file" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!previewExtensions.has(extension)) {
    sendJson(response, 415, { error: "File type is not previewable as text" });
    return;
  }

  if (fileStat.size > maxPreviewBytes) {
    sendJson(response, 413, { error: "File is too large to preview" });
    return;
  }

  sendJson(response, 200, {
    path: toMatterRelative(filePath),
    name: path.basename(filePath),
    content: await readFile(filePath, "utf8"),
  });
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function resolveStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(__dirname, relativePath);
  if (!absolutePath.startsWith(__dirname)) return null;
  return absolutePath;
}

async function serveStatic(request, response) {
  const filePath = resolveStaticPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": contentTypes.get(extension) || "application/octet-stream",
      "content-length": fileStat.size,
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "POST" && request.url === "/api/matter-init") {
      const root = ensureMatterRoot();
      const body = await readRequestJson(request);
      const result = await runMatterInit({
        matterRoot: root,
        metadata: body.metadata || {},
        dryRun: Boolean(body.dryRun),
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/workspace") {
      await serveWorkspace(response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/file") {
      await serveFilePreview(requestUrl, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

server.listen(port, () => {
  console.log(`Legal Workbench running at http://127.0.0.1:${port}/`);
  console.log(matterRoot
    ? `Matter root: ${matterRoot}`
    : "Matter root: not configured. Start with MATTER_ROOT=/absolute/path/to/matter npm start");
});
