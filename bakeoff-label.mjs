// Post-Extraction Labeling Bakeoff
// Tests which model best assigns semantic labels to legal documents
// using extracted text records (_extracted/FILE-NNNN.json), NOT raw documents.
// This matches the current /describe_sources pipeline but does not evaluate
// vision/document-native models or extraction quality.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { extractResponsesOutputText } from "./shared/responses-client.mjs";

const envPath = new URL(".env", import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document_type", "label", "summary", "parties_mentioned", "key_dates", "confidence", "reasoning"],
  properties: {
    document_type: {
      type: "string",
      enum: [
        "agreement",
        "notice",
        "correspondence",
        "financial_record",
        "legal_filing",
        "report",
        "transcript",
        "declaration",
        "receipt",
        "manifest",
        "other",
      ],
    },
    label: {
      type: "string",
      description: "2-5 hyphen-separated words. Format: {doc-noun}-{qualifier}. e.g. 'demand-notice', 'bank-statement', 'purchase-agreement'. Must start with the document's primary noun (agreement, notice, statement, report, receipt, vakalatnama, transcript, manifest, letter, email). Do NOT prefix with entity names or case names. Do NOT add suffixes like -rera or -project unless the qualifier is truly distinguishing.",
    },
    summary: {
      type: "string",
      description: "One factual sentence summarizing what this document is and its legal significance.",
    },
    parties_mentioned: {
      type: "array",
      items: { type: "string" },
      description: "Full names of people and organizations. Include both first and last names where available. Exclude generic role references like 'the plaintiff'.",
    },
    key_dates: {
      type: "array",
      items: { type: "string" },
      description: "Dates in YYYY-MM-DD format. Only include dates that are legally significant (execution, deadline, filing, incident). Exclude date ranges or vague references.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reasoning: {
      type: "string",
      description: "2-3 sentence chain-of-thought: what you see in the document, why you chose this type and label, and any ambiguity.",
    },
  },
};

const SYSTEM_PROMPT = `You are a legal document classifier for Indian legal matters. Assign a semantic label to each document.

## Label Format Rules (CRITICAL — follow exactly)
1. Format: {primary-noun}-{qualifier}, 2-5 words, kebab-case
2. Start with the document's PRIMARY NOUN: agreement, notice, statement, report, receipt, vakalatnama, transcript, manifest, letter, email-chain
3. NEVER prefix with entity names: NOT "hdfc-bank-statement", NOT "skyline-payment-receipt", NOT "rera-demand-notice"
4. NEVER add context suffixes unless truly distinguishing: NOT "purchase-agreement-rera", NOT "interview-transcript-rera"
5. If two documents share the same noun, use the qualifier to distinguish: "demand-notice" vs "response-letter", "bank-statement" vs "payment-receipt"

## Document Type Rules
- agreement: bilateral contracts, sale deeds, purchase agreements
- notice: demand notices, legal notices, show-cause notices (originates FROM a party demanding action)
- correspondence: letters, emails, replies (bilateral communication that is NOT a formal notice)
- financial_record: bank statements, ledgers, account summaries
- receipt: payment receipts, acknowledgements of payment
- legal_filing: court/tribunal filings — vakalatnama, petition, complaint, affidavit
- report: inspection reports, assessment reports, expert opinions
- transcript: interview or deposition transcripts
- declaration: sworn declarations, undertakings
- manifest: file manifests, indexes, inventories of other documents
- other: anything that doesn't fit above

## Party Extraction Rules
- Extract full names: "Shri Rajesh Kumar Mehta", "Skyline Builders & Developers Private Limited"
- Include advocates/law firms if mentioned
- Exclude generic references: "the opposite party", "the complainant"

## Examples
Input: "AGREEMENT FOR SALE OF FLAT under RERA Act 2016, between Skyline Builders and Vikram Joshi, dated 15 March 2022"
Output: {"document_type":"agreement","label":"purchase-agreement","summary":"Sale agreement for a flat under RERA between Skyline Builders and Vikram Joshi.","parties_mentioned":["Skyline Builders & Developers Private Limited","Vikram Suresh Joshi"],"key_dates":["2022-03-15"],"confidence":0.99,"reasoning":"This is a bilateral contract for property sale, so type is agreement. The primary noun is 'agreement' qualified by 'purchase' to distinguish from other agreement types."}

Input: "VAKALATNAMA before MahaRERA, authorizing Adv. Meenakshi Pillai to represent Shri R.K. Mehta"
Output: {"document_type":"legal_filing","label":"vakalatnama","summary":"Power of attorney authorizing Adv. Meenakshi Pillai to represent the complainant before MahaRERA.","parties_mentioned":["Shri Rajesh Kumar Mehta","Adv. Meenakshi Pillai","Pillai & Associates"],"key_dates":["2024-03-01"],"confidence":1,"reasoning":"A vakalatnama is a legal filing authorizing counsel. The primary noun 'vakalatnama' is already specific enough — no qualifier needed."}

Input: "Email thread between Mehta and Skyline Builders regarding possession delays, with attachments"
Output: {"document_type":"correspondence","label":"email-chain","summary":"Email correspondence between the complainant and builder regarding delayed possession.","parties_mentioned":["Rajesh Kumar Mehta","Skyline Builders & Developers Pvt Ltd"],"key_dates":[],"confidence":0.9,"reasoning":"This is bilateral communication (not a formal notice), so type is correspondence. The primary noun is 'email' qualified by 'chain' to indicate multiple messages."}`;

function buildUserMessage(fileId, originalName, category, textContent) {
  return JSON.stringify({
    file_id: fileId,
    original_name: originalName,
    current_category: category,
    document_text: textContent.slice(0, 3000),
  });
}

async function callOpenRouter(model, messages, apiKey) {
  const startMs = Date.now();
  const body = {
    model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "document_label",
        strict: true,
        schema: LABEL_SCHEMA,
      },
    },
    max_tokens: 1024,
    temperature: 0,
  };

  const resp = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://matter-workbench.opencode.ai",
      "X-Title": "Matter Workbench Label Bakeoff",
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    return { model, error: data.error?.message || resp.statusText, latencyMs };
  }

  const content = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || {};
  const parsed = safeParseJson(content);

  return {
    model,
    latencyMs,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    raw: content,
    parsed,
  };
}

async function callOpenAIResponses(model, messages, apiKey) {
  const startMs = Date.now();
  const body = {
    model,
    input: messages,
    max_output_tokens: 1024,
    text: {
      format: {
        type: "json_schema",
        name: "document_label",
        description: "Semantic label for a legal document.",
        strict: true,
        schema: LABEL_SCHEMA,
      },
    },
  };

  const resp = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    return { model, error: data.error?.message || resp.statusText, latencyMs };
  }

  const content = extractResponsesOutputText(data);
  const usage = data.usage || {};
  const parsed = safeParseJson(content);

  return {
    model,
    latencyMs,
    promptTokens: usage.input_tokens || 0,
    completionTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    raw: content,
    parsed,
  };
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function loadMatterDocs(matterRoot) {
  const results = [];
  const inboxPath = path.join(matterRoot, "00_Inbox");
  const entries = fs.readdirSync(inboxPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^Intake \d{2,}/.test(entry.name)) continue;
    const intakeDir = path.join(inboxPath, entry.name);
    const extractedDir = path.join(intakeDir, "_extracted");
    if (!fs.existsSync(extractedDir)) continue;

    const registerPath = path.join(intakeDir, "File Register.csv");
    const registerMap = {};
    if (fs.existsSync(registerPath)) {
      const lines = fs.readFileSync(registerPath, "utf8").split("\n");
      const headers = lines[0].split(",").map((h) => h.trim());
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cols = line.split(",").map((c) => c.trim());
        const row = {};
        headers.forEach((h, i) => { row[h] = cols[i] || ""; });
        if (row.file_id) registerMap[row.file_id] = row;
      }
    }

    const files = fs.readdirSync(extractedDir).filter((f) => f.endsWith(".json") && /^FILE-/.test(f));
    for (const file of files) {
      const filePath = path.join(extractedDir, file);
      const rec = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const fileId = rec.file_id || file.replace(".json", "");
      const regEntry = registerMap[fileId] || {};
      const pages = rec.pages || [];
      const blocks = pages.flatMap((p) => p.blocks || []);
      const text = blocks.map((b) => b.text || "").join("\n");

      results.push({
        fileId,
        originalName: rec.original_name || regEntry.original_name || "",
        category: regEntry.category || "Unknown",
        text,
      });
    }
  }
  return results;
}

function computeCost(result, pricing) {
  if (!pricing) return null;
  const pt = result.promptTokens || 0;
  const ct = result.completionTokens || 0;
  const promptCost = pt * (pricing.prompt || 0);
  const completionCost = ct * (pricing.completion || 0);
  return { promptCost, completionCost, totalCost: promptCost + completionCost };
}

const MODEL_CONFIGS = [
  {
    id: "gpt-5.4-mini",
    provider: "openai_responses",
    display: "openai/gpt-5.4-mini",
    pricing: { prompt: 0.00000075, completion: 0.0000045 },
  },
  {
    id: "google/gemini-2.5-flash",
    provider: "openrouter",
    display: "google/gemini-2.5-flash",
    pricing: { prompt: 0.0000003, completion: 0.0000025 },
  },
  {
    id: "google/gemini-2.0-flash-lite-001",
    provider: "openrouter",
    display: "google/gemini-2.0-flash-lite",
    pricing: { prompt: 0.000000075, completion: 0.0000003 },
  },
  {
    id: "inception/mercury-2",
    provider: "openrouter",
    display: "inception/mercury-2",
    pricing: { prompt: 0.00000025, completion: 0.00000075 },
  },
  {
    id: "qwen/qwen3-30b-a3b-instruct-2507",
    provider: "openrouter",
    display: "qwen/qwen3-30b-a3b",
    pricing: { prompt: 0.00000009, completion: 0.0000003 },
  },
];

async function runBakeoff(matterRoot) {
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const openrouterKey = process.env.OPENROUTER_API_KEY || "";

  const docs = loadMatterDocs(matterRoot);
  console.log(`\nLoaded ${docs.length} documents from ${path.basename(matterRoot)}\n`);

  const results = {};

  for (const modelConfig of MODEL_CONFIGS) {
    const { id, provider, pricing } = modelConfig;
    const needsOpenrouter = provider === "openrouter";
    const needsOpenai = provider === "openai_responses";

    if (needsOpenrouter && !openrouterKey) {
      console.log(`SKIP ${id} (no OPENROUTER_API_KEY)`);
      continue;
    }
    if (needsOpenai && !openaiKey) {
      console.log(`SKIP ${id} (no OPENAI_API_KEY)`);
      continue;
    }

    console.log(`\n=== ${id} ===`);
    results[id] = [];

    for (const doc of docs) {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(doc.fileId, doc.originalName, doc.category, doc.text) },
      ];

      let result;
      try {
        if (provider === "openrouter") {
          result = await callOpenRouter(id, messages, openrouterKey);
        } else {
          result = await callOpenAIResponses(id, messages, openaiKey);
        }
      } catch (err) {
        result = { model: id, error: err.message, latencyMs: 0 };
      }

      const cost = computeCost(result, pricing);
      result.fileId = doc.fileId;
      result.originalName = doc.originalName;
      result.cost = cost;
      results[id].push(result);

      const label = result.parsed?.label || "(error)";
      const conf = result.parsed?.confidence ?? "n/a";
      const ms = result.latencyMs;
      const costStr = cost ? `$${cost.totalCost.toFixed(6)}` : "n/a";
      const errStr = result.error ? ` ERROR: ${result.error.slice(0, 60)}` : "";
      const docLine = [
        `  ${doc.fileId}:`,
        doc.originalName.padEnd(40),
        "→",
        label.padEnd(30),
        `conf=${conf}`,
        `latency=${ms}ms`,
        `cost=${costStr}`,
        errStr,
      ].join(" ");
      console.log(docLine);
    }
  }

  return results;
}

const GROUND_TRUTH = {
  "FILE-0001": {
    document_type: "financial_record",
    label_keywords: ["bank", "statement"],
    forbidden_label_keywords: ["hdfc", "skyline", "rera"],
    required_parties: ["mehta", "hdfc"],
    key_date_substr: ["2022-03", "2023-09"],
    original_name: "bank_statement_hdfc.xlsx",
  },
  "FILE-0002": {
    document_type: "correspondence",
    label_keywords: ["response", "letter", "reply"],
    forbidden_label_keywords: ["skyline", "rera"],
    required_parties: ["skyline", "pillai"],
    key_date_substr: ["2024-03"],
    original_name: "builder_response_letter.txt",
  },
  "FILE-0003": {
    document_type: "transcript",
    label_keywords: ["interview", "transcript"],
    forbidden_label_keywords: ["rera"],
    required_parties: ["mehta", "pillai"],
    key_date_substr: ["2024-02"],
    original_name: "client_interview_transcript.txt",
  },
  "FILE-0004": {
    document_type: "correspondence",
    label_keywords: ["email", "chain"],
    forbidden_label_keywords: ["rera", "possession", "sale"],
    required_parties: ["skyline", "mehta"],
    key_date_substr: ["2022-03", "2023-04"],
    original_name: "email_chain.txt",
  },
  "FILE-0005": {
    document_type: "agreement",
    label_keywords: ["purchase", "agreement", "sale"],
    forbidden_label_keywords: ["rera", "skyline"],
    required_parties: ["skyline", "joshi", "mehta"],
    key_date_substr: ["2022-03-15", "2023-12"],
    original_name: "flat_purchase_agreement.pdf",
  },
  "FILE-0006": {
    document_type: "notice",
    label_keywords: ["demand", "notice"],
    forbidden_label_keywords: ["rera", "consumer", "skyline"],
    required_parties: ["pillai", "mehta", "skyline"],
    key_date_substr: ["2024-03-14"],
    original_name: "legal_demand_notice.pdf",
  },
  "FILE-0007": {
    document_type: ["financial_record", "receipt"],
    label_keywords: ["payment", "receipt"],
    forbidden_label_keywords: ["skyline", "rera"],
    required_parties: ["skyline", "mehta"],
    key_date_substr: ["2022-03", "2022-07"],
    original_name: "payment_receipts.xlsx",
  },
  "FILE-0008": {
    document_type: ["manifest", "other", "report"],
    label_keywords: ["manifest", "bundle", "readme"],
    forbidden_label_keywords: ["rera", "violation"],
    required_parties: ["mehta"],
    key_date_substr: ["2022-03"],
    original_name: "README_MANIFEST.txt",
  },
  "FILE-0009": {
    document_type: "report",
    label_keywords: ["inspection", "report", "site"],
    forbidden_label_keywords: ["rera", "skyline", "residency"],
    required_parties: ["deshpande", "skyline"],
    key_date_substr: ["2024-02", "2024-03"],
    original_name: "site_visit_inspection_report.docx",
  },
  "FILE-0010": {
    document_type: "legal_filing",
    label_keywords: ["vakalatnama"],
    forbidden_label_keywords: ["maharera", "consumer", "commission"],
    required_parties: ["mehta", "pillai"],
    key_date_substr: ["2024-03"],
    original_name: "vakalatnama.pdf",
  },
};

function scoreResult(parsed, groundTruth) {
  if (!parsed) return { total: 0, breakdown: { schema: 0, docType: 0, labelRelevance: 0, labelConciseness: 0, labelClean: 0, parties: 0, dates: 0 } };

  const bd = {};

  const required = ["document_type", "label", "summary", "parties_mentioned", "key_dates", "confidence", "reasoning"];
  const schemaOk = required.every((f) => parsed[f] !== undefined && parsed[f] !== "" && parsed[f] !== null);
  bd.schema = schemaOk ? 2 : 0;

  const expectedTypes = Array.isArray(groundTruth.document_type) ? groundTruth.document_type : [groundTruth.document_type];
  const predictedType = (parsed.document_type || "").toLowerCase().trim();
  bd.docType = expectedTypes.includes(predictedType) ? 3 : 0;

  const label = (parsed.label || "").toLowerCase();
  const matchedKeywords = groundTruth.label_keywords.filter((kw) => label.includes(kw));
  bd.labelRelevance = matchedKeywords.length >= 2 ? 3 : matchedKeywords.length >= 1 ? 1 : 0;

  const parts = label.split("-").filter(Boolean);
  if (parts.length >= 2 && parts.length <= 5 && label.length <= 40) {
    bd.labelConciseness = 2;
  } else if (parts.length >= 2 && parts.length <= 6 && label.length <= 55) {
    bd.labelConciseness = 1;
  } else {
    bd.labelConciseness = 0;
  }

  const forbiddenHits = (groundTruth.forbidden_label_keywords || []).filter((fk) => label.includes(fk));
  bd.labelClean = forbiddenHits.length === 0 ? 2 : forbiddenHits.length === 1 ? 1 : 0;

  const partiesLower = (parsed.parties_mentioned || [])
    .map((p) => String(p || "").toLowerCase().trim())
    .filter(Boolean);
  const partiesFound = groundTruth.required_parties.filter((rp) =>
    partiesLower.some((p) => {
      const firstToken = p.split(/\s+/)[0];
      return p.includes(rp) || (firstToken && rp.includes(firstToken));
    })
  );
  bd.parties = partiesFound.length >= groundTruth.required_parties.length * 0.5 ? 2 : partiesFound.length > 0 ? 1 : 0;

  const datesStr = (parsed.key_dates || []).join(" ").toLowerCase();
  const datesFound = groundTruth.key_date_substr.filter((ds) => datesStr.includes(ds.toLowerCase()));
  bd.dates = datesFound.length > 0 ? 1 : 0;

  const total = Object.values(bd).reduce((a, b) => a + b, 0);
  return { total, breakdown: bd, maxTotal: 15, matchedKeywords, partiesFound, datesFound, forbiddenHits };
}

function printQualityGatedReport(results) {
  const models = Object.keys(results).filter((m) => results[m].some((r) => r.parsed));
  if (!models.length) {
    console.log("\nNo models produced valid results.");
    return;
  }

  const fileIds = Object.keys(GROUND_TRUTH);

  console.log("\n\n=== QUALITY-GATED SCORECARD ===\n");
  console.log(`Scoring: schema=2, docType=3, labelRelevance=3, conciseness=2, labelClean=2, parties=2, dates=1  (max 15 per doc)\n`);

  for (const m of models) {
    const display = MODEL_CONFIGS.find((c) => c.id === m)?.display || m;
    console.log(`\n--- ${display} ---`);
    let modelTotal = 0;
    let modelMax = 0;

    for (const fid of fileIds) {
      const r = results[m]?.find((x) => x.fileId === fid);
      const gt = GROUND_TRUTH[fid];
      if (!r || !r.parsed) {
        console.log(`  ${fid}: NO RESULT`);
        modelMax += 15;
        continue;
      }
      const score = scoreResult(r.parsed, gt);
      modelTotal += score.total;
      modelMax += score.maxTotal;
      const bd = score.breakdown;
      const pass = score.total >= 12 ? "PASS" : score.total >= 9 ? "WEAK" : "FAIL";
      const cleanNote = score.forbiddenHits?.length ? ` DIRTY:${score.forbiddenHits.join(",")}` : "";
      console.log(
        `  ${fid}: ${score.total}/${score.maxTotal} [${pass}]  schema=${bd.schema} docType=${bd.docType} rel=${bd.labelRelevance} concise=${bd.labelConciseness} clean=${bd.labelClean} parties=${bd.parties} dates=${bd.dates}  label="${r.parsed.label}"${cleanNote}`,
      );
    }

    const pct = Math.round((modelTotal / modelMax) * 100);
    const passes = fileIds.filter((fid) => {
      const r = results[m]?.find((x) => x.fileId === fid);
      return r?.parsed && scoreResult(r.parsed, GROUND_TRUTH[fid]).total >= 12;
    }).length;
    console.log(`  TOTAL: ${modelTotal}/${modelMax} (${pct}%)  passes=${passes}/${fileIds.length}`);
  }

  console.log("\n\n=== COMPARATIVE RANKING ===\n");
  const ranked = models.map((m) => {
    const display = MODEL_CONFIGS.find((c) => c.id === m)?.display || m;
    let total = 0;
    let max = 0;
    let passes = 0;
    const docTypeCorrect = [];
    for (const fid of fileIds) {
      const r = results[m]?.find((x) => x.fileId === fid);
      const gt = GROUND_TRUTH[fid];
      const score = r?.parsed ? scoreResult(r.parsed, gt) : { total: 0, maxTotal: 15, breakdown: {} };
      total += score.total;
      max += score.maxTotal;
      if (score.total >= 12) passes++;
      const expectedTypes = Array.isArray(gt.document_type) ? gt.document_type : [gt.document_type];
      docTypeCorrect.push(expectedTypes.includes((r?.parsed?.document_type || "").toLowerCase().trim()) ? 1 : 0);
    }
    const runs = results[m].filter((r) => !r.error);
    const avgLat = runs.length ? Math.round(runs.reduce((a, r) => a + r.latencyMs, 0) / runs.length) : 0;
    const totalCost = runs.reduce((a, r) => a + (r.cost?.totalCost || 0), 0);
    return { display, total, max, passes, avgLat, totalCost, docTypePct: Math.round(docTypeCorrect.reduce((a, b) => a + b, 0) / docTypeCorrect.length * 100) };
  });

  ranked.sort((a, b) => b.total - a.total);

  const hdr = ["RANK", "MODEL", "SCORE", "PASS%", "DOC_TYPE%", "AVG_LAT", "COST"].map((h) => h.padEnd(14));
  console.log(hdr.join(" "));
  console.log("-".repeat(hdr.length * 15));

  ranked.forEach((r, i) => {
    const pct = Math.round((r.total / r.max) * 100);
    const passPct = Math.round((r.passes / fileIds.length) * 100);
    const row = [
      String(i + 1).padEnd(14),
      r.display.padEnd(14),
      `${pct}%`.padEnd(14),
      `${passPct}%`.padEnd(14),
      `${r.docTypePct}%`.padEnd(14),
      `${r.avgLat}ms`.padEnd(14),
      `$${r.totalCost.toFixed(4)}`.padEnd(14),
    ];
    console.log(row.join(" "));
  });

  console.log("\n\n=== DIMENSION BREAKDOWN BY MODEL ===\n");
  const dimensions = ["schema", "docType", "labelRelevance", "conciseness", "labelClean", "parties", "dates"];
  const dimMax = [2, 3, 3, 2, 2, 2, 1];
  const dimHdr = ["MODEL".padEnd(25), ...dimensions.map((d, i) => `${d}(${dimMax[i]})`.padEnd(14))];
  console.log(dimHdr.join(" "));
  console.log("-".repeat(dimHdr.join("").length));

  for (const m of models) {
    const display = MODEL_CONFIGS.find((c) => c.id === m)?.display || m;
    const dimSums = {};
    for (const d of dimensions) dimSums[d] = 0;
    for (const fid of fileIds) {
      const r = results[m]?.find((x) => x.fileId === fid);
      const gt = GROUND_TRUTH[fid];
      const score = r?.parsed ? scoreResult(r.parsed, gt) : { breakdown: {} };
      for (const d of dimensions) dimSums[d] += score.breakdown[d] || 0;
    }
    const row = [display.slice(0, 25).padEnd(25), ...dimensions.map((d) => `${dimSums[d]}/${dimMax[dimensions.indexOf(d)] * fileIds.length}`.padEnd(14))];
    console.log(row.join(" "));
  }
}

const matterRoot = process.argv[2] || "/Users/aksingh/matters-workbench-opencode-storage/mehta";
const outPath = process.argv[3] || "/tmp/bakeoff-results.json";

const results = await runBakeoff(matterRoot);
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nRaw results written to ${outPath}`);

printQualityGatedReport(results);
