# Quickstart: V4 Database Provisioning

This is the intended operator sequence. Every database operation happens while V4 is off.
The flag is last.

## 1. Confirm V4 is off and host is healthy

```bash
grep -q '^MWB_V4_INTAKE=1' "$HOME/.config/matter-workbench/runtime.env" && exit 1 || true
systemctl --user is-active matter-workbench-runtime matter-workbench-mothership
curl -fsS http://127.0.0.1:4191/api/config >/dev/null
```

## 2. Prepare operator-only configuration

Store admin/migration secrets in a mode-0600 operator file that systemd does not load.
Runtime service configuration receives only the restricted V4 URL and non-secret settings.

```text
MWB_V4_DB_NAME=matter_workbench_v4
MWB_V4_MIGRATION_ROLE=<operator role>
MWB_V4_RUNTIME_ROLE=<restricted role>
MWB_V4_DB_POOL_MAX=16
MWB_V4_AUTO_MIGRATE=0
MWB_V4_LANES=4
```

Never print or place connection URLs/passwords in evidence.

## 3. Install the cross-database denial rules explicitly

Provisioning never escalates itself. Run the dedicated installer as an identity already able
to write PostgreSQL's pg_hba file and reload PostgreSQL:

```bash
npm run v4:db:pg-hba:install
```

It owns one marker-delimited block and must preserve everything outside it. It writes a
backup, reloads, verifies active rules, and restores its backup on failure. The installer
never invokes `sudo` or prompts internally.

## 4. Provision and migrate

```bash
npm run v4:db:provision
```

Re-run immediately. Both runs must succeed; the second reports verified existing state, not
new resources. Confirm Matter Workbench was never restarted.

## 5. Produce recoverability evidence

```bash
npm run private-vm:recoverability-pack -- \
  --base-url http://127.0.0.1:4191 \
  --out-dir "$HOME/matter-workbench-backups/recoverability"
```

The pack must contain runtime and V4 database backups and restore-drill results under one
timestamped directory. V4 restore verifies current migrations, forced RLS, the recovery
canary, and cleanup.

## 6. Run readiness

```bash
npm run v4:db:readiness -- \
  --backup-manifest <pack>/v4-db/<manifest>.json \
  --restore-report <pack>/v4-db-restore/<report>.json \
  --out-dir "$HOME/matter-workbench-backups/v4-readiness"
```

Do not proceed unless `activationReady: true`. Readiness is read-only and may safely be rerun.

## 7. Activate last

Only now add `MWB_V4_INTAKE=1` to runtime configuration and deploy/restart beta.133. The
runtime URL uses the restricted role; `MWB_V4_AUTO_MIGRATE=0`; pool max is 16.

## 8. Verify

- Matter Workbench and Mothership active.
- `/api/v4/status` ready; panel visible.
- One real intake reaches the matter record.
- Outcome report survives browser reload.
- Connection count never exceeds 16.

## Failure drill

With V4 flagged on, provide an unreachable V4 database URL and restart in a controlled window.
Expected:

- Matter Workbench starts and legacy extraction works;
- `/api/v4/status` returns 503 with `v4.database_unavailable`;
- panel hidden;
- no background retry.

Restore the correct URL, run readiness, then restart. V4 becomes ready. Never use repeated
restarts as the readiness check.

## Evidence invalidation

Repeat backup, restore and readiness after:

- any V4 schema migration;
- database move;
- migration/runtime role posture change;
- change from the 16-connection budget;
- backup-policy change.

A routine flag-off/flag-on cycle with none of those changes may reuse current evidence.
