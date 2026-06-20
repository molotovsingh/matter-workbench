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
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
]);

export function resolveStaticPath(appDir, urlPath) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }

  const reactRoot = path.resolve(appDir, "react-dist");
  const prototypeRoot = path.resolve(appDir, "prototypes");

  if (cleanPath === "/prototype/nav-shell" || cleanPath === "/prototype/nav-shell/") {
    const prototypePath = path.resolve(prototypeRoot, "nav-shell.html");
    if (!isInsideRoot(prototypeRoot, prototypePath)) return null;
    return prototypePath;
  }

  if (cleanPath === "/prototype/nav-shell-final" || cleanPath === "/prototype/nav-shell-final/") {
    const prototypePath = path.resolve(prototypeRoot, "nav-shell-final.html");
    if (!isInsideRoot(prototypeRoot, prototypePath)) return null;
    return prototypePath;
  }

  if (cleanPath === "/") {
    return path.join(reactRoot, "index.html");
  }

  if (cleanPath === "/react" || cleanPath === "/react/" || cleanPath.startsWith("/react/")) {
    const reactRelativePath = cleanPath === "/react" || cleanPath === "/react/"
      ? "index.html"
      : cleanPath.replace(/^\/react\/+/, "");
    const requestedReactPath = path.resolve(reactRoot, reactRelativePath);
    if (!isInsideRoot(reactRoot, requestedReactPath)) return null;
    return path.extname(reactRelativePath) ? requestedReactPath : path.join(reactRoot, "index.html");
  }

  return null;
}

export async function serveStatic({ appDir, request, response }) {
  const filePath = resolveStaticPath(appDir, request.url || "/");
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
      "cache-control": cacheControlForStaticPath(appDir, filePath),
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

function cacheControlForStaticPath(appDir, filePath) {
  const reactRoot = path.resolve(appDir, "react-dist");
  const relativePath = path.relative(reactRoot, filePath).replace(/\\/g, "/");
  if (relativePath.startsWith("assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}
