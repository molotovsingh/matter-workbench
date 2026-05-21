# AI-Native Skill Router

The skill router sits before skill creation or modification. It reads a natural-language user request, compares it against `skills/registry.json`, and returns a structured routing decision.

The current Skills tab is read-only. It displays built-in skill stubs and
matter-derived artifact status, but it does not create, edit, activate, or run
configurable skills.

`GET /api/skills` should remain the shared metadata source for the Command
rail, Skills tab, router context, and future supervision flows. The router
compares capability requests; it does not own runtime execution.

For the future user-created-skill lifecycle, see
[New Skill Creation Contract](new-skill-creation-contract.md). The router is
only the overlap gate. It must not by itself create runnable skills.

For future changes to existing configurable skills, see
[Skill Modification Contract](skill-modification-contract.md). The router may
recommend modification, but it must not mutate or activate a skill.

## Product Principle

```text
Command rail = deterministic command layer and proposal capture surface
Skill Router = architectural gatekeeper
Skill Registry = source of truth for capabilities
Slash Skills = auditable execution machinery
Skill Tuning = versioned expert guidance
Artifacts/logs = audit trail
```

The router may use AI for fuzzy language understanding, but the app owns the gate. It must not silently create duplicate skills.

The router is not the future Copilot Q&A engine. Matter questions should follow
[Copilot Q&A Contract](../../copilot-qna-contract.md), use the bounded context packet,
and validate citations. Skill routing decides whether a user wants a capability
or workflow change.

## Relationship To New Skill Creation

The router decides whether a user idea overlaps existing capability. It is not
the skill lifecycle.

A future `/new_skill` flow should use this order:

```text
adaptive skill interview
  -> test matter selection
  -> sample output
  -> feedback and sample revision
  -> approved sample
  -> router overlap check
  -> create draft configurable skill
  -> validate against approved sample
  -> activate slash command
```

The router may recommend `new_skill`, `adjacent_skill`, or
`modify_existing_skill`, but it is only the overlap gate. It must not tell the
user a slash command is usable. A future skill may say `Use /<skill_name>` only
after the configurable skill is created, validated, activated, and visible in
the Command rail.

## Relationship To Skill Modification

When the router recommends `modify_existing_skill`, the next step should be a
visible user gate:

```text
Approve modification
  -> create draft revision
  -> test revised behavior
  -> save or paste golden
  -> validate
  -> activate
```

The router must not:

- edit the active skill brief;
- create a hidden replacement skill;
- activate a revision;
- weaken citation/source rules from an AI decision alone.

Built-in code-backed skills are not editable through this path. A request to
change `/extract`, `/describe_sources`, `/create_listofdates`, or another
built-in skill is a product/engineering change request, not a configurable-skill
revision.

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
