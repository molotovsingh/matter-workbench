# Feature Specification: Fast extraction results reach the matter record under PostgreSQL storage

**Feature Branch**: `001-v4-record-parity`
**Created**: 2026-08-29
**Status**: Draft
**Input**: User description: "V4 extraction results do not reach the matter record when matters are stored in PostgreSQL. Make the PostgreSQL path behave identically to the filesystem path, and show the lawyer which documents landed."

## Overview

A matter can be held in more than one way. Fast extraction currently delivers its results
into the matter record for one of those arrangements and silently retains them for the
other — so on the arrangement actually in use, a lawyer can run fast extraction, wait, pay
for it, and end up with nothing in the matter.

This feature makes the outcome independent of how the matter is stored, and tells the lawyer
what happened.

The governing property is **parity**: for the same documents and the same matter, fast
extraction produces the same observable result under either storage arrangement. This is
deliberately not an improvement to fast extraction. Where the existing behaviour is
imperfect, parity means reproducing it faithfully rather than fixing it here.

## Clarifications

### Session 2026-08-29

- Q: What happens to the outcome report when the lawyer does not watch the run to
  completion? → A: Session recovery. The panel reconnects to a run that is still in progress
  or has recently completed, after a reload or navigating away. Chosen over letting the
  report be ephemeral because runs can take several minutes for large documents, and a
  report that only appears for a lawyer who waits does not reliably tell anyone whether fast
  extraction is working.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Results reach the record however the matter is stored (Priority: P1)

A lawyer adds documents to an existing matter and chooses fast extraction. When it finishes,
those documents are part of the matter's record and preparation does not read them again
slowly — and this is true regardless of how the matter happens to be stored.

**Why this priority**: This is the entire defect. On the storage arrangement in use today,
fast extraction produces text that never reaches the matter, so the feature delivers nothing.
Nothing else in this spec matters until this holds.

**Independent Test**: Run the same documents through fast extraction against a matter held
each way, and compare the resulting matter records. They must be equivalent — same documents
accepted, same text, same references, same activity log entries.

**Acceptance Scenarios**:

1. **Given** a matter held under either storage arrangement, **When** fast extraction
   completes for a fully-readable registered document, **Then** that document is present in
   the matter record as already extracted, and preparation does not re-read it.
2. **Given** identical documents and an identical matter, **When** fast extraction runs once
   against each storage arrangement, **Then** the two resulting records are equivalent in
   accepted documents, extracted text, passage references, and activity log entries.
3. **Given** a document that fast extraction could not read completely, **When** extraction
   completes, **Then** it is left for normal extraction under either arrangement — the
   decision does not depend on storage.
4. **Given** a document that already has a valid extraction record, **When** fast extraction
   produces output for the same content, **Then** the existing record is kept under either
   arrangement.

---

### User Story 2 - The lawyer can see which documents landed (Priority: P2)

After fast extraction finishes, the lawyer can tell which documents entered the matter
record and which did not, with a reason for each that did not.

**Why this priority**: Real but not blocking — P1 decides the outcome, this makes it
visible. It is also the cheapest way to find out whether fast extraction is worth relying
on, because it turns ordinary use into evidence.

**Independent Test**: Run fast extraction over a batch mixing readable documents,
partially-unreadable documents, documents not registered in the matter, and documents that
already have records. Confirm the reported outcome for each matches the record's actual
contents.

**Acceptance Scenarios**:

1. **Given** a batch where some documents are accepted and some are not, **When** extraction
   completes, **Then** the lawyer sees a per-document outcome, and every document not
   accepted carries a reason.
2. **Given** a batch where nothing is accepted, **When** extraction completes, **Then** the
   lawyer is told plainly that nothing entered the record, rather than shown a success
   message.
3. **Given** any completed run, **When** the lawyer compares what was reported against the
   matter record, **Then** the two agree exactly.
4. **Given** a run still in progress, **When** the lawyer reloads or navigates away and
   returns to the matter, **Then** the run is still shown as in progress and reaches its
   outcome report without being restarted.
5. **Given** a run that completed while the lawyer was away, **When** the lawyer returns to
   the matter, **Then** the outcome report for that run is available.

---

### Edge Cases

These are the cases where the two storage arrangements could plausibly diverge. Each must
produce the same outcome under both.

- A document was fast-extracted but is not registered in the matter: skipped and reported,
  never invented into the record.
- The same content is registered more than once in the matter: exactly one record results,
  and the outcome does not depend on how many duplicate registrations exist.
- A valid record already exists for the same content: it is kept, not replaced.
- A document is readable except for one blank or unreadable page: the whole document is left
  for normal extraction, with no substituted text for the missing page.
- The matter's activity log already contains an entry for the document: the entry is updated
  in place, and entries for other documents survive untouched.
- The lawyer reloads or navigates away mid-run: the run continues, is not restarted, and its
  documents are not submitted twice.
- The lawyer returns after the extraction service has discarded the run's result: they are
  told the report is no longer available, rather than shown an empty or misleading one.
- A document's registered filename differs from the name it was uploaded under: identity is
  established by content, and the outcome is unaffected.
- The matter cannot be identified unambiguously: nothing is written under either
  arrangement.
- Fast extraction finishes after the matter has changed or been removed: the output is
  discarded safely rather than recreating or corrupting matter state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Fast-extraction output MUST enter the matter record under every storage
  arrangement the product supports.
- **FR-002**: For the same documents and matter, the observable result MUST be equivalent
  under either storage arrangement — the same documents accepted, the same extracted text,
  the same passage references, and the same activity log entries.
- **FR-003**: The rules deciding whether a document is accepted MUST NOT depend on how the
  matter is stored.
- **FR-004**: A document MUST be matched to the matter's existing registration by content.
  The system MUST NOT create a registration to make output fit.
- **FR-005**: A document whose extraction is incomplete MUST be left for normal extraction,
  and MUST NOT enter the record partially or with substituted text.
- **FR-006**: An existing valid record for the same content MUST NOT be replaced by
  fast-extraction output.
- **FR-007**: The matter's activity log MUST be updated per document without discarding
  entries for other documents.
- **FR-008**: Records produced by fast extraction MUST satisfy the same record contract as
  normal extraction, including whatever makes a record eligible for reuse. A record that
  would cause a later preparation run to silently re-read the document MUST NOT be written.
- **FR-009**: Where a document cannot be attributed to exactly one matter, the system MUST
  decline to write rather than choose.
- **FR-010**: Every document submitted to fast extraction MUST reach exactly one reported
  outcome: entered the record, left for normal extraction, skipped as unregistered, or
  skipped because a record already existed.
- **FR-011**: The reported outcomes MUST match the matter record's actual contents.
- **FR-012**: Fast extraction MUST remain an explicit choice made when adding documents to
  an existing matter. A matter prepared without it MUST behave exactly as it does today.
- **FR-013**: A lawyer who reloads or navigates away MUST be able to return to the matter
  and see a run that is still in progress, or the outcome report of a run that completed
  while they were away, for as long as the extraction service retains that run's result.
  Returning MUST NOT restart the run or re-submit its documents.
- **FR-014**: Filing MUST NOT write into a matter outside the caller's tenant. Where the
  matter belongs to another tenant, the system MUST decline to write rather than fail open.

### Key Entities

- **Matter record**: The durable representation of a legal matter that every later process
  reads from. Held under more than one storage arrangement.
- **Registration**: The matter's authoritative list of its documents, establishing each
  document's permanent identifier and content fingerprint. Created before extraction.
- **Extraction record**: The per-document text output later processes read.
- **Activity log**: The per-matter record of which documents were extracted and with what
  outcome.
- **Extraction run**: One submission of documents to fast extraction. Carries the identity a
  lawyer returns to when they leave and come back.
- **Extraction outcome**: The per-document result reported to the lawyer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of fully-readable registered documents accepted by fast extraction enter
  the matter record, under every supported storage arrangement.
- **SC-002**: Running the same batch against each storage arrangement produces zero
  differences in accepted documents, extracted text, passage references, or activity log
  entries.
- **SC-003**: Preparation performs no slow re-reading for any document fast extraction
  accepted — zero re-read operations for accepted documents.
- **SC-004**: Zero documents are silently dropped: every submitted document has a reported
  outcome, and reported outcomes match the record's contents exactly.
- **SC-005**: Zero documents enter the record carrying text that was not read from the
  document.
- **SC-006**: For a batch of 10–30 documents, the lawyer can see on one screen what entered
  the record and what did not.
- **SC-007**: A lawyer who leaves and returns during or after a run sees the same outcome
  report they would have seen by waiting, with zero runs restarted and zero documents
  submitted twice as a result of returning.

## Assumptions

- Documents are registered in the matter before fast extraction runs. Fast extraction is a
  second pass over already-registered documents, not a replacement for registration.
- Content fingerprints are the authoritative identity for a document; filenames are
  descriptive and may differ between registration and upload.
- Where fast extraction and normal extraction disagree about readability, normal extraction
  is the fallback and fast extraction yields.
- Outcome reports are recoverable within a run's lifetime, not archived. Recovery is bounded
  by how long the extraction service already retains a run's result; this feature introduces
  no new retention policy and no new durable artifact.
- What was filed remains independently visible in the matter's activity log regardless of
  whether the report was seen.
- Documents left for normal extraction need no action from the lawyer — ordinary preparation
  already handles them.
- Matters extracted before this feature remain valid and are not migrated.
- The existing filesystem behaviour is the reference. Where it is imperfect, parity means
  reproducing it, and any defect it has is inherited rather than fixed here.

## Out of Scope

The following were considered and deliberately excluded. Each is either a pre-existing
concern that this feature does not worsen, or a separate decision.

- **Passage reference stability across extraction paths.** Fast extraction and normal
  extraction divide a page into passages differently, so a reference can mean different
  things depending on which produced the record. This is a real defect, it predates this
  feature, and it affects the filesystem path identically. Fixing it requires a citation
  resolver that does not yet exist.
- **Concurrent extraction of the same document by both paths.** The existing behaviour has
  this race; parity means inheriting it, not solving it.
- **The initial set-up of a new matter.** Fast extraction applies only to documents added to
  a matter that already exists.
- Changing the quality, provider routing, latency, or cost of fast extraction.
- Making fast extraction automatic, default, or the only extraction path.
- Migrating or rewriting extraction records produced before this feature.
- Any certification of fast extraction's accuracy, capacity, or security posture.
