# Matter Workbench Release Policy

Status: Current release authority

This policy exists to keep private beta releases boring. It captures the
practical rule we use when the deployed app, release tag, release notes, and
branch documentation do not all land in the same commit.

## North Star

A release should answer four questions without guesswork:

1. What exact code is running for testers?
2. What tag names that code?
3. What evidence says it is fit for the current beta scope?
4. Where should the next operator or agent look before changing it?

If a release artifact cannot answer those questions, the release is not done.

## Release Numbering

Use annotated tags in this shape:

```text
v1.0.0-beta.N
```

Increment `N` for each meaningful private beta checkpoint. Do not reuse or move
an existing release tag. If a tag already exists, create the next number.

## Tag Target Rule

The release tag must point to the deployed app artifact, not necessarily the
later documentation commit.

That means this is allowed and expected:

```text
v1.0.0-beta.12 -> f4375df Extract runtime DB query helper
branch HEAD    -> 2a33b6d Record v1.0.0-beta.12 release notes
```

This is not a contradiction. The tag identifies what testers are running. The
later branch commit records and indexes the release for humans.

If product code changes after the tag target, either deploy and tag a new
release or clearly label the later commit as documentation-only. Do not imply
that testers are running code that has not been deployed.

## Required Release Note

Every release tag needs a note under:

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

## Current Release Pointers

When a release becomes current, update:

- `README.md`;
- `docs/README.md`;
- `docs/beta-operator-checklist.md`;
- the default release in `scripts/private-beta-rc-closure-pack.mjs`;
- related tests that assert the current release pointer.

Then run a stale-pointer scan for the previous release number in release-current
contexts.

Example:

```bash
rg -n 'Current release notes|Current checklist|git checkout v1\.0\.0-beta\.OLD|DEFAULT_RELEASE = "v1\.0\.0-beta\.OLD"' README.md docs scripts test
```

Historical release tables may still mention older tags. Do not delete useful
history merely to make a grep empty.

## Verification Gates

Before tagging a private beta checkpoint, use the smallest gate set that proves
the release claim.

For code changes, run at least:

```bash
npm test --silent
npm run ui:typecheck --silent
npm run ui:build --silent
git diff --check
```

For deployment changes, also require deployment-specific evidence such as:

- runtime DB migrations applied;
- service check passed;
- rendered UI hardening passed;
- no console errors in the browser smoke;
- telemetry/mothership health where relevant.

For docs-only release-note updates after the deployed artifact is already
tagged, a focused docs/test pointer check is enough, but the release note must
cite the earlier code/deploy evidence.

## Deployment Relationship

The release note must distinguish:

- `tag target`: the code commit the release tag points to;
- `docs commit`: the branch commit that records or updates release material;
- `deployed commit`: the commit actually installed on the VM or cloud host.

In the common case, `tag target` and `deployed commit` are the same. If they are
not, the release note must say why.

## Git Actions

Use annotated tags:

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

Do not force-push a release tag. If a release note is wrong, fix the note in a
new commit. If the deployed code is wrong, cut a new release tag.

## Human Rule

A beta tester should be able to say: "I am on Beta N, dated X." An operator
should be able to say: "Beta N is commit Y, deployed at URL Z, with evidence E."

If both statements are easy, the release policy is working.
