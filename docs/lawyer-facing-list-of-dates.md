# Lawyer-Facing List of Dates Design Note

This note defines the next product direction for `/create_listofdates`.

The current skill is intentionally conservative. It reads extraction records, asks for dated events, requires a raw `FILE-NNNN pX.bY` citation, and writes `List of Dates.json`, `.csv`, and `.md`. That is the right base layer. It gives the system a source-backed chronology without turning the AI into a pleading writer.

The next step is not to make the chronology more dramatic. The next step is to make it more useful to the lawyer.

## Goal

`/create_listofdates` should produce a lawyer-facing chronology that is:

- source-backed;
- client-favourable;
- readable by an advocate reviewing the file;
- strict about what the cited source actually supports;
- audit-friendly, with raw citations preserved.

The output should help the lawyer see why an event matters, not merely that an event occurred.

Today this is acceptable:

```text
2024-09-30 | Possession deadline missed | FILE-0007 p1.b2
```

The desired lawyer-facing form is closer to:

```text
2024-09-30 | Possession deadline missed | Supports delay / default theory under the client's possession claim | Flat Purchase Agreement - 12 April 2022 (FILE-0007 p1.b2)
```

The chronology should still read like a case-preparation tool, not a drafted pleading.

## Non-Goals

This design does not authorize:

- unsupported argument;
- invented facts;
- invented legal conclusions;
- pleading-draft language;
- conclusory accusations such as "fraud", "bad faith", or "breach proved" unless the cited source itself says that;
- hiding source uncertainty behind polished prose;
- replacing canonical `FILE-NNNN pX.bY` citations with human labels.

The skill may make the chronology client-favourable. It may not fabricate the client's case.

## Tone Rule

Advocate for the declared client, but only within what cited sources support.

The declared client is the client recorded in `matter.json`. Client-favourable does not mean every event must flatter the client. It means the chronology should:

- surface events that help the client's legal theory;
- preserve adverse events when they matter;
- describe disputed facts with attribution;
- avoid false neutrality that hides contradictions, missed deadlines, acknowledgments, objections, or payment gaps.

Good lawyer-facing chronology is careful, not timid. It should say "Builder missed the possession deadline" if the agreement supplies the deadline and no possession event appears in the cited block. It should not say "Builder committed breach" unless the source itself uses that conclusion or a later implementation has a separately approved legal-analysis layer.

## Recommended Verbs

Prefer verbs that keep the event grounded in the record:

- `records`
- `states`
- `claims`
- `denies`
- `objected`
- `failed`
- `missed`
- `demanded`
- `acknowledged`

These verbs are useful because they carry legal posture without overclaiming.

Examples:

```text
Bank statement records debit of Rs.21,50,000.
Builder claims 60% completion as of March 2024.
Client objected to parking reassignment.
Builder failed to deliver possession by the contractual deadline.
Receipt acknowledged Rs.18,00,000, leaving the bank debit discrepancy visible.
```

Avoid verbs that silently decide the case:

```text
defrauded
cheated
proved
admitted liability
breached
acted in bad faith
```

Those may become appropriate only if the cited source itself says them, or if a later approved legal-analysis skill creates a separately sourced conclusion.

## Output Contract Proposal

The existing chronology entry shape should remain backward-compatible.

Keep:

```json
{
  "date_iso": "2024-09-30",
  "event": "Possession deadline missed",
  "citation": "FILE-0007 p1.b2"
}
```

Add proposed fields:

```json
{
  "date_iso": "2024-09-30",
  "event": "Possession deadline missed",
  "citation": "FILE-0007 p1.b2",
  "event_type": "deadline_missed",
  "legal_relevance": "Supports the client's delay/default theory because the cited agreement records 30 September 2024 as the possession deadline.",
  "issue_tags": ["delay", "possession", "contractual_deadline"],
  "perspective": "client_favourable"
}
```

### `event_type`

`event_type` should be a short machine-readable category. Initial suggested values:

- `agreement`
- `payment`
- `notice`
- `demand`
- `reply`
- `admission`
- `denial`
- `objection`
- `deadline`
- `deadline_missed`
- `hearing`
- `filing`
- `inspection`
- `contradiction`
- `gap_marker`
- `other`

This should help later filtering without making the `event` text stiff.

### `legal_relevance`

`legal_relevance` is the lawyer-facing explanation of why the event matters.

Rules:

- It must be supported by the same cited source as `citation`.
- It should be one sentence.
- It should be written from the declared client's perspective.
- It should use attribution where facts are disputed.
- It should not introduce a legal conclusion that the source does not support.

Good:

```text
Supports the client's payment discrepancy issue because the bank statement records a debit larger than the builder's receipt.
```

Bad:

```text
Proves the builder committed fraud.
```

### `issue_tags`

`issue_tags` should be an array of short stable tags. These are not court pleadings; they are review handles.

Initial suggested tags:

- `payment`
- `delay`
- `possession`
- `notice`
- `reply`
- `deadline`
- `missed_deadline`
- `contradiction`
- `admission`
- `denial`
- `objection`
- `document_gap`
- `authority`
- `damages`
- `procedure`
- `evidence_gap`

Tags should be conservative. If the model is unsure, use fewer tags.

### `perspective`

Add:

```json
"perspective": "client_favourable"
```

This marks the artifact posture. It should not vary per event unless a future design explicitly supports multiple perspectives.

The value means:

- prioritize relevance to the client's case;
- keep adverse facts if they matter;
- do not write from the opponent's advocacy posture;
- never invent support.

## Markdown Proposal

The lawyer-facing Markdown table should move from a neutral source log to a review chronology:

```text
| Date | Event | Legal Relevance | Source |
|---|---|---|---|
| 2024-09-30 | Possession deadline missed | Supports the client's delay/default theory because the cited agreement records 30 September 2024 as the possession deadline. | Flat Purchase Agreement - 12 April 2022 (FILE-0007 p1.b2) |
```

Columns:

- `Date`
- `Event`
- `Legal Relevance`
- `Source`

Do not remove the raw citation from `Source`. The readable label helps the lawyer scan the table; the raw citation keeps it auditable.

The CSV can carry the same fields as the JSON for review and filtering.

## Guardrails

The guardrails are the main point of this design.

1. Raw `FILE-NNNN pX.bY` citations remain canonical.
2. Every event must cite exactly one extracted block.
3. Every `legal_relevance` sentence must be supported by the same cited source as the event.
4. Use `claimed`, `denied`, `alleged`, `states`, or `records` for disputed facts.
5. Do not say `fraud`, `bad faith`, `breach proved`, `liability admitted`, or equivalent unless the cited source says it.
6. Do not use source labels as proof. Source labels help display; the event and relevance must rest on the cited block.
7. If the cited source is unclear, set `needs_review=true` and write cautious relevance.
8. If a source records only a relative date, bare year, statute year, or section number, do not create a dated event unless a full calendar date is available.
9. Do not collapse multiple same-day events when they carry different legal meaning or different citations.
10. Do not hide contradictions. If a case contains both a claim and counter-evidence, both should be visible as source-backed events.

## Client-Favourable Does Not Mean One-Sided

A good client chronology is not a sales pitch. It is a working case map.

If the opponent denies liability, include it:

```text
Respondent denies liability and claims force majeure.
```

The legal relevance can still be client-aware:

```text
Frames the opponent's defence and identifies the period the client must answer with contrary evidence.
```

If a bank debit hurts the client, include it if it matters. If a deadline helps the client, make its relevance explicit. The rule is not "only helpful facts"; the rule is "lawyer-useful facts arranged for the client's case theory."

## Eval Plan

Use the dummy golden files as the acceptance harness before changing runtime prompts or schema.

### Primary Cases

Start with:

- case 06, `chronology_rich`
- case 07, `sharma_v_raheja`

Case 06 is the clean end-to-end chronology test. It should check whether all expected dated events appear with correct raw citations.

Case 07 is the legal-quality test. It should check whether the chronology surfaces:

- the 2022-04-12 same-day event cluster without collapsing it;
- payment discrepancy facts;
- parking reassignment objection;
- possession deadline;
- builder's 60% completion claim;
- independent inspection counter-evidence;
- the legal demand notice;
- the four-month correspondence gap as a later claims/gaps concern, not necessarily as a dated list-of-dates event.

### What To Check

The eval should report:

- missing expected events;
- over-neutralized events, where legally important facts are reduced to bland labels;
- collapsed same-day events;
- extra events that are meta-documentation rather than evidence;
- legal relevance unsupported by the cited block;
- disputed facts stated as proven;
- missing raw citation in Markdown;
- missing readable source label where `Source Index.json` exists.

### Golden Checker Direction

The golden checker should remain a dev/eval tool before it becomes a normal test. It can be strict about dates and citations, and looser about event wording.

For the lawyer-facing upgrade, add additional checks:

- every generated event has `event_type`;
- every generated event has non-empty `legal_relevance`;
- `legal_relevance` does not contain banned conclusions unless the cited text contains the same conclusion;
- `issue_tags` are present for key case 07 flaws;
- same-day case 07 events remain separate.

## Rollout Sequence

Do this in small slices:

1. Land this design note.
2. Update golden/eval tooling to understand the proposed fields.
3. Add schema fields in JSON/CSV while preserving existing fields.
4. Update Markdown rendering to include `Legal Relevance`.
5. Tighten the prompt for client-favourable source-backed chronology.
6. Run case 06 and case 07 goldens before asking users to rely on the new posture.

Do not combine this with fallback routing, provider changes, UI settings, or source descriptor changes.

The contract should move first. Prompt and schema changes should follow only after this posture is agreed.
