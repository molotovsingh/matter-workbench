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
const V4_DEPLOY_DOCS = [
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
    const isV4 = V4_ROOTS.some((prefix) => relativePath.startsWith(prefix))
      || relativePath.startsWith("scripts/v4-db-");
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
  // The integration point must stay singular as well as gated: a second,
  // ungated import would load V4 in deployments that exclude its source.
  const serverSource = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  const mountSpecifier = "./services/document-intake-extraction/integration/app-mount.mjs";
  assert.equal(serverSource.split(mountSpecifier).length - 1, 1, "server.mjs must contain exactly one V4 mount import site");
  const gateWindow = serverSource.slice(Math.max(0, serverSource.indexOf(mountSpecifier) - 400), serverSource.indexOf(mountSpecifier));
  assert.match(gateWindow, /MWB_V4_INTAKE === "1"/, "the V4 mount import must sit inside the MWB_V4_INTAKE gate");
});

// The mount's refusal to build without the flag is behavior, not source
// shape — assert the behavior so refactors cannot quietly weaken it.
test("V4-ISO-001 the app mount refuses to build unless the intake flag is set", async () => {
  const { createV4IntakeMount } = await import("../services/document-intake-extraction/integration/app-mount.mjs");
  assert.equal(await createV4IntakeMount({ env: {} }), null);
  assert.equal(await createV4IntakeMount({ env: { MWB_V4_INTAKE: "0", MWB_V4_DB_URL: "postgres://unused" } }), null);
});

// V4-DEPLOY-001
// V4 used to be withheld from the beta VM entirely, so isolation had two
// independent guarantees: the code was not on the box, and the flag kept it
// unmounted. Shipping V4 to the in-house beta gives up the first and keeps the
// second. That is a deliberate downgrade, so this gate now asserts what is
// actually true rather than being deleted: executables ship, internal docs do
// not, and V4-ISO-001 carries the isolation claim alone.
test("V4-DEPLOY-001 ships V4 executables to the beta VM and keeps V4 internal docs off it", async () => {
  const deploySource = await readFile(path.join(ROOT, "scripts/private-vm-rsync-deploy.mjs"), "utf8");
  for (const root of V4_ROOTS) {
    assert.doesNotMatch(deploySource, new RegExp(`^[ \\t]*["']${escapeRegex(root)}["'],?$`, "m"), `${root} must ship so MWB_V4_INTAKE=1 can mount it`);
  }
  for (const doc of V4_DEPLOY_DOCS) {
    assert.match(deploySource, new RegExp(`^[ \\t]*["']${escapeRegex(doc)}["'],?$`, "m"), `${doc} must stay an rsync exclusion`);
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
