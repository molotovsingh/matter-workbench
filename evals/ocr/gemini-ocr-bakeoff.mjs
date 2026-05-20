import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createGeminiOcrProvider, DEFAULT_GEMINI_OCR_MODEL } from "../../extract-utils/gemini-ocr-provider.mjs";
import { createMistralOcrProvider, MISTRAL_OCR_MODEL } from "../../extract-utils/mistral-ocr-provider.mjs";
import { markdownToBlocks } from "../../extract-utils/ocr-normalize.mjs";
import { parseCsv } from "../../shared/csv.mjs";
import { loadLocalEnv } from "../../shared/local-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MATTERS_HOME = path.join(os.homedir(), "matters-matter-workbench");
const DEFAULT_GEMINI_OCR_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const options = parseArgs(process.argv.slice(2));

if (!options.run && process.env.RUN_GEMINI_OCR_BAKEOFF !== "1") {
  console.log("[gemini-ocr-bakeoff] skipped; pass --run or set RUN_GEMINI_OCR_BAKEOFF=1 to run live OCR calls");
  process.exit(0);
}

await loadLocalEnv({ appDir: REPO_ROOT, override: false });

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!geminiApiKey) {
  throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini OCR bakeoff. Add it to repo-root .env; do not paste it in chat.");
}

const pdfs = await resolvePdfInputs(options);
if (!pdfs.length) {
  throw new Error("No PDF inputs found. Use --pdf PATH, --matter-root PATH, or --matter NAME.");
}

const limitedPdfs = options.limit ? pdfs.slice(0, options.limit) : pdfs;
const models = resolveModels(options);
const includeMistral = options.includeMistral || process.env.MISTRAL_OCR_ENABLED === "1";
const runDir = await createRunDir(options.outDir);
const rows = [];

console.log(`[gemini-ocr-bakeoff] writing ${runDir}`);
console.log(`[gemini-ocr-bakeoff] pdfs=${limitedPdfs.length} geminiModels=${models.length} includeMistral=${includeMistral}`);

for (const pdf of limitedPdfs) {
  for (const model of models) {
    const label = `gemini:${model}`;
    const row = await runProvider({
      label,
      pdf,
      outDir: runDir,
      providerFactory: () => createGeminiOcrProvider({ model, apiKey: geminiApiKey }),
    });
    rows.push(row);
    console.log(formatConsoleRow(row));
  }

  if (includeMistral) {
    if (!process.env.MISTRAL_API_KEY) {
      const row = failedRow({
        label: `mistral:${MISTRAL_OCR_MODEL}`,
        pdf,
        error: "MISTRAL_API_KEY missing; skipped current Mistral comparison",
      });
      rows.push(row);
      console.log(formatConsoleRow(row));
      continue;
    }
    const row = await runProvider({
      label: `mistral:${process.env.MISTRAL_OCR_MODEL || MISTRAL_OCR_MODEL}`,
      pdf,
      outDir: runDir,
      providerFactory: () => createMistralOcrProvider(),
    });
    rows.push(row);
    console.log(formatConsoleRow(row));
  }
}

await writeFile(path.join(runDir, "summary.json"), `${JSON.stringify({
  created_at: new Date().toISOString(),
  run_dir: runDir,
  matter: options.matter || null,
  matter_root: options.matterRoot || null,
  models,
  include_mistral: includeMistral,
  rows,
}, null, 2)}\n`);
await writeFile(path.join(runDir, "summary.md"), renderSummaryMarkdown(rows, { models, includeMistral }));

console.log(`[gemini-ocr-bakeoff] done summary=${path.join(runDir, "summary.md")}`);

async function runProvider({ label, pdf, outDir, providerFactory }) {
  const started = performance.now();
  try {
    const provider = providerFactory();
    const result = await provider({ pdfPath: pdf.path, pageCount: undefined });
    const elapsedMs = Math.round(performance.now() - started);
    const metrics = summarizeProviderResult(result);
    const artifactBase = safeFilename(`${pdf.inputId || pdf.fileId || path.basename(pdf.path, ".pdf")}__${label}`);
    const jsonPath = path.join(outDir, `${artifactBase}.json`);
    const mdPath = path.join(outDir, `${artifactBase}.md`);
    await writeFile(jsonPath, `${JSON.stringify({ pdf, label, elapsed_ms: elapsedMs, result, metrics }, null, 2)}\n`);
    await writeFile(mdPath, renderPreviewMarkdown({ pdf, label, elapsedMs, result, metrics }));
    return {
      status: "ok",
      label,
      pdf_path: pdf.relativePath || pdf.path,
      file_id: pdf.fileId || null,
      elapsed_ms: elapsedMs,
      ...metrics,
      json: path.relative(REPO_ROOT, jsonPath),
      preview: path.relative(REPO_ROOT, mdPath),
    };
  } catch (err) {
    return failedRow({
      label,
      pdf,
      elapsedMs: Math.round(performance.now() - started),
      error: err?.message || String(err),
    });
  }
}

function failedRow({ label, pdf, elapsedMs = 0, error }) {
  return {
    status: "failed",
    label,
    pdf_path: pdf.relativePath || pdf.path,
    file_id: pdf.fileId || null,
    elapsed_ms: elapsedMs,
    pages: 0,
    chars: 0,
    blocks: 0,
    warnings: 0,
    date_hits: 0,
    amount_hits: 0,
    average_confidence: null,
    error: String(error || "unknown error").slice(0, 800),
  };
}

function summarizeProviderResult(result) {
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  const markdownByPage = pages.map((page) => String(page.markdown || page.text || ""));
  const text = markdownByPage.join("\n\n");
  const blocks = markdownByPage.reduce((sum, markdown, index) => sum + markdownToBlocks(markdown, index + 1).length, 0);
  const warnings = pages.reduce((sum, page) => sum + (Array.isArray(page.warnings) ? page.warnings.length : 0), 0);
  const confidences = pages.map((page) => Number(page.confidence)).filter(Number.isFinite);
  return {
    engine: result?.engine || "",
    pages: pages.length,
    chars: text.length,
    blocks,
    warnings,
    date_hits: countMatches(text, /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/g),
    amount_hits: countMatches(text, /\b(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d+)?\b/gi),
    average_confidence: confidences.length ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100 : null,
  };
}

function renderPreviewMarkdown({ pdf, label, elapsedMs, result, metrics }) {
  const sections = [
    `# OCR Bakeoff Preview`,
    "",
    `- Provider: ${label}`,
    `- File: ${pdf.relativePath || pdf.path}`,
    pdf.fileId ? `- File ID: ${pdf.fileId}` : null,
    `- Elapsed: ${elapsedMs}ms`,
    `- Metrics: ${metrics.pages} pages, ${metrics.chars} chars, ${metrics.blocks} blocks, ${metrics.warnings} warnings, ${metrics.date_hits} date hits, ${metrics.amount_hits} amount hits`,
    "",
  ].filter(Boolean);

  for (const page of result.pages || []) {
    sections.push(`## Page ${page.page}`);
    if (Array.isArray(page.warnings) && page.warnings.length) {
      sections.push(`Warnings: ${page.warnings.join("; ")}`);
    }
    sections.push(String(page.markdown || "").trim() || "_No text returned._");
    sections.push("");
  }
  return `${sections.join("\n")}\n`;
}

function renderSummaryMarkdown(rows, { models, includeMistral }) {
  const lines = [
    "# Gemini OCR Bakeoff",
    "",
    `Created: ${new Date().toISOString()}`,
    `Gemini models: ${models.join(", ")}`,
    `Mistral comparison: ${includeMistral ? "included" : "not included"}`,
    "",
    "| Status | Provider | File | ms | Pages | Chars | Blocks | Warnings | Dates | Amounts | Confidence | Notes |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const row of rows) {
    lines.push([
      row.status,
      row.label,
      row.file_id || row.pdf_path,
      row.elapsed_ms,
      row.pages,
      row.chars,
      row.blocks,
      row.warnings,
      row.date_hits,
      row.amount_hits,
      row.average_confidence ?? "",
      row.status === "ok" ? `[preview](${row.preview})` : escapeMarkdown(row.error || ""),
    ].map((cell) => String(cell).replace(/\|/g, "\\|")).join("|").replace(/^/, "|").replace(/$/, "|"));
  }
  lines.push("");
  lines.push("This eval writes only under `evals/ocr/runs/`; it does not change matter artifacts or production extraction.");
  return `${lines.join("\n")}\n`;
}

async function resolvePdfInputs(opts) {
  const explicit = [];
  for (const pdfPath of opts.pdfs) {
    const resolved = path.resolve(pdfPath);
    const relativePath = path.relative(REPO_ROOT, resolved);
    explicit.push({
      path: resolved,
      relativePath,
      inputId: safeFilename(`${path.basename(resolved, ".pdf")}__${relativePath}`),
    });
  }
  if (explicit.length) return explicit;

  const matterRoot = opts.matterRoot
    ? path.resolve(opts.matterRoot)
    : opts.matter
      ? await findMatterRoot(opts.matter)
      : null;
  if (!matterRoot) return [];

  const registerIndex = await readFileRegisterIndex(matterRoot);
  const scanRoot = path.join(matterRoot, "00_Inbox");
  const pdfPaths = await findPdfs(scanRoot);
  const inputs = pdfPaths.map((pdfPath) => {
    const relativePath = path.relative(matterRoot, pdfPath);
    const registerRow = registerIndex.byRelativePath.get(normalizePath(relativePath))
      || registerIndex.byBasename.get(path.basename(pdfPath));
    return {
      path: pdfPath,
      relativePath,
      fileId: registerRow?.file_id || null,
      originalName: registerRow?.original_name || registerRow?.originalName || null,
      inputId: safeFilename(`${registerRow?.file_id || path.basename(pdfPath, ".pdf")}__${relativePath}`),
    };
  });
  if (!opts.fileIds.length) return inputs;

  const wanted = new Set(opts.fileIds.map((fileId) => String(fileId).trim().toUpperCase()));
  return inputs.filter((input) => wanted.has(String(input.fileId || "").toUpperCase()));
}

async function findMatterRoot(matterName) {
  const homes = [...new Set([
    process.env.MATTERS_HOME,
    DEFAULT_MATTERS_HOME,
  ].filter(Boolean).map((value) => path.resolve(String(value).replace(/^~(?=$|\/|\\)/, os.homedir()))))];

  for (const home of homes) {
    let entries = [];
    try {
      entries = await readdir(home, { withFileTypes: true });
    } catch {
      continue;
    }
    const exact = entries.find((entry) => entry.isDirectory() && entry.name === matterName);
    if (exact) return path.join(home, exact.name);
    const normalized = normalizeMatterName(matterName);
    const fuzzy = entries.find((entry) => entry.isDirectory() && normalizeMatterName(entry.name) === normalized);
    if (fuzzy) return path.join(home, fuzzy.name);
  }
  throw new Error(`Matter not found: ${matterName}`);
}

async function findPdfs(root) {
  const found = [];
  async function visit(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        found.push(entryPath);
      }
    }
  }
  await visit(root);
  return found.sort((a, b) => a.localeCompare(b));
}

async function readFileRegisterIndex(matterRoot) {
  const byRelativePath = new Map();
  const byBasename = new Map();
  for (const registerPath of await findFileRegisters(path.join(matterRoot, "00_Inbox"))) {
    const registerDir = path.dirname(registerPath);
    let rows = [];
    try {
      rows = parseCsv(await readFile(registerPath, "utf8"));
    } catch {
      continue;
    }
    for (const row of rows) {
      const candidates = [
        row.source_path,
        row.stored_path,
        row.path,
        row.normalized_path,
        row.relative_path,
      ].filter(Boolean);
      for (const candidate of candidates) {
        byRelativePath.set(normalizePath(candidate), row);
        byRelativePath.set(normalizePath(path.relative(matterRoot, path.resolve(registerDir, candidate))), row);
      }
      for (const candidate of [...candidates, row.file_id, row.original_name].filter(Boolean)) {
        byBasename.set(path.basename(candidate), row);
      }
    }
  }
  return { byRelativePath, byBasename };
}

async function findFileRegisters(root) {
  const found = [];
  async function visit(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name === "File Register.csv") {
        found.push(entryPath);
      }
    }
  }
  await visit(root);
  return found;
}

async function createRunDir(rawOutDir) {
  const parent = path.resolve(rawOutDir || path.join(REPO_ROOT, "evals", "ocr", "runs"));
  await mkdir(parent, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dir = path.join(parent, `${stamp}-gemini-ocr-bakeoff`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function resolveModels(opts) {
  const raw = opts.models || process.env.GEMINI_OCR_MODELS || DEFAULT_GEMINI_OCR_CANDIDATES.join(",");
  const models = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return models.length ? [...new Set(models)] : [DEFAULT_GEMINI_OCR_MODEL];
}

function parseArgs(argv) {
  const opts = {
    pdfs: [],
    matter: "",
    matterRoot: "",
    models: "",
    limit: 0,
    fileIds: [],
    outDir: "",
    run: false,
    includeMistral: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") opts.run = true;
    else if (arg === "--include-mistral") opts.includeMistral = true;
    else if (arg === "--pdf") opts.pdfs.push(requireValue(argv, ++i, arg));
    else if (arg === "--matter") opts.matter = requireValue(argv, ++i, arg);
    else if (arg === "--matter-root") opts.matterRoot = requireValue(argv, ++i, arg);
    else if (arg === "--models") opts.models = requireValue(argv, ++i, arg);
    else if (arg === "--limit") opts.limit = parsePositiveInteger(requireValue(argv, ++i, arg));
    else if (arg === "--file-id") opts.fileIds.push(requireValue(argv, ++i, arg));
    else if (arg === "--out-dir") opts.outDir = requireValue(argv, ++i, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printHelpAndExit() {
  console.log(`Usage:
  node evals/ocr/gemini-ocr-bakeoff.mjs --run --matter "Matter Name" --limit 3 --include-mistral
  node evals/ocr/gemini-ocr-bakeoff.mjs --run --matter "Matter Name" --file-id FILE-0003
  node evals/ocr/gemini-ocr-bakeoff.mjs --run --pdf /path/to/file.pdf --models gemini-3.5-flash,gemini-2.5-pro

Environment:
  GEMINI_API_KEY or GOOGLE_API_KEY is required.
  GEMINI_OCR_MODELS overrides the default Gemini model list.
  GEMINI_OCR_THINKING_LEVEL can be MINIMAL, LOW, MEDIUM, or HIGH.

Outputs:
  evals/ocr/runs/<timestamp>-gemini-ocr-bakeoff/
`);
  process.exit(0);
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeFilename(value) {
  return String(value || "ocr")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180) || "ocr";
}

function normalizeMatterName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function countMatches(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function escapeMarkdown(text) {
  return String(text || "").replace(/\n+/g, " ").slice(0, 300);
}

function formatConsoleRow(row) {
  if (row.status === "ok") {
    return `[${row.status}] ${row.label} ${row.file_id || row.pdf_path} pages=${row.pages} chars=${row.chars} warnings=${row.warnings} ms=${row.elapsed_ms}`;
  }
  return `[${row.status}] ${row.label} ${row.file_id || row.pdf_path}: ${row.error}`;
}
