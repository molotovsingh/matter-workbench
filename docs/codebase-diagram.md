# Matter Workbench Codebase Diagram

This document maps the current Matter Workbench architecture as it exists in this repo. It is a maintenance artifact, not a roadmap. Keep future Unibox/v2 ideas out unless they are clearly marked as future work.

Read the main diagram from left to right: the browser and CLI send actions into the local Node server or workflow engines, the engines use shared contracts and provider policies, and the result is written back as durable matter artifacts on disk.

## Maintenance Rule

Update this diagram when adding a new route, service, engine, persistent artifact, provider path, or major lifecycle stage.

## Runtime System Map

```mermaid
flowchart LR
  Browser["Browser UI<br/>index.html<br/>styles.css<br/>frontend/*.js"]
  Server["Local Node server<br/>server.mjs"]
  Cli["CLI commands<br/>MATTER_ROOT=... node *.mjs --apply"]

  Browser -->|"HTTP JSON/file requests"| Server

  subgraph Routes["Route/API layer"]
    ApiRoutes["routes/api-routes.mjs"]
    HttpUtils["routes/http-utils.mjs<br/>JSON parsing and 413 guard"]
    StaticRoutes["routes/static-routes.mjs"]
  end

  Server --> ApiRoutes
  Server --> StaticRoutes
  ApiRoutes --> HttpUtils

  subgraph Services["Services"]
    ConfigService["services/config-service.mjs<br/>matters home"]
    MatterStore["services/matter-store.mjs<br/>active matter and overlap checks"]
    WorkspaceService["services/workspace-service.mjs<br/>tree and previews"]
    UploadService["services/upload-service.mjs<br/>new matters and add files"]
    AiSettingsService["services/ai-settings-service.mjs<br/>settings visibility"]
    SkillRegistryService["services/skill-registry-service.mjs"]
    SkillRouterService["services/skill-router-service.mjs"]
    DoctorService["services/doctor-service.mjs"]
  end

  ApiRoutes --> ConfigService
  ApiRoutes --> MatterStore
  ApiRoutes --> WorkspaceService
  ApiRoutes --> UploadService
  ApiRoutes --> AiSettingsService
  ApiRoutes --> SkillRegistryService
  ApiRoutes --> SkillRouterService
  ApiRoutes --> DoctorService

  subgraph Engines["Workflow engines"]
    MatterInit["matter-init-engine.mjs<br/>/matter-init"]
    Extract["extract-engine.mjs<br/>/extract"]
    SourceDescriptors["source-descriptors-engine.mjs<br/>/describe_sources"]
    ListOfDates["create-listofdates-engine.mjs<br/>/create_listofdates"]
  end

  ApiRoutes --> MatterInit
  ApiRoutes --> Extract
  ApiRoutes --> ListOfDates
  Cli --> MatterInit
  Cli --> Extract
  Cli --> SourceDescriptors
  Cli --> ListOfDates

  subgraph ExtractUtils["Extract utilities"]
    PdfExtract["extract-utils/pdf-extract.mjs<br/>pdfjs-dist"]
    DocxExtract["extract-utils/docx-extract.mjs<br/>mammoth"]
    XlsxExtract["extract-utils/xlsx-extract.mjs<br/>xlsx"]
    EmlExtract["extract-utils/eml-extract.mjs<br/>mailparser"]
    RtfExtract["extract-utils/rtf-extract.mjs"]
    TextExtract["extract-utils/text-extract.mjs"]
    OcrNormalize["extract-utils/ocr-normalize.mjs"]
    MistralOcr["extract-utils/mistral-ocr-provider.mjs<br/>Mistral OCR opt-in"]
  end

  Extract --> PdfExtract
  Extract --> DocxExtract
  Extract --> XlsxExtract
  Extract --> EmlExtract
  Extract --> RtfExtract
  Extract --> TextExtract
  PdfExtract --> OcrNormalize
  PdfExtract --> MistralOcr

  subgraph Shared["Shared contracts and AI policy"]
    MatterContract["shared/matter-contract.mjs<br/>folders, headers, categories"]
    ModelPolicy["shared/model-policy.mjs<br/>task policy"]
    ProviderPolicy["shared/ai-provider-policy.mjs<br/>request-ready provider config"]
    ResponsesClient["shared/responses-client.mjs<br/>OpenAI Responses helper"]
    LocalEnv["shared/local-env.mjs"]
    Csv["shared/csv.mjs"]
    SafePaths["shared/safe-paths.mjs"]
  end

  MatterInit --> MatterContract
  Extract --> MatterContract
  ListOfDates --> ModelPolicy
  ListOfDates --> ProviderPolicy
  ListOfDates --> ResponsesClient
  SourceDescriptors --> ModelPolicy
  SourceDescriptors --> ProviderPolicy
  SkillRouterService --> ModelPolicy
  SkillRouterService --> ResponsesClient
  Server --> LocalEnv
  MatterInit --> Csv
  Extract --> Csv
  ListOfDates --> Csv
  StaticRoutes --> SafePaths
  WorkspaceService --> SafePaths

  subgraph Providers["External provider paths"]
    OpenAI["OpenAI direct<br/>Responses API"]
    OpenRouter["OpenRouter<br/>chat completions + strict JSON schema"]
    Mistral["Mistral OCR<br/>mistral-ocr-latest"]
  end

  ResponsesClient --> OpenAI
  SourceDescriptors --> OpenRouter
  ListOfDates --> OpenRouter
  MistralOcr --> Mistral

  subgraph Disk["Matter disk artifacts"]
    MatterJson["matter.json"]
    Inbox["00_Inbox/"]
    FileRegister["00_Inbox/*/File Register.csv"]
    Extracted["00_Inbox/*/_extracted/<br/>FILE-NNNN.json<br/>FILE-NNNN.txt"]
    ExtractionLog["00_Inbox/*/Extraction Log.csv"]
    Library["10_Library/"]
    SourceIndex["10_Library/Source Index.json"]
    LodJson["10_Library/List of Dates.json"]
    LodCsv["10_Library/List of Dates.csv"]
    LodMd["10_Library/List of Dates.md"]
  end

  MatterInit --> MatterJson
  MatterInit --> Inbox
  MatterInit --> FileRegister
  Extract --> Extracted
  Extract --> ExtractionLog
  SourceDescriptors --> SourceIndex
  ListOfDates --> SourceIndex
  ListOfDates --> LodJson
  ListOfDates --> LodCsv
  ListOfDates --> LodMd
  SourceIndex --> Library
  LodJson --> Library
  LodCsv --> Library
  LodMd --> Library

  subgraph Verification["Verification and supervision"]
    Tests["test/*.mjs<br/>node --test"]
    Evals["evals/*<br/>smoke + golden checks"]
    Docs["docs/*<br/>contracts, strategy, architecture"]
  end

  Tests --> Server
  Tests --> MatterInit
  Tests --> Extract
  Tests --> SourceDescriptors
  Tests --> ListOfDates
  Evals --> SourceDescriptors
  Evals --> MistralOcr
  Evals --> ListOfDates
  Docs --> MatterContract
  Docs --> ModelPolicy
```

## Matter Lifecycle Map

```mermaid
flowchart TD
  RawMatter["Raw matter folder<br/>client files"]
  MatterInit["/matter-init<br/>preserve originals<br/>classify working copies<br/>register hashes"]
  InboxArtifacts["00_Inbox artifacts<br/>Originals<br/>By Type<br/>File Register.csv<br/>Intake Log.csv"]
  Extract["/extract<br/>deterministic extractors<br/>Mistral OCR when enabled"]
  ExtractionRecords["extraction-record/v1<br/>_extracted/FILE-NNNN.json<br/>_extracted/FILE-NNNN.txt<br/>Extraction Log.csv"]
  DescribeSources["/describe_sources<br/>OpenRouter source labels<br/>local contract validation"]
  SourceIndex["10_Library/Source Index.json<br/>lawyer-readable source labels"]
  CreateListOfDates["/create_listofdates<br/>source-backed chronology<br/>meta-source filtering<br/>lawyer-facing fields<br/>cluster classification"]
  ListOfDates["10_Library/List of Dates.*<br/>JSON + CSV + Markdown<br/>readable labels + raw citations"]
  BetaReview["Supervised beta review<br/>missing events<br/>overstated relevance<br/>cluster completeness<br/>raw citation integrity"]

  RawMatter --> MatterInit
  MatterInit --> InboxArtifacts
  InboxArtifacts --> Extract
  Extract --> ExtractionRecords
  ExtractionRecords --> DescribeSources
  DescribeSources --> SourceIndex
  ExtractionRecords --> CreateListOfDates
  SourceIndex --> CreateListOfDates
  CreateListOfDates --> ListOfDates
  ListOfDates --> BetaReview
```

## Eval And Smoke Tooling

These are not normal runtime routes. They are repo tools for checking provider behavior and artifact quality.

```mermaid
flowchart LR
  SourceEval["evals/source-descriptors/<br/>openrouter-source-descriptors-eval-check.mjs<br/>openrouter-source-descriptors-live.mjs"]
  OcrSmoke["evals/ocr/<br/>mistral-ocr-smoke.mjs"]
  LodEval["evals/listofdates/<br/>check-golden-listofdates.mjs<br/>openrouter-ocr-listofdates-smoke.mjs"]

  SourceEval -->|"synthetic fixtures + gated live OpenRouter"| SourceContract["Source descriptor contract"]
  OcrSmoke -->|"gated live Mistral OCR smoke"| OcrContract["OCR provider shape"]
  LodEval -->|"golden markdown/json checks"| LodContract["List of Dates quality gates"]
```

## Current Provider Posture

- `/extract` is deterministic by default. Mistral OCR is opt-in through `MISTRAL_OCR_ENABLED=1`.
- `/describe_sources` is implemented by `source-descriptors-engine.mjs` and uses OpenRouter with strict structured output and local validation.
- `/create_listofdates` uses OpenAI direct by default, or OpenRouter when `SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter`.
- OpenRouter routing remains explicit. Automatic fallback is not enabled for lawyer-facing artifacts.
- Provider output is treated as untrusted until it passes local validation.

At this repo state, `source-descriptors-engine.mjs` is shown as an operational engine path rather than a `routes/api-routes.mjs` endpoint.

## Current Beta Posture

The pipeline is beta-ready for supervised use:

```text
/extract -> /describe_sources -> /create_listofdates
```

The generated List of Dates should be reviewed by a lawyer. The target status is lawyer-review-ready, not court-ready without review.

During beta, reviewers should pay special attention to:

- missing legally important events;
- overstated legal relevance;
- duplicate rows that should have clustered;
- clusters that merged unrelated events;
- missing supporting sources inside a cluster;
- broken raw `FILE-NNNN pX.bY` citations;
- weak source labels;
- OCR quality on scanned PDFs.
