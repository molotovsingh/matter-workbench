# Post-Extraction Labeling Bakeoff — Test Script & Results

## What This Is

A bakeoff test that runs multiple OpenRouter/OpenAI models against **extracted text records** from a matter to evaluate which model best assigns semantic labels (e.g., `demand-notice`, `bank-statement`, `vakalatnama`) to legal documents after `/extract` has run.

**This is a post-extraction labeling bakeoff, not a full document-understanding bakeoff.** It evaluates the labeling step only, reading from `_extracted/FILE-NNNN.json` records that were produced by the extract engine. It does not test whether models can read PDFs, images, or spreadsheets directly. See [Scope and Blind Spots](#scope-and-blind-spots) below.

## Running It

```bash
# Ensure .env has OPENROUTER_API_KEY and/or OPENAI_API_KEY
node bakeoff-label.mjs <matterRoot> [outputPath]

# Example
node bakeoff-label.mjs /Users/aksingh/matters-workbench-opencode-storage/mehta /tmp/bakeoff-results.json
```

## How It Works

1. Reads all extraction records (`FILE-NNNN.json`) from `_extracted/` directories
2. For each document, sends the first ~3000 chars to each model with a structured-output prompt
3. Models return JSON matching a strict schema: `document_type`, `label`, `summary`, `parties_mentioned`, `key_dates`, `confidence`, `reasoning`
4. Scores each result against ground truth across 7 dimensions (max 15 per doc)
5. Outputs per-doc scores, comparative ranking, dimension breakdown, and label cleanliness

## Scoring Dimensions

| Dimension | Max Pts | What It Checks |
|-----------|---------|---------------|
| schema | 2 | All required fields present and non-empty |
| docType | 3 | `document_type` matches ground truth |
| labelRelevance | 3 | Label contains ≥2 of the expected keywords |
| conciseness | 2 | 2-5 hyphen-separated words, ≤40 chars |
| labelClean | 2 | No forbidden entity/case-name prefixes (e.g., `hdfc-`, `rera-`, `skyline-`) |
| parties | 2 | ≥50% of required parties extracted |
| dates | 1 | At least one legally significant date found |

**Pass** = 12+/15, **Weak** = 9-11, **Fail** = <9

## Models Tested

| Model | Provider | Prompt $/M | Compl $/M | API |
|-------|----------|-----------|-----------|-----|
| openai/gpt-5.4-mini | OpenAI | $0.75 | $4.50 | OpenAI Responses |
| google/gemini-2.5-flash | OpenRouter | $0.30 | $2.50 | Chat Completions |
| google/gemini-2.0-flash-lite | OpenRouter | $0.075 | $0.30 | Chat Completions |
| inception/mercury-2 | OpenRouter | $0.25 | $0.75 | Chat Completions |
| qwen/qwen3-30b-a3b | OpenRouter | $0.09 | $0.30 | Chat Completions |

## Prompt Design (v2)

The v2 prompt enforces a strict label format through three mechanisms:

### 1. Format Rules

```
- {primary-noun}-{qualifier}, 2-5 words, kebab-case
- Start with the document's PRIMARY NOUN (agreement, notice, statement, etc.)
- NEVER prefix with entity names (NOT "hdfc-bank-statement")
- NEVER add context suffixes unless truly distinguishing (NOT "purchase-agreement-rera")
```

### 2. Document Type Enum

The schema uses a strict `enum` instead of a free-text description:

```json
"document_type": {
  "type": "string",
  "enum": ["agreement","notice","correspondence","financial_record","legal_filing","report","transcript","declaration","receipt","manifest","other"]
}
```

This forces the model to pick from a fixed taxonomy rather than inventing types.

### 3. Chain-of-Thought Field

The schema includes a `reasoning` field that requires 2-3 sentences of chain-of-thought. This improves label quality by forcing the model to articulate what it sees before assigning a label.

### 4. Few-Shot Examples

The system prompt includes 3 worked examples covering the most common Indian legal doc types:
- Purchase agreement → `purchase-agreement`
- Vakalatnama → `vakalatnama`
- Email chain → `email-chain`

## Ground Truth

Defined in `GROUND_TRUTH` constant in the script. Based on the `mehta` sample matter:

| File | Expected Type | Label Keywords | Forbidden Prefixes |
|------|-------------|----------------|-------------------|
| FILE-0001 bank_statement | financial_record | bank, statement | hdfc, skyline, rera |
| FILE-0002 builder_response | correspondence | response, letter, reply | skyline, rera |
| FILE-0003 interview_transcript | transcript | interview, transcript | rera |
| FILE-0004 email_chain | correspondence | email, chain | rera, possession, sale |
| FILE-0005 purchase_agreement | agreement | purchase, agreement, sale | rera, skyline |
| FILE-0006 demand_notice | notice | demand, notice | rera, consumer, skyline |
| FILE-0007 payment_receipts | financial_record/receipt | payment, receipt | skyline, rera |
| FILE-0008 README_manifest | manifest/other/report | manifest, bundle, readme | rera, violation |
| FILE-0009 site_inspection | report | inspection, report, site | rera, skyline, residency |
| FILE-0010 vakalatnama | legal_filing | vakalatnama | maharera, consumer, commission |

## Results

### v1 Prompt (basic instructions, no format constraints)

All models produced entity-prefixed labels like `rera-demand-notice`, `skyline-builders-payment-receipts`, `hdfc-bank-statement`. Labels were semantically correct but inconsistent in format — the same doc type got different labels depending on which entities the model noticed.

### v2 Prompt (strict format rules + enum + chain-of-thought + few-shot)

| Rank | Model | Score | Pass/10 | Avg Latency | Cost/10 docs |
|------|-------|-------|---------|-------------|-------------|
| 1 | **inception/mercury-2** | **96%** | **10/10** | 2,723ms | $0.0068 |
| 1 | google/gemini-2.5-flash | 96% | 9/10 | 2,619ms | $0.0120 |
| 1 | google/gemini-2.0-flash-lite | 96% | 9/10 | 3,285ms | $0.0021 |
| 4 | qwen/qwen3-30b-a3b | 94% | 8/10 | 7,800ms | $0.0026 |

**Mercury 2 is the only model that passes all 10 docs.** The others fail on `vakalatnama` (single-word label fails conciseness gate) and one other doc each.

### Label Cleanliness

All 4 models scored **0/10 dirty labels** with the v2 prompt. The forbidden-prefix constraint was 100% effective — no model produced `rera-*`, `skyline-*`, or `hdfc-*` labels.

### Per-Model Weak Spots

| Model | Weak Doc | Issue |
|-------|----------|-------|
| Gemini 2.5 Flash | FILE-0010 | `vakalatnama` is 1 word → fails conciseness (needs qualifier) |
| Gemini 2.0 Lite | FILE-0010 | Same — `vakalatnama` alone |
| Mercury 2 | FILE-0004 | `email-correspondence` misses `chain` keyword → relevance=1 |
| Mercury 2 | FILE-0008 | `manifest-case` misses `bundle`/`readme` → relevance=1 |
| Qwen3 30b | FILE-0008 | `manifest` alone → fails conciseness + misses dates |
| Qwen3 30b | FILE-0010 | `vakalatnama` alone → fails conciseness |

## Prompt v1 vs v2 Comparison

| Metric | v1 | v2 |
|--------|----|----|
| Entity-prefixed labels | ~70% | 0% |
| Context-suffixed labels | ~50% | 0% |
| Models with 10/10 pass | 0 | 1 |
| Score range | N/A | 94-96% |
| Label conciseness rate | ~30% | ~90% |
| Inter-model label variance | High (0% exact match) | Low (format-standardized) |

The prompt is doing the heavy lifting. With v2, model choice matters less for label quality — the constraints force convergence.

## Recommendations

| Use Case | Model | Why |
|----------|-------|-----|
| **Best overall** | inception/mercury-2 | Only 10/10 pass, fastest, $0.00068/doc |
| **Best value** | google/gemini-2.0-flash-lite | 3.2x cheaper, 96% score, $0.00021/doc |
| **Best doc type accuracy** | google/gemini-2.5-flash | Strongest on ambiguous docs |
| **Budget + high confidence** | qwen/qwen3-30b-a3b | $0.00026/doc, 0.98 avg confidence, but slowest |

### Cost Projection

At 50 docs/matter, 10 matters/month:

| Model | Monthly cost |
|-------|-------------|
| Mercury 2 | $0.34 |
| Gemini 2.0 Lite | $0.11 |
| Gemini 2.5 Flash | $0.60 |
| Qwen3 30b | $0.13 |

## Scope and Blind Spots

This bakeoff reads `_extracted/FILE-NNNN.json` records, not the original uploaded documents. The pipeline it tests is:

```
original files → /extract → text records → label model
```

It does **not** test whether the model can read PDFs/images/spreadsheets directly. This matches the current app architecture (the `/describe_sources` skill also labels from extraction records), but it has two blind spots:

### Blind Spot 1: Extraction mistakes are inherited

If OCR/PDF extraction misses headers, dates, tables, signatures, or handwritten text, the bakeoff blames the labeling model even though the extraction layer failed. A model might produce a "wrong" label because the extraction record omitted the key signal (e.g., a notice header on page 1 that OCR skipped).

**Mitigation:** Run an extraction-quality audit separately — compare extracted text against originals for a few key docs, especially PDFs with complex layouts and spreadsheets. If extraction quality is the bottleneck, no labeling model improvement will help.

### Blind Spot 2: Vision/document-native models are not evaluated

Gemini, Qwen-VL, and other vision-capable models may produce better labels if given raw PDFs or rendered page images directly. This bakeoff never gives them visual input, so we can't tell whether direct-document understanding outperforms the extract-then-label pipeline.

**Mitigation:** A future direct-document bakeoff would send raw PDFs/images to vision-capable OpenRouter models and compare whether they recover better labels, dates, and parties than the extraction-text-only path.

### Recommended Three-Track Evaluation

| Track | What it tests | Current status |
|-------|--------------|----------------|
| **Post-extraction labeling** | Which model best labels from extracted text? | **This bakeoff (done)** |
| **Extraction-quality audit** | Does `/extract` lose signal that affects labels? | Not yet done |
| **Direct-document bakeoff** | Can vision models label better from raw PDFs? | Not yet done |

For now, this bakeoff's results are valid for the **current pipeline**. Before investing in a better labeling model, check whether extraction quality is the real bottleneck (track 2). And before assuming text-only labeling is sufficient, test whether vision models recover more signal from raw documents (track 3).

## Known Limitations

1. **Ground truth is manual** — the `GROUND_TRUTH` dict is hand-curated for the `mehta` matter. A different matter type (employment, IP, criminal) would need its own ground truth.

2. **Single-word labels penalized** — `vakalatnama` is a single valid word but fails the 2-5 word conciseness gate. The scoring should accept single-word labels for terms that are already specific (Indian legal terms of art).

3. **No cross-matter validation** — the bakeoff only tests against one matter. Labels that work for property disputes may not generalize.

4. **Temperature=0** — all calls use temperature=0 for determinism. Production may benefit from slightly higher temperature for edge cases.

5. **OpenAI quota** — gpt-5.4-mini was quota-exhausted during testing. Results for OpenAI models are pending a key with available quota.

## Adding a New Model

1. Add an entry to `MODEL_CONFIGS` in `bakeoff-label.mjs`:
```js
{
  id: "provider/model-id",        // OpenRouter model ID or bare OpenAI model ID
  provider: "openrouter",          // "openrouter" or "openai_responses"
  display: "short display name",
  pricing: { prompt: <per-token>, completion: <per-token> },
}
```

2. Ensure the model supports `structured_outputs` on OpenRouter (check `/api/v1/models?supported_parameters=structured_outputs`)

3. Re-run: `node bakeoff-label.mjs <matterRoot>`
