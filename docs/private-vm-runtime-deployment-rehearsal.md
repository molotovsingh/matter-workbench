# Private VM Runtime Deployment Rehearsal

Date: 2026-06-06

Status: private Debian VM runtime rehearsal passed; service-pack hardening added afterward

This note records the first private-machine deployment rehearsal after the
local/private runtime DB cutover. The purpose was not to create a public hosted
deployment. It was to prove that the current React beta can run from a Debian VM
against a Postgres runtime database, be reached from the Mac over the VM network,
serve DB-backed matter payloads, and perform a controlled runtime DB write.

## Environment

The rehearsal used the VM at:

```text
host: debian
ip: 172.16.37.128
deploy path: /home/aks/matter-workbench-deployments/12d8cd7/app
app url from Mac: http://172.16.37.128:4191/
code checkpoint: 12d8cd7
```

Runtime versions on the VM:

```text
node: v22.22.2
npm: 11.16.0
git: 2.47.3
psql: 17.10
```

The app was started in explicit runtime DB mode:

```text
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
```

Database URLs were loaded from the VM-local `.env.shadow`. That file contains
secrets and must not be committed, printed, or copied into bug reports.

## Build And Startup

The release tarball for checkpoint `12d8cd7` was copied to the VM, installed,
and built:

```text
npm ci
npm run ui:build --silent
```

The app was then started with a VM-local runtime helper:

```text
nohup node start-runtime-vm.mjs > /tmp/mwb-vm-runtime.log 2>&1 &
```

The process was alive during the rehearsal:

```text
pid: 38683
listener: 0.0.0.0:4191
vm-local health: HTTP 200
```

At this checkpoint the app was not yet installed as a persistent service.
User-level `systemd` was available on the VM, but no service file or linger
setting had been installed in that slice. The follow-up service pack adds a
committed user-service template and service-check script; see
[Private VM Service Pack](../deployment/private-vm/README.md).

## Mac-To-VM Reachability

From the Mac, the VM app returned:

```text
GET http://172.16.37.128:4191/ -> 200
GET http://172.16.37.128:4191/api/matters -> 15 matters
```

`/api/matters` returned DB-backed matters with `enabled: true` and
`mattersHome: null`, confirming that the served matter list was not coming from
a live Mac or VM matter-folder root.

## Rendered React UI Checks

The in-app browser loaded the React shell at `http://172.16.37.128:4191/` with
title `Matter Workbench`.

The browser checks covered:

- active matter overview for `Atlas Constuction vs Diptishree`;
- Matter Preparation card and advisory;
- Activity page, including missing-output receipts;
- Settings page;
- Skills page, including the first-time skills explanation;
- Copilot model selector presence;
- DB-custody status text for Source Labels and List of Dates.

The browser console had no relevant `error` or `warn` entries during those
checks.

The Settings page showed configuration issues on the VM. That is expected for
this private rehearsal because the VM runtime env was set up for database
serving, not for carrying the full Mac-local AI provider configuration.

## Payload Read Checks

The VM app served DB-backed workspace and file payloads:

```text
GET /api/workspace?matterName=Atlas%20Constuction%20vs%20Diptishree
```

returned a workspace tree containing extracted JSON and original PDF payload
entries.

Text preview worked:

```text
path: 00_Inbox/Intake 01 - 2026-05-17 Initial/_extracted/FILE-0002.json
textLength: 59568
preview: {"schema_version":"extraction-record/v1", ...}
```

Raw PDF streaming worked:

```text
path: 00_Inbox/Intake 01 - 2026-05-17 Initial/By Type/PDFs/FILE-0001__dg1.pdf
content-type: application/pdf
content-length: 304304
magic: %PDF-
```

That is the important storage proof: the VM app can serve both preview text and
raw legal-file bytes from runtime DB payload custody.

## Controlled Runtime Write Check

The runtime write smoke was run from inside the VM deployment directory:

```text
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke --silent -- --out-dir /tmp/mwb-vm-runtime-write-smoke
```

Result:

```text
passed: yes
role_guard_passed: yes
upload_created: yes
workspace_readable: yes
file_preview_readable: yes
raw_file_readable: yes
db_rows_verified: yes
rollback_verified: yes
cleanup_deleted: yes
```

The smoke created a disposable DB-backed matter, read it through the runtime
app, verified database rows and payload custody, proved rollback behavior, and
deleted the disposable matter afterward.

VM-local reports were written outside the repository:

```text
/tmp/mwb-vm-runtime-write-smoke/runtime-db-write-smoke-2026-06-06T09-43-14-334Z.json
/tmp/mwb-vm-runtime-write-smoke/runtime-db-write-smoke-2026-06-06T09-43-14-334Z.md
```

## Shadow Verifier Limit Found

The VM runtime cutover stop-check did not pass:

```text
shadow_evidence_accepted: no
verify_success: no
failed_verify_step: db:hydrate:verify
runtime_cutover_blockers:
  shadow_database_not_accepted
  object_storage_or_single_host_volume_policy
  pdf_storage_backup_restore_policy
```

The immediate underlying error was:

```text
ENOENT: no such file or directory, scandir '/home/aks/matters-matter-workbench'
```

This is a verification-tool limitation in this deployment shape. The VM has the
runtime DB payloads, but it does not have the original local matter-folder tree
that `db:hydrate:verify` compares against. Therefore, the old shadow verifier is
still source-host dependent. It is useful for checking a hydration mirror on the
machine that owns the source folders; it is not the right proof that the VM app
can serve runtime DB payloads after those folders are absent.

The product-serving proof for this rehearsal is the combination of:

- Mac-to-VM app reachability;
- rendered React UI checks;
- DB-backed matter list with `mattersHome: null`;
- workspace/file preview/raw payload reads;
- runtime write smoke with rollback and cleanup.

## Security And Operations Limits

This rehearsal is private-network only.

It does not yet provide:

- public HTTPS;
- user authentication;
- reverse proxy hardening;
- persistent service installation;
- automatic restart after reboot;
- cloud object storage;
- cloud backup/restore automation;
- hosted worker recovery;
- production observability.

The `npm ci` run also reported one high-severity npm audit item. That was not
investigated in this slice because the goal was runtime deployment proof, but it
should be handled before any internet-exposed deployment claim.

## Resulting Claim

Matter Workbench can now be described as having a successful private Debian VM
runtime DB rehearsal: the React app runs on the VM, is reachable from the Mac
over the VM IP, serves matter/file payloads from Postgres runtime custody, and
passes a controlled runtime DB write smoke from inside the VM.

It should not yet be described as a production cloud deployment or a
restart-proof service deployment.

## Follow-Up Service Pack

The follow-up private VM service pack adds:

- `scripts/start-runtime-server.mjs` for the runtime DB server entrypoint;
- `scripts/private-vm-service-check.mjs` for checking an already running VM app;
- `deployment/private-vm/matter-workbench-runtime.service` for user-level
  `systemd`;
- `deployment/private-vm/README.md` for install, status, logs, smoke, and backup
  commands.

Once installed, the VM claim can move from "works under `nohup`" to "runs as a
private user-level service." It is still not a public production deployment
until HTTPS, auth, backups, and hosted-worker recovery are complete.

## Service Pack Evidence

The service-pack checkpoint was installed on the VM from commit `aff9fea`:

```text
deploy path: /home/aks/matter-workbench-deployments/aff9fea/app
current symlink: /home/aks/matter-workbench-deployments/current -> /home/aks/matter-workbench-deployments/aff9fea
service unit: /home/aks/.config/systemd/user/matter-workbench-runtime.service
runtime env: /home/aks/.config/matter-workbench/runtime.env
runtime env mode: 0600
linger: yes
```

User-level `systemd` reported:

```text
is-active: active
is-enabled: enabled
ActiveState: active
SubState: running
```

VM-local service check:

```text
npm run private-vm:service-check -- --base-url http://127.0.0.1:4191
passed: yes
runtime_db_enabled: yes
matters_home: null
matter_count: 15
workspace_readable: yes
file_preview_readable: yes
```

Mac-to-VM service check:

```text
GET http://172.16.37.128:4191/ -> 200
npm run private-vm:service-check -- --base-url http://172.16.37.128:4191
passed: yes
runtime_db_enabled: yes
matters_home: null
matter_count: 15
workspace_readable: yes
file_preview_readable: yes
```

The in-app browser reloaded `http://172.16.37.128:4191/` after the service
install, showed the React Home screen with 15 matters, and had no relevant
console warnings or errors.

The controlled runtime write smoke also passed from the service-pack deployment:

```text
test_run_id: runtime-db-write-smoke-2026-06-06T13-03-38-908Z
passed: yes
role_guard_passed: yes
upload_created: yes
workspace_readable: yes
file_preview_readable: yes
raw_file_readable: yes
db_rows_verified: yes
rollback_verified: yes
cleanup_deleted: yes
```

Database backup succeeded:

```text
backup: /home/aks/matter-workbench-backups/db/shadow-db-backup-2026-06-06T13-03-39-182Z.sql
bytes: 513494035
sha256: 0981a33b9290f9e0f3d2d14d6693f7e043c49a5e8f427c922ffa82549fe1683e
```

Restore drill status:

```text
create restore database: ok
restore backup: ok
verify restored database: failed
drop restore database: ok
failed_step: verify restored database
reason: ENOENT: no such file or directory, scandir '/home/aks/matters-matter-workbench'
```

The restore drill proved that the SQL backup can be restored into a temporary
database and cleaned up. Its verification phase still uses the old source-folder
shadow verifier, so it fails on the VM for the same known reason described
above: the VM runtime is DB-payload-backed and does not have the original matter
folder tree.
