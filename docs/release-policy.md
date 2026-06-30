# Matter Workbench Release Policy

Status: Current release authority

This policy keeps supervised private beta releases boring without making every
safe internal change pay the full official-release ceremony. The core rule is:
**always make the exact deployed code knowable, but only promote a build to a
new official tester release when the change warrants it.**

## North Star

Every change should answer the right version of these questions without
guesswork:

1. What exact code is running, if anything was deployed?
2. Is that code an official tester release, a maintenance checkpoint, or an
   unreleased main-only change?
3. What evidence says it is fit for its scope?
4. Where should the next operator or agent look before changing it?

If an artifact cannot answer the questions for its tier, the release or deploy
is not done.

## Release / Deployment Tiers

### Tier 1 — Official Tester Release

Use this tier when the change affects what supervised testers are expected to
use, validate, or rely on.

Examples:

- user-visible behavior, labels, copy, workflows, or generated legal output;
- legal output contracts, schemas, prompt semantics, or fallback behavior;
- runtime DB migrations, storage/custody/auth/upload/preparation behavior;
- error-boundary or safety behavior;
- new deployment posture, rollback target, or beta handoff state;
- any change that should be named in the tester/operator release history.

Requirements:

- annotated tag `v1.0.0-beta.N`;
- release note `docs/releases/v1.0.0-beta.N.md`;
- VM/cloud deploy when the release is live;
- current-release pointer updates;
- `npm run release:position-check -- --release v1.0.0-beta.N` passes;
- validation evidence appropriate to the change.

This is the only tier that changes the **current official supervised beta
release**.

### Tier 2 — Deployed Maintenance Checkpoint

Use this tier for behavior-preserving refactors or operational/tooling changes
that are deployed to the beta VM but should not create a new official tester
release.

Allowed only when all of these are true:

- no intended user-facing behavior change;
- no generated legal-output contract change;
- no migration or custody/auth/upload/preparation semantic change;
- no new tester instruction or handoff claim;
- rollback to the current official beta tag remains valid;
- the deploy is useful enough to justify VM churn now instead of batching later.

Requirements:

- deploy by immutable commit hash;
- stamp `/api/config` with the deployed commit;
- keep `MWB_RELEASE_VERSION` on the current official beta version, or use an
  unambiguous maintenance suffix such as `v1.0.0-beta.N+maint.<shortsha>` if the
  operator wants the title bar to show that this is not the tagged beta commit;
- record a short entry in
  [`docs/releases/maintenance-checkpoints.md`](releases/maintenance-checkpoints.md)
  with date, base official release, deployed commit, reason, validation, live
  evidence, and rollback target;
- do **not** update current-release pointers;
- do **not** create or move a `v1.0.0-beta.N` tag;
- if the change is later found to affect tester behavior, promote it by cutting
  the next Tier 1 beta release.

Tier 2 is for exact deployed-code traceability, not for hiding product changes.

### Tier 3 — Main-Only Refactor / Unreleased Code

Use this tier for refactors, tests, internal cleanup, prototypes, or tooling
that are committed to `main` but not deployed to supervised testers.

Requirements:

- run the smallest validation set that proves the claim;
- do not update release pointers;
- do not imply testers are running the change;
- bundle the change into the next Tier 1 release note if it becomes part of an
  official tester release.

Main is allowed to be ahead of the current official beta tag. The release note
and `/api/config` identify what testers are running.

### Tier 4 — Docs-Only / Policy / Planning Change

Use this tier for documentation, policy, runbook, planning, or release-note
corrections that do not change product code and are not deployed as app code.

Requirements:

- no beta tag;
- no VM deploy;
- focused docs/tests only;
- do not update current-release pointers unless recording a Tier 1 release;
- if correcting a release note, keep the tag target immutable and explain the
  correction in the docs commit when necessary.

## Decision Matrix

| Question | If yes | Tier |
| --- | --- | --- |
| Should testers know a new beta number? | Cut a new official release. | Tier 1 |
| Does user-visible behavior, legal output, data custody, auth, upload, or preparation semantics change? | Cut a new official release. | Tier 1 |
| Is it a behavior-preserving refactor that must be deployed now? | Deploy by commit and record a maintenance checkpoint. | Tier 2 |
| Is it safe to leave on `main` until the next official release? | Commit with validation; no deploy or tag. | Tier 3 |
| Is it docs/policy/planning only? | Commit docs; no deploy or tag. | Tier 4 |

When unsure between Tier 1 and Tier 2, choose Tier 1.

## Official Release Numbering

Official tester releases use annotated tags in this shape:

```text
v1.0.0-beta.N
```

Increment `N` for each Tier 1 private beta checkpoint. Do not reuse, move, or
force-push an existing release tag. If a tag already exists, create the next
number.

Maintenance checkpoints do not consume beta numbers.

## Tag Target Rule For Tier 1

The official release tag must point to the deployed app artifact, not
necessarily the later documentation commit.

That means this is allowed and expected:

```text
v1.0.0-beta.12 -> f4375df Extract runtime DB query helper
branch HEAD    -> 2a33b6d Record v1.0.0-beta.12 release notes
```

This is not a contradiction. The tag identifies what testers are running as the
official beta. The later branch commit records and indexes the release for
humans.

If product code changes after the tag target, classify the new commit:

- Tier 1: deploy and tag the next beta;
- Tier 2: deploy by commit and record a maintenance checkpoint without changing
  current-release pointers;
- Tier 3: leave on main as unreleased;
- Tier 4: clearly label it as documentation-only.

Do not imply testers are running code that has not been deployed.

## Required Tier 1 Release Note

Every Tier 1 release tag needs a note under:

```text
docs/releases/v1.0.0-beta.N.md
```

The note must include:

- date;
- whether it is the current release;
- release tag name;
- tag target commit;
- deployed URL or deployment surface;
- included changes since the prior release;
- live deployment or acceptance evidence;
- explicit non-promises and remaining boundaries;
- operator command or recovery pointer when relevant.

Keep the note concrete. Avoid broad claims like "production ready" unless the
deployment evidence supports that exact phrase.

## Tier 2 Maintenance Checkpoint Entry

Every Tier 2 deploy needs a short entry in:

```text
docs/releases/maintenance-checkpoints.md
```

Use this shape:

```text
## YYYY-MM-DD — <short title>

- Base official release: v1.0.0-beta.N / <codename>
- Deployed commit: <shortsha> <subject>
- Deployment surface: <URL or host>
- Why Tier 2: <why this is behavior-preserving and deployed now>
- Validation: <tests/build/checks>
- Live evidence: <service check, config smoke, UI hardening if run>
- Rollback: v1.0.0-beta.N / <tag target>
```

If a maintenance deploy accumulates tester-visible changes, stop using Tier 2
and cut a Tier 1 release.

## Current Release Pointers

When a Tier 1 release becomes current, update:

- `README.md`;
- `docs/README.md`;
- `docs/beta-operator-checklist.md`;
- the default release in `scripts/private-beta-rc-closure-pack.mjs`;
- related tests that assert the current release pointer.

Tier 2, Tier 3, and Tier 4 changes do not update these pointers unless they are
part of a Tier 1 release documentation commit.

Then run a stale-pointer scan for the previous release number in release-current
contexts.

Example:

```bash
rg -n 'Current release notes|Current checklist|git checkout v1\.0\.0-beta\.OLD|DEFAULT_RELEASE = "v1\.0\.0-beta\.OLD"' README.md docs scripts test
```

Historical release tables may still mention older tags. Do not delete useful
history merely to make a grep empty.

This pointer agreement is checked mechanically for Tier 1 releases. Run:

```bash
npm run release:position-check
```

It verifies, for the current official release, that the annotated tag, the
release note's `Tag target / deployed commit`, and every current-release pointer
(`README.md`, `docs/README.md`, `docs/beta-operator-checklist.md`, and the
closure pack `DEFAULT_RELEASE`) name the same `v1.0.0-beta.N`, and that no older
history row still carries the current marker. Pass `--release v1.0.0-beta.N` to
check a specific release. A non-zero exit means a pointer drifted.

Do not use `release:position-check` as a Tier 2 checker; Tier 2 is recorded by
commit and maintenance-checkpoint evidence.

## Verification Gates

Use the smallest gate set that proves the tier claim.

For Tier 1 code changes, run at least:

```bash
npm test --silent
npm run ui:typecheck --silent
npm run ui:build --silent
git diff --check
```

For Tier 1 deployment changes, also require deployment-specific evidence such
as:

- runtime DB migrations applied or skipped/current;
- service check passed;
- rendered UI hardening passed when the UI may be affected;
- no console errors in the browser smoke;
- telemetry/mothership health where relevant.

For Tier 2 maintenance deploys, run focused tests for the touched area plus the
minimum deployment evidence needed to prove the app still starts and the release
metadata identifies the deployed commit. Prefer service check; use UI hardening
when React-rendered surfaces, asset builds, or browser behavior are touched.

For Tier 3 main-only changes, run focused tests and broader tests when the code
path warrants it.

For Tier 4 docs-only updates, a focused docs/test pointer check is enough.

## Deployment Relationship

Tier 1 release notes must distinguish:

- `tag target`: the code commit the release tag points to;
- `docs commit`: the branch commit that records or updates release material;
- `deployed commit`: the commit actually installed on the VM or cloud host.

In the common Tier 1 case, `tag target` and `deployed commit` are the same. If
they are not, the release note must say why.

Tier 2 maintenance entries must distinguish:

- `base official release`: the tester release still being operated;
- `deployed commit`: the maintenance commit actually installed;
- `rollback`: the official beta tag or prior maintenance commit to restore.

## Git Actions

Tier 1 official release:

```bash
git tag -a v1.0.0-beta.N <deployed-commit> -m "Matter Workbench v1.0.0-beta.N"
git push origin v1.0.0-beta.N
```

Commit release documentation separately when needed:

```bash
git add README.md docs/README.md docs/beta-operator-checklist.md docs/releases/v1.0.0-beta.N.md
git commit -m "Record v1.0.0-beta.N release notes"
git push origin <branch>
```

Tier 2 maintenance deploy:

```bash
# deploy by commit, then record docs/releases/maintenance-checkpoints.md
git add docs/releases/maintenance-checkpoints.md
git commit -m "Record maintenance deploy checkpoint"
```

Do not force-push a release tag. If a Tier 1 release note is wrong, fix the note
in a new commit. If the deployed code is wrong, either roll back or cut a new
Tier 1 release. If a Tier 2 checkpoint is wrong, fix or append the maintenance
log; do not rewrite history after it has been pushed.

## Human Rule

A beta tester should be able to say: "I am on Beta N, dated X."

An operator should be able to say one of:

- "Beta N is commit Y, deployed at URL Z, with evidence E" for Tier 1; or
- "The official beta is still N, but the VM is on maintenance commit M, recorded
  in the maintenance checkpoint log with evidence E" for Tier 2.

If both statements are easy, the policy is working.
