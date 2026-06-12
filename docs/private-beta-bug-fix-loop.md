# Private Beta Bug-Fix Loop

Status: supervised private beta operating rule

Use this loop after the release checkpoint is handed to trusted testers. It is
meant to keep beta work disciplined: fix what testers actually hit, preserve
evidence, and avoid turning the beta into a feature sprint.

## The Rule

During supervised private beta, default to bug fixes and beta polish only.

Allowed work:

- broken clicks, dead ends, missing data, stale UI state, or confusing language;
- preparation, OCR, Source Labels, List of Dates, Copilot, custom-skill, Activity,
  Settings, or runtime DB defects that testers actually encounter;
- small polish needed to make an existing beta workflow understandable;
- evidence capture, tests, docs, and rollback notes for the bug being fixed.

Parked work:

- new product features;
- public web deployment;
- hosted multi-user expansion;
- broad native-skill roadmap work;
- database schema expansion that is not needed for the reported defect;
- model/provider experiments that are not needed to reproduce or fix the bug.

## Standard Bug Loop

For each report:

1. Capture the tester's short report first. Prefer the in-app
   **Have a problem? Tell us what happened** feedback record when it exists.
2. Open the operator observability bundle and find the report by feedback id,
   matter, trace id, or recent time:

   ```bash
   curl -sS "http://127.0.0.1:4191/api/private-beta/observability?limit=50" \
     | jq '.summary, .topProblems[0:10], .feedbackEvidence[0:5]'
   ```

   This endpoint joins feedback, nearby failed jobs, diagnostic signals, and
   the latest backend metrics. It is superuser/operator-only and should be the
   first debugging surface before manually searching ledgers.
3. Record matter name, time, command/button, visible model/provider, trace id,
   exact error
   text, and screenshot if visual. If the tester used the in-app feedback flow,
   start from the Activity feedback packet instead of asking them to recreate
   the whole context manually.
4. Run the bug evidence pack only when developer handoff needs more context:

   ```bash
   npm run private-beta:bug-evidence-pack -- \
     --base-url http://127.0.0.1:4191 \
     --matter "Matter Name" \
     --note "Short description of what the tester saw"
   ```

5. Reproduce the issue on the smallest safe matter or read-only surface.
6. Fix the narrowest code path that owns the bug.
7. Add or update the focused test that would have caught it.
8. Run focused verification, then the release gates relevant to the touched
   surface.
9. Commit the fix with the bug evidence path or reproduction summary in the
   commit context.

## Severity

Use this triage language:

- `P0`: wrong matter, secret/client-data leak, unsafe cross-matter output, or
  app cannot start.
- `P1`: beta workflow blocked, output missing with no recovery, failed
  preparation chain, broken custom-skill control, or serious legal-quality
  miscue.
- `P2`: confusing wording, weak empty state, slow-but-working flow, layout
  clipping, or non-blocking receipt/advisory problem.
- `P3`: polish that can wait unless it repeats across testers.

## Verification Floor

Every committed beta bug fix should have:

- `git diff --check`;
- the focused test for the touched path;
- `npm run ui:typecheck --silent`;
- `npm run ui:build --silent`;
- `npm test --silent` before tagging or handing off a new checkpoint.

Run `npm run ui:smoke --silent` when UI routing, command panel behavior, matter
selection, skills, Activity, Settings, runtime mode labels, or operator
observability routes are touched.

Run `npm run db:runtime:smoke` when runtime DB storage, status readers, job
state, receipts, or database-backed matter data are touched.

## Stop Rules

Stop and re-plan before fixing if the bug points to:

- a new public deployment requirement;
- a schema migration that changes production custody;
- a broad provider/model policy change;
- replacing the local/private beta storage model;
- access-control or secret-handling behavior that needs a dedicated security
  pass.

The beta loop is intentionally narrow. Its job is to make the current supervised
beta truthful and usable, not to silently start the next product phase.
