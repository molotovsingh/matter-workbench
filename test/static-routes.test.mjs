import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { resolveStaticPath, serveStatic } from "../routes/static-routes.mjs";

test("static route containment rejects traversal and prefix sibling paths", () => {
  const appDir = path.resolve("/tmp/matter-static-app");

  assert.equal(resolveStaticPath(appDir, "/"), path.join(appDir, "index.html"));
  assert.equal(resolveStaticPath(appDir, "/styles.css"), path.join(appDir, "styles.css"));
  assert.equal(resolveStaticPath(appDir, "/react"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(resolveStaticPath(appDir, "/react/"), path.join(appDir, "react-dist", "index.html"));
  assert.equal(
    resolveStaticPath(appDir, "/react/assets/index.js"),
    path.join(appDir, "react-dist", "assets", "index.js"),
  );
  assert.equal(resolveStaticPath(appDir, "/../matter-static-app-secret/secret.txt"), null);
  assert.equal(resolveStaticPath(appDir, "/../../etc/passwd"), null);
  assert.equal(resolveStaticPath(appDir, "/react/../../matter-static-app-secret/secret.txt"), null);
  assert.equal(resolveStaticPath(appDir, "/%E0%A4%A"), null);
});

test("static route streams file content with no-store headers", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-static-"));
  try {
    await writeFile(path.join(appDir, "index.html"), "<h1>Home</h1>");
    const response = new CaptureResponse();

    const handled = await serveStatic({
      appDir,
      request: { url: "/" },
      response,
    });

    assert.equal(handled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.bodyText(), "<h1>Home</h1>");
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
