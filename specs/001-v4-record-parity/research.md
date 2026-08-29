# Phase 0 Research: Fast extraction results reach the matter record under PostgreSQL storage

**Branch**: `001-v4-record-parity` | **Date**: 2026-08-29

All unknowns from Technical Context are resolved below. Two findings changed the design and
are called out as such.

---

## R1. Shape of the storage port

**Decision**: A three-method port expressed entirely in matter-relative paths.

```text
resolveMatter({ folderName, slug })            -> matter handle | null
readText(handle, relativePath)                 -> string | null
writeText(handle, relativePath, text, { role, mimeType }) -> void
```

Every file the filing service touches — the matter manifest, the document registration, an
existing extraction record, the record it writes, the flat text it writes, the activity log
it merges — is a matter-relative text read or write. Three methods cover all of them.

**Rationale**: The filing rules are already storage-agnostic; only the I/O is not. Keeping
the rules in one place is what makes parity achievable rather than merely intended. This is
Constitution principle II applied structurally: the rules forbidding invented identifiers,
substituted text, and overwritten records are the ones that must not be duplicated.

**Alternatives considered**:

- *A second filing service for the database path.* Rejected. It duplicates every acceptance
  rule and lets them drift silently — precisely the failure the parity requirement exists to
  prevent.
- *A richer port mirroring filesystem primitives (mkdir, rename, stat).* Rejected. Those are
  filesystem concepts with no database counterpart, and modelling them would force the
  database adapter to fake them.

---

## R2. Read surface in the database arrangement — **finding**

**Decision**: Add one narrow read method to the runtime database storage service, rather
than reusing the existing raw-file reader.

**Rationale**: The service exposes no general "read this matter-relative file as text".
The closest is `getRawFile`, which is shaped for browser display: it returns
`{ contentType, fileSize, safeFilename, stream }` and enforces a `maxRawBytes` inline-display
cap. Both are wrong here. The cap governs what is safe to render in a browser, and applying
it to a registration file or activity log would make filing fail for large matters for a
reason that has nothing to do with filing. `readMatterJson` exists but is hard-wired to the
manifest.

A narrow addition keeps the display cap where it belongs and gives the adapter a primitive
that matches what it actually needs.

**Alternatives considered**:

- *Consume `getRawFile`'s stream and ignore the shaping.* Rejected: inherits the display cap
  as a filing limit, producing a size-dependent parity break.
- *Reach past the service to the payload row query.* Rejected: bypasses tenant scoping and
  error handling that the service owns.

---

## R3. Matter identity, and one justified asymmetry — **finding**

**Decision**: The database adapter resolves a matter by name only. Where the name does not
resolve, it declines to write. The filesystem adapter keeps its existing two-step
resolution unchanged.

**Rationale**: In the database arrangement a matter's storage key is derived directly from
its name (`runtime-db-object-key-policy.mjs:27` builds candidates from `name`, `folderName`,
`matterName` — all variants of the same name). There is no directory to enumerate.

The filesystem adapter's second step exists to recover from a condition that only a
filesystem has: a matter's folder name can differ from its display name, so when the exact
name misses, it scans the matters directory and re-derives each folder's simplified
identifier until one matches. In the database arrangement the key *is* the name, so the
condition being recovered from cannot arise.

This is a deliberate, documented asymmetry rather than a parity break. Parity is defined
over outcomes for the same matter, and both adapters resolve the same matter to the same
place in every case that can occur under both. It is recorded here so a later reader does
not "fix" it by adding a matter-listing query.

Two consequences worth stating:

- The filesystem fallback is ambiguous when two matters reduce to the same simplified
  identifier — it takes whichever the directory yields first. The database adapter has no
  such ambiguity. Neither improves nor worsens the other; the existing behaviour is
  inherited per the spec's parity assumption.
- FR-009 (decline rather than choose when a matter cannot be attributed) is satisfied by
  both, for different reasons.

**Alternatives considered**:

- *Add a matter-listing query so the database adapter can mirror the fallback.* Rejected:
  it reproduces a recovery path for a condition that cannot occur, and imports the
  first-match ambiguity along with it.

---

## R4. Write granularity — **finding**

**Decision**: The database adapter writes one document at a time, not one batch.

**Rationale**: The two arrangements have different natural granularity, and taking the
database's natural one would break parity. The filesystem path writes each document's files
individually, so a failure partway through a batch leaves earlier documents filed and later
ones not. The database service's `persistTextArtifacts` accepts an array and compiles it
into a single statement, so a batch either lands entirely or not at all.

Both are defensible, but they are *different*, and the difference is observable: after a
mid-batch failure the two arrangements would leave different matter records and different
reported outcomes. FR-002 requires equivalence, so the adapter must adopt the filesystem's
per-document granularity by calling the persistence method once per document.

This costs one statement per document instead of one per batch. For batches of 10–30 that
is not a concern, and this feature has no performance goal.

**Alternatives considered**:

- *Batch writes for efficiency.* Rejected: changes failure semantics observably, which is
  exactly what FR-002 forbids. Efficiency is not a goal here.
- *Make the filesystem path batch-atomic to match the database.* Rejected: changes existing
  behaviour, which the spec's parity assumption explicitly forbids — the filesystem path is
  the reference.

---

## R5. Surfacing the per-document outcome

**Decision**: Return the existing summary through the result-delivery seam as plain data and
render it in the panel. The panel must be able to re-attach to a run it was not watching,
rather than only rendering at the moment of completion. No new durable artifact is added.

> **Revised 2026-08-29** after the spec clarification chose session recovery over ephemeral
> reporting (FR-013, SC-007). The original decision rendered outcomes only at completion,
> which loses the report entirely for any run the lawyer does not wait out — and runs reach
> several minutes on large documents. What did *not* change: outcomes are still not persisted
> as a new artifact. Recovery re-reads a result the extraction service already retains, so
> retention is inherited rather than invented.

**Rationale**: The filing service already computes exactly the four outcomes the spec
requires — filed, left for normal extraction, skipped as unregistered, skipped because a
record existed. It returns them, and the caller discards them. The work is surfacing, not
computing.

Plain data across the seam preserves the isolation boundary that Constitution principle V
requires stay executable: the filing service must not gain an import from the extraction
service, and `V4-ISO-001` must continue to pass unchanged.

The spec's Assumptions bound recovery by the extraction service's existing result retention,
so no storage and no retention policy are added. The panel needs to remember which run it
was watching and be able to ask for that run's state again; the server side already holds
the state.

The port contract is unaffected. Recovery is a client-and-request concern, not a storage
concern, so no obligation is added to either adapter.

**Alternatives considered**:

- *Persist outcomes in the matter record.* Rejected, and re-confirmed at the clarification
  that chose recovery: it adds a durable artifact whose lifecycle nobody has specified. What
  was filed already remains visible in the matter's activity log, so the durable half of the
  picture exists without it.
- *Render only at completion.* Rejected at the same clarification. Superseded above.
- *Derive outcomes in the client by comparing the record.* Rejected: duplicates the filing
  rules in a second place, in a second language.

---

## R6. Testing strategy for a parity claim

**Decision**: One scenario table, executed against both adapters, asserting equal results.
Real-database coverage lives in `integration-test/*.postgres.mjs`.

**Rationale**: Constitution principle IV forbids asserting parity — it must be demonstrated,
and a passing filesystem suite is evidence about the filesystem only. Principle V requires
the invariant be executable rather than documented. A shared scenario table run through both
adapters satisfies both: adding a scenario automatically covers both arrangements, and a
divergence fails rather than drifts.

The existing `test/v4-extraction-import.test.mjs` must pass unchanged throughout, which is
what proves the refactor did not alter the reference behaviour.

**Alternatives considered**:

- *Separate test suites per adapter.* Rejected: they drift, and nothing fails when one gains
  a case the other lacks.
- *Only integration tests against real PostgreSQL.* Rejected: too slow to run per change, so
  in practice they run rarely and the invariant stops being executable.
