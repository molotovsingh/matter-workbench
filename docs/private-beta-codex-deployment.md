# Codex Private Beta Deployment Pack

Status: current operating target for private VM/cloud beta deployment

The deployment goal is:

> Use Codex to make the VM/cloud private beta deployment boring, repeatable,
> and observable. Sites becomes interesting later for public-facing or
> lightweight companion surfaces.

That means Codex is not being asked to magically host the whole legal
workbench. Codex is acting as release engineer, QA operator, and deployment
scribe for a conventional private deployment:

```text
React app + Node server
  -> private VM/cloud instance
  -> Postgres runtime DB and payload custody
  -> HTTPS reverse proxy
  -> private beta auth with operator-managed tester accounts
  -> mothership feedback and diagnostic signal sync
  -> ops/recovery/rollback evidence packs
```

## Why Not Sites For The Main App Yet

OpenAI Sites is useful for hosted sites and compatible web apps. Matter
Workbench is currently a Node + Postgres + provider-key + runtime DB custody
application with legal work-product files, OCR/provider workflows, service logs,
and private beta operational evidence.

That does not make Sites bad. It means the main app is not the right Sites
candidate today.

Good future Sites candidates:

- a public landing page;
- a first-time tester guide;
- a lightweight feedback dashboard;
- a mothership summary surface;
- an internal status page that reads already-synced summaries.

Bad current Sites candidate:

- the full Matter Workbench legal runtime.

## One Command To Create The Deployment Pack

Run:

```bash
npm run private-beta:deployment-pack
```

Useful options:

```bash
npm run private-beta:deployment-pack -- \
  --target-url https://mwb-beta.example.com \
  --deployment-host mwb-vm \
  --deployment-user aks \
  --deployment-root /home/aks/matter-workbench-deployments
```

Machine-readable output:

```bash
npm run private-beta:deployment-pack -- --json
```

The pack writes:

- `private-beta-deployment-pack.md`
- `private-beta-deployment-pack.json`

under `.local/private-beta-deployment-packs/` by default.

## What The Pack Does

The deployment pack is a Codex/operator handoff document. It combines:

- the private-web readiness result;
- the ordered command phases for source release, runtime env, artifact deploy,
  service start, HTTPS access, verification, observability, rollback, and Sites
  boundary;
- hard stop rules;
- links between the high-level deployment story and the lower-level evidence
  packs.

It does not run a deployment by itself. That is intentional. The app holds legal
matter data and provider credentials. Deployment should remain explicit,
reviewable, and reversible.

## Boring Deployment Shape

The boring shape is:

1. Prepare the source release artifact from a known commit.
2. Use `private-vm:rsync-deploy` to copy the committed app to the target
   VM/cloud host.
3. Install dependencies and build React.
4. Atomically move the `current` symlink.
5. Start or restart the user-level service.
6. Put HTTPS in front of the local service.
7. Provision named tester accounts.
8. Run the readiness and evidence packs.
9. Give the URL to testers only after blocker checks pass.

The pack writes that order every time, so operator memory is not the deployment
system.

## Repeatable VM Deploy Command

For the private Debian VM, use:

```bash
npm run private-vm:rsync-deploy -- \
  --host 172.16.37.128 \
  --user aks \
  --deployment-root /home/aks/matter-workbench-deployments
```

Preview the exact commands first:

```bash
npm run private-vm:rsync-deploy -- \
  --host 172.16.37.128 \
  --user aks \
  --deployment-root /home/aks/matter-workbench-deployments \
  --dry-run
```

The deploy helper uses `git ls-files -z` piped into `rsync`, so it syncs
tracked source files rather than local scratch files. It excludes local-only and
secret-bearing paths, builds before switching the `current` symlink, restarts
the user-level service, and runs the VM-local service check plus rendered UI
hardening pass.

It intentionally does not accept a password argument. Use SSH keys, an
interactive password prompt, or your normal SSH agent flow.

## Repeatable Deployment Shape

Repeatability comes from committed scripts:

```bash
npm run private-vm:rsync-deploy
npm run private-web:readiness-check
npm run private-vm:service-check
npm run private-vm:security-check
npm run private-vm:recoverability-pack
npm run private-vm:ops-pack
npm run private-beta:rc-closure-pack
npm run private-beta:bug-evidence-pack
```

The deployment pack ties these together in the order Codex should use when
acting as release engineer.

## Observable Deployment Shape

Observability means the beta should tell the operator what happened without
requiring testers to export anything manually.

Current surfaces:

- private beta feedback ledger and mothership sync;
- diagnostic signal ledger and mothership sync;
- job-status ledger;
- Activity receipts;
- `private-vm:ops-pack`;
- service logs through `journalctl`;
- bug evidence pack;
- RC closure pack.

The operator should be able to answer:

- what version is running;
- whether the app is in runtime DB mode;
- whether feedback and signals are syncing;
- whether jobs failed;
- whether rollback is available;
- whether backup/restore has been proved.

## Handoff Rule

Before giving a private URL to testers:

```bash
printf '%s\n' '<temporary password>' | npm run private-beta:users -- add --file ~/.config/matter-workbench/private-beta-users.json --username <tester> --password-stdin
npm run private-beta:users -- list --file ~/.config/matter-workbench/private-beta-users.json
npm run private-beta:deployment-pack
npm run private-web:readiness-check
npm run private-beta:auth-preflight -- --base-url http://127.0.0.1:4191
npm run private-beta:tester-handoff-drill -- \
  --base-url http://127.0.0.1:4191 \
  --users-file ~/.config/matter-workbench/private-beta-users.json \
  --feedback-ledger ~/.local/share/matter-workbench/private-beta-feedback-ledger.json
npm run private-beta:rc-closure-pack
```

Account file changes are picked up on the next login attempt. Restart the
service only when changing runtime environment variables such as the account
file path itself.

The tester handoff drill is intentionally temporary. It creates a disposable
tester, proves the access and feedback path, writes an evidence pack, then
restores the account file and feedback ledger. It is the quick spot-check proof
that a URL and account file are usable.

The auth preflight proves that the configured operator credentials in
`runtime.env` can actually log in against the live service. If it fails after
changing credentials, update the protected account file with
`private-beta:users -- set-password`. The RC closure pack now runs both the
operator auth preflight and the tester handoff drill as required gates. Use the
standalone commands for spot checks; use `private-beta:rc-closure-pack` when
deciding whether the checkpoint is ready to hand to testers.

If any hard blocker appears, do not hand out the URL.

This is stricter than local testing because a URL creates a different social
contract. A local app can be experimental. A URL given to lawyers must be
boring, repeatable, and observable.
