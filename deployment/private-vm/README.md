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
MWB_PRIVATE_BETA_AUTH=required
MWB_PRIVATE_BETA_USERS_FILE=/home/aks/.config/matter-workbench/private-beta-users.json
MWB_PRIVATE_BETA_SESSION_TTL_SECONDS=28800
```

Do not commit `runtime.env`.

## Install Or Refresh

From the deployed app directory:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm run ui:build --silent
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/matter-workbench"
cp deployment/private-vm/matter-workbench-runtime.service "$HOME/.config/systemd/user/"
ln -sfn "$PWD/.." "$HOME/matter-workbench-deployments/current"
chmod 600 "$HOME/.config/matter-workbench/runtime.env"
systemctl --user daemon-reload
systemctl --user enable --now matter-workbench-runtime.service
```

`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` keeps deployment installs small. The RC
closure and runtime browser acceptance packs still require a system
Chrome/Chromium binary. On Debian, keep `chromium` installed or set
`MWB_PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` in `runtime.env`.

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

## Ops, Bug Evidence, And Incident Bundles

For release-candidate closeout, run the aggregate RC closure pack from the VM:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-beta:rc-closure-pack -- \
  --base-url http://127.0.0.1:4191 \
  --out-dir "$HOME/matter-workbench-backups/rc-closure" \
  --deployment-root "$HOME/matter-workbench-deployments" \
  --runtime-env "$HOME/.config/matter-workbench/runtime.env" \
  --git-branch <release branch> \
  --git-commit <release commit>
```

Use this before widening tester access. It joins local verification, runtime DB
browser acceptance, service health, ops evidence, security posture, and
recoverability into one release verdict.

For routine beta operation, create a lightweight ops pack:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-vm:ops-pack -- \
  --base-url http://127.0.0.1:4191 \
  --out-dir "$HOME/matter-workbench-backups/ops-packs"
```

The ops pack writes:

- `ops-pack.md` - readable operator summary;
- `ops-pack.json` - redacted machine-readable evidence;
- `rollback-plan.sh` - a generated rollback script for the previous deployment
  candidate.

Use the ops pack when you need a quick picture of service health, current
deployment, rollback candidate, disk/memory posture, and recent service logs.
It does not back up the database and it does not perform rollback by itself.
Review `rollback-plan.sh` before running it. When private-beta auth is enabled,
the generated rollback script does not store credentials; export
`MWB_PRIVATE_BETA_USERNAME` and `MWB_PRIVATE_BETA_PASSWORD` in the shell before
running the script so its final service check can log in.

When a private beta tester reports a specific bug, create a bug evidence pack
instead of sending scattered screenshots and terminal scrollback:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-beta:bug-evidence-pack -- \
  --base-url http://127.0.0.1:4191 \
  --out-dir "$HOME/matter-workbench-backups/bug-evidence" \
  --matter "Matter Name" \
  --note "Short description of what the tester saw"
```

The bug evidence pack writes a redacted Markdown/JSON handoff and nests an ops
pack inside it. It captures service smoke, runtime DB posture, current
deployment, rollback candidate, and recent command-panel interactions. It does
not attach raw matter documents or `.env` files.

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

If `MWB_PRIVATE_BETA_AUTH=required`, the service and security checks read
`MWB_PRIVATE_BETA_USERNAME` and `MWB_PRIVATE_BETA_PASSWORD` from the shell/env
and log in before checking product APIs. These values may be supplied only for
the operator command being run; they do not need to live in `runtime.env`.

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
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-vm:service-check -- --base-url http://127.0.0.1:4191
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke -- --out-dir /tmp/mwb-vm-runtime-write-smoke
```

From the Mac:

```bash
curl -sS -o /tmp/mwb-vm-root.html -w '%{http_code} %{size_download}\n' http://172.16.37.128:4191/
MWB_PRIVATE_BETA_USERNAME=<operator username> MWB_PRIVATE_BETA_PASSWORD=<operator password> \
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

Use `private-vm:ops-pack` for daily health, incident capture, and rollback
planning. Use `private-vm:recoverability-pack` when proving that backup and
restore actually work.

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
