# Private Beta RC Closure Pack

Status: private beta release-candidate closeout evidence

Run:

```bash
npm run private-beta:rc-closure-pack
```

Useful options:

```bash
npm run private-beta:rc-closure-pack -- --base-url http://172.16.37.128:4191
npm run private-beta:rc-closure-pack -- --out-dir .local/private-beta-rc-closure-packs
npm run private-beta:rc-closure-pack -- --runtime-browser-evidence-json /path/to/runtime-db-browser-acceptance-pack.json
npm run private-beta:rc-closure-pack -- --git-branch codex/matter-workbench-checkpoint-2026-05-17 --git-commit <release-commit>
```

The pack answers one release question:

> Is the current Matter Workbench checkpoint ready to be treated as a private
> beta release candidate, with evidence across local verification, runtime DB
> browser behavior, private VM health, operator posture, and recovery?

## What It Runs

The closure pack aggregates existing acceptance packs instead of duplicating
their internals:

- local verification: `ui:typecheck`, `ui:build`, and `npm test`;
- runtime DB browser acceptance;
- private VM service smoke;
- private VM ops pack;
- private VM security/access check;
- private VM recoverability pack.

The runtime that runs this command must have Playwright and a Chrome/Chromium
binary available. Playwright is a project dev dependency, so a clean deployment
installed with `npm ci` has the Node package. On the Debian VM, install or keep
`chromium` available and set `MWB_PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`
if auto-detection ever fails. If browser tooling is unavailable on the VM, run
`npm run db:runtime:browser-accept` from a machine that can reach the app, copy
the resulting JSON to the VM, then pass it with `--runtime-browser-evidence-json`.
The closure pack will treat that JSON as the browser-acceptance evidence instead
of weakening the run with a skipped browser gate.

It writes:

- `private-beta-rc-closure-pack.md`
- `private-beta-rc-closure-pack.json`

If the VM deployment is a clean source artifact rather than a git checkout,
pass `--git-branch` and `--git-commit` from the Mac checkout that produced the
artifact. That records the release identity without requiring `.git` inside the
private runtime directory.

When the runtime uses `MWB_RUNTIME_DB_STORAGE=postgres`, the recoverability pack
marks local filesystem storage backup as not applicable unless `--matters-home`
is explicitly provided. In that mode the database restore drill is the storage
payload recovery proof.

## What A Pass Means

A useful pass means:

- the current commit and branch were recorded;
- local code and React build gates passed;
- runtime DB mode rendered through a real browser path;
- the private VM service responded and exposed DB-backed matter data;
- operator logs, deployment state, rollback candidate, and disk posture were
  captured;
- private access/security posture was checked;
- database and local storage recovery were checked together.

## What It Does Not Prove

The pack does not:

- make the app public-cloud ready;
- add HTTPS or hosted auth;
- replace lawyer review;
- prove perfect OCR or perfect legal output;
- run paid AI preparation stages by itself;
- replace a future hosted worker/object-storage architecture.

It is a private beta release-candidate evidence bundle. It proves that the
current local/private architecture is coherent enough for supervised beta use.

## Operator Meaning

Treat a failed closure pack as a release blocker until the failed section is
understood. The JSON file is the best artifact to attach to a bug report. The
Markdown file is the best artifact to read during release review.

The pack redacts common secret shapes, including API keys and PostgreSQL
passwords, but operators should still avoid sharing generated evidence outside
the trusted beta circle without checking it first.

## Checked-In VM Closure Evidence

The checked-in 2026-06-07 VM run for commit `a24d4cc`, tagged as
`v1.0.0-beta.10`, passed all closure gates:

- local verification;
- runtime DB browser acceptance;
- private VM service smoke;
- private VM ops pack;
- private VM security/access check;
- private VM recoverability pack.

Current beta.10 evidence:

- [2026-06-07 beta.10 RC closure Markdown](private-beta-rc-closure-packs/private-beta-rc-closure-pack-2026-06-07T15-50-41-147Z.md)
- [2026-06-07 beta.10 RC closure JSON](private-beta-rc-closure-packs/private-beta-rc-closure-pack-2026-06-07T15-50-41-147Z.json)

Older representative evidence remains available in
`docs/private-beta-rc-closure-packs/`, but the beta.10 pack is the current
release reference.

## Latest Live VM Post-Beta.10 Closure

The live private VM was later advanced to commit `131bb83` for private-beta
operator/auth hardening after the `v1.0.0-beta.10` tag. That deployment was
closed separately as `v1.0.0-beta.10+131bb83` and passed all closure gates:

- local verification;
- runtime DB browser acceptance;
- private VM service smoke;
- private VM ops pack;
- private VM security/access check;
- private VM recoverability pack.

Latest live VM evidence:

- [2026-06-07 beta.10+131bb83 RC closure Markdown](private-beta-rc-closure-packs/private-beta-rc-closure-pack-2026-06-07T16-24-29-328Z.md)
- [2026-06-07 beta.10+131bb83 RC closure JSON](private-beta-rc-closure-packs/private-beta-rc-closure-pack-2026-06-07T16-24-29-328Z.json)
