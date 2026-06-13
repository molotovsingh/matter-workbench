import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const matterDetailsPath = new URL("../react-ui/src/lib/matterDetails.ts", import.meta.url);

test("matter detail labels are lawyer-facing rather than schema-facing", async () => {
  const { formatMissingMatterDetails } = await importMatterDetails();

  assert.equal(
    formatMissingMatterDetails(["matterType", "jurisdiction", "clientName"]),
    "Matter type, Jurisdiction, Client",
  );
  assert.equal(formatMissingMatterDetails(["unknown_custom_field"]), "Unknown custom field");
});

async function importMatterDetails() {
  const source = await readFile(matterDetailsPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-react-matter-details-"));
  const modulePath = path.join(dir, "matterDetails.mjs");
  await writeFile(modulePath, compiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
