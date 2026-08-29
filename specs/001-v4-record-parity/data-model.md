# Phase 1 Data Model: Fast extraction results reach the matter record under PostgreSQL storage

**Branch**: `001-v4-record-parity` | **Date**: 2026-08-29

This feature introduces no new persisted entity. It makes existing entities reachable under
a second storage arrangement, and surfaces one value that is currently computed and
discarded. The model below therefore describes what already exists, what each adapter must
address it by, and the one in-memory type the port adds.

---

## Storage addressing

The same logical file is addressed differently by each arrangement. Everything else about it
is identical.

| | Filesystem arrangement | Database arrangement |
|---|---|---|
| Matter root | A directory under the matters home | A normalized matter name forming a key prefix |
| A matter file | Path joined to that directory | `<normalized matter name>/<relative path>` |
| Existence | Directory entry | Payload row for that key |
| Write | Atomic file replace | Row upsert carrying bytes, size, role, mime type |

**Invariant**: the *relative path* is identical under both. `_extracted/FILE-0003.json` is
the same logical file either way. The port is expressed entirely in relative paths for this
reason, and it is what makes the parity assertion a straight comparison.

---

## Entities

### Matter handle *(new, in-memory only)*

Opaque value returned by `resolveMatter` and passed back to every other port call. Never
persisted, never inspected by the filing service.

| Field | Meaning |
|---|---|
| *(filesystem)* | Absolute path to the matter directory |
| *(database)* | Matter descriptor sufficient to build storage keys |

**Rules**: A handle is only valid for the adapter that produced it. `resolveMatter` returns
null rather than a handle when the matter cannot be identified — the filing service treats
null as decline-to-write (FR-009).

---

### Registration *(existing)*

The matter's authoritative list of its documents. Written before extraction; read-only here.

| Field | Meaning | Used for |
|---|---|---|
| `file_id` | Permanent document identifier | Names the record; appears in every citation |
| `sha256` | Content fingerprint | The only key used to match a document |
| `status` | Registration state | Rows marked duplicate are ignored |
| `intake_id` | Which intake registered it | Locates the sibling activity log |
| `working_copy_path` / `source_path` | Where the bytes live | Recorded into the record |

**Rules**:
- Matching is by `sha256` only. Filenames are descriptive and MUST NOT participate (FR-004).
- The first registration of a given content owns the record; later duplicates are ignored.
- A document with no matching registration is skipped, never registered (FR-004).

---

### Extraction record *(existing, `extraction-record/v1`)*

The per-document output every later process reads.

| Field | Constraint relevant here |
|---|---|
| `schema_version` | Fixed at `extraction-record/v1` |
| `file_id`, `sha256` | Must match the registration row that was matched |
| `engine` | Identifies the producing extractor — already distinguishes fast from normal |
| `extraction_strategy`, `ocr_pipeline` | Must satisfy the reuse gates, or preparation silently re-reads the document (FR-008) |
| `pages[]` | `{ page, ocr_required, confidence_avg, needs_review, blocks }` |
| `pages[].blocks[]` | `{ id, type, text, bbox? }`, id formatted `p<page>.b<n>` |
| `warnings[]` | Records that confidence is synthesized |

**Rules**:
- Written only when every page is accepted and carries non-empty text. Otherwise the whole
  document is left for normal extraction — no page is filled in (FR-005, Constitution II).
- Never replaces an existing record for the same content (FR-006).
- A companion flat-text file is written alongside, at the same relative path with a text
  extension.

**Not in scope**: block segmentation differs between extractors, so `p3.b7` can denote
different passages depending on which produced the record. Pre-existing, identical under
both arrangements, excluded by the spec.

---

### Activity log *(existing)*

One row per document per matter intake, recording what extracted it and how it went.

**Rules**:
- Merged by `file_id`: an existing row for the same document is replaced, rows for other
  documents survive untouched (FR-007).
- Column set and ordering are fixed by the existing contract; the merge must not reorder or
  drop columns.

---

### Extraction run *(existing identity, newly remembered)*

A single submission of documents to fast extraction. Already exists server-side with a
durable identity and an addressable state; this feature only makes the client remember which
one it was watching.

| Field | Meaning |
|---|---|
| run identity | Names the run. Already minted and already addressable |
| state | In progress, or terminal with an outcome set |

**Rules**:
- The client MUST retain the run identity across reload and navigation, scoped to the matter
  it belongs to (FR-013).
- Re-attaching MUST be a read. It MUST NOT resubmit documents or start a second run.
- When the extraction service no longer holds the run, re-attaching MUST report that the
  report is unavailable rather than render an empty one.
- No new server state and no new endpoint. Run identity and state are already exposed per
  run; see plan post-design note.

---

### Extraction outcome *(existing value, newly surfaced)*

Computed per document by the filing service today and discarded by the caller.

| Outcome | Meaning |
|---|---|
| `filed` | Entered the matter record |
| `left_for_normal_extraction` | Incomplete extraction; ordinary preparation will read it |
| `skipped_unregistered` | No registration matched the content |
| `skipped_existing_record` | A valid record already existed |

**Rules**:
- Every submitted document reaches exactly one outcome (FR-010).
- Outcomes must match the record's actual contents (FR-011) — they are reported after the
  write, not predicted before it.
- Crosses the isolation seam as plain data only.
- Belong to a run, and are reachable through that run's identity for as long as the
  extraction service retains it (FR-013). They are not archived beyond that, and are not
  written into the matter record as a separate artifact.

**Durability split, stated because it is easy to misread**: what was *filed* is durably
visible in the matter's activity log regardless of whether anyone saw the report. What is
lost when a run's result ages out is the *reasons* for documents that were not filed.

---

## Lifecycle

```text
registered ──▶ fast extraction completes
                   │
                   ├─ content matches no registration ──▶ skipped_unregistered
                   ├─ a valid record already exists  ──▶ skipped_existing_record
                   ├─ any page unreadable or empty   ──▶ left_for_normal_extraction
                   └─ every page accepted, non-empty ──▶ record + flat text written,
                                                          activity log merged ──▶ filed
```

Identical under both arrangements. The branch conditions read only registration content and
existing-record state, both obtained through the port — which is what makes the outcome
storage-independent (FR-003).

**Failure partway through a batch**: documents already processed keep their outcomes;
remaining documents are not filed. Per-document granularity is required of the database
adapter for this reason — see research R4.
