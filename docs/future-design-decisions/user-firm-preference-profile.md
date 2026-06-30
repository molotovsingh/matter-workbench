# Future Design Decision: User And Firm Preference Profile

Date: 2026-06-30
Status: Planned feature / product note

## Product Idea

Matter Workbench should eventually have a user/firm preference profile that helps
New Matter intake and inference start with the user's normal legal-work context.

This note captures Manish's idea from New Matter input review: date convention,
nationality/default locale, user profile, and main practice areas should be
user-driven preferences rather than hard-coded assumptions.

## Preferences To Capture Later

Possible first profile fields:

- date convention, such as `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, or a firm
  default;
- country / nationality / locale defaults, where relevant to the user's work;
- default jurisdiction or forum context;
- primary practice areas, such as insurance, consumer, arbitration, criminal,
  company, writs, tax, labour, or insolvency;
- user role and seniority, if useful for drafting depth and review prompts;
- preferred language, spelling, and drafting tone;
- firm-level defaults versus per-user overrides.

## Relationship To New Matter Intake

Preferences should improve New Matter inputs by:

- pre-filling likely defaults;
- interpreting ambiguous dates in the user's chosen convention;
- suggesting likely matter types or practice-area routes;
- improving initial skill routing and context selection;
- reducing repeated setup questions for repeat users.

They should not make New Matter setup rigid. Every default should remain
editable at matter creation time, and matter-level overrides should be visible.

## Legal Safety Boundary

Preferences are context hints, not matter facts.

Rules:

- source-backed matter facts win over user/firm preferences;
- party nationality, citizenship, domicile, residence, or similar status must
  not be invented from a profile default;
- preferences must not be cited as evidence;
- generated artifacts should not present profile defaults as established facts;
- when the document record conflicts with a preference/default, the app should
  ask the lawyer to confirm or correct the matter metadata.

## Suggested Precedence

```text
explicit matter field
  -> lawyer-confirmed metadata review
  -> document-derived evidence
  -> user preference
  -> firm default
  -> app fallback
```

Preferences should mainly affect defaults, parsing, labels, and inference
routing. They should not override the record.

## Privacy And Product Notes

User profile fields can become sensitive. The first slice should be conservative:

- show users exactly what is stored;
- allow clearing or changing defaults;
- keep profile data separate from client/matter evidence;
- avoid training or analytics use without a separate policy decision;
- distinguish personal user preference from firm-wide default.

## Future First Slice

A narrow first slice could add a read/write profile settings page with:

1. date convention;
2. default country/legal locale;
3. primary practice areas;
4. preferred language/tone;
5. firm default fallback display.

Then New Matter intake can consume those values only as editable defaults and
inference hints.

## Not Implementation Permission

This is a parked planned-feature note. Do not change New Matter inputs, metadata
inference, or generated-artifact behavior until a dedicated implementation plan
is accepted.
