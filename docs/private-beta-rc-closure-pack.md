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

It writes:

- `private-beta-rc-closure-pack.md`
- `private-beta-rc-closure-pack.json`

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
