#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createAiProviderService } from "../services/ai-provider-service.mjs";
import { buildPostureDiagnosisPrompts, critiqueSchema } from "../services/procedural-posture-diagnosis-service.mjs";
import { diagnosisSchema, finalDiagnosisSchema, renderProceduralPostureDiagnosisMarkdown } from "../services/procedural-posture-diagnosis-contract.mjs";
import { loadLocalEnv } from "../shared/local-env.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";

const DEFAULT_PROPOSER_MODEL = "gpt-5.5";
const DEFAULT_CRITIC_MODEL = "o3";
const DEFAULT_FINALIZER_MODEL = "gpt-5.5";
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DEFAULT_TIMEOUT_MS = 180_000;

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: "",
    outDir: "",
    provider: "",
    proposerModel: DEFAULT_PROPOSER_MODEL,
    criticModel: DEFAULT_CRITIC_MODEL,
    finalizerModel: DEFAULT_FINALIZER_MODEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--out-dir") {
      args.outDir = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--provider") {
      args.provider = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--proposer-model") {
      args.proposerModel = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--critic-model") {
      args.criticModel = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--finalizer-model") {
      args.finalizerModel = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--max-output-tokens") {
      args.maxOutputTokens = parsePositiveInteger(requiredValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = parsePositiveInteger(requiredValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return `Prototype posture-diagnosis proposer → critique → finalizer loop.

Usage:
  node prototypes/posture-diagnosis-loop.mjs [options]

Options:
  --input <path>              JSON or text packet. If omitted, uses a small built-in sample.
  --out-dir <path>            Output directory. Default: .local/posture-diagnosis-loop/<timestamp>
  --provider <provider>       openai-direct or openrouter. Defaults to SOURCE_BACKED_ANALYSIS policy/env.
  --proposer-model <model>    Default: ${DEFAULT_PROPOSER_MODEL}
  --critic-model <model>      Default: ${DEFAULT_CRITIC_MODEL}
  --finalizer-model <model>   Default: ${DEFAULT_FINALIZER_MODEL}
  --max-output-tokens <n>     Default: ${DEFAULT_MAX_OUTPUT_TOKENS}
  --timeout-ms <n>            Default: ${DEFAULT_TIMEOUT_MS}
  --dry-run                   Write prompts/payloads only; do not call providers.

Examples:
  node prototypes/posture-diagnosis-loop.mjs --dry-run
  node prototypes/posture-diagnosis-loop.mjs --input .local/my-matter-packet.json --provider openai-direct
  node prototypes/posture-diagnosis-loop.mjs --provider openrouter --proposer-model openai/gpt-5.5 --critic-model openai/o3
`;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(usage());
    return;
  }

  const appDir = process.cwd();
  const loaded = await loadLocalEnv({ appDir, override: true });
  const env = { ...process.env, ...(loaded.env || {}) };
  if (args.provider) env.SOURCE_BACKED_ANALYSIS_PROVIDER = normalizeProvider(args.provider);

  normalizeDefaultModelNamesForProvider(args, env.SOURCE_BACKED_ANALYSIS_PROVIDER || "");

  const packet = args.input ? await readInputPacket(args.input) : sampleMatterPacket();
  const outDir = path.resolve(args.outDir || path.join(".local", "posture-diagnosis-loop", timestampSlug(new Date())));
  await mkdir(outDir, { recursive: true });

  const prompts = buildPostureDiagnosisPrompts();
  await writeJson(path.join(outDir, "input-packet.json"), packet);
  await writeFile(path.join(outDir, "proposer-system.md"), prompts.proposerSystem, "utf8");
  await writeFile(path.join(outDir, "critic-system.md"), prompts.criticSystem, "utf8");
  await writeFile(path.join(outDir, "finalizer-system.md"), prompts.finalizerSystem, "utf8");

  const config = {
    schema_version: "posture-diagnosis-loop-prototype/v1",
    dryRun: args.dryRun,
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    provider: env.SOURCE_BACKED_ANALYSIS_PROVIDER || "policy-default",
    proposerModel: args.proposerModel,
    criticModel: args.criticModel,
    finalizerModel: args.finalizerModel,
    maxOutputTokens: args.maxOutputTokens,
    timeoutMs: args.timeoutMs,
    outDir,
  };
  await writeJson(path.join(outDir, "run-config.json"), redactConfig(config));

  if (args.dryRun) {
    await writeJson(path.join(outDir, "proposer-user-payload.json"), { matterPacket: packet });
    await writeJson(path.join(outDir, "critic-user-payload-template.json"), { matterPacket: packet, proposerDraft: "<proposer output>" });
    await writeJson(path.join(outDir, "finalizer-user-payload-template.json"), { matterPacket: packet, proposerDraft: "<proposer output>", critique: "<critique output>" });
    console.log(renderSummary({ ...config, dryRun: true }));
    return;
  }

  const aiProvider = createAiProviderService({ env });

  const proposer = await aiProvider.invoke({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    systemPrompt: prompts.proposerSystem,
    userPayload: { matterPacket: packet },
    schema: diagnosisSchema("posture_diagnosis_draft"),
    schemaName: "posture_diagnosis_draft",
    schemaDescription: "Provisional filing and procedural posture diagnosis draft.",
    responseMode: "json",
    label: "posture diagnosis proposer",
    overrides: providerOverrides(args.proposerModel, args),
  });
  await writeJson(path.join(outDir, "01-proposer-draft.json"), proposer.parsed);
  await writeJson(path.join(outDir, "01-proposer-ai-run.json"), proposer.aiRun);

  const critique = await aiProvider.invoke({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    systemPrompt: prompts.criticSystem,
    userPayload: { matterPacket: packet, proposerDraft: proposer.parsed },
    schema: critiqueSchema(),
    schemaName: "posture_diagnosis_critique",
    schemaDescription: "Critique of provisional filing and procedural posture diagnosis.",
    responseMode: "json",
    label: "posture diagnosis critique",
    overrides: providerOverrides(args.criticModel, args),
  });
  await writeJson(path.join(outDir, "02-critique.json"), critique.parsed);
  await writeJson(path.join(outDir, "02-critique-ai-run.json"), critique.aiRun);

  const finalizer = await aiProvider.invoke({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    systemPrompt: prompts.finalizerSystem,
    userPayload: { matterPacket: packet, proposerDraft: proposer.parsed, critique: critique.parsed },
    schema: finalDiagnosisSchema(),
    schemaName: "posture_diagnosis_final",
    schemaDescription: "Final provisional filing and procedural posture diagnosis after critique.",
    responseMode: "json",
    label: "posture diagnosis finalizer",
    overrides: providerOverrides(args.finalizerModel, args),
  });
  await writeJson(path.join(outDir, "03-final-diagnosis.json"), finalizer.parsed);
  await writeJson(path.join(outDir, "03-finalizer-ai-run.json"), finalizer.aiRun);
  await writeMarkdown(path.join(outDir, "03-final-diagnosis.md"), finalizer.parsed);

  console.log(renderSummary({ ...config, dryRun: false }));
}

function normalizeDefaultModelNamesForProvider(args, provider) {
  if (provider !== AI_PROVIDERS.OPENROUTER) return;
  if (args.proposerModel === DEFAULT_PROPOSER_MODEL) args.proposerModel = `openai/${DEFAULT_PROPOSER_MODEL}`;
  if (args.criticModel === DEFAULT_CRITIC_MODEL) args.criticModel = `openai/${DEFAULT_CRITIC_MODEL}`;
  if (args.finalizerModel === DEFAULT_FINALIZER_MODEL) args.finalizerModel = `openai/${DEFAULT_FINALIZER_MODEL}`;
}

function providerOverrides(model, args) {
  return {
    model,
    maxOutputTokens: args.maxOutputTokens,
    timeoutMs: args.timeoutMs,
    omitTemperature: true,
    requireParameters: true,
    allowFallbacks: false,
  };
}

async function readInputPacket(filePath) {
  const text = await readFile(filePath, "utf8");
  if (/\.json$/i.test(filePath)) return JSON.parse(text);
  return { schema_version: "freeform-matter-packet/v1", text };
}

function sampleMatterPacket() {
  return {
    schema_version: "sample-posture-packet/v1",
    matter_metadata: {
      client_name: "Sample Client",
      matter_name: "Sample Lease Termination Dispute",
      client_role: "tenant / respondent-like posture uncertain",
      jurisdiction_hint: "Delhi",
      intake_note: "Client received a termination notice after repeated rent disputes and wants to know immediate options.",
    },
    case_timeline: [
      {
        date: "2025-11-01",
        event: "Lease agreement executed for commercial premises.",
        source: "Lease Agreement",
        source_ref: "FILE-0001 p1",
      },
      {
        date: "2026-02-15",
        event: "Landlord issued email alleging delayed rent and threatening termination.",
        source: "Landlord email",
        source_ref: "FILE-0002 p1",
      },
      {
        date: "2026-03-01",
        event: "Client replied that delay was caused by unresolved maintenance defects and requested adjustment.",
        source: "Client reply email",
        source_ref: "FILE-0003 p1",
      },
      {
        date: "2026-04-10",
        event: "Termination notice issued requiring vacation within 15 days.",
        source: "Termination notice",
        source_ref: "FILE-0004 p1",
      },
    ],
    matter_story: {
      at_a_glance: "The matter concerns a commercial lease dispute after rent-delay allegations and a termination notice.",
      procedural_posture: "No filed proceeding is visible in the supplied record. The immediate posture appears pre-filing / response-to-notice, but this requires lawyer confirmation.",
      risks: "The record may be missing payment proof, defect correspondence, and the full lease termination clause.",
    },
    source_index_summary: [
      "FILE-0001 Lease Agreement",
      "FILE-0002 Landlord email alleging delayed rent",
      "FILE-0003 Client reply alleging maintenance defects",
      "FILE-0004 Termination notice",
    ],
  };
}

async function writeMarkdown(filePath, diagnosis) {
  const markdown = renderProceduralPostureDiagnosisMarkdown(diagnosis);
  await writeFile(filePath, `${markdown}
`, "utf8");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderSummary(config) {
  return [
    "Posture diagnosis loop prototype",
    `dry_run: ${config.dryRun ? "yes" : "no"}`,
    `task: ${config.task}`,
    `provider: ${config.provider}`,
    `proposer_model: ${config.proposerModel}`,
    `critic_model: ${config.criticModel}`,
    `finalizer_model: ${config.finalizerModel}`,
    `out_dir: ${config.outDir}`,
  ].join("\n");
}

function redactConfig(config) {
  return { ...config };
}

function normalizeProvider(value) {
  const provider = String(value || "").trim();
  if (provider === AI_PROVIDERS.OPENAI_DIRECT || provider === AI_PROVIDERS.OPENROUTER) return provider;
  throw new Error(`Unsupported provider: ${value}. Use ${AI_PROVIDERS.OPENAI_DIRECT} or ${AI_PROVIDERS.OPENROUTER}.`);
}

function requiredValue(argv, index, label) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${label} requires a value`);
  return value;
}

function parsePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
