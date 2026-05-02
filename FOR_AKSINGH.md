# Matter Workbench, Explained for Aksingh

This file is the plain-English map of the project. If you come back after a week away, read this before opening random files. It explains what Matter Workbench is, how the pieces fit together, what decisions we made, what went wrong along the way, and what good engineering lessons are hiding inside the work.

## The One-Sentence Version

Matter Workbench turns a messy legal matter folder into a structured, source-backed workspace, then helps produce a lawyer-facing List of Dates where every event remains traceable to raw `FILE-NNNN pX.bY` evidence.

It is not trying to be a magical legal chatbot. It is closer to a disciplined junior chamber clerk:

- preserve the brief;
- number the documents;
- extract the record;
- label the sources;
- prepare a chronology;
- keep every claim tied back to the file.

## The Product Idea

Legal work starts with mess. Clients send PDFs, emails, receipts, photos, Word files, scans, WhatsApp exports, and occasionally a file named something like `final final use this one.pdf`. The first job is not drafting a petition. The first job is turning the mess into a record a lawyer can trust.

Matter Workbench is a local-first legal workbench for that job.

The current pipeline is:

```text
/matter-init
  -> /extract
  -> /describe_sources
  -> /create_listofdates
```

Each step leaves artifacts on disk. That is intentional. A legal workflow should not depend on memory inside a chat window. It should create files a lawyer can inspect, diff, copy, print, and challenge.

## The Current Beta State

The project is now beta-ready for supervised use.

That means:

- the core pipeline runs end to end on real local matters;
- extraction is stable on the available matters;
- Mistral OCR can be enabled for scanned PDFs;
- source descriptions can create lawyer-readable labels through OpenRouter;
- List of Dates output now includes lawyer-facing fields;
- meta files like manifests and indexes are filtered before chronology generation;
- repeated chronology rows can be clustered;
- payment discrepancies are explicitly flagged;
- raw citations like `FILE-0001 p1.b2` are preserved.

It does not mean:

- the output is court-ready without review;
- the model never misses an event;
- legal relevance can be trusted blindly;
- all clusters are perfect;
- provider calls will never fail.

The correct status is:

```text
lawyer-review-ready, not lawyer-replacement-ready
```

## How to Run It

Start the app:

```sh
npm start
```

The app runs at:

```text
http://127.0.0.1:4173/
```

The default local matters home is controlled by `services/config-service.mjs` and local `config.json`. On this machine it has been used with:

```text
/Users/aksingh/matters-matter-workbench
```

For direct CLI testing, set `MATTER_ROOT`:

```sh
MATTER_ROOT="/absolute/path/to/matter" node matter-init-engine.mjs --apply
MATTER_ROOT="/absolute/path/to/matter" node extract-engine.mjs --apply
MATTER_ROOT="/absolute/path/to/matter" node source-descriptors-engine.mjs --apply
MATTER_ROOT="/absolute/path/to/matter" node create-listofdates-engine.mjs --apply
```

Run tests:

```sh
npm test
```

## Important Local Config

Copy `.env.example` to `.env` and fill only the keys you intend to use.

For the current beta path:

```text
MISTRAL_OCR_ENABLED=1
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS=6000
```

Keep provider failures fail-closed. Do not silently fall back to a different model for lawyer-facing work until the fallback model has been tested.

## The Folder Story

A matter folder becomes structured like this:

```text
Matter Name/
  matter.json
  00_Inbox/
    Intake 01 - Initial/
      Source Files/
      Originals/
      By Type/
      File Register.csv
      Intake Log.csv
      Extraction Log.csv
      _extracted/
        FILE-0001.json
        FILE-0001.txt
  10_Library/
    Source Index.json
    List of Dates.json
    List of Dates.csv
    List of Dates.md
```

The naming is deliberately boring. In legal work, boring structure is power. The folder tree is not decoration; it is the audit trail.

## The Engines

The app is split into engines. That is one of the best decisions in the project.

### `matter-init-engine.mjs`

This is the intake clerk.

It:

- validates matter metadata;
- creates the initial matter structure;
- preserves untouched originals;
- creates working copies under `By Type`;
- hashes files with SHA-256;
- assigns stable `FILE-NNNN` ids;
- writes `File Register.csv` and `Intake Log.csv`;
- filters junk like OS metadata and Office lockfiles before registration.

Good lesson: never let AI touch the intake ledger. Intake is deterministic work.

### `extract-engine.mjs`

This is the record extractor.

It reads `File Register.csv`, opens supported working-copy files, and writes `extraction-record/v1` JSON plus a text companion.

Supported routes include:

- PDFs through `pdfjs-dist`;
- DOCX through `mammoth`;
- RTF;
- text and Markdown;
- spreadsheets through `xlsx`;
- EML email through `mailparser`.

For scanned PDFs, extraction can use Mistral OCR, but only when explicitly enabled:

```text
MISTRAL_OCR_ENABLED=1
```

The extraction log now records OCR observability:

- whether OCR was applied;
- provider/model;
- low-confidence page count;
- needs-review page count;
- provider warning count.

Good lesson: add observability before adding fallback logic. If you cannot see what happened, you cannot safely automate the next decision.

### `source-descriptors-engine.mjs`

This is the source-labeling clerk.

It reads extraction records and writes:

```text
10_Library/Source Index.json
```

`Source Index.json` gives each file a lawyer-readable identity:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026
```

But it does not replace the raw file id. The source descriptor contract preserves:

- `file_id`;
- `sha256`;
- `source_path`;
- evidence citations;
- document type;
- document date;
- parties;
- warnings and confidence.

The engine rejects provider output that cites the wrong file, invents missing required fields, produces impossible dates, or pollutes human labels with `FILE-0001` prefixes.

Good lesson: if AI is allowed to describe a source, it must not be allowed to mutate the source identity.

### `create-listofdates-engine.mjs`

This is the chronology builder.

It reads extraction records and source labels, filters out meta/index-style blocks, sends only chronology-eligible material to the AI provider, then writes:

```text
10_Library/List of Dates.json
10_Library/List of Dates.csv
10_Library/List of Dates.md
```

The chronology is now lawyer-facing. Each event includes:

- `date_iso`;
- `event`;
- `event_type`;
- `legal_relevance`;
- `issue_tags`;
- `perspective`;
- raw `citation`;
- source label fields;
- cluster metadata.

The Markdown is intentionally review-friendly:

```text
Date | Event | Legal Relevance | Source
```

The important rule:

```text
Readable label first, raw citation preserved.
```

Example:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026 (FILE-0001 p1.b2)
```

That is the balance we wanted. The lawyer can read the source name. The audit trail still points to the exact extracted block.

## Clustering: Why It Exists

Legal chronologies often contain repeats:

- bank statement records payment;
- receipt acknowledges the same payment;
- email discusses the same payment;
- agreement schedule names the installment.

If every supporting source becomes a separate row, the List of Dates becomes noisy. If we blindly dedupe, we lose useful corroboration. So the app now classifies clusters.

Cluster types include:

- `single_event`;
- `corroborated_event`;
- `payment_discrepancy`;
- `source_repeat`;
- `true_duplicate`.

For corroborated events, Markdown shows one lead row and lists supporting sources in the Source cell.

For payment discrepancies, the row stays explicit:

```text
Payment discrepancy: same-date sources record inconsistent amounts (Rs.12,25,000 vs Rs.15,70,000)
```

Good lesson: dedupe is often the wrong word in legal work. The real task is classification. Some repeats are noise. Some repeats are corroboration. Some repeats are contradictions.

## The Server

`server.mjs` is the local Node server.

It:

- loads `.env`;
- creates services;
- serves the frontend;
- dispatches API routes;
- tracks active matter state.

Important route file:

```text
routes/api-routes.mjs
```

Key endpoints include:

- `POST /api/matter-init`;
- `POST /api/extract`;
- `POST /api/create-listofdates`;
- `GET/POST /api/ai-settings`;
- `GET /api/skills`;
- `POST /api/skills/check-intent`;
- `GET /api/config`;
- `GET /api/matters`;
- `POST /api/switch-matter`;
- `POST /api/matters/new`;
- `POST /api/matters/add-files`;
- `POST /api/doctor/scan`;
- `POST /api/doctor/fix`;
- `POST /api/matters/check-overlap`;
- `GET /api/workspace`;
- `GET /api/file`;
- `GET /api/file-raw`.

The server is intentionally local-first. This is a confidentiality-friendly architecture: matters live on disk, not in a cloud database.

## The Frontend

The frontend is plain browser JavaScript, not React.

Important files:

- `index.html` - app shell;
- `styles.css` - layout and visual system;
- `frontend/event-wiring.js` - user actions and skill dispatch;
- `frontend/matter-screens.js` - settings and matter screens;
- `frontend/workspace-view.js` - explorer and preview rendering;
- `frontend/api-client.js` - API helper;
- `frontend/state.js` - shared state;
- `frontend/status.js` - status output.

The frontend should stay quiet and utilitarian. This is not a marketing site. It is an operational tool for repeated legal review.

## Shared Contracts

The `shared/` folder is where many important boundaries live.

Key files:

- `shared/matter-contract.mjs` - folder names, headers, file classification, metadata normalization;
- `shared/model-policy.mjs` - AI task policy;
- `shared/ai-provider-policy.mjs` - request-ready provider config;
- `shared/responses-client.mjs` - OpenAI Responses API helper;
- `shared/local-env.mjs` - local `.env` loader;
- `shared/csv.mjs` - CSV parse/write helpers;
- `shared/safe-paths.mjs` - path safety helpers.

Good lesson: centralize contracts before the codebase grows around duplicated assumptions. Headers, folder names, model policy, and provider behavior should not be scattered across UI, routes, and engines.

## AI Provider Shape

The project now treats AI as task-specific policy, not random model calls.

Current AI tasks include:

- `skill_router`;
- `source_description`;
- `source_backed_analysis`.

OpenAI direct remains the default for some paths. OpenRouter is explicit where configured. For legal chronology work, provider behavior should remain visible and fail-closed.

Important rule:

```text
No silent fallback for lawyer-facing artifacts.
```

If a provider fails, the system should say so. It should not quietly swap in another model and write an artifact that looks authoritative.

## Testing Philosophy

The test suite is Node's built-in test runner:

```sh
npm test
```

The tests are not just ceremonial. They lock down the legal workflow rules:

- file intake does not register junk files;
- overlap checks read all intake registers;
- JSON request bodies cannot buffer without size limits;
- OCR provider paths can be tested without live network calls;
- source descriptors reject bad citations and bad labels;
- model policy preserves provider behavior;
- List of Dates preserves raw citations;
- lawyer-facing fields are required;
- unsupported proof language is softened;
- meta sources are filtered before AI;
- clustering avoids false payment discrepancies.

Good lesson: tests should protect the professional contract, not only the code mechanics.

## Bugs We Hit and What They Taught

### Reading Only the First Intake

Overlap checks originally looked only at:

```text
00_Inbox/Intake 01 - Initial/File Register.csv
```

That meant matters with multiple intakes could under-report overlaps.

Fix: union hashes across all intake folders.

Lesson: when a product supports multiple batches, every downstream scan must respect the batch model.

### JSON Body Size

`readRequestJson` could buffer arbitrary request bodies.

Fix: add a 1 MB default limit and return HTTP 413 for oversized JSON bodies.

Lesson: local-first does not mean ignore basic server hygiene.

### Sidebar and Preview Scrolling

Some panels expanded instead of scrolling, which made settings and previews hard to use.

Fix: constrain the shell to the viewport, make the sidebar/editor regions own their scrolling, and add `min-height: 0` where nested flex/grid overflow needs it.

Lesson: layout bugs are often missing containment, not missing JavaScript.

### OpenRouter Provider Routing

Provider order and price/latency sorting can conflict. If you pin a provider and also ask OpenRouter to sort by price, the request is ambiguous.

Fix: reject mixed provider pin plus sort/max-price settings.

Lesson: configuration should fail early when it expresses two different strategies.

### Source Labels with `FILE-0001` Prefixes

The AI sometimes put file ids into human labels.

Fix: prompt and validator reject `FILE-NNNN` inside `display_label` and `short_label`.

Lesson: human labels and audit ids are both valuable, but they must stay separate.

### Malformed or Bad Provider Output

OpenRouter can return malformed JSON or semantically bad JSON.

Fix: validate locally and fail closed. The Mehta smoke even hit a `sha256` mismatch once; retry succeeded, and the failed attempt did not write a bad source index.

Lesson: the model is not the contract. The validator is the contract.

### Lawyer-Facing Language Overreach

The AI can drift into proof language like "proves breach."

Fix: add lawyer-facing fields, guardrails, and sanitizers. Keep raw citations out of the Event column. Soften unsupported proof/breach language.

Lesson: "make it more lawyerly" needs structure. Without guardrails, style improvements become legal-risk regressions.

### Payment Clustering False Positives

Same-day payments can be separate legitimate payments. A loose similarity rule could turn them into a fake discrepancy.

Fix: same-day payments only cluster on stronger signals: matching amounts, matching installment/ordinal, or explicit discrepancy language.

Lesson: in legal tools, false contradictions are dangerous. A useful discrepancy row must be reviewable and defensible.

## How Good Engineers Should Think About This Project

The best engineering choices here came from treating the legal workflow as a chain of custody.

Ask these questions before changing behavior:

1. Does this preserve the original file?
2. Does this preserve the raw citation?
3. Does this create a durable artifact?
4. Can a lawyer inspect what happened?
5. Can a test prove the contract?
6. If an AI provider misbehaves, do we fail closed?
7. Is this deterministic work being incorrectly handed to AI?
8. Is this AI work being validated before persistence?

If the answer is fuzzy, slow down.

## What to Watch During Beta

Reviewers should inspect:

- missing legally important events;
- overstated legal relevance;
- duplicate rows that should have clustered;
- clusters that merged unrelated events;
- missing supporting sources inside a cluster;
- broken raw citations;
- weak source labels;
- OCR text quality;
- provider failures that should fail closed.

For payment matters, cluster completeness is especially important. Check whether the discrepancy row includes all relevant supporting sources: bank statement, receipt, email, agreement schedule, and legal notice if they all discuss the same payment issue.

## What Not to Do Next

Do not immediately add automatic fallback. The pipeline is just reaching lawyer-review usefulness. More routing cleverness can wait.

Avoid these moves unless there is a clear PR-sized reason:

- silent model fallback;
- UI toggles for every provider knob;
- broad prompt rewrites without eval evidence;
- changing raw citation format;
- merging source labels into canonical ids;
- moving files or renaming artifact contracts casually.

The next strong work is likely operational:

- run more real matters;
- collect reviewer notes;
- identify repeated quality failures;
- turn those into narrow tests or docs;
- only then tune the algorithm or prompt.

## The Mental Model

Think of Matter Workbench as a table in chambers.

On the left: the messy brief.

In the middle: the clerk's registers, extracted pages, source labels, and chronology.

On the right: the lawyer's judgment.

The software's job is not to jump straight to the right side. Its job is to make the middle reliable enough that the lawyer can move faster without losing the thread back to the original file.

That is why the repeated phrase in this project matters:

```text
raw FILE-NNNN pX.bY citations remain canonical
```

Everything else is help. The citation is the anchor.
