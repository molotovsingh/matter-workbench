# AI-Native Skill Router

The skill router sits before skill creation or modification. It reads a natural-language user request, compares it against `skills/registry.json`, and returns a structured routing decision.

## Product Principle

```text
AI box = natural language command layer
Skill Router = architectural gatekeeper
Skill Registry = source of truth for capabilities
Slash Skills = auditable execution machinery
Skill Tuning = versioned expert guidance
Artifacts/logs = audit trail
```

The router may use AI for fuzzy language understanding, but the app owns the gate. It must not silently create duplicate skills.

## MECE Categories

```text
Ingest
Extract
Organize
Analyze
Draft
Review
Export
Maintain
```

## Direct MECE Violation

```text
same category
+ same goal
+ same input contract
+ same output contract
= MECE violation
```

When this happens, the router returns `needs_user_approval` with `recommended_action: "modify_existing_skill"`.

The user gate has two paths:

```text
[Approve modification]
[Justify new skill]
```

If the user justifies a new skill, the router re-evaluates the request against distinct purpose, input contract, output contract, workflow stage, reviewer/audience, and legal setting.

## Legal Setting Awareness

Skill identity is not only functional. It also includes legal setting:

```json
{
  "jurisdiction": "India",
  "forum": "Delhi High Court",
  "case_type": "Writ Petition",
  "procedure_stage": "Filing",
  "side": "Petitioner",
  "relief_type": "Article 226 writ"
}
```

Different forums may require different profiles or tuning, but not automatically separate skills. A new skill is justified only when the legal setting changes the workflow, input contract, output contract, or review path enough that a profile or tuning is insufficient.

## Markdown-First Rule

All AI-generated legal work product is Markdown-first until the review/export layer is mature. DOCX and PDF are downstream `Export` skills, not primary AI drafting outputs.

## V1 Endpoints

```text
GET  /api/skills
POST /api/skills/check-intent
```

`POST /api/skills/check-intent` sends only the user request and registry cards to the AI provider. It does not send matter documents or extraction records.
