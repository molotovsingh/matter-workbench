# Beta Testing: Lawyer-Facing List of Dates

This is the supervised beta handoff for the current app workflow:

```text
pick matter -> status -> open library -> /extract -> /describe_sources -> /create_listofdates
```

The pipeline is ready for real-matter testing with lawyer review. It is not court-ready without review. Treat the generated chronology as lawyer-review-ready work product: useful, source-backed, and auditable, but still requiring professional judgment before use.

## Beta Go

Use the app on real matters with the checklist below. The expected output is:

- extraction records for supported source files;
- `10_Library/Source Index.json` with readable source labels;
- `10_Library/List of Dates.json`, `.csv`, and `.md`;
- lawyer-facing chronology rows with readable source labels;
- raw `FILE-NNNN pX.bY` citations preserved beside those labels.

The most important review question is no longer "does the app run?" The question is now whether the generated chronology is useful to a lawyer reviewing the matter.

## Recommended Local Config

Use `.env.example` as the base. For beta testing, use:

```text
MISTRAL_OCR_ENABLED=1
OPENROUTER_SOURCE_DESCRIPTION_MODEL=meta-llama/llama-3.3-70b-instruct
OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS=6000
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=openai/gpt-4.1
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=8000
```

Keep real API keys only in local `.env`. At minimum, a live beta run needs:

```text
MISTRAL_API_KEY=...
OPENROUTER_API_KEY=...
```

The `latency` route is the recommended `/create_listofdates` OpenRouter route for now because the final smoke run succeeded through that path. Do not enable automatic model fallback for beta testing. Provider failures should fail closed instead of writing partial bad artifacts.

## Current Tester Workflow

Use the light-themed app and the right-side Command rail. The Command rail is deterministic in this beta: it runs known commands, opens workspace lanes, previews the bounded context packet, and can search that packet locally. It is not a chat surface, Q&A tool, semantic search system, or drafting copilot yet. Future provider-backed matter Co-pilot behavior is parked in [Matter Co-pilot Product Policy](copilot-qna-contract.md).

1. Pick a matter from the sidebar.
2. Type `status` in the Command rail.
   - Confirm the matter pipeline panel appears.
   - Check whether `/extract`, `/describe_sources`, and `/create_listofdates` are current, stale, missing, or not run.
3. Type `open library`.
   - This opens `10_Library` / Analysis Library.
   - Existing source labels and List of Dates artifacts should be visible there.
4. Run `/extract`.
   - This updates extraction records and `Extraction Log.csv`.
   - If Mistral OCR is enabled, scanned PDFs may make Mistral OCR calls.
5. Run `/describe_sources`.
   - This writes `10_Library/Source Index.json`.
   - If the existing artifact is current, the app shows a rerun warning before making a paid provider call.
   - Cancel should leave the existing artifact unchanged.
6. Run `/create_listofdates`.
   - This writes `10_Library/List of Dates.json`, `.csv`, and `.md`.
   - If the existing artifact is current, the app shows a rerun warning before making a paid provider call.
   - If upstream inputs are stale or missing, the app may allow the run without an overwrite warning.
7. Review outputs in `open library`.
8. Type `find <term>` or `search <term>` only when you want local context search.
   - This searches the bounded context packet, not raw files.
   - It should show source labels and raw `FILE-NNNN pX.bY` citations.
   - It should not call an AI provider or write artifacts.
9. Use `Copy Report` when sharing behavior.
   - The report should include matter name, folder, typed command, matched command, status, provider/model when available, artifact paths, and latest visible terminal lines.
   - It should not include API keys, `.env`, raw source document text, or full extraction records.
10. Use `open skills` when you want to inspect available capabilities.
    - The Skills tab is read-only in this beta.
    - It shows built-in skills, deterministic versus paid posture, and current matter status where available.
    - It does not create, edit, activate, or run configurable skills.

Useful Command rail inputs:

```text
/extract
/describe_sources
/context_preview
/context_search
/create_listofdates
find payment
search notice
status
open inbox
open library
open workshop
open drafts
open dispatch
open skills
```

The lane commands and local context search are read-only. They do not run providers, write artifacts, move files, or generate documents.

## CLI Smoke Option

For CLI smoke testing, set `MATTER_ROOT` and run:

```sh
MATTER_ROOT="/path/to/matter" node extract-engine.mjs --apply
MATTER_ROOT="/path/to/matter" node source-descriptors-engine.mjs --apply
MATTER_ROOT="/path/to/matter" node create-listofdates-engine.mjs --apply
```

Then inspect:

```text
00_Inbox/Intake 01 - Initial/Extraction Log.csv
10_Library/Source Index.json
10_Library/List of Dates.json
10_Library/List of Dates.md
```

## Where Outputs Live

The durable artifacts testers should inspect are:

```text
00_Inbox/Intake */Extraction Log.csv       extraction/OCR run log
00_Inbox/Intake */File Register.csv        canonical file ids and hashes
_extracted/                                extraction-record/v1 JSON records
10_Library/Source Index.json               source-index/v1 readable source labels
10_Library/List of Dates.json              structured lawyer-facing chronology
10_Library/List of Dates.csv               spreadsheet review copy
10_Library/List of Dates.md                lawyer-facing review artifact
```

The app may show friendly lane labels:

```text
00_Inbox      Inbox
10_Library    Analysis Library
20_Workshop   Workshop
30_Drafts     Drafts
40_Dispatch   Dispatch
```

The disk paths remain canonical. When reporting an issue, include the canonical path as well as the friendly label.

## What Looks Good

The current pipeline has crossed the beta threshold because:

- `/extract` is stable on the available matters;
- Mistral OCR is available behind an explicit local gate for scanned PDFs;
- `/describe_sources` writes source labels and fails closed on bad provider output;
- `/create_listofdates` produces lawyer-facing chronology fields;
- manifest, README, and index-style source noise is filtered before AI input;
- repeated chronology rows are clustered without deleting raw citations;
- payment discrepancies are explicit and reviewable;
- readable labels are additive and do not replace canonical citations.

The desired lawyer-facing source style is:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026 (FILE-0001 p1.b2)
```

The readable label helps the lawyer. The raw citation remains the audit handle.

## Tester Checklist

For each matter, reviewers should mark:

- whether the Command rail action did what the tester expected;
- whether a paid rerun warning appeared when a current artifact already existed;
- whether Cancel preserved the existing artifact;
- missing legally important events;
- overstated legal relevance;
- duplicate rows that should have clustered;
- clusters that merged unrelated events;
- missing supporting sources inside a cluster;
- broken raw `FILE-NNNN pX.bY` citations;
- source labels that are not lawyer-readable;
- OCR text that appears garbled, incomplete, or wrongly paginated;
- provider failures that did not fail closed.

Payment and discrepancy clusters need special attention. Check whether all relevant payment sources were pulled into the cluster, especially:

- bank statements;
- receipts;
- emails acknowledging or disputing payments;
- agreements or schedules that identify instalment amounts;
- notices that rely on the payment record.

The beta goal is to learn whether the chronology helps the lawyer see the case faster without hiding auditability.

## Known Beta Caveats

- OpenRouter can still return malformed JSON or transient provider errors.
- `/describe_sources` may need a retry if the provider returns metadata that fails local validation.
- Source descriptors may need rerun if extraction records or source hashes shift.
- `/create_listofdates` may run without confirmation when upstream inputs are newer than the existing artifact. That is intentional: the artifact is stale, not current.
- Reviewers must check for missing events and overstated legal relevance.
- Cluster completeness needs human review, especially for payment and discrepancy clusters.
- The Command rail has local context search, but it is not legal Q&A, semantic search, chat, or drafting copilot yet.
- Lane commands are just navigation; they do not validate whether a lane is legally complete.
- This is not "court-ready without review"; it is "lawyer-review-ready."

## Smoke Evidence

The merged pipeline was smoke-tested on two local matters.

### Kamran vs NCT

- `/extract`: 8 cached, 18 duplicate skips, 1 unsupported-format, 0 failed.
- `/describe_sources`: wrote `Source Index.json`.
- `/create_listofdates`: accepted 8 events and rendered 5 clustered rows.
- Raw citations were preserved.
- Readable source labels were present for all chronology rows.
- `/create_listofdates` used OpenRouter and returned provider `Friendli`.

### Mehta vs Skyline

- `/extract`: 10 cached, 2 unsupported-format, 0 failed.
- First `/describe_sources`: failed closed on a `sha256` mismatch.
- Retry `/describe_sources`: succeeded and wrote fresh `Source Index.json`.
- `/create_listofdates`: accepted 53 events and rendered 42 clustered rows.
- Cluster output included 32 `single_event`, 8 `corroborated_event`, 1 `payment_discrepancy`, and 1 `source_repeat`.
- The payment discrepancy row preserved three supporting sources: bank statement, email chain, and payment receipts.
- Raw citations were preserved.
- Readable source labels were present for all chronology rows.
- `/create_listofdates` used OpenRouter and returned provider `Friendli`.

## Review Posture

Use this beta to review quality, not just runtime success.

Good feedback is concrete:

```text
Missing event: 2023-09-12 receipt acknowledgement should appear in the payment discrepancy cluster.
Overstated relevance: row 14 says "proves default" but the source only alleges delay.
Bad cluster: two separate same-day payments were merged.
Weak label: "Email Chain" is too generic; should identify sender/recipient/date.
```

Avoid vague feedback like:

```text
Output is not good.
Needs better AI.
Too many events.
```

The useful beta question is: what exact event, label, source, citation, or legal relevance sentence should change?
