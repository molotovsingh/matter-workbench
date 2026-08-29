# Tier 1 release note draft — V4 record parity

**Status**: Draft. Not deployed, not tagged, not a release yet.

This is T030's output: the note prepared in advance so the release ceremony is not
improvised at deploy time. It lives here rather than in `docs/releases/` because it has no
beta number yet — see the open question below.

## Why Tier 1

Under `docs/release-policy.md` this cannot be a Tier 2 maintenance checkpoint:

- **Storage, custody and preparation semantics change.** Extraction results now enter the
  matter record under an arrangement where they previously did not.
- **Runtime DB migration.** `010_intake_filing_summary.sql` adds a column to the V4 intake
  table.
- **User-visible behaviour.** The fast-extraction panel gains a per-document outcome report
  and rejoins a run after a reload.

The policy also says to choose Tier 1 when the call is ambiguous. It is not ambiguous here.

## Open question: which beta number

`docs/releases/v1.0.0-beta.133.md` on `main` is already drafted for *shipping V4 dormant with
the flag off*. This feature is what makes V4 useful once the flag is on. Two coherent
sequences:

1. **Fold into beta.133.** Deploy this together with enabling `MWB_V4_INTAKE`, so the single
   Tier 1 release is "V4 available to testers". Simplest story, larger single step.
2. **beta.134.** Ship beta.133 dormant first as already drafted, then this as the release
   that turns it on.

This is a deploy-sequencing decision, not an engineering one. The note gets its number when
that is settled.

## Included changes

- Fast-extraction results reach the matter record under both storage arrangements. On the
  deployed configuration they previously did not reach it at all.
- A storage port separates filing rules from storage access, with one adapter per
  arrangement, so the rules protecting the legal record exist in one place rather than two.
- Filing declines to write into a matter outside the caller's tenant.
- The panel reports what entered the record and what did not, with a reason for each, and
  rejoins a run after a reload or navigating away.
- Migration `010_intake_filing_summary.sql` adds a nullable column to
  `document_intake_extraction.intakes`.

## Validation

- `npm test` — 1,940 passed, 0 failed.
- `npm run ui:build` — React typecheck and production build passed.
- `git diff --check` — clean.
- `MWB_POSTGRES_TEST_ADMIN_URL=... npm run test:postgres` — the new record-parity suite
  passes against a real PostgreSQL database, covering filing, tenant refusal, replay
  idempotency, and the filing report round trip.
- `V4-ISO-001` and `V4-DEPLOY-001` pass unchanged.
- `test/v4-extraction-import.test.mjs` passes **unedited**, which is the evidence that the
  refactor preserved reference behaviour rather than redefining it.

**Known environmental failures on the development machine, both pre-existing and identical on
`main`:** the V4 control-plane RLS integration test (the local admin role bypasses RLS) and
16 of 46 `ui:smoke` checks. Neither is caused by this work. Both should be re-checked on the
VM, where the environment differs.

## Live deployment evidence

```text
PENDING — to be recorded at deploy:
- VM `current` symlink target
- V4 schema migration 010 applied
- private-vm service check
- rendered UI hardening pass with console-error count
- one real intake filed into a matter, with its outcome report visible in the panel
- the same run rejoined after a browser reload
```

## Not Promised

- **This does not certify V4.** All five acceptance gates — load, quality, quota, security,
  cutover — remain open. Filing results into the matter record does not bear on any of them.
- **This does not make fast extraction automatic.** It remains an explicit choice when adding
  documents to an existing matter. New-matter set-up does not use it.
- **This does not perform the V4 cutover.** Legacy extraction remains the authoritative path.
- **Passage references are not made interchangeable across extraction paths.** Fast and
  normal extraction divide a page into passages differently, so a citation can mean different
  things depending on which produced the record. This is a real defect. It predates this work,
  affects both storage arrangements identically, and needs a citation resolver that does not
  exist yet.
- **Concurrent extraction of the same document by both paths is unchanged.** The existing
  race is inherited deliberately; adding locking to one arrangement would itself break parity.
- **The outcome report is not archived.** It lives with the run and is discarded with it. What
  was filed remains visible in the matter's activity log regardless.

## Operator notes

- Migration `010_intake_filing_summary.sql` is additive and nullable; existing intakes read
  back a null report.
- Nothing here activates unless `MWB_V4_INTAKE=1`. With the flag off this release changes
  nothing a tester can see.
- Rollback target is whatever commit is deployed before this one — not the current beta tag,
  which is eleven commits behind the VM. See the 2026-08-28 maintenance checkpoint.
