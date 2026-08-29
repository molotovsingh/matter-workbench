# Quickstart: Fast extraction results reach the matter record under PostgreSQL storage

**Branch**: `001-v4-record-parity` | **Date**: 2026-08-29

How to work on this feature, and how to tell whether it is done.

---

## The defect in one paragraph

The application decides at start-up whether it can file fast-extraction results into a
matter. When matters are held in the runtime database it concludes it cannot, logs that
results will stay in the extraction store, and sets the filing step to nothing. From then on
fast extraction runs, succeeds, and its output never reaches the matter. On a deployment
configured for database storage the feature is inert.

## Reproduce it

```bash
# Confirm the branch that disables filing
grep -n "postgres storage mode" server.mjs
```

The surrounding block sets the result consumer to null when the matter store is in database
mode. Everything downstream of that is correct and untouched by this feature.

## Verify the reference behaviour still works

The filesystem path is the reference. It must not change.

```bash
npm test -- test/v4-extraction-import.test.mjs
```

This suite must pass **unchanged** for the entire life of the branch. If it needs editing,
the refactor has altered reference behaviour, which the spec forbids.

---

## Working order

1. **Extract the port without changing behaviour.** Introduce the three methods, move the
   existing filesystem reads and writes behind the filesystem adapter, leave every filing
   rule where it is. `test/v4-extraction-import.test.mjs` passing unchanged is the proof.
2. **Stand up the parity harness against one adapter.** Write the scenario table and run it
   through the filesystem adapter only. It should pass immediately — it is describing
   behaviour that already exists.
3. **Add the database adapter.** Point the same table at it. Every failure is a real parity
   gap.
4. **Wire the application.** Choose an adapter instead of disabling filing.
5. **Surface the outcomes.** Carry the summary through and render it.
6. **Make the panel re-attach.** Remember the run identity per matter, and on mount rejoin a
   run already in flight or recently finished.

Steps 1–3 are where the risk is. Step 1 changes code that works today; steps 2–3 are where
the actual defect gets fixed. Steps 5–6 are additive and touch no server code —
`GET /v1/intakes/{intakeId}` and `.../progress` are already addressable by run identity, so
re-attachment is a client concern only.

---

## Test commands

```bash
# Reference behaviour — must pass unchanged throughout
npm test -- test/v4-extraction-import.test.mjs

# Parity across both adapters — the feature's core assertion
npm test -- test/v4-record-parity.test.mjs

# Isolation boundary — must keep passing; the filing service must not
# acquire an import from the extraction service
npm test -- test/document-intake-extraction-v4-isolation.test.mjs

# Whole suite
npm test

# Real PostgreSQL. Needs a reachable admin URL; creates and drops a disposable database
MWB_POSTGRES_TEST_ADMIN_URL='postgresql:///postgres' npm run test:postgres
```

---

## Try it by hand

```bash
npm run ui:dev
```

Open a matter, add PDFs, and use the fast-extraction panel. Then run preparation and confirm
it does not re-read the documents fast extraction accepted.

To exercise the database arrangement, run the app with the runtime database storage mode
enabled and repeat. **The same steps must produce the same result** — that is the whole
feature, and it is worth doing manually once even though the parity test covers it, because
the test compares adapters while this compares against what a lawyer actually sees.

---

## Done when

- `test/v4-extraction-import.test.mjs` passes with no edits.
- The parity scenario table passes against both adapters.
- `V4-ISO-001` passes.
- Full suite green.
- A manual run under each arrangement produces the same matter record.
- Every document in a mixed batch shows an outcome, and those outcomes match the record.
- Reloading mid-run rejoins the same run rather than restarting it, and no document is
  submitted twice.
- Returning after a run's result has aged out says so, rather than showing an empty report.

## Not done by this feature

Stated so they are not mistaken for regressions:

- A citation `p3.b7` can denote different passages depending on which extractor produced the
  record. Pre-existing, identical under both arrangements, out of scope.
- Fast extraction and normal extraction can race on the same document. The existing race is
  inherited deliberately; adding locking to one adapter would itself break parity.
- New-matter set-up does not use fast extraction.

---

## Traps

- **Do not batch database writes.** It is the natural shape of the persistence method and it
  breaks parity on partial failure. One document per call (research R4).
- **Do not add a matter-listing query** to make the database adapter mirror the filesystem's
  fallback resolution. That fallback recovers from a filesystem-only condition (research R3).
- **Do not reuse the raw-file reader.** Its size cap is for browser display and would make
  filing fail on large matters (research R2).
- **Do not "fix" things while refactoring.** Confidence synthesis, block segmentation, and
  the extraction race all look wrong up close. They are the reference behaviour, and parity
  means reproducing them.
- **Do not add a server endpoint for re-attachment.** Run state is already addressable by
  identity. Adding one would create a second way to ask the same question.
- **Do not persist outcomes into the matter record** to make them survive longer. What was
  filed is already durable in the activity log; what ages out is only the reasons for
  documents that were not filed, and archiving those was explicitly rejected.
