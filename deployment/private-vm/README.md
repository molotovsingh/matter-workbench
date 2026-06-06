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
The operator must back up the database. When running the shadow backup tools:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run db:shadow:backup -- --out-dir "$HOME/matter-workbench-backups/db"
```

Run the restore drill whenever the database role and `pg_hba.conf` allow a
temporary restore database:

```bash
npm run db:shadow:restore-drill -- --backup "$HOME/matter-workbench-backups/db/<backup>.sql" --out-dir "$HOME/matter-workbench-backups/restore-drills"
```

