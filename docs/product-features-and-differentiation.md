# Matter Workbench: Product Features and Differentiation

Matter Workbench is a local legal-matter workbench for turning a messy folder of case papers into a structured, source-backed, lawyer-review-ready workspace.

It is not a general chatbot. It is not an unsupervised drafting robot. It is a workflow system for organizing matter documents, extracting readable records, labeling sources, creating a List of Dates, searching prepared context, and supervising reusable legal skills with review gates.

The central product idea is simple:

```text
legal matter folder -> structured source record -> lawyer-review-ready outputs
```

The product helps a lawyer answer the first hard questions in any matter:

- What papers do we have?
- Which files are duplicates, bad copies, or unsupported?
- What does each document actually contain?
- What should each source be called in lawyer language?
- What happened, when, and where is each event supported?
- Is the current chronology still reliable after new documents were added?
- What needs lawyer or developer attention before downstream use?

## What The Product Does

### 1. Creates a matter workspace from client files

A lawyer starts with a matter folder or creates a new matter in the app. Matter Workbench records matter metadata such as:

- client name;
- matter name;
- opposite party;
- matter type;
- jurisdiction;
- brief description.

In ordinary local mode it creates a stable matter structure on disk:

```text
00_Inbox/      original intake batches and working copies
10_Library/    source-backed matter knowledge and generated review outputs
20_Workshop/   analysis and internal working material
30_Drafts/     lawyer-owned drafts
40_Dispatch/   material intended for sending or filing after review
matter.json    matter metadata and intake history
```

The folder structure is deliberately boring. The app can show friendlier labels,
but the artifact contract stays stable so generated outputs, review tools, and
future workflows have a reliable home. In explicit runtime DB mode, the same
matter structure is represented through Postgres matter/storage/payload rows
instead of relying on a live matter folder as the source of truth.

### 2. Preserves originals and creates a file register

The intake stage is deterministic. It does not need AI.

For every file, the app:

- calculates a SHA-256 hash;
- gives the file a stable matter-scoped ID such as `FILE-0001`;
- preserves untouched originals;
- creates working copies organized by type;
- classifies files by extension;
- records duplicates;
- writes `File Register.csv` and `Intake Log.csv`.

This matters because legal work depends on file custody and repeatability. A lawyer should be able to tell which source was used, whether a later upload was a duplicate, and whether a generated output came from the current document set.

### 3. Extracts text from legal documents

Matter Workbench extracts readable text from supported source files, including formats such as:

- PDF;
- DOCX;
- XLSX;
- EML;
- RTF;
- TXT / Markdown.

For PDFs, the current quality posture is OCR-first when OCR providers are
configured: Mistral is the primary OCR path and Gemini can repair doubtful OCR
output. PDF.js remains useful for page-count, text-layer diagnostics, and
fallback. Extraction outputs become structured records under each intake's
`_extracted/` folder in filesystem mode, or equivalent payload-backed records in
runtime DB mode.

Each extraction record preserves source location information so later outputs can cite source blocks like:

```text
FILE-0001 p1.b2
```

Those raw citations are internal audit handles. They let the system trace a generated event back to a specific document, page, and block.

### 4. Creates Source Labels / Document Index

Raw source IDs are useful for machines but poor for lawyers. A lawyer does not want to review a chronology full of `FILE-0007` and `FILE-0014` without knowing what those documents are.

The Source Labels / Document Index stage reads extracted source records and produces a `Source Index.json` with lawyer-readable labels, for example:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026
```

The app preserves both identities:

| Identity | Purpose |
| --- | --- |
| `FILE-0001 p1.b2` | Internal audit handle, stable citation, source traceability |
| `Legal Notice from ... 20 April 2026` | Lawyer-readable source label for review and output |

The AI may help produce labels, but local validation keeps source identity server-owned. The model is not allowed to invent files, move hashes, or cite evidence from another document.

### 5. Creates a source-backed List of Dates

The centerpiece of the current product is Create List of Dates.

It produces:

```text
10_Library/List of Dates.json
10_Library/List of Dates.csv
10_Library/List of Dates.md
```

The chronology is designed for lawyer review. Each row connects:

- date;
- event;
- legal or practical relevance;
- source support;
- internal citation metadata;
- readable source labels where available.

The system does not merely ask a model to summarize a folder. It builds from prepared extraction records and source labels, validates the output shape, preserves raw citations, clusters related event candidates, and writes durable artifacts that can be inspected later.

The current List of Dates path also handles legal-review needs such as:

- duplicate mentions of the same event;
- corroborated events across multiple sources;
- payment discrepancies;
- non-merits source noise such as manifests or file indexes;
- label refresh when only source labels changed;
- regeneration warnings when source content changed.

The output is not court-ready without review. It is lawyer-review-ready: useful, auditable, and structured so a lawyer can verify it.

### 6. Distinguishes refresh, review, and regeneration

Matter Workbench tracks whether downstream outputs are still current against upstream source records.

It distinguishes three cases:

```text
label_refresh_needed
chronology_review_needed
chronology_regeneration_needed
```

This is important because not every change deserves an expensive AI rerun.

Examples:

- If only a document's lawyer-facing label changed, the app can refresh rendered labels without regenerating the chronology.
- If metadata changed, the app can warn that lawyer review is needed.
- If source text or document set changed, the app can recommend regenerating the List of Dates.

This is the difference between a workflow system and a one-off chat response. The app knows what artifacts exist, what they depend on, and what kind of update is appropriate.

### 7. Provides local matter context search

Matter Workbench can build a bounded matter context packet from prepared records and search it locally.

The local search path is useful for questions like:

```text
find payment
search notice
search possession
```

This does not call an AI provider and does not write artifacts. It searches prepared matter context and returns snippets with source labels and citations.

This gives the lawyer quick source-backed lookup without turning every query into a paid or open-ended AI interaction.

### 8. Shows matter status and developer attention

The app can inspect the matter lifecycle and show what exists, what is missing, and what needs attention.

Matter status tracks stages such as:

- matter intake;
- extraction;
- Source Labels / Document Index;
- List of Dates.

Matter Attention aggregates scattered evidence from logs and artifacts into a matter-level diagnostic view. It can surface issues such as:

- missing or unreadable `matter.json`;
- missing file registers;
- failed extraction rows;
- OCR-required documents;
- missing Source Index after extraction;
- source labels that still expose developer identifiers;
- missing or stale List of Dates artifacts;
- failed custom-skill runs.

This is intentionally diagnostic. It helps a developer, operator, or supervised beta tester see problems before a lawyer quietly relies on a broken matter state.

### 9. Supports governed custom skills

Matter Workbench includes a custom skill factory for supervised reusable workflows.

A user can describe a skill idea, but the app does not immediately create a runnable prompt. Instead, it follows a governed lifecycle:

```text
skill idea
-> interview / design brief
-> sample output
-> user review and approval
-> skill authoring
-> validation
-> activation
-> run ledger
-> improvement path
```

This matters because reusable legal workflows are durable product behavior. A weak prompt should not silently become a trusted skill. The app requires sample review and preserves version/run metadata so custom skills remain supervised.

## How The Product Works

Matter Workbench combines deterministic local processing with provider-backed AI only at controlled checkpoints.

### Deterministic local stages

These stages run locally and do not need an AI model:

- matter setup;
- file hashing;
- duplicate detection;
- folder organization;
- file register writing;
- extraction for supported file formats;
- local context packet construction;
- local context search;
- status checks;
- matter attention diagnostics;
- artifact currentness checks.

These stages provide the evidence base. They make the matter stable enough for AI-assisted steps to be useful.

### Provider-backed stages

AI providers are used for tasks that benefit from language understanding, such as:

- source label generation;
- chronology event selection and relevance drafting;
- skill interview planning;
- sample output generation;
- custom skill authoring and execution.

These provider-backed tasks inherit app-owned legal-output policy rules:

- use only supplied matter records;
- do not invent facts, documents, dates, citations, parties, or legal conclusions;
- preserve uncertainty;
- keep raw source handles internally;
- use lawyer-readable labels for normal output;
- fail closed on invalid structure;
- record provider/model/policy metadata.

The model is a component inside a workflow. It does not own the workflow.

### Durable artifacts instead of transient chat

Matter Workbench writes outputs to disk as durable matter artifacts:

```text
File Register.csv
Extraction Log.csv
_extracted/FILE-NNNN.json
Source Index.json
List of Dates.json
List of Dates.csv
List of Dates.md
custom skill output metadata
command interaction diagnostics
```

A lawyer can inspect those artifacts later. A developer can reproduce bugs. A downstream workflow can check whether the current output is stale.

This artifact-first design is one of the product's main differences from chat.

### Local validation around AI output

The app does not accept AI output just because it is fluent.

It validates things such as:

- JSON shape;
- required fields;
- impossible dates;
- missing citations;
- citations to the wrong source;
- source labels that leak raw `FILE-NNNN` identifiers;
- stale source metadata;
- unsupported provider fallback.

If a provider returns malformed or unsafe output, the app fails closed rather than writing a polished but unreliable artifact.

### Explicit paid-action guardrails

Provider-backed actions can cost money and can replace existing work. Matter Workbench keeps those boundaries visible.

When current artifacts already exist, rerun advice can tell the user:

- whether the artifact is missing;
- whether it is current;
- whether upstream records changed;
- whether only labels need refresh;
- whether regeneration is recommended.

The goal is not to block the lawyer. The goal is to prevent accidental paid reruns and accidental replacement of reviewed work.

## Why A Lawyer Cannot Just Do This With Generic AI Chat

A lawyer can absolutely ask a generic AI chat product to summarize documents, draft a chronology, or answer questions. Generic chat is useful.

But generic chat is not a matter workbench.

The difference is not that Matter Workbench has access to a smarter model. The difference is that Matter Workbench wraps models inside a legal workflow with source custody, artifact state, validation, and review boundaries.

### Generic chat has no stable matter memory

In a chat, the lawyer uploads or pastes documents into a conversation. The model sees what was supplied in that session. It usually does not maintain a durable, inspectable matter record across intake batches.

Matter Workbench keeps a matter folder with stable artifacts. It knows which documents were loaded, which were extracted, which labels were generated, which chronology was produced, and whether those outputs are current.

### Generic chat does not preserve source identity well

A chat model may say:

```text
According to the legal notice...
```

But the lawyer still has to verify which file, which page, and which passage supports that statement.

Matter Workbench maintains internal citations like:

```text
FILE-0001 p1.b2
```

and ties them to lawyer-readable source labels. This gives both usability and auditability.

### Generic chat can produce fluent but unvalidated output

A model can write a convincing chronology with:

- missing events;
- invented dates;
- overconfident legal relevance;
- citations that do not correspond to the document set;
- duplicate events;
- lost adverse facts.

Matter Workbench still needs lawyer review, but it adds local validation before an output becomes a matter artifact. The app can reject malformed output, impossible dates, wrong-file citations, and schema failures.

### Generic chat does not know when work is stale

If a lawyer adds ten more documents after a chat-generated chronology, the chat transcript does not automatically know that the earlier chronology is stale.

Matter Workbench can compare artifacts against upstream extraction records and source labels. It can distinguish:

- refresh labels;
- review metadata change;
- regenerate because source content changed.

This is critical in real matters where documents arrive in batches.

### Generic chat does not separate local/free work from paid/provider work

In a chat product, almost every interaction is a model call. Matter Workbench separates deterministic local stages from provider-backed stages.

Examples:

| Local/free workflow | Provider-backed workflow |
| --- | --- |
| file hashing | source label generation |
| duplicate detection | chronology generation |
| text extraction | skill sample generation |
| context search | custom skill execution |
| status checks | provider-backed legal analysis |

This gives lawyers and operators better control over cost, privacy, and repeatability.

### Generic chat does not enforce matter lanes or dispatch boundaries

A chat model may happily rewrite anything the user pastes. It has no inherent concept of:

- original source material;
- generated Library artifacts;
- lawyer-owned Drafts;
- frozen Dispatch copies;
- review before reliance.

Matter Workbench encodes those boundaries. `10_Library` outputs are generated source-backed artifacts. `30_Drafts` is where lawyer-owned drafting belongs. `40_Dispatch` is a send/file-ready boundary, not a scratchpad.

### Generic chat does not create governed reusable skills

A lawyer can save prompts in a generic AI product, but a saved prompt is not the same as a governed skill lifecycle.

Matter Workbench custom skills require:

- a design brief;
- sample generation;
- user approval;
- validation;
- activation;
- run metadata;
- non-mutating improvement flow.

That makes reusable legal workflows safer than informal prompt reuse.

### Generic chat does not give a developer/operator diagnostic surface

When a chat answer is bad, it is often hard to know why. Was the source missing? Was OCR bad? Did the model ignore a document? Did a previous upload fail? Did the provider return invalid JSON?

Matter Workbench exposes matter status, logs, artifacts, and Matter Attention so a problem can be traced to a concrete stage.

## What Makes Matter Workbench Unique

### 1. It treats AI as untrusted input

The product is built around distrust of AI output.

AI can help label, summarize, structure, and draft. But before output becomes part of the matter workspace, the app tries to validate it, preserve source handles, record metadata, and keep lawyer review visible.

This is different from AI-first products that treat the model response as the product.

### 2. It has source identity dualism

Matter Workbench keeps two identities at once:

```text
machine identity: FILE-0001 p1.b2
lawyer identity: Legal Notice dated 20 April 2026
```

The machine identity gives auditability. The lawyer identity gives readability. Most generic AI tools collapse these into vague natural-language references.

### 3. It is artifact-first, not chat-first

The app produces matter artifacts that live on disk and can be inspected:

- source register;
- extraction records;
- Source Index;
- List of Dates;
- run metadata;
- attention diagnostics.

The lawyer is not left with only a chat transcript.

### 4. It is local-first

Matter folders live on the user's machine. Deterministic stages run locally. Provider calls are explicit and limited to configured AI-backed operations.

This is useful for legal users who need control over documents, experiments, and beta testing before any hosted workflow is introduced.

### 5. It understands legal matter lifecycle

Matter Workbench does not ask, “What should the model say?” first.

It asks:

```text
What source material exists?
What is extracted?
What is labeled?
What chronology exists?
What changed?
What needs review?
What can safely feed drafting later?
```

That lifecycle orientation is what makes it a workbench rather than a prompt window.

### 6. It distinguishes generated knowledge from lawyer-owned drafts

The app does not encourage the lawyer to manually edit generated chronology rows as the canonical truth. If the List of Dates is wrong, the preferred path is to fix upstream source records, labels, metadata, or extraction, then refresh or regenerate.

Lawyer editing belongs downstream in drafts. This protects provenance and makes regeneration possible.

### 7. It supports reusable native and custom workflows

The current native spine is:

```text
/matter-init -> /extract -> /describe_sources -> /create_listofdates
```

That spine can support future native skills such as procedural history, party maps, claims/defences matrices, evidence support, contradictions, gaps, and counsel notes.

Custom skills exist, but they are governed. The product direction is not “make every legal task a custom prompt.” It is “build a native legal workbench, and use custom skills for firm-specific or experimental workflows.”

### 8. It fails closed instead of silently falling back

Matter Workbench does not silently switch models for legal-output tasks when a provider fails. Provider/model metadata matters. A lawyer reviewing a chronology should know which route produced it.

Silent fallback may be convenient in a generic AI app. In a legal workbench, it can break auditability.

## Product Positioning

Matter Workbench is best understood as:

```text
A local legal matter preparation system with controlled AI checkpoints.
```

It is for lawyers and legal teams who want:

- structured matter intake;
- source-backed chronologies;
- auditability;
- local control;
- reusable legal workflows;
- clear review boundaries;
- less dependence on ad hoc prompting.

It is not trying to replace a lawyer. It is trying to become the structured assistant a lawyer wishes they had before drafting, conference, filing, or advice work begins.

## Current Product Promise

The current V1 beta promise is:

```text
Turn a folder of legal matter documents into a structured, source-backed workspace with readable source labels, extracted records, a lawyer-review-ready List of Dates, and diagnostics that show what needs attention.
```

The promise is not:

```text
Upload documents and receive final legal work product ready to file.
```

That distinction is the product's strength. It makes Matter Workbench more conservative, more auditable, and more useful for real legal work than a generic chat session.
