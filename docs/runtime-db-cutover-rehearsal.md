# Runtime DB Cutover Rehearsal

Date: 2026-06-06

Status: local/private runtime DB rehearsal passed

This note records the first rendered-app rehearsal after the runtime DB readiness
gate. The purpose was not to add schema or new product behavior. It was to prove
that the React beta can be started in explicit runtime Postgres mode and still
behave like the local app a lawyer would use.

## Mode Under Test

The app was started on `http://127.0.0.1:4191/` with:

```text
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
```

The database URL was loaded through the local DB env helper and was not printed
in the rehearsal output.

## Rendered UI Checks

The in-app browser loaded the React shell at `/` with title `Matter Workbench`.
The app showed the DB-backed matter list with 15 matters, including:

- Atlas Constuction vs Diptishree
- Ayesha Vs Japan Airlines
- Bharat Nagpal Vs Gionee India
- Techbeliever Vs GST

The rendered checks covered:

- Home screen loads and shows the matter list.
- Selecting `Atlas Constuction vs Diptishree` opens the matter overview.
- Matter Preparation renders DB-backed status and advisory.
- The matter tree shows DB-backed source/artifact files.
- A visible file row can be opened and previewed from DB payload custody.
- Activity renders.
- Settings renders without exposing database URLs or API keys.
- Skills renders custom and built-in skill state.
- Home navigation clears the active matter view and returns to `No matter selected`.

The browser console had no relevant `error` or `warn` entries during those
checks.

## Controlled Runtime Write Check

The runtime write smoke was run with its report output outside the repository:

```text
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke -- --out-dir /private/tmp/mwb-runtime-db-rehearsal
```

Result:

```text
passed: yes
role_guard_passed: yes
upload_created: yes
workspace_readable: yes
file_preview_readable: yes
raw_file_readable: yes
db_rows_verified: yes
rollback_verified: yes
cleanup_deleted: yes
```

This proves the runtime DB path can create a disposable matter, persist source
payload bytes, read the DB-backed workspace, prove transaction rollback, and
delete the disposable matter afterward.

## Filesystem Fallback Check

A second server was started on `http://127.0.0.1:4192/` with runtime DB mode off.
It served the React shell and listed the same 15 local matters from the
filesystem-backed local workspace.

This preserves the beta safety boundary: runtime DB mode is explicit, and normal
local filesystem mode remains available when the runtime DB flags are absent.

## Resulting Claim

Matter Workbench can now be described as having an accepted local/private
runtime DB mode for matter selection, DB payload custody, workspace/file preview,
custom skill state, and a controlled upload/write path.

That is still not a hosted production cutover. Hosted production still needs
deployment-specific work around authentication, object storage, backups,
background workers, observability, and operator runbooks.

## Notes And Limits

- The browser test used a desktop viewport. The responsive UI was not the target
  of this rehearsal.
- Source Labels and List of Dates were observed as existing DB-backed payloads;
  the rehearsal did not rerun paid AI preparation stages.
- Historical provider-run rows with legacy model labels and unknown-cost values
  remain a cost-governance cleanup item, not a runtime DB blocker.
- The file-tree contained duplicate technical file labels in the DOM; the
  visible UI was usable, but test locators had to target visible coordinates for
  one file-row preview. This is not a cutover blocker, but it is worth keeping in
  mind for future accessibility-oriented UI tests.
