# Contract: `v4-db-readiness/v1`

JSON and Markdown carry the same facts. JSON is authoritative for activation tooling.

## Required JSON shape

```json
{
  "schemaVersion": "v4-db-readiness/v1",
  "generatedAt": "2026-08-29T00:00:00.000Z",
  "success": true,
  "activationReady": true,
  "postureFingerprint": "<64 lowercase hex>",
  "database": {
    "name": "matter_workbench_v4",
    "configured": true,
    "owner": "<migration role name>"
  },
  "runtimeConfiguration": {
    "poolMaximum": 16,
    "autoMigrate": false
  },
  "runtimeIdentity": {
    "role": "<runtime role name>",
    "superuser": false,
    "createDatabase": false,
    "createRole": false,
    "inherit": false,
    "bypassRls": false,
    "connectionLimit": 16,
    "runtimeDatabaseDenied": true,
    "mothershipDatabaseDenied": true,
    "requiredPrivileges": true
  },
  "migrations": {
    "complete": true,
    "immutable": true,
    "entries": [{ "name": "001_control_plane.sql", "sha256": "<64 hex>" }]
  },
  "backup": {
    "policy": "private-vm-recoverability-pack/v1",
    "manifest": "<path>",
    "generatedAt": "<ISO timestamp>",
    "bytes": 1,
    "sha256": "<64 hex>"
  },
  "restore": {
    "report": "<path>",
    "success": true,
    "cleanup": true,
    "sourceSha256": "<same as backup>"
  },
  "failedChecks": []
}
```

## Truth rules

- `success` and `activationReady` are true only when every required boolean is true.
- Backup and restore digests must match.
- Migration entries, role/posture fields, pool maximum, and auto-migration setting feed the
  fingerprint; paths and timestamps do not, so moving an evidence file does not invalidate
  it.
- `runtimeConfiguration.poolMaximum` must be 16 and `autoMigrate` must be false.
- A migration, database-location, role-attribute, connection-budget, or backup-policy change
  changes the fingerprint and makes earlier restore evidence ineligible.
- A routine flag cycle does not change the fingerprint.
- `failedChecks` contains stable codes, never exception text.

## Forbidden data

The record MUST NOT include connection strings, passwords, tokens, host credentials, raw SQL
errors, or environment snapshots. Database and role names are allowed non-secret identifiers.
