# Shadow DB Restore Drills

This folder is for generated shadow-database restore-drill handoff artifacts.

Run:

```bash
MWB_DATABASE_URL="postgres://..." npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --out-dir docs/shadow-db-restore-drills
```

Each restore-drill artifact records whether a local shadow backup could be
restored into a temporary PostgreSQL database, verified with the combined
`db:shadow:report`, and cleaned up. It is evidence for a developer/operator that
the Postgres backup itself can be restored.

Treat every restore drill as one-run evidence, not live truth. A successful
restore drill proves the database backup path, not PDF/object-storage backup and
restore. While storage objects still point at local filesystem paths, the local
storage backup or object-storage migration remains a separate runtime-cutover
requirement.

Restore drills do not switch Matter Workbench runtime storage to Postgres.
