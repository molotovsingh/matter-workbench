# Future Design Decision: Matter Metadata and Client Interview

Date: 2026-05-16
Status: SME requirement capture

## Why This Exists

Matter metadata deserves separate treatment from native skills.

The current app captures basic matter metadata such as client name, matter name,
opposite party, matter type, jurisdiction, and brief description. That is a
good starting contract. The New Matter form already has both structured fields
and a free-text narrative field: `Brief description`, with helper text asking
for the dispute, key dates, forum, and desired client outcome.

That means the missing product layer is not "add a client interview from
scratch." The missing layer is to make the existing intake metadata richer,
more explicit about stage/role, and reviewable after the documents are in
place.

The SME clarified that client interview facts and procedural context should be
captured when adding a new matter, then revisited after documents are ingested
and organized.

This should not be hidden inside a single native skill. It is a matter setup and
metadata-quality feature that native skills should consume.

## Product Principle

Matter metadata is not a one-time form. It is a living case context.

Lawyers may enter:

- truncated names;
- spelling errors;
- shorthand party names;
- incomplete court/forum information;
- vague matter type;
- wrong or incomplete procedural stage;
- first impressions that change once the documents are read.

The app should not shame the user for this. It should expect metadata to mature
as the matter file becomes clearer.

## Two-Step Metadata Model

### Step 1: Extend The Existing Add New Matter Interview

When a lawyer creates a new matter, the app already collects:

- matter name;
- client name;
- opposite party;
- matter type;
- jurisdiction;
- brief description / narrative;
- initial files.

The brief description already behaves like a simple client-interview field. It
should be preserved, not replaced.

The next product step is to extend that existing flow so it also captures:

- what the dispute is about;
- court/forum/authority, if known;
- current stage;
- client role, such as plaintiff, defendant, appellant, petitioner,
  respondent, complainant, applicant, or not sure;
- whether there is a challenged order, judgment, award, or notice;
- urgent objective, such as complaint, suit, writ, SLP, appeal, reply,
  conference, or advisory note;
- short client interview or factual narrative.

The goal is not perfection. The goal is enough context for intake, chronology,
and later skill routing to start responsibly while accepting that some names,
roles, and stage labels may be corrected later.

### Step 2: Metadata Reconciliation After Documents Are In Place

After intake, extraction, source labeling, and first chronology work, the app
should offer a metadata review:

```text
The documents suggest these matter details. Confirm or correct them.
```

This review should help clean up:

- misspelled party names;
- expanded full names from abbreviated names;
- party aliases;
- swapped client/opposite-party roles;
- court/forum names;
- matter stage;
- challenged order date;
- document-derived dispute summary;
- jurisdiction clues;
- cause-of-action clues, without final legal conclusion.

This is not an AI confidence trick. It is a lawyer confirmation step.

## Relationship To User/Firm Preferences

A later [User And Firm Preference Profile](user-firm-preference-profile.md)
should provide editable defaults for date convention, country/nationality/locale
context, user profile, and main practice areas. Those preferences can guide New
Matter defaults and inference routing, but they must not become source-backed
matter facts. Explicit matter fields and document-derived evidence should win.

## Relationship To Native Skills

Native skills should not own the metadata interview.

Instead:

- Add New Matter captures initial metadata and client narrative.
- Intake and extraction produce document evidence.
- Source Labels / Document Index uses metadata as context.
- Source Labels / Document Index can flag possible metadata corrections.
- Metadata Review confirms corrections before later skills rely on them.
- Chronology and court-facing outputs use confirmed metadata labels.

This keeps responsibilities clean:

| Surface | Owns |
|---|---|
| Add New Matter | initial client interview and metadata capture |
| Metadata Review | correction and confirmation after documents are read |
| Source Labels / Document Index | document organization, bad-copy flags, chronology feed, possible metadata issues |
| List of Dates | time-ordered source-grounded story using confirmed metadata |
| Later legal skills | issue, relief, evidence, contradiction, brief, and drafting work |

## Metadata Quality Flags

The app should flag metadata for review when:

- client name appears as an abbreviation but documents contain a fuller name;
- multiple versions of a party name appear;
- party names appear reversed;
- document titles imply a different forum or jurisdiction;
- pleadings suggest a different matter type;
- a judgment/order suggests appellate or challenge-stage posture;
- the client narrative conflicts with the document chronology;
- the matter stage is unknown but documents reveal likely stage;
- the active objective appears inconsistent with the documents.

The app should present these as review prompts, not automatic corrections.

Example:

```text
Client entered "ABC". Documents also refer to "ABC Infrastructure Pvt. Ltd.".
Use full name?
```

## Why This Should Be Separate From The Skill

If Source Labels / Document Index owns metadata cleanup, the skill becomes too
broad. It would mix:

- matter creation;
- user interview;
- document organization;
- chronology generation;
- metadata correction;
- legal posture classification.

That would make the native skill harder to test and harder for lawyers to
understand.

The better architecture is:

```text
Add New Matter interview -> initial metadata
Document intake/extraction -> evidence
Metadata Review -> corrected matter context
Native skills -> source-backed work products
```

## Product Requirement

Extend the existing New Matter intake into a stronger metadata and
client-interview flow:

```text
New Matter Interview + Matter Metadata Review
```

It should support both:

- initial matter setup before documents are fully understood, using the current
  structured fields plus free-text narrative;
- later correction after documents reveal better information.

The user's mental model should be:

```text
I can start with imperfect matter details. The app will help me clean them up
once the documents make the matter clearer.
```

## Open SME Questions

1. What are the minimum current-stage choices lawyers will understand?
2. Should the client interview be a free-text narrative, structured questions,
   or both?
3. Should the app allow multiple client roles where one party is appellant in
   one proceeding and original plaintiff/defendant below?
4. When the app finds better party names from documents, should it show a
   one-click correction or require a fuller review screen?
5. Should metadata history be preserved so a lawyer can see what changed and
   when?
