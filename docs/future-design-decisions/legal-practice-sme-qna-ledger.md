# Legal Practice SME Q&A Ledger

Date: 2026-06-28
Status: SME requirement capture / living ledger

## Purpose

This is the global Matter Workbench SME Q&A ledger for litigation-practice nuance.

It is not matter-specific. It records legal practice rules, drafting instincts, workflow distinctions, ethical boundaries, terminology choices, and product-alignment decisions that emerge from discussion with the SME/operator.

The goal is to transfer legal-practice judgment into durable product memory:

```text
SME discussion
  -> practice rule
  -> product implication
  -> future contract / skill / prompt / test / UX copy
```

This ledger is intentionally broader than any one artifact such as chronology, Case Analysis, List of Dates, drafts, or intake. It should hold reusable litigation-practice rules that can later be promoted into canonical contracts or implementation plans.

## Scope

Use this ledger for:

- litigation workflow nuance;
- drafting and advocacy principles;
- legal ethics / adverse-fact handling;
- court/forum/procedural posture reasoning;
- distinction between neutral fact work and advocacy work;
- terms lawyers expect vs app/internal terms;
- what MW should ask before generating;
- rules that should guide native skills, custom skills, prompts, UX labels, and artifacts.

Do not use this ledger for:

- matter-specific facts or instructions;
- client confidential details;
- one-off bug reports;
- implementation TODOs without practice rationale;
- final product contracts unless promoted elsewhere.

Matter-specific Q&A belongs in a matter-local artifact such as:

```text
Case Analysis/Case Analysis Q&A.md
```

This global ledger answers:

```text
How litigation practice works.
```

A matter-local Q&A answers:

```text
How this matter should be understood.
```

## Entry Format

Use this format for future entries:

```markdown
### Q: ...?

**Answer / SME rule:**
...

**Practice rationale:**
...

**Product implication:**
...

**Status:** Proposed | Accepted SME rule | Needs validation | Promoted to contract

**Promote / link to:**
- ...
```

## Ledger Entries

### Q: Should the first chronology be neutral or advocacy-shaped?

**Answer / SME rule:**
The first chronology should be neutral, source-backed, and not biased toward either party. Lawyers need to see the facts as they are at the first stage before deliberately shaping facts toward a legal end.

**Practice rationale:**
A lawyer first understands the record. Only after identifying the dispute, client interest, procedural posture, and remedy does the lawyer shape the chronology into an advocacy instrument. Prematurely biased chronology is dangerous because it can hide weaknesses and distort case understanding.

**Product implication:**
The current neutral List of Dates should conceptually be renamed **Case Timeline**. It should remain the source-backed factual spine. A later legal List of Dates should be derived from Case Timeline plus Case Analysis.

**Status:** Accepted SME rule.

**Promote / link to:**
- [Case Analysis, Procedural Posture Diagnosis, and MW List of Dates](case-analysis-posture-diagnosis-and-lod.md)
- Chronology / Case Timeline terminology contract when created.

### Q: What is a legal List of Dates in litigation practice?

**Answer / SME rule:**
A good legal List of Dates is not every fact in chronological order. It is a selected and framed chronology built by a draftsman to explain and argue a point of view, centered on the main issues, procedural posture, client objective, and remedy.

**Practice rationale:**
Lawyers include introductory facts and central events needed to build the legal story. They do not treat every extracted fact with equal weight. The List of Dates is an advocacy-aware instrument, not a raw chronology dump.

**Product implication:**
The advocacy List of Dates should live under **Case Analysis**, not as the neutral primary chronology. It should be MW-authored, versioned, source-backed, and downstream of posture diagnosis.

**Status:** Accepted SME rule.

**Promote / link to:**
- [Case Analysis, Procedural Posture Diagnosis, and MW List of Dates](case-analysis-posture-diagnosis-and-lod.md)
- Future Case Analysis skill design.

### Q: Should filing and procedural posture diagnosis precede drafting a List of Dates?

**Answer / SME rule:**
Yes. Filing posture and procedural posture diagnosis are critical and should precede the MW List of Dates. The diagnosis may identify several possible remedies or filings, because lawyers work through differential diagnosis before selecting the path.

**Practice rationale:**
The same facts may support different legal moves depending on forum, stage, statute, limitation, remedy, and urgency. A List of Dates without posture diagnosis may be polished but legally misdirected.

**Product implication:**
The first buildable Case Analysis artifact should be **Filing and Procedural Posture Diagnosis**, not the final LoD. It should identify court/forum, stage, possible filings/remedies, priority, uncertainty, and lawyer-confirmation needs.

**Status:** Accepted SME rule.

**Promote / link to:**
- [Case Analysis, Procedural Posture Diagnosis, and MW List of Dates](case-analysis-posture-diagnosis-and-lod.md)
- Future posture diagnosis skill.

### Q: How should adverse or inconvenient facts be handled?

**Answer / SME rule:**
Legally important adverse facts should be included with responsible framing. Facts cannot be suppressed under law. They may be stated without excessive treatment, but material facts should not be silently omitted.

**Practice rationale:**
Advocacy permits emphasis and proportionate treatment; it does not permit concealment of material facts. Lawyers must know adverse facts to assess risk and draft responsibly.

**Product implication:**
MW outputs should distinguish between selected/emphasized facts and facts considered but not emphasized. The latter can appear in an internal review section with a strict warning that it is not for formal-facing consequential drafts.

**Status:** Accepted SME rule.

**Promote / link to:**
- Legal output policy.
- Case Analysis / MW LoD output schema.

### Q: Should MW-authored analysis and lawyer-shaped drafts be separate?

**Answer / SME rule:**
Yes. **Case Analysis** is MW-authored. **Drafts** are lawyer-shaped versions. The aspiration is for lawyers to edit drafts through small LLM instructions while MW analysis remains auditable.

**Practice rationale:**
There must be a clean boundary between machine-generated analysis and documents a lawyer shapes for legal use. This keeps responsibility, review, and version history clear.

**Product implication:**
MW-authored Case Analysis artifacts should not be silently mutated into final drafts. Lawyer-facing drafts should be separate artifacts, possibly derived from MW analysis.

**Status:** Accepted SME rule.

**Promote / link to:**
- Artifact visibility and dispatch contract.
- Case Analysis skill design.

### Q: How should MW List of Dates versions be organized?

**Answer / SME rule:**
There should be one current MW List of Dates in the Case Analysis folder. Previous versions should move to an archive subfolder. Each version should be named `MW List of Dates v{n}` with date and time because more than one version can be generated on the same day.

**Practice rationale:**
Multiple visible versions in the same folder are confusing. Lawyers need a current working artifact, with earlier reasoning preserved but not competing for attention.

**Product implication:**
Use a latest-plus-archive pattern:

```text
Case Analysis/
  MW List of Dates v3 - 2026-06-28 19-10.md
  archive/
    MW List of Dates v1 - 2026-06-28 18-30.md
    MW List of Dates v2 - 2026-06-28 18-55.md
```

**Status:** Accepted SME rule.

**Promote / link to:**
- Case Analysis artifact lifecycle contract when created.

## Relationship To Other Notes

This ledger is the reusable practice-rule source. Specific product notes should link here rather than restating broad legal-practice principles.

Current related notes:

- [Case Analysis, Procedural Posture Diagnosis, and MW List of Dates](case-analysis-posture-diagnosis-and-lod.md)
- [Chronology / List of Dates](native-skill-chronology-list-of-dates.md)
- [Court-Facing Drafts Workbench](court-facing-drafts-workbench.md)
- [Legal Workbench Policy Prompt](legal-workbench-policy-prompt.md)

## Maintenance Rules

- Add new SME rules here when the discussion reveals reusable legal practice judgment.
- Keep entries concise but preserve the legal rationale.
- Mark whether a rule is proposed, accepted, needs validation, or promoted.
- Do not put client-specific facts here.
- When a rule becomes implementation authority, promote it into a canonical contract and link back to this ledger.
