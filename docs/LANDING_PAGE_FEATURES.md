# Matter Workbench - Product Feature List (End-User)

> Turn a messy folder of case documents into a structured, searchable, lawyer-review-ready workspace. No cloud. No database. Your files, your machine.

---

## Core Pipeline

### Ingest Without Fuss
Drop a folder of documents — PDFs, Word files, spreadsheets, emails, scanned papers — and Matter Workbench takes over. It fingerprints every file, organizes them by type, keeps pristine originals untouched, and gives every document a stable ID. Bring more files later and they merge cleanly into the same case. Duplicates are caught automatically.

### Extract Documents, With OCR Support For Scans
Supported documents get their text pulled out into structured extraction records. OCR can be enabled for scanned PDFs when the provider is configured. If you re-upload unchanged files, cached extraction records are reused; changed files are processed again.

### Sources Get Names, Not Numbers
The AI reads every document and gives each a lawyer-friendly label: "Sale Deed dated 12.03.2021 between Rajesh Kumar and Sunita Devi." No more squinting at file names. But the raw FILE-NNNN citations stay underneath for audit. If the AI hallucinates a citation, the system rejects it.

### Chronology Built for You
The centerpiece: a neutral Case Timeline sourced entirely from your documents. Every event is traced back to its source with a sharp legal relevance tag — supports, rebuts, corroborates, contradicts. It catches payment mismatches, flags corroborated events (multiple sources confirm), and clusters related entries so you can scan for patterns instead of hunting through pages.

### Custom Skills You Design
Need something Matter Workbench doesn't do yet? Describe what you want, and the system interviews you to nail down the design. It generates sample output, you approve it, and then it authors a custom skill — a reusable command you can run on any matter. Every custom run is logged for review.

---

## Workspace That Thinks Like a Lawyer

### Five Lanes, One Screen
Every case is organized into five workspace lanes mirroring real legal workflow:
- **Inbox** — raw intake, extraction records, file register
- **Library** — source index, chronology, searchable reference
- **Workshop** — your analysis space
- **Drafts** — working documents in progress
- **Dispatch** — ready-to-file or ready-to-send

### Home Dashboard
Switch between matters quickly. Search your case list. Continue the last matter or pick a recent one without digging through folders.

### Slash Commands
Type `/` and a command — like `/matter-init`, `/extract`, `/create_case_timeline` — and the system runs that pipeline stage. Familiar if you've used VS Code or Slack. Autocomplete guides you. No hunting through menus.

### File Preview In-App
Click any file and preview it directly — markdown, CSV, JSON, plain text. No need to open Finder or another app.

---

## Safety You Can Trust

### Local-First, Always
Your case files never leave your machine except when you explicitly send text to an AI provider for labeling or chronology generation. There is no cloud database. There is no server-side storage. Your matters live on your disk, in folders you control.

### Lawyer-Review-Ready, Not Lawyer-Replacement
Every AI-generated output is designed to be reviewed by a lawyer. The system does not treat generated output as final filed or sent work product. It produces structured review artifacts with source references so you can verify, edit, and sign off. Paid or replacing operations are guarded by explicit confirmation.

### No Hallucinated Citations
The source labeling and chronology engines validate AI output locally before accepting it. Impossible dates are rejected. References to files that don't exist are caught. Citations to wrong documents are blocked.

### Secrets Stay Secret
API keys and credentials are automatically stripped from all logs, reports, and copy-paste buffers. You can share context reports with a colleague without worrying about exposing your provider keys.

---

## Built for Indian Legal Practice

- Classification system tuned for litigation documents: Sale Deeds, Legal Notices, Written Statements, Affidavits, Orders, Judgments
- Chronology event types map to Indian legal contexts: agreements, payments, notices, demands, replies, court filings, hearings
- Payment discrepancy detection catches mismatched amounts across documents — critical for property and commercial disputes
- Source labeling understands Indian naming conventions and document types

---

## Under the Hood (for the curious)

| Capability | Detail |
|-----------|--------|
| Document formats | PDF, DOCX, XLSX, EML, RTF, TXT, MD |
| OCR | Mistral OCR for scanned PDFs (opt-in) |
| AI providers | OpenAI direct + OpenRouter (configurable) |
| File integrity | SHA-256 hashing; duplicates detected on intake |
| Storage | Local disk — no cloud dependency |
| Operating System | macOS (local Node.js server) |
| Skills | 8 built-in + configurable custom skill factory |
