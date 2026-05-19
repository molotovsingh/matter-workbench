import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { isInsideRoot } from "../shared/safe-paths.mjs";

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

export function resolveStaticPath(appDir, urlPath, options = {}) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }

  const uiShell = options.uiShell === "legacy" ? "legacy" : "react";
  const reactRoot = path.resolve(appDir, "react-dist");

  if (uiShell === "react" && cleanPath === "/") {
    return path.join(reactRoot, "index.html");
  }

  if (cleanPath === "/react" || cleanPath === "/react/" || cleanPath.startsWith("/react/")) {
    const reactRelativePath = cleanPath === "/react" || cleanPath === "/react/"
      ? "index.html"
      : cleanPath.replace(/^\/react\/+/, "");
    const reactPath = path.resolve(reactRoot, reactRelativePath);
    if (!isInsideRoot(reactRoot, reactPath)) return null;
    return reactPath;
  }

  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(appDir, relativePath);
  if (!isInsideRoot(appDir, absolutePath)) return null;
  return absolutePath;
}

export async function serveStatic({ appDir, request, response, uiShell = "react" }) {
  const filePath = resolveStaticPath(appDir, request.url || "/", { uiShell });
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return true;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": contentTypes.get(extension) || "application/octet-stream",
      "content-length": fileStat.size,
      "cache-control": "no-store",
    });
    await pipeline(createReadStream(filePath), response);
  } catch {
    if (response.headersSent) {
      response.destroy?.();
    } else {
      response.writeHead(404);
      response.end("Not found");
    }
  }
  return true;
}
