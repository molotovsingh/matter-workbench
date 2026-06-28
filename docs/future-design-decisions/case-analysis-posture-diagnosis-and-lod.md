# Case Analysis, Procedural Posture Diagnosis, and MW List of Dates

Date: 2026-06-28
Status: SME requirement capture

## Purpose

This note is downstream of the global [Legal Practice SME Q&A Ledger](legal-practice-sme-qna-ledger.md), which captures reusable litigation-practice rules across the app.

This is a live SME/product Q&A note for the next evolution of Matter Workbench's chronology and analysis workflow.

It should persist the reasoning we are building together, so later implementation does not flatten the legal workflow into a generic chronology generator.

The immediate focus is **diagnosis**, not drafting automation:

```text
source documents
  -> neutral Case Timeline
  -> Case Analysis Q&A / legal context capture
  -> Filing and Procedural Posture Diagnosis
  -> MW-authored List of Dates
  -> downstream lawyer-shaped drafts
```

## Core Distinction

### Case Timeline

The current neutral source-backed chronology should conceptually become **Case Timeline**.

Its job is to preserve and organize the factual record before legal advocacy:

- neutral / not party-biased at the first stage;
- source-backed;
- broad enough to contain all material events;
- useful even where facts are inconvenient or adverse;
- not shaped toward one prayer, filing, or argument.

The source documents remain the ultimate evidence. The Case Timeline is the primary structured fact spine.

### Case Analysis

Case Analysis is MW-authored legal analysis. It should hold the persistent reasoning layer over the Case Timeline:

- live Q&A and instructions;
- client side and interest;
- court/forum;
- governing statute or legal framework;
- procedural posture;
- possible remedies and imminent filings;
- priority order among filings/remedies;
- uncertainty and missing facts;
- diagnosis before drafting.

### MW List of Dates

The legal List of Dates is not merely the neutral Case Timeline.

It is an MW-authored, versioned, advocacy-aware chronology derived from Case Timeline plus Case Analysis. It should select and frame events for the main legal objective and remedy while staying source-backed and ethically complete.

It belongs under **Case Analysis**, not as the neutral primary chronology.

## Current Design Decisions

1. **Focus first on filing/procedural posture diagnosis.**
   The List of Dates should not be drafted until the app understands the court, filing posture, procedural posture, client objective, and possible remedies.

2. **Diagnosis can be differential.**
   It is acceptable, and often necessary, to identify several optional filings/remedies. Lawyers work by differential diagnosis before choosing the drafting path.

3. **One current MW List of Dates.**
   Do not produce multiple parallel LoDs for every possible filing at this stage. Produce one current MW LoD addressing the main issues and main remedy. Other later drafts may read from it as a source of truth.

4. **MW List of Dates is versioned.**
   The latest version should live directly in the Case Analysis folder. Earlier versions should move to an archive subfolder to avoid confusion.

   Proposed naming:

   ```text
   Case Analysis/
     Filing and Procedural Posture Diagnosis.md
     MW List of Dates v3 - 2026-06-28 19-10.md
     archive/
       MW List of Dates v1 - 2026-06-28 18-30.md
       MW List of Dates v2 - 2026-06-28 18-55.md
   ```

   Timestamp is required because more than one version may be generated on the same day.

5. **MW-authored analysis is distinct from lawyer-shaped drafts.**
   Case Analysis is MW-authored. Drafts are lawyer-shaped versions. The aspiration is that lawyers can later edit draft outputs through small instructions to LLMs, while MW analysis remains auditable.

6. **Adverse facts should be included if legally important.**
   Facts cannot be suppressed under law. They may be stated with proportionate treatment and responsible framing, but material adverse facts should not be silently omitted.

7. **Omitted / de-emphasized facts need a review section.**
   An advocacy LoD may select and emphasize facts. It should include an end section for facts considered but not emphasized, with a strict warning that this section is for lawyer review only and not for formal-facing consequential drafts.

8. **Skill first, native later.**
   The posture diagnosis and MW LoD should begin as a custom/governed skill or skill-family experiment. Once output quality is consistently right, the best parts can be promoted into native automation.

## Product Hypothesis

The first buildable artifact is not "Draft List of Dates".

The first buildable artifact should be:

```text
Filing and Procedural Posture Diagnosis
```

This diagnosis should come before any MW List of Dates and should answer, in priority order:

1. What court/forum appears relevant?
2. What is the current procedural posture?
3. What filings/remedies are possible?
4. Which filing/remedy appears most imminent or central?
5. What legal objective should the MW List of Dates serve?
6. What governing statute/rules/framework appear material?
7. What facts are central, introductory, adverse, missing, or uncertain?
8. What should the lawyer confirm before relying on the diagnosis?

## Persistent Case Analysis Q&A

Each matter should eventually have a persistent Case Analysis Q&A document that MW can read and build upon.

Purpose:

- preserve the lawyer's answers and corrections;
- prevent repeated questioning;
- let later analysis inherit prior context;
- keep assumptions visible;
- separate SME/lawyer instructions from source facts;
- create a matter-local reasoning trail without mutating source documents.

Proposed file:

```text
Case Analysis/Case Analysis Q&A.md
```

Possible structure:

```markdown
# Case Analysis Q&A

Author: MW + lawyer instructions
Matter: ...
Last updated: ...
Based on Case Timeline: ...

## Current Working Posture

- Client side:
- Court/forum:
- Procedural stage:
- Main objective:
- Possible filings/remedies:
- Priority filing/remedy:
- Governing statute/rules:

## Q&A Ledger

### 2026-06-28 19:15

**MW question:** Which court/forum is the immediate filing likely to be before?

**Lawyer answer:** ...

**Effect on analysis:** ...

## Assumptions To Verify

- ...

## Lawyer Corrections

- ...
```

This Q&A is not itself evidence. It is legal instruction/context for MW analysis and should not pollute the neutral Case Timeline unless a point is supported by source documents.

## Live Q&A Capture

### Q1. Should the List of Dates live inside Case Analysis, not as a primary neutral artifact?

**Answer:** Yes. The neutral artifact should be Case Timeline. The legal List of Dates belongs in Case Analysis because it depends on strategy, posture, remedy, court, and client interest.

### Q2. Should one Case Analysis produce multiple possible List of Dates versions?

**Answer:** No for now. There should be one version dealing with the main issues and main remedy. Other drafts can read from it as a source of truth.

### Q3. Should filing/posture diagnosis precede drafting the List of Dates?

**Answer:** Yes. This is critical. Filing posture and procedural posture diagnosis should precede the List of Dates. It is acceptable to identify several possible remedies/options as part of differential legal diagnosis. Priority order matters.

### Q4. Should every advocacy LoD record metadata such as client side, court, posture, intended filing, relief/objective, and Case Timeline version?

**Answer:** Metadata is important. Exact fields should be iterated once real outputs are reviewed.

### Q5. How should versioning work?

**Answer:** The latest MW LoD should live in the Case Analysis folder. Previous versions should be moved into an archive subfolder. Each version should be named `MW List of Dates v{n}` with date and time because the same day may have more than one version.

### Q6. Should MW-authored LoDs be locked/generated artifacts unless copied into lawyer drafts?

**Answer:** Case Analysis is MW-authored. Drafts are lawyer-shaped versions. The aspiration is for the lawyer to edit drafts through small LLM instructions later.

### Q7. Should omitted facts be listed for review?

**Answer:** Yes. They should appear at the end with a strict warning that they are not for formal-facing consequential drafts. Facts cannot be suppressed under law; they can only be stated with proportionate treatment.

### Q8. Should adverse facts be included by default if legally important?

**Answer:** Yes. Legally important adverse facts should be included with responsible framing rather than silently omitted.

### Q9. Should the neutral Case Timeline be the only place where all material events are expected?

**Answer:** Yes. The Case Timeline holds all material events. The List of Dates is selected and framed for the current legal purpose.

### Q10. Should this be native immediately or a skill first?

**Answer:** Skill first. Because LoD quality is heavily strategy- and procedural-posture-dependent, the interview should confirm court, legal objectives, governing statute, and related context. Once the output is right, it can become native and automated.

## Open Questions For Next Discussion

1. What is the minimum set of questions the posture diagnosis skill must ask before it can produce useful output?
2. Should Case Analysis Q&A be a single cumulative document, or should it also have archived versions?
3. Should the diagnosis explicitly rank filings/remedies as `primary`, `secondary`, `parked`, and `not advised yet`?
4. How should MW represent uncertainty without sounding indecisive?
5. How should lawyer corrections update the diagnosis and later MW LoD without silently rewriting history?
6. Should the Q&A document be exposed in the UI, or initially only as a generated artifact under Case Analysis?

## Non-Goals For Now

- Do not replace the current neutral chronology immediately.
- Do not automate court-specific filing templates yet.
- Do not make the MW LoD a final court-facing draft.
- Do not allow facts to be hidden from the neutral Case Timeline.
- Do not implement native automation before the diagnosis output is validated through real matters.
