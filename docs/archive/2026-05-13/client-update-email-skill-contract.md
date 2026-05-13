# Client Update Email Skill Contract

Date: 2026-05-13

Status: design contract only. This document selects the first runtime custom skill candidate and defines the guardrails before implementation. It does not add a runnable skill, route, prompt, schema, provider call, or artifact write.

## Decision

The first custom skill runtime candidate should be:

```text
Client Update Email
```

Default output:

```text
30_Drafts/Client Update Email.md
```

This is the right first candidate because it is useful, bounded, and draft-only. It can reuse existing reliable artifacts, especially `10_Library/List of Dates.md`, without attempting high-risk legal adjudication. It also exercises the future configurable-skill path in a realistic way: read trusted matter outputs, draft something useful, keep the lawyer in control, and do not dispatch anything.

## Candidate Order

| Rank | Candidate | Decision |
| --- | --- | --- |
| 1 | Client Update Email | First runtime candidate. Useful, draft-only, clear lane, lower legal complexity than strategic review. |
| 2 | Party and Officer Map | Next likely candidate. Useful and source-backed, but should be an internal workshop artifact before it becomes a runtime skill. |
| 3 | Weakness Review | Defer. Valuable but judgment-heavy and easy to overstate. Needs better evals and review language. |
| 4 | Limitation Review | Defer. High legal sensitivity; must handle special statutes, forums, acknowledgments, delay, and uncertainty. |
| 5 | Judge Simulation | Defer. Powerful, but it can sound more authoritative than it is unless the guardrails are strict. |

## Goal

Generate a lawyer-reviewable client update email that tells the client, in careful language, that the matter has been reviewed and further work is underway.

The output should help a lawyer communicate progress without accidentally giving final advice, promising an outcome, or exposing internal citations.

Good output sounds like:

```text
We have reviewed the material received so far and are now working through the next steps. We may come back to you for clarifications or additional documents as the review progresses.
```

Bad output sounds like:

```text
Your claim is strong, the opponent is liable, and we will win.
```

## Non-Goals

Do not implement any of these in the first runtime slice:

- sending email;
- email account integration;
- DOCX/PDF export;
- final legal advice;
- limitation opinions;
- settlement advice;
- opponent-facing correspondence;
- court filing language;
- automatic dispatch to `40_Dispatch`;
- configurable skill activation;
- mutation of built-in skill stubs;
- broad Q&A/chat behavior.

## Proposed Skill Stub

This is a future configurable skill, not a built-in stub yet.

```json
{
  "schema_version": "configurable-skill-contract/v0",
  "id": "client_update_email",
  "slash": "/client_update_email",
  "title": "Client Update Email",
  "category": "Draft",
  "mode": "AI",
  "matter_required": true,
  "paid_provider_call": true,
  "rerun_guarded": true,
  "source_backed": "required_internal",
  "markdown_first": true,
  "default_lane": "30_Drafts",
  "output_artifact": "30_Drafts/Client Update Email.md"
}
```

The slash name is only a proposal. Do not add it to the active command list until the runtime, tests, golden review, and activation gates exist.

## Inputs

The runtime may read:

- `matter.json` for matter name, client, opposite party, and basic metadata;
- `10_Library/List of Dates.md` and/or `10_Library/List of Dates.json`;
- `10_Library/Source Index.json` for readable source labels when internal traceability is needed;
- the bounded `matter-context-packet/v1` only if the skill needs additional source summaries;
- user-supplied drafting instructions:
  - recipient or audience;
  - purpose of the email;
  - tone;
  - whether to include next steps;
  - whether to request documents;
  - whether to avoid all legal assessment.

The runtime must not read:

- `.env`;
- API keys;
- terminal logs;
- Command rail interaction logs;
- raw original files directly;
- full extraction records unless accessed through the bounded context reader;
- unrelated draft files;
- prior chat history.

## Preconditions

Preferred state:

```text
/extract -> /describe_sources -> /create_listofdates
```

Minimum state:

- active matter selected;
- `10_Library/List of Dates.md` or `.json` exists.

If List of Dates is missing, the skill should not silently draft from weak context. It should explain that the chronology artifact is missing and ask the user to run `/create_listofdates` first.

If Source Index is missing, the skill may still draft from the List of Dates if the List of Dates already contains readable labels. It should record a warning in the draft metadata or run result.

## Output Contract

Write exactly one Markdown artifact in the first runtime slice:

```text
30_Drafts/Client Update Email.md
```

Recommended Markdown shape:

```markdown
# Client Update Email

Status: Draft - lawyer review required
Matter: ...
Generated: ...
Model: ...

## Email Draft

Subject: ...

Dear ...

...

Regards,
...

## Lawyer Review Notes

- Purpose: ...
- Tone: ...
- Source basis: ...
- Warnings: ...
```

The `Email Draft` section is the only client-facing content.

`Lawyer Review Notes` are internal. They may refer to source labels and raw citations if needed for traceability, but they must be clearly separated from the email body.

## Source And Citation Handling

The draft must be source-informed, not source-spilling.

Rules:

- Do not put raw `FILE-NNNN pX.bY` citations inside the client-facing email body by default.
- Do not put extraction block IDs in the subject or body.
- Do not quote source text unless the lawyer explicitly asks for it.
- Keep source-backed reasoning internal through review notes or run metadata.
- If an internal source basis is included, it may use readable labels plus raw citations.
- Every factual statement about the matter status should be supportable by the List of Dates, Source Index, or matter metadata.

The client-facing draft may say:

```text
We have reviewed the papers shared with us and are working through the next steps.
```

It must not say:

```text
The documents prove that the opponent breached the agreement.
```

## Tone And Legal Safety

Default tone:

```text
warm, professional, cautious, non-committal
```

Allowed:

- acknowledge receipt/review;
- say further review or research is underway;
- say the team may ask for more documents or clarifications;
- give process updates;
- use reassuring but honest language.

Not allowed without explicit lawyer-provided instruction:

- final merits assessment;
- guaranteed timelines;
- guaranteed outcomes;
- admission of weakness;
- advice on limitation, liability, fraud, breach, settlement, or litigation strategy;
- statements that could be read as court-ready legal conclusions.

## User Confirmation Points

Before the provider call, the UI should confirm:

- selected matter;
- source artifact being used;
- recipient or audience;
- recipient style or salutation:
  - `Sir/Madam`;
  - `<ClientName>`;
  - company/team;
  - named in-house contact;
- purpose:
  - comfort/status update;
  - request documents;
  - explain next steps;
  - brief legal update;
- tone:
  - warm;
  - formal;
  - concise;
  - cautious;
- whether legal assessment is excluded or allowed in limited form;
- output path.

The safe default is:

```text
status/comfort update only; no legal assessment
```

Before writing the artifact, the first runtime slice may either:

- show a preview and require `Save draft`; or
- write directly to `30_Drafts` only after the pre-run confirmation is accepted.

It must never send the email.

## Rerun Behavior

The skill should be rerun-guarded.

If `30_Drafts/Client Update Email.md` already exists and upstream inputs are current:

- show a confirmation before overwriting;
- identify the existing artifact path;
- show the last generated time if available;
- show provider/model if known;
- default to keeping the current draft.

If upstream inputs changed:

- allow rerun;
- explain that the draft may be stale because the List of Dates or Source Index changed.

No new durable status file is needed. Derive current/stale state from existing artifacts and upstream mtimes or hashes where possible.

## Model Policy

This is an external-facing draft task. Quality should beat cost.

Recommended future model posture:

```text
AI task: configurable_skill_run or drafting/client_communication
Default model tier: gpt-5.4 via OpenAI direct
Fallback: fail closed unless an explicitly tested same-tier fallback exists
```

Do not expose a model selector in the drafting UI. Settings may show the resolved task/model later, but the lawyer should choose purpose, tone, and audience, not model routing.

The runtime must persist or display provider/model metadata in the run result or draft metadata so reviewers can see how the draft was produced.

## Failure Behavior

Fail closed when:

- required source artifact is missing;
- provider returns invalid structured output;
- provider times out;
- generated output contains raw citation leaks inside the email body;
- generated output contains unsupported legal conclusions;
- target path would escape `30_Drafts`;
- existing draft would be overwritten without confirmation.

Failure must not write a partial bad draft.

## Acceptance Tests

Minimum automated coverage for the first runtime PR:

- missing List of Dates blocks the run with a clear message;
- pre-run confirmation data identifies matter, source artifact, recipient style, tone, purpose, and output path;
- provider payload excludes `.env`, API keys, logs, raw original files, and full extraction records;
- provider payload includes only allowed matter metadata and selected source artifacts;
- output writes `30_Drafts/Client Update Email.md`;
- output does not modify `10_Library`;
- client-facing email body contains no raw `FILE-NNNN pX.bY` citations;
- internal review notes, if present, are clearly separated from the client-facing draft;
- unsupported legal conclusions are softened, rejected, or sent back for regeneration;
- existing current draft triggers a rerun confirmation;
- malformed provider JSON fails closed without writing a draft;
- Command rail and sidebar/Skills entry, if both exist, use the same runner path.

Minimum human smoke:

```text
new skill
draft a warm client update email saying we have reviewed the matter and further work is happening
```

Then, once runtime exists:

```text
/client_update_email
```

Expected result:

- draft lands in `30_Drafts/Client Update Email.md`;
- email is warm and cautious;
- no raw citations in the email body;
- no final legal advice;
- provider/model metadata visible;
- no matter artifacts outside `30_Drafts` are changed.

## What Must Not Happen

The first runtime PR must not:

- create a general drafting framework;
- create configurable skill activation;
- create prompt editing UI;
- add email sending;
- add chat memory;
- run on raw files directly;
- mutate built-in skills;
- write to `40_Dispatch`;
- treat the draft as lawyer-approved;
- silently overwrite an existing draft;
- silently downgrade the model.

## Open Questions Before Runtime

- Should the first runtime expose this only from the Skills governance surface, or also as a Command rail action?
- Should the output include an internal review-note section in the same Markdown file, or should traceability stay only in run metadata?
- Should the first version require a current List of Dates, or allow a source-index-only status email?
- Should the skill have a proposed slash command immediately, or remain a saved idea until validation/golden infrastructure exists?

Default answers for the first implementation:

- start from Command rail or Skills, but keep one shared runner;
- include internal review notes only if clearly separated;
- require List of Dates;
- do not activate a slash command until the validation path is explicit.
