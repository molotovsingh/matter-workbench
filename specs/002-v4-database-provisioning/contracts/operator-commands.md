# Contract: V4 Database Operator Commands

## Shared rules

Every command:
- is non-interactive;
- exits non-zero on any failed required check;
- redacts URLs, passwords and tokens from stdout, stderr and evidence;
- accepts secrets through environment only, never command-line arguments;
- refuses a database name other than `matter_workbench_v4` except the restore drill's
  restricted disposable prefix.

Provision, pg_hba rendering/installation, backup, restore and readiness commands MUST NOT set
`MWB_V4_INTAKE` or restart Matter Workbench. **Activation and disable are the only
exceptions**, and their bounded behaviour is defined below.

## Privileged pg_hba installer

```text
npm run v4:db:pg-hba:install
```

This is the only command requiring privileged filesystem access. It MUST be invoked explicitly
as an identity that can write PostgreSQL's pg_hba file and reload PostgreSQL; it MUST NOT call
`sudo` or prompt internally. It owns one marker-delimited V4 block, preserves all bytes outside
that block, writes atomically with a backup, reloads, verifies the active rules, and restores
the backup if verification fails. Provisioning itself only renders and verifies the required
rules; it does not silently escalate privileges.

## Provision

```text
npm run v4:db:provision
```

Consumes operator-only admin/migration configuration and creates or verifies the database,
migration/runtime identities, runtime connection limit, cross-database denial, migrations,
grants, forced RLS, and recovery canary. Re-running correct state succeeds without mutation.
Conflicting existing state fails with a stable code.

Output: non-secret `v4-db-provision/v1` result.

## Backup

```text
npm run v4:db:backup -- --out-dir <directory>
```

Dumps exactly `matter_workbench_v4`, writes a non-empty SQL file and
`v4-db-backup/v1` integrity manifest, and fails when either bytes or digest is absent.

## Restore drill

```text
npm run v4:db:restore-drill -- --backup <sql> --manifest <json> --out-dir <directory>
```

Creates a uniquely-named database under `matter_workbench_v4_restore_*`, verifies the backup
digest before restoring, verifies migrations/RLS/canary after restoring, and drops only the
database it created. `--keep` may retain it for operator diagnosis and is recorded as cleanup
false; kept evidence cannot satisfy activation readiness.

## Readiness

```text
npm run v4:db:readiness -- --backup-manifest <json> --restore-report <json> --out-dir <directory>
```

Read-only. Verifies current posture and supplied evidence, emits `v4-db-readiness/v1`, and
exits zero only when activation-ready. It never migrates, grants, repairs, backs up, restores,
sets the flag, or restarts the application.

## Activation and disable

```text
npm run v4:db:activate -- --readiness <readiness.json>
npm run v4:db:disable
```

Activation is the only command allowed to set `MWB_V4_INTAKE=1` and restart Matter Workbench.
It verifies current evidence first, atomically edits only that setting, then restarts. Disable
atomically removes only that setting, then restarts; it never changes or deletes V4 data.
Neither command migrates, grants, backs up, restores, or repairs database state.

## Recoverability pack integration

`npm run private-vm:recoverability-pack` runs runtime DB backup/restore and V4 DB
backup/restore in the same timestamped pack. V4 failure fails the whole pack. No V4 scheduler
is added; one pack invocation is one backup window for both databases.
