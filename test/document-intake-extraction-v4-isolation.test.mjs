import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V4_ROOTS = [
  "packages/extraction-contracts/",
  "services/document-intake-extraction/",
  "workers/document-processing/",
];
const V4_DEPLOY_ARTIFACTS = [
  ...V4_ROOTS,
  "docs/architecture/document-intake-extraction-v4*",
  "docs/acceptance/document-intake-extraction-v4*",
  "docs/operations/document-intake-extraction-v4*",
];
const SOURCE_EXTENSION = /\.(?:mjs|js|cjs|ts|tsx)$/;
const IMPORT_SPECIFIER = /(?:import\s+(?:[^"']*?\s+from\s+)?|export\s+[^"']*?\s+from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;

// V4-ISO-001
test("V4-ISO-001 keeps production callers and legacy dependencies outside the isolated V4 boundary", async () => {
  const files = await sourceFiles(ROOT);
  const productionViolations = [];
  const v4Violations = [];
  for (const absolutePath of files) {
    const relativePath = path.relative(ROOT, absolutePath).replaceAll(path.sep, "/");
    const source = await readFile(absolutePath, "utf8");
    const imports = Array.from(source.matchAll(IMPORT_SPECIFIER), (match) => match[1]);
    const isV4 = V4_ROOTS.some((prefix) => relativePath.startsWith(prefix));
    const isEvidence = relativePath.startsWith("test/")
      || relativePath.startsWith("docs/")
      || relativePath.startsWith("integration-test/document-intake-extraction-v4")
      || relativePath === "Alignment Interview.md";
    if (!isV4 && !isEvidence) {
      for (const specifier of imports) {
        // The single sanctioned integration point: server.mjs may import the
        // flag-gated app mount (dynamically, behind MWB_V4_INTAKE=1) — the
        // deliberate "integrated but disabled" milestone. Everything else in
        // production stays outside the V4 boundary.
        if (relativePath === "server.mjs" && specifier === "./services/document-intake-extraction/integration/app-mount.mjs") continue;
        if (specifier.includes("extraction-contracts") || specifier.includes("document-intake-extraction") || specifier.includes("document-processing")) {
          productionViolations.push(`${relativePath} -> ${specifier}`);
        }
      }
    }
    if (isV4) {
      for (const specifier of imports) {
        if (/(?:^|\/)(?:extract-engine\.mjs|extract-utils|routes|react-ui|server\.mjs)(?:$|\/)/.test(specifier)
          || /runtime-db-(?:processing|extract|upload)/.test(specifier)) {
          v4Violations.push(`${relativePath} -> ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(productionViolations, [], `production must not import V4:\n${productionViolations.join("\n")}`);
  assert.deepEqual(v4Violations, [], `V4 must not import legacy runtime internals:\n${v4Violations.join("\n")}`);

  // The sanctioned integration point must stay flag-gated: the app entry may
  // only load the mount dynamically when MWB_V4_INTAKE=1, and the mount
  // itself must refuse to build without the flag.
  const serverSource = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  assert.match(serverSource, /env\.MWB_V4_INTAKE === "1"\s*\?\s*await\s*\(await import\("\.\/services\/document-intake-extraction\/integration\/app-mount\.mjs"\)\)/, "server.mjs must import the V4 mount dynamically behind MWB_V4_INTAKE=1");
  const mountSource = await readFile(path.join(ROOT, "services/document-intake-extraction/integration/app-mount.mjs"), "utf8");
  assert.match(mountSource, /if \(String\(env\[V4_INTAKE_FLAG\] \|\| ""\) !== "1"\) return null;/, "the app mount must return null unless the flag is set");
});

// V4-DEPLOY-001
test("V4-DEPLOY-001 excludes every V4 executable directory from private beta deployment", async () => {
  const deploySource = await readFile(path.join(ROOT, "scripts/private-vm-rsync-deploy.mjs"), "utf8");
  for (const artifact of V4_DEPLOY_ARTIFACTS) {
    assert.match(deploySource, new RegExp(`^[ \\t]*["']${escapeRegex(artifact)}["'],?$`, "m"), `${artifact} must be an rsync exclusion`);
  }
});

async function sourceFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", "react-dist", ".local"].includes(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) output.push(absolutePath);
    }
  }
  await visit(root);
  return output;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
