import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveStaticPath } from "../routes/static-routes.mjs";

test("static route containment rejects traversal and prefix sibling paths", () => {
  const appDir = path.resolve("/tmp/matter-static-app");

  assert.equal(resolveStaticPath(appDir, "/"), path.join(appDir, "index.html"));
  assert.equal(resolveStaticPath(appDir, "/styles.css"), path.join(appDir, "styles.css"));
  assert.equal(resolveStaticPath(appDir, "/../matter-static-app-secret/secret.txt"), null);
  assert.equal(resolveStaticPath(appDir, "/../../etc/passwd"), null);
});
