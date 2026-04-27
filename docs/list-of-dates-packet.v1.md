# list-of-dates-packet/v1

`list-of-dates-packet/v1` is the output contract for `/create_listofdates`.
It is a lawyer workflow packet, not just a chronology table.

## Producer

`/create_listofdates`

## Consumers

- `/export_listofdates`
- Future drafting and review skills

## Files

```text
10_Library/List of Dates.md
10_Library/List of Dates.csv
10_Library/List of Dates.json
10_Library/Timeline Gaps.md
10_Library/Client Document Requests.md
```

## Scope

The packet should help a lawyer:

1. Understand the matter timeline.
2. See contradictions, unsupported assertions, and missing periods.
3. Ask the client for missing documents or clarification.
4. Export a linked human review copy without changing the analysis.

## Source Discipline

All chronology and gap-review outputs must be grounded in extracted records.
The skill must not imply hidden knowledge or client fault.

Use this language:

```text
The record contains X, but no supporting document was found in extracted records.
```

Do not use this language:

```text
The client failed to provide X.
```

## Gap Items

Gap review is stored as a structured list of gap items. Each item uses one of four types:

```json
{
  "type": "missing_period | unsupported_assertion | contradiction | client_request",
  "summary": "",
  "source_refs": [],
  "why_it_matters": "",
  "lawyer_review_required": true
}
```

`source_refs` contains canonical source-block citations such as `FILE-0001 p1.b2`.
When no source exists for a missing period, `source_refs` should cite the source blocks that define the edges of the gap, if available.

Hard rule:

```text
Do not infer client failure. Only say no supporting document was found in extracted records.
```

## Gap Type Rules

### Missing Period

A time range where no source block explains a legally relevant interval.

Proof rule:

```text
No source block found between X and Y for the relevant issue.
```

### Unsupported Assertion

A claim or assertion appears in the record, but no supporting document is found in extracted records.

Proof rule:

```text
Cite the assertion source, then state that supporting material was not found in extracted records.
```

### Contradiction

Two or more source blocks conflict on date, event, party position, amount, service, possession, payment, or another material fact.

Proof rule:

```text
Cite each conflicting source block.
```

### Client Request

A lawyer-review-required request for documents or clarification derived from one of the gap types above.

Proof rule:

```text
Tie the request to a missing period, unsupported assertion, or contradiction.
Mark lawyer_review_required as true.
```

## JSON Shape

The exact engine schema can evolve, but the packet should preserve this conceptual shape:

```json
{
  "schema_version": "list-of-dates-packet/v1",
  "entries": [],
  "gaps": [
    {
      "type": "missing_period",
      "summary": "",
      "source_refs": [],
      "why_it_matters": "",
      "lawyer_review_required": true
    },
    {
      "type": "unsupported_assertion",
      "summary": "",
      "source_refs": [],
      "why_it_matters": "",
      "lawyer_review_required": true
    },
    {
      "type": "contradiction",
      "summary": "",
      "source_refs": [],
      "why_it_matters": "",
      "lawyer_review_required": true
    },
    {
      "type": "client_request",
      "summary": "",
      "source_refs": [],
      "why_it_matters": "",
      "lawyer_review_required": true
    }
  ]
}
```

## Export Rule

`/export_listofdates` may render PDF, DOCX, or printable bundles from this packet.
Export skills must not reinterpret facts or add new legal analysis.
