import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCreateListOfDates } from "../../create-listofdates-engine.mjs";
import { loadLocalEnv } from "../../shared/local-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

if (process.env.RUN_OPENROUTER_LISTOFDATES_SMOKE !== "1") {
  console.log("[openrouter-listofdates-smoke] skipped; set RUN_OPENROUTER_LISTOFDATES_SMOKE=1 to run the live chronology call");
  process.exit(0);
}

await loadLocalEnv({ appDir: REPO_ROOT, override: false });

const matterRoot = process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : "";
if (!matterRoot) throw new Error("MATTER_ROOT is required for the OpenRouter list-of-dates smoke");
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required for the OpenRouter list-of-dates smoke");
if (!process.env.OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL) {
  throw new Error("OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL is required for the OpenRouter list-of-dates smoke");
}

const records = await readExtractionRecords(matterRoot);
if (!records.some((record) => record.engine === "mistral-ocr-latest")) {
  throw new Error("Smoke matter must include at least one mistral-ocr-latest extraction record");
}

const result = await runCreateListOfDates({
  matterRoot,
  dryRun: false,
  env: {
    ...process.env,
    SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
  },
});

if (result.aiRun.provider !== "openrouter") throw new Error(`Expected OpenRouter provider, got ${result.aiRun.provider}`);
if (!result.entries.length) throw new Error("OpenRouter list-of-dates smoke produced no chronology entries");
if (!result.entries.every((entry) => /^FILE-\d{4,} p\d+\.b\d+$/.test(entry.citation))) {
  throw new Error("OpenRouter list-of-dates smoke produced an invalid raw citation");
}

console.log(`[openrouter-listofdates-smoke] ok entries=${result.entries.length} model=${result.aiRun.model} returnedModel=${result.aiRun.returnedModel || ""}`);

async function readExtractionRecords(matterRoot) {
  const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  const intakes = Array.isArray(matterJson.intakes) ? matterJson.intakes : [];
  const records = [];
  for (const intake of intakes) {
    const extractedDir = path.join(matterRoot, intake.intake_dir, "_extracted");
    let entries = [];
    try {
      entries = await readdir(extractedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((item) => item.isFile() && /^FILE-\d+\.json$/.test(item.name))) {
      records.push(JSON.parse(await readFile(path.join(extractedDir, entry.name), "utf8")));
    }
  }
  return records;
}
