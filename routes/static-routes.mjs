import { readFile, stat } from "node:fs/promises";
import path from "node:path";

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

export function resolveStaticPath(appDir, urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(appDir, relativePath);
  if (!absolutePath.startsWith(appDir)) return null;
  return absolutePath;
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
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
  return true;
}
