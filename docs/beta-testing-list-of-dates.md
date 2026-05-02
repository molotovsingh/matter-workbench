# Beta Testing: Lawyer-Facing List of Dates

This is the supervised beta handoff for the full matter pipeline:

```text
/extract -> /describe_sources -> /create_listofdates
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
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS=6000
```

Keep real API keys only in local `.env`.

The `latency` route is the recommended `/create_listofdates` OpenRouter route for now because the final smoke run succeeded through that path. Do not enable automatic model fallback for beta testing. Provider failures should fail closed instead of writing partial bad artifacts.

## How to Run

In the app, run:

```text
/extract
/describe_sources
/create_listofdates
```

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
- Reviewers must check for missing events and overstated legal relevance.
- Cluster completeness needs human review, especially for payment and discrepancy clusters.
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
