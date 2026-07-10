# Matter Semantics Service

Date: 2026-07-10
Status: Review draft / product-service purpose note

## Purpose

Matter Workbench needs a small, explicit **Matter Semantics** layer between raw matter preparation and downstream lawyer work.

Today, tools such as MW List of Dates infer client side, party posture, proceeding posture, and opponent role from scattered artifacts such as the Matter Story, Case Timeline, and Filing and Procedural Posture Diagnosis. That works sometimes, but it makes every downstream tool re-solve the same question:

> Who is who in this matter, in what proceeding, on which side, and with what confidence?

The Matter Semantics Service should answer that once, as a reviewable structured proposal, then later allow confirmed semantics to update the matter metadata.

The service is not primarily another prose artifact. Its purpose is to produce a stable semantic map that other features can consume.

## Core Loop

The intended loop is:

```text
Raw documents + intake answers
  -> ingest/extraction/source mechanics
  -> initial matter metadata
  -> Case Timeline + Matter Story + party discovery + procedural posture diagnosis
  -> Matter Semantics proposal
  -> lawyer confirmation/correction
  -> updated matter metadata
  -> better downstream outputs
```

The important product idea is that matter metadata should not remain only what the user typed at intake. It should become a living, reviewable semantic layer improved by preparation artifacts and lawyer confirmation.

## Entity vs Entity Posture

The service should keep a sharp distinction between **entity** and **entity posture**.

### Entity

An entity is the stable identity across the matter record.

Examples:

- `Krishnakumar Badridas Taori`
- `Sharda Krishnakumar Taori`
- `Roma Builders Pvt. Ltd.`
- `National Consumer Disputes Redressal Commission`
- `Flat No. 1202, Basilius`

Entity discovery answers:

> What persons, companies, authorities, courts, properties, agreements, or material objects appear in the record?

Entity records should eventually handle:

- formal name;
- short display name;
- aliases/spelling variants;
- entity type, e.g. person, company, court, authority, property, document;
- source provenance;
- confidence;
- confirmation state.

### Entity Posture

Entity posture is contextual. The same entity may have different roles in different proceedings or procedural tracks.

Example:

```text
Krishnakumar Taori
- entity: person
- in NCDRC Complaint No. 2576/2017: complainant / flat purchaser
- in respondent's later application: non-applicant / complainant responding to application
- in a future execution proceeding: possible decree-holder / applicant, depending on the record
```

Posture should therefore be modeled as:

```text
entity + proceeding/track + role + side + basis + confidence + confirmation state
```

Not as a single global label attached permanently to the entity.

## Service Boundary

The first version should be a **standalone, non-mutating proposal service**.

It should read existing matter preparation artifacts and return a proposed semantic map. It should not silently rewrite `matter.json`, matter metadata, Case Timeline, Story, or diagnosis outputs.

Initial inputs may include:

- intake/matter metadata;
- source/document labels;
- Case Timeline;
- Matter Story;
- party discovery skill output, when available;
- Filing and Procedural Posture Diagnosis;
- later, lawyer corrections/confirmations.

Initial output should be structured JSON plus, optionally, a human-readable review note:

```text
20_Workshop/Case Analysis/Matter Semantics.json
20_Workshop/Case Analysis/Matter Semantics.md
```

The JSON is the real product contract; Markdown is only for review.

## Minimum Useful Output

A first useful version can stay deliberately small:

```json
{
  "entities": [],
  "proceedings": [],
  "entity_postures": [],
  "primary_matter_posture": {
    "client_side_display": "Complainants / flat purchasers",
    "opponent_side_display": "Respondent / builder",
    "client_entity_ids": [],
    "opponent_entity_ids": [],
    "primary_proceeding_id": "",
    "confidence": "inferred",
    "needs_lawyer_confirmation": true
  }
}
```

The first slice should optimize for downstream usefulness, not exhaustive ontology.

For MW List of Dates, the key fields are:

- client-side display label;
- opponent-side display label;
- client role in the primary proceeding;
- opponent role in the primary proceeding;
- whether the posture is confirmed, inferred, or disputed;
- basis for that inference.

## Relationship to Intake

This service is related to the intake form but should not be collapsed into it.

The intake form should seed simple values:

- client name;
- opposite party;
- known court/forum;
- matter type;
- what the client wants;
- optional client role, if known.

But intake will often be incomplete, informal, or wrong. Matter Semantics should compare intake against the record, detect likely roles, and propose corrections or enrichments.

The product loop should be:

```text
intake seeds metadata
record-derived semantics improves metadata
lawyer confirms metadata
```

## Relationship to Party Discovery

Party discovery is an upstream semantic skill or sub-skill. It discovers names and aliases from the record.

Matter Semantics uses party discovery, but goes further:

- party discovery: “these names appear and may refer to these parties”;
- matter semantics: “these entities have these roles in these proceedings, with this confidence and basis.”

Party discovery should not be expected to decide the whole legal posture by itself.

## Relationship to Procedural Posture Diagnosis

Procedural Posture Diagnosis answers questions such as:

- what proceeding are we in;
- what filing posture exists;
- what route or next-step frame is likely;
- what must be confirmed before downstream work proceeds.

Matter Semantics should consume that diagnosis and promote only the reusable structured parts into the semantic map.

Examples:

- primary forum;
- case number;
- current procedural track;
- role labels used in the proceeding;
- client/opponent side hypothesis;
- confirmation gaps.

The diagnosis remains the richer legal analysis. Matter Semantics is the reusable structured layer.

## Downstream Benefits

### MW List of Dates

MW List should not infer from scratch whether it is writing for complainants, respondents, flat purchasers, builder, plaintiff, defendant, etc.

With Matter Semantics, it can write:

- `Relevance for the complainants' case`;
- `Respondent asserted...`;
- `Complainants disputed...`;
- `Builder demanded...`;
- `Supports rebuttal to respondent's default narrative...`.

This makes Chapter 1 more lawyer-facing and less generic, while preserving source-grounding.

### Other Features

The same semantic layer can later improve:

- Matter Story;
- Ask answers;
- court-facing drafts;
- hearing notes;
- issue lists;
- limitation review;
- client updates;
- party maps;
- preparation planner decisions.

## Confirmation and Mutation Rules

The service should not silently mutate canonical metadata.

A safe lifecycle is:

1. Generate Matter Semantics proposal.
2. Show proposed client side, opponent side, proceedings, and key party roles.
3. Lawyer confirms or corrects.
4. Persist confirmed values into matter metadata.
5. Mark affected downstream artifacts stale where needed.

Every promoted value should carry:

- value;
- source/basis;
- confidence;
- confirmation state;
- updated timestamp;
- whether it was user-provided, model-inferred, document-derived, or lawyer-confirmed.

## Non-Goals for V1

V1 should not attempt to build a full legal ontology.

It should not:

- decide final legal merits;
- classify every person mentioned in every document;
- infer fraud, illegality, mala fides, or final findings;
- replace Procedural Posture Diagnosis;
- replace Matter Story;
- mutate matter metadata without review;
- treat inferred posture as confirmed fact;
- send matter context to sidecars that should not receive matter context.

## Open Product Questions

1. What is the smallest intake-form change needed to seed party/posture data without burdening the user?
2. Should Matter Semantics be a visible Case Analysis row, or initially hidden as service metadata?
3. Should party discovery be a separate native skill, a stage inside Matter Semantics, or both?
4. What confirmation UI is simplest: a form, a review card, or inline matter metadata editing?
5. When semantics changes, which downstream artifacts become stale automatically?
6. How proceeding-specific should V1 be? One primary proceeding only, or primary plus detected related applications/appeals?
7. Should MW List consume unconfirmed inferred semantics, or only confirmed semantics with fallback language?

## Working Principle

Keep the first slice narrow:

```text
Discover entities lightly.
Infer posture cautiously.
Expose a proposal.
Require confirmation before canonical mutation.
Let downstream tools consume the semantic map instead of guessing.
```
