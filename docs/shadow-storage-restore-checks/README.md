# Shadow Storage Restore Checks

This folder is for generated shadow-storage restore-check handoff artifacts.

Generate a local ignored storage backup first:

```sh
npm run db:shadow:storage-backup
```

Then preserve a redacted restore-check artifact:

```sh
npm run db:shadow:storage-restore-check -- --manifest .local/shadow-storage-backups/<backup>/manifest.json --out-dir docs/shadow-storage-restore-checks
```

Each artifact proves that the local storage backup manifest can be read and the
backed-up PDF objects are present and hash-matching. It does not include source
document bytes. Treat it as one-run evidence, not live truth; refresh it after
meaningful matter-folder or storage-hydration changes.
