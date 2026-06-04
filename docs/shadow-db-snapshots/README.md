# Shadow DB Snapshots

This folder is for generated shadow-database handoff snapshots.

Run:

```bash
MWB_DATABASE_URL="postgres://..." npm run db:shadow:snapshot
```

Each snapshot records the combined `db:shadow:report` output as Markdown and
JSON. It is evidence for a developer/operator that the Postgres shadow
control-plane mirror currently matches, or does not match, the local
filesystem-backed Matter Workbench state.

Snapshots do not switch runtime storage to Postgres, do not upload source
documents, and do not store legal work product in the database.
