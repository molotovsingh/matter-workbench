# Private VM Service Pack

Status: service template for the private Debian VM beta

This folder contains the operator template for running Matter Workbench as a
user-level `systemd` service on the private Debian VM.

## Layout

Expected VM layout:

```text
/home/aks/matter-workbench-deployments/<commit>/app
/home/aks/matter-workbench-deployments/current -> /home/aks/matter-workbench-deployments/<commit>
/home/aks/.config/matter-workbench/runtime.env
/home/aks/.config/systemd/user/matter-workbench-runtime.service
```

`runtime.env` must be mode `0600`. It should contain only deployment/runtime
environment values, including:

```text
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
MWB_RUNTIME_DATABASE_URL=<redacted runtime role URL>
MWB_DATABASE_URL=<redacted admin or backup-capable URL, if needed for operator scripts>
```

Do not commit `runtime.env`.

## Install Or Refresh

From the deployed app directory:

```bash
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/matter-workbench"
cp deployment/private-vm/matter-workbench-runtime.service "$HOME/.config/systemd/user/"
ln -sfn "$PWD/.." "$HOME/matter-workbench-deployments/current"
chmod 600 "$HOME/.config/matter-workbench/runtime.env"
systemctl --user daemon-reload
systemctl --user enable --now matter-workbench-runtime.service
```

To start the user service after VM reboot before an interactive login, enable
linger once:

```bash
sudo loginctl enable-linger "$USER"
```

## Operator Commands

```bash
systemctl --user status matter-workbench-runtime.service --no-pager
systemctl --user restart matter-workbench-runtime.service
systemctl --user stop matter-workbench-runtime.service
journalctl --user -u matter-workbench-runtime.service -n 80 --no-pager
```

## Access And Security Check

Do not expose this service to the public internet. This private VM pack assumes
a trusted private network or local tunnel. Public access still requires a
separate hosted security design: authentication, HTTPS, session controls,
provider-token handling, rate limiting, logging policy, and object-storage
custody.

From the VM, run:

```bash
npm audit --omit=dev --json > /tmp/mwb-npm-audit-prod.json
npm run private-vm:security-check -- \
  --base-url http://127.0.0.1:4191 \
  --runtime-env "$HOME/.config/matter-workbench/runtime.env" \
  --audit-json /tmp/mwb-npm-audit-prod.json \
  --audit-disposition docs/security/npm-audit-disposition.md
```

From the Mac, use the VM URL but skip the VM-local runtime env file check:

```bash
curl -sS -o /tmp/mwb-vm-root.html -w '%{http_code} %{size_download}\n' http://172.16.37.128:4191/
npm run private-vm:security-check -- \
  --base-url http://172.16.37.128:4191 \
  --skip-runtime-env \
  --skip-service-check
```

The security check verifies:

- the service URL is loopback or RFC1918 private-network only;
- `runtime.env` is a regular file with mode `0600` when checked on the VM;
- the systemd template uses `EnvironmentFile`, restart policy, and basic
  process hardening;
- runtime DB least privilege is proved by `npm run db:runtime:write-smoke`,
  which rejects superuser and `BYPASSRLS` runtime roles;
- the live service check passes unless explicitly skipped;
- npm audit JSON has no high or critical production vulnerabilities, or else
  records a clear disposition requirement.

Current audit disposition: `xlsx@0.18.5` has high advisories with no direct npm
fix available. The disposition is documented in
`docs/security/npm-audit-disposition.md` for private beta only. Revisit before
public or wider hosted access.

If any VM password, database URL, or provider key has been shared in chat,
terminal history, screenshots, or handoff notes, rotate it before expanding
access beyond the current trusted operator.

## Smoke Commands

From the VM:

```bash
npm run private-vm:service-check -- --base-url http://127.0.0.1:4191
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke -- --out-dir /tmp/mwb-vm-runtime-write-smoke
```

From the Mac:

```bash
curl -sS -o /tmp/mwb-vm-root.html -w '%{http_code} %{size_download}\n' http://172.16.37.128:4191/
npm run private-vm:service-check -- --base-url http://172.16.37.128:4191
```

## Backup Boundary

For the private VM, Postgres is the runtime custody source in DB storage mode.
The operator must back up the database. If storage rows still point at local
filesystem paths, the matching file bytes must be backed up too. A DB-only
backup can restore valid rows that point at missing PDFs.

The preferred one-command operator check is:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-vm:recoverability-pack -- --base-url http://127.0.0.1:4191 --out-dir "$HOME/matter-workbench-backups/recoverability"
```

That command creates:

- a database backup;
- a restored-database drill using DB-only summary verification;
- a storage backup for local PDF storage objects;
- a storage restore/hash check;
- a live private-VM service check.

The output folder contains `recoverability-pack.md` and
`recoverability-pack.json`. Treat those files as the operator evidence bundle
for a private VM recovery pass.

The lower-level commands remain useful for focused debugging. When running the
shadow backup tools:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run db:shadow:backup -- --out-dir "$HOME/matter-workbench-backups/db"
```

Run the restore drill whenever the database role and `pg_hba.conf` allow a
temporary restore database:

```bash
npm run db:shadow:restore-drill -- --backup "$HOME/matter-workbench-backups/db/<backup>.sql" --verify-mode sql-summary --out-dir "$HOME/matter-workbench-backups/restore-drills"
```

Use `--verify-mode report` only when running the restore drill on the same
source host that still has the original matter folder tree. The default report
mode compares restored DB rows against local folders. The private VM
recoverability pack uses `--verify-mode sql-summary` so a restored DB can be
proved without requiring the source matter folders to exist.

On the first service-pack rehearsal, the SQL restore itself succeeded but the
old report verification phase failed because `db:hydrate:verify` expects the
original source matter folder tree at `/home/aks/matters-matter-workbench`.
That was a source-host verifier limit, not a SQL restore failure.
