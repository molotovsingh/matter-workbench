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
/home/aks/.config/matter-workbench/mothership.env
/home/aks/.config/systemd/user/matter-workbench-runtime.service
/home/aks/.config/systemd/user/matter-workbench-mothership.service
```

Before creating a new cloud target, start from the repository template
`public-deployment.env.example`. Keep the filled copy outside git, for example
`~/.config/matter-workbench/digitalocean-deployment.env`. The template splits
deployment values into values we decide/control and values supplied by the cloud,
DNS, database, model, and OCR vendors.

`runtime.env` must be mode `0600`. It should contain only deployment/runtime
environment values, including:

```text
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
MWB_MIGRATION_DATABASE_URL=<redacted migration-capable URL, optional if runtime URL can migrate>
MWB_RUNTIME_DATABASE_URL=<redacted runtime role URL>
MWB_DATABASE_URL=<redacted operator or backup URL, optional>
MWB_PRIVATE_BETA_AUTH=required
MWB_PRIVATE_BETA_USERS_FILE=/home/aks/.config/matter-workbench/private-beta-users.json
MWB_PRIVATE_BETA_FEEDBACK_PATH=/home/aks/.local/share/matter-workbench/private-beta-feedback-ledger.json
MWB_PRIVATE_BETA_SIGNAL_PATH=/home/aks/.local/share/matter-workbench/private-beta-signal-ledger.json
MWB_PRIVATE_BETA_METRICS_PATH=/home/aks/.local/share/matter-workbench/private-beta-metrics-ledger.json
MWB_PRIVATE_BETA_SESSION_TTL_SECONDS=28800
MWB_PRIVATE_BETA_USERNAME=<dedicated smoke-test username>
MWB_PRIVATE_BETA_PASSWORD=<dedicated smoke-test password>
MWB_RESTORE_DRILL_STATUS=unknown
MWB_STORAGE_BACKUP_STATUS=unknown
```

Do not commit `runtime.env`.

The smoke-test username/password are for VM-local deploy verification only.
Store them only in the mode-`0600` VM `runtime.env`, or pass the password through
stdin for one-off checks. Do not pass passwords as command-line arguments.

`mothership.env` is a separate mode-`0600` file for the operator-only feedback
receiver. It contains `MOTHERSHIP_DATABASE_URL` plus the loopback host/port.
Start from `deployment/private-vm/mothership.env.example`, but never copy a real
database URL into the repository.

Provision the mothership once with a separate PostgreSQL database and a
non-superuser login role that owns only that database. Then write
`$HOME/.config/matter-workbench/mothership.env` and apply its independent
migrations:

```bash
npm run mothership:migrate
npm run mothership:operator -- installations create \
  --id <stable-installation-id> \
  --label "<operator-readable label>"
```

The installation command prints the ingestion token once. Put it in
`runtime.env` as the feedback, signal, and metrics sync token, with loopback
URLs ending in `/v1/feedback`, `/v1/signals`, and `/v1/metrics`. Do not pass
the token through a command argument or commit it. Restart both user services
after changing the environment files.

Keep feedback, signal, and metrics ledgers outside the deployment directory. If
those paths are left at their app-default `.local/` locations, a new deployment
can make tester feedback or operator metrics look empty because the service
starts reading from the new commit folder.

## Install Or Refresh

### Repeatable rsync deploy from the Mac

Now that the VM has `rsync`, prefer the committed deploy helper instead of the
older tarball/scp workaround:

```bash
npm run private-vm:rsync-deploy -- \
  --host 172.16.37.128 \
  --user aks \
  --deployment-root /home/aks/matter-workbench-deployments
```

For a command preview without touching the VM:

```bash
npm run private-vm:rsync-deploy -- \
  --host 172.16.37.128 \
  --user aks \
  --deployment-root /home/aks/matter-workbench-deployments \
  --dry-run
```

The helper deploys the current committed `HEAD` into
`$deploymentRoot/<commit>/app`. It pipes `git ls-files -z` into `rsync`, so
untracked local scratch files are not deployed. It also excludes local-only
folders such as `node_modules/`, `.local/`, `codex_review/`,
and `.env*`.

Before mutating the release directory, it checks the VM has `rsync`, `node`,
`npm`, user-level `systemd`, a readable
`$HOME/.config/matter-workbench/runtime.env`, and a writable deployment root.
It also refuses to clean a release directory that is already the target of the
`current` symlink; deploy a new commit or move `current` first instead of
reusing the active release path.
Only then does it build React, apply runtime database migrations when
`MWB_RUNTIME_DB=postgres` or `MWB_RUNTIME_DB_STORAGE=postgres`, switch the
`current` symlink, restart the user-level service, and run the VM-local service
check plus rendered UI hardening pass. Runtime-DB deployment fails before
activation if no migration-capable URL is available. The deploy helper checks
`MWB_MIGRATION_DATABASE_URL`, then `MWB_RUNTIME_DATABASE_URL`, then
`MWB_DATABASE_URL`, then `DATABASE_URL`, and passes the selected value to the
migration runner without printing it.

The deploy also installs `matter-workbench-mothership.service`. If
`$HOME/.config/matter-workbench/mothership.env` exists, it restarts the
mothership and verifies `http://127.0.0.1:4192/health`. If that environment file
does not exist, the mothership step is explicitly skipped and the ordinary
Workbench deployment continues unchanged. Secrets are never synced from the
Mac.

It does not accept password arguments. Use SSH keys, an interactive SSH
session, or your normal SSH agent flow. Tracked uncommitted changes are rejected
unless you explicitly pass `--allow-dirty`.

### Explicit rollback to a previous release

Use rollback only when you have identified the previous release to restore.
The command requires the target release name; it does not guess.

```bash
npm run private-vm:rollback -- \
  --host 172.16.37.128 \
  --user aks \
  --deployment-root /home/aks/matter-workbench-deployments \
  --to <previous-commit>
```

Preview the rollback commands without touching the VM:

```bash
npm run private-vm:rollback -- \
  --host 172.16.37.128 \
  --user aks \
  --deployment-root /home/aks/matter-workbench-deployments \
  --to <previous-commit> \
  --dry-run
```

Rollback first checks the target release exists and has an app directory, checks
the VM user service/runtime env posture, then switches the `current` symlink,
restarts the user-level service, and runs the VM-local service check plus
rendered UI hardening pass from the restored release. It does not accept
password arguments.

### Manual refresh from inside a deployed app directory

From the deployed app directory:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm run ui:build --silent
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/matter-workbench"
cp deployment/private-vm/matter-workbench-runtime.service "$HOME/.config/systemd/user/"
cp deployment/private-vm/matter-workbench-mothership.service "$HOME/.config/systemd/user/"
ln -sfn "$PWD/.." "$HOME/matter-workbench-deployments/current"
chmod 600 "$HOME/.config/matter-workbench/runtime.env"
systemctl --user daemon-reload
systemctl --user enable --now matter-workbench-runtime.service
# After provisioning mothership.env and its database:
systemctl --user enable --now matter-workbench-mothership.service
```

`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` keeps deployment installs small. The RC
closure and runtime browser acceptance packs still require a system
Chrome/Chromium binary. On Debian, keep `chromium` installed or set
`MWB_PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` in `runtime.env`.

### Upload batch limit

The private VM runtime defaults `MWB_MAX_UPLOAD_BYTES` to `100663296`
bytes, which is 96 MiB. This is a safety guard for the current DB-backed upload
path: very large browser uploads can otherwise force the Node process to hold
too many bytes in memory while persisting the intake, which can trigger an OOM
restart and surface to the tester as a 502.

Keep the default unless the VM size and upload architecture have been reviewed.
If a tester hits the limit, ask them to create the matter with a smaller first
batch and then use Add Files in batches. The long-term solution for very large
intakes is streaming/direct object storage plus background import jobs, not a
larger HTTP body limit.

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
systemctl --user status matter-workbench-mothership.service --no-pager
systemctl --user restart matter-workbench-mothership.service
journalctl --user -u matter-workbench-mothership.service -n 80 --no-pager
```

The mothership is an operator surface, not a tester UI. Use
`npm run mothership:operator -- health` and `npm run mothership:report` from the
deployed app directory. These commands automatically load the standard VM
`mothership.env` file when explicit shell env vars are absent. The report is the
intake surface Codex can use to triage repeated errors, tester bugs, confusing
UX, and feature ideas against the current repository and runtime evidence.

For a boring, repeatable first pass on a specific complaint, use the canned
read-only investigation bundle instead of hand-assembling SQL:

```bash
npm run mothership:investigate -- \
  --user shivangi \
  --matter "National Insurance" \
  --since-hours 72
```

The investigation bundle reads the same mothership store once and reports the
matching feedback, nearby signals, nearby heartbeat journeys, latest matter
health, and open-feedback counts. Use `--format json` when another tool should
consume the result.

The same report also carries deployment/backend metrics:

- **Backend Suitability** asks whether the current VM is still good enough for
  beta traffic.
- **Deployment Portability** asks whether the app can be moved to another VM or
  provider without heroic manual recovery.
- **Restore Confidence** is deliberately strict; it should stay low until a
  real Postgres + file-storage restore drill passes.
- **User Patience Risk** watches latency and silent waits. Slow legal work is
  tolerable when the app visibly progresses; silent waiting is what makes beta
  testers think the app is stuck.

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
deployment, rollback candidate, user-facing readiness, disk/memory posture, and
recent service logs. The service check also probes `/api/user-readiness` and
flags restricted technical-language leaks in tester-facing readiness copy. It
does not back up the database and it does not perform rollback by itself.
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

Do not expose the Node runtime directly to the public internet. The private VM
pack supports either a trusted private-network URL or a public HTTPS beta URL
fronted by nginx, but the public path must require private-beta login and Secure
cookies. The runtime service itself should bind to `127.0.0.1:4191` behind the
HTTPS proxy.

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
the operator command being run; the deploy smoke path usually keeps a dedicated
smoke account in the protected VM `runtime.env`.

From the Mac, use the VM URL but skip the VM-local runtime env file check:

```bash
curl -sS -o /tmp/mwb-vm-root.html -w '%{http_code} %{size_download}\n' http://172.16.37.128:4191/
npm run private-vm:security-check -- \
  --base-url http://172.16.37.128:4191 \
  --skip-runtime-env \
  --skip-service-check
```

The security check verifies:

- the service URL is either loopback/RFC1918 private-network, or public HTTPS
  with required private-beta auth and Secure cookies configured;
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
export MWB_PRIVATE_BETA_USERNAME=<operator username>
read -rsp "Private beta password: " MWB_PRIVATE_BETA_PASSWORD; echo
npm run private-vm:service-check -- \
  --base-url http://172.16.37.128:4191 \
  --auth-username "$MWB_PRIVATE_BETA_USERNAME" \
  --auth-password-stdin <<< "$MWB_PRIVATE_BETA_PASSWORD"
unset MWB_PRIVATE_BETA_PASSWORD
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
