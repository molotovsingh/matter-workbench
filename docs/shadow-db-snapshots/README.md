# Shadow DB Snapshots

This folder is for generated shadow-database handoff snapshots.

Run:

```bash
MWB_DATABASE_URL="postgres://..." npm run db:shadow:snapshot
```

Each snapshot records the combined `db:shadow:report` output as Markdown and
JSON, together with the repo branch, short commit, and clean/dirty worktree
state that produced the report. It is evidence for a developer/operator that
the Postgres shadow control-plane mirror currently matches, or does not match,
the local filesystem-backed Matter Workbench state.

Treat every snapshot as one-run evidence, not live truth. Refresh the snapshot
after meaningful repo changes, local matter folder or skill-ledger changes, or a
new shadow hydration / verify pass. The checked-in files are useful handoff
evidence only when their repo provenance and generated-at time match the run you
intend to discuss.

`db:shadow:snapshot` runs a read-only `db:doctor` preflight before writing files.
It refuses to write snapshot files unless the doctor reports
`ready_to_hydrate: yes`.

Snapshots do not switch runtime storage to Postgres, do not upload source
documents, and do not store legal work product in the database.
