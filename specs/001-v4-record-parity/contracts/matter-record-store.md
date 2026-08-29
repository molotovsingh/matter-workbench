# Contract: Matter Record Store

**Branch**: `001-v4-record-parity` | **Date**: 2026-08-29

The storage port the extraction-filing service depends on. Two adapters implement it — one
for the filesystem arrangement, one for the runtime database. This document is the
authoritative statement of what an adapter must do; the shared parity test is its executable
form.

## Scope

The port covers only the reads and writes the filing service performs. It is not a general
matter-storage abstraction and MUST NOT grow into one. Anything that cannot be expressed as
"read or write this matter-relative text file" belongs outside it.

---

## Interface

```text
resolveMatter({ folderName, slug }) -> handle | null
readText(handle, relativePath)      -> string | null
writeText(handle, relativePath, text, { role, mimeType }) -> void
```

---

### `resolveMatter({ folderName, slug }) -> handle | null`

Identify the matter these results belong to.

**MUST**
- Return an opaque handle when exactly one matter is identified.
- Return `null` when zero matters match, or when the inputs cannot identify exactly one.
- Be free of side effects. Resolution never creates a matter.

**MUST NOT**
- Guess between candidates. Ambiguity returns `null` (FR-009).
- Interpret `folderName` as a path. Values containing separators or parent references are
  rejected.

**Adapter latitude**: how a matter is located is adapter-specific. The filesystem adapter
resolves by exact directory name and falls back to matching the simplified identifier
against directory entries. The database adapter resolves by name only — the storage key is
derived from the name, so the condition the fallback recovers from cannot arise. See
research R3; this asymmetry is deliberate and must not be "fixed".

---

### `readText(handle, relativePath) -> string | null`

Read one matter-relative file as text.

**MUST**
- Return the full contents as a string, regardless of size.
- Return `null` when the file does not exist.
- Confine reads to the given matter. A path escaping the matter is an error, not a miss.

**MUST NOT**
- Apply a size limit. Display-oriented caps do not belong on this path — a large
  registration file must be readable (research R2).
- Convert a read failure into `null`. Absent and unreadable are different; only absence is
  `null`.

---

### `writeText(handle, relativePath, text, { role, mimeType }) -> void`

Write one matter-relative file.

**MUST**
- Replace any existing file at that path completely.
- Make the write durable before returning.
- Ensure a reader never observes a partially written file.
- Confine writes to the given matter.
- Write exactly one file per call. Per-document granularity is required so that a failure
  partway through a batch leaves the same state under both arrangements (research R4).

**MUST NOT**
- Batch or defer writes across calls.
- Alter the text. Byte-for-byte equality between arrangements is what the parity test
  asserts.

---

## Parity obligations

These bind the pair, not either adapter alone. They are the executable form of FR-002.

- **P1 — Equal outcomes.** For the same documents and matter, every document reaches the same
  outcome under both adapters.
- **P2 — Equal content.** Every file written has byte-identical content under both.
- **P3 — Equal paths.** Every file is written at the same relative path under both.
- **P4 — Equal absence.** A file not written under one is not written under the other.
- **P5 — Equal partial failure.** After a failure at document *N*, both have filed the same
  documents and left the same ones unfiled.

**Verification**: one scenario table executed against both adapters, asserting equality
rather than asserting expected values twice. Adding a scenario must automatically cover both
arrangements — if a scenario can pass against one adapter and be absent for the other, the
test is wrong (Constitution IV and V).

---

## Non-obligations

Deliberately not guaranteed, so nobody implements them speculatively:

- **No transactions across documents.** Per-document granularity is the requirement; batch
  atomicity is forbidden because it diverges from the reference behaviour.
- **No concurrency control.** The existing filesystem path has a check-then-write race
  against normal extraction. Parity means inheriting it. An adapter MUST NOT add locking
  that would make the arrangements behave differently.
- **No caching.** Reads reflect current state at call time.
- **No listing or enumeration.** Nothing in the filing rules needs it, and adding it invites
  the matter-listing resolution rejected in research R3.
- **No deletion.** Filing never removes anything.

---

## Isolation constraint

The filing service and its adapters MUST NOT import from the extraction service. Only plain
data crosses that seam. `V4-ISO-001` enforces this and MUST continue to pass unchanged —
this contract does not relax it.
