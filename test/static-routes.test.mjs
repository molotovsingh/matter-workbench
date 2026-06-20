import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { resolveStaticPath, serveStatic } from "../routes/static-routes.mjs";

test("static route containment rejects traversal and prefix sibling paths", () => {
  const appDir = path.resolve("/tmp/matter-static-app");

  assert.equal(resolveStaticPath(appDir, "/"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(resolveStaticPath(appDir, "/react"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(resolveStaticPath(appDir, "/react/"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(
    resolveStaticPath(appDir, "/react/assets/index.js"),
    path.join(appDir, "react-dist", "assets", "index.js"),
  );
  assert.equal(resolveStaticPath(appDir, "/react/matters/demo"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(resolveStaticPath(appDir, "/prototype/nav-shell"), path.join(appDir, "prototypes", "nav-shell.html"));
  assert.equal(resolveStaticPath(appDir, "/prototype/nav-shell/"), path.join(appDir, "prototypes", "nav-shell.html"));
  assert.equal(resolveStaticPath(appDir, "/prototype/nav-shell/../../secret"), null);
  assert.equal(resolveStaticPath(appDir, "/index.html"), null);
  assert.equal(resolveStaticPath(appDir, "/app.js"), null);
  assert.equal(resolveStaticPath(appDir, "/styles.css"), null);
  assert.equal(resolveStaticPath(appDir, "/config.json"), null);
  assert.equal(resolveStaticPath(appDir, "/../matter-static-app-secret/secret.txt"), null);
  assert.equal(resolveStaticPath(appDir, "/../../etc/passwd"), null);
  assert.equal(resolveStaticPath(appDir, "/react/../../matter-static-app-secret/secret.txt"), null);
  assert.equal(resolveStaticPath(appDir, "/%E0%A4%A"), null);
});

test("static route ignores legacy shell opt-in and serves React at root", () => {
  const appDir = path.resolve("/tmp/matter-static-app");

  assert.equal(resolveStaticPath(appDir, "/"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(
    resolveStaticPath(appDir, "/", { uiShell: "legacy" }),
    path.join(appDir, "react-dist", "index.html"),
  );
  assert.equal(
    resolveStaticPath(appDir, "/react/assets/index.js", { uiShell: "react" }),
    path.join(appDir, "react-dist", "assets", "index.js"),
  );
  assert.equal(resolveStaticPath(appDir, "/styles.css", { uiShell: "react" }), null);
});

test("static route streams React shell with no-cache headers", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-static-"));
  try {
    await mkdir(path.join(appDir, "react-dist"), { recursive: true });
    await writeFile(path.join(appDir, "react-dist", "index.html"), "<h1>React</h1>");
    const response = new CaptureResponse();

    const handled = await serveStatic({
      appDir,
      request: { url: "/" },
      response,
      uiShell: "legacy",
    });

    assert.equal(handled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-cache");
    assert.equal(response.bodyText(), "<h1>React</h1>");
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test("static route streams React hashed assets with immutable cache and modern content types", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-static-"));
  try {
    await mkdir(path.join(appDir, "react-dist", "assets"), { recursive: true });
    await writeFile(path.join(appDir, "react-dist", "assets", "font.woff2"), "font");
    const response = new CaptureResponse();

    const handled = await serveStatic({
      appDir,
      request: { url: "/react/assets/font.woff2" },
      response,
    });

    assert.equal(handled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "font/woff2");
    assert.equal(response.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(response.bodyText(), "font");
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test("static route streams React shell by default", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-static-"));
  try {
    await writeFile(path.join(appDir, "index.html"), "<h1>Legacy</h1>");
    await mkdir(path.join(appDir, "react-dist"), { recursive: true });
    await writeFile(path.join(appDir, "react-dist", "index.html"), "<h1>React</h1>");
    const response = new CaptureResponse();

    const handled = await serveStatic({
      appDir,
      request: { url: "/" },
      response,
    });

    assert.equal(handled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-cache");
    assert.equal(response.bodyText(), "<h1>React</h1>");
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

class CaptureResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 0;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  bodyText() {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}
