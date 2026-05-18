import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const reactSourceRoot = new URL("../react-ui/src/", import.meta.url);

test("React source does not suppress hook dependency checks", async () => {
  const files = await listReactSourceFiles(reactSourceRoot);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /eslint-disable-next-line react-hooks\/exhaustive-deps/,
      `${path.relative(fileURLToPath(new URL("..", reactSourceRoot)), fileURLToPath(file))} should use explicit dependencies or refs`,
    );
  }
});

async function listReactSourceFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) {
      files.push(...await listReactSourceFiles(child));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}
