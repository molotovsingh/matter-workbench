# Skill Interview Owner Test Plan

Date: 2026-06-25
Status: Owner reading / testing note — no implementation decision yet

## Why This Note Exists

The Skill Factory interview is probably the right primitive for Matter Workbench.
Legal workflow intent is often not captured by a single prompt. A short interview
can discover:

- what the lawyer actually wants;
- what document types matter;
- what output should look like;
- what legal risk level applies;
- what should stay out of scope;
- whether the user wants a one-time answer or a reusable workflow.

So the issue is not whether interviews are good. They probably are.

The question is whether the current interview feels like a smart legal assistant
or like a generic product form.

Before redesigning it, the owner should test the current flow firsthand.

## Current Concern

The current planner may be doing two things at once:

1. correctly protecting Matter Workbench from frivolous/code/non-legal use;
2. sometimes asking standard workflow questions even when the user’s intent is
   already clear.

Example concern:

```text
User: Create a reusable skill to produce a comparison chart of terms.
```

The interview may ask about audience, format, presets, exclusions, and other
workflow-design details. Some of those questions are useful, but too many can
make the assistant feel like it missed the simple intent: “make me a comparison
chart.”

The desired behavior is closer to:

```text
I understand: you want an internal source-backed comparison table.
I’ll assume Markdown table, matter sources, and lawyer review.
I only need three choices:
1. Which documents should be compared?
2. Which term categories matter most?
3. Should I only extract stated terms, or also flag conflicts and omissions?
```

That is still an interview, but it is assumption-led and intent-aware.

## Working Hypothesis

The current safety posture may be correct, but the interview style may need
calibration.

Do not loosen legal safety yet.

Instead, test whether the interview should become:

```text
fewer questions
better assumptions
more legal-intent awareness
less generic audience/format discovery
```

## What Should Stay Protected

The interview should continue to avoid:

- generating code;
- creating arbitrary scripts or software workflows;
- helping with frivolous/non-matter tasks;
- pretending a skill is created before sample/approval;
- producing legal conclusions without source support;
- silently creating or mutating active skills;
- turning a one-time Ask into a reusable skill without user intent.

The interview should stay matter/workflow-specific.

## What May Need Improvement

The interview may need to ask fewer generic questions when the user has already
signaled enough.

Potential overused questions:

- “Who is the audience?”
- “What format do you want?”
- “What should be out of scope?”
- “Do you want a summary?”
- “Do you want presets?”

These are sometimes useful, but should not be automatic.

They matter more for:

- client-facing drafts;
- dispatch-facing documents;
- court-facing filings;
- external communication;
- high-risk legal opinions.

They matter less for:

- internal comparison tables;
- contradiction charts;
- party maps;
- evidence gap reviews;
- source-backed issue lists.

## Suggested Owner Test

Use the current product exactly as a lawyer would.

Do not pre-decide the redesign.

Create a few skill ideas from the UI and observe:

1. Does the assistant understand the task?
2. Does it ask legally useful questions?
3. Does it ask too many generic questions?
4. Does it infer obvious defaults?
5. Does the sample reflect the intended workflow?
6. Would a lawyer continue, or abandon the flow?

## Test Prompts

### 1. Broad comparison chart

```text
Create a reusable skill to produce a comparison chart of terms.
```

Watch for:

- Does it infer “internal comparison table”?
- Does it ask only the missing scoping questions?
- Or does it ask a long generic workflow questionnaire?

Good questions:

- Which documents or document types should be compared?
- Which term categories should be included?
- Should it only extract stated terms, or also flag conflicts/omissions?

Less useful early questions:

- Who is the audience?
- Do you want presets?
- What should stay out of scope?

### 2. Specific inconsistency table

```text
Create a skill that compares the sale deed, loan agreement, notices, and pleadings, then produces a table of inconsistent terms with source citations.
```

Watch for:

- Does it connect to sale deed / loan agreement / notices / pleadings?
- Does it ask what counts as inconsistency?
- Does it ask whether to include omissions and soft mismatches?
- Does it preserve source-backed citations?

This should require fewer questions than the broad comparison-chart prompt.

### 3. Limitation review

```text
I want a limitation review skill for this matter. Identify when limitation starts, acknowledgements or part-payments, extension/exclusion issues, and whether claims are time-barred.
```

Watch for:

- Does it ask about legal setting/statute/forum?
- Does it ask whose perspective to use?
- Does it ask what conclusion shape is wanted?
- Does it preserve uncertainty and source discipline?

This is high-risk and should ask more careful legal questions.

### 4. Client update email

```text
Draft a client update email from the latest matter record focusing on next steps, in a warm but careful tone.
```

Watch for:

- Does it infer client-facing draft?
- Does it ask about legal assessment vs procedural update?
- Does it ask what “latest matter record” means?
- Does it avoid raw citations in the client-facing draft?

Audience/tone questions are more acceptable here because the output is external.

### 5. Contradiction review

```text
Make a skill that finds contradictions between the complainant statement, defence reply, and medical records, with citations and a risk note.
```

Watch for:

- Does it ask what counts as contradiction?
- Does it ask defence-focused vs neutral?
- Does it ask how to handle ambiguous medical records?
- Does it avoid overclaiming legal significance?

This should feel like a legal review interview, not a generic format interview.

## Scoring Rubric

For each interview, score 1 to 5.

| Dimension | 1 | 5 |
| --- | --- | --- |
| Intent understanding | Misses the task | Clearly understands the legal workflow |
| Question quality | Generic/form-like | Sharp legal/workflow questions |
| Question count | Too many | Only what is needed |
| Assumption quality | Asks obvious things | Infers sensible defaults |
| Safety posture | Too loose or too gagged | Safe but useful |
| Sample usefulness | Does not reflect intent | Looks like the desired artifact |

## Signs The Current Posture Is Correct

The current interview may be good enough if:

- the questions feel legally relevant;
- it catches ambiguity before sample generation;
- the sample output improves after answering;
- the user feels guided, not blocked;
- it avoids non-legal/code/frivolous drift;
- it does not create skills prematurely.

## Signs The Interview Needs Calibration

The interview likely needs changes if:

- it asks 7–10 questions for a simple internal table;
- it repeatedly asks audience/format when obvious;
- it sounds like a generic SaaS setup wizard;
- it misses legal intent already present in the prompt;
- the sample is generic despite detailed input;
- the user has to restate the same intent multiple times.

## Possible Future Adjustment

If testing confirms the concern, the likely adjustment is not to remove
interviews.

The adjustment is:

```text
assumption-led interview
```

Meaning:

1. summarize understood intent;
2. state sensible defaults;
3. ask only the missing choices;
4. proceed to sample quickly;
5. allow correction/regeneration.

Example:

```text
I understand this as an internal source-backed inconsistency table.
I’ll assume Markdown, lawyer-review tone, and citations.

I only need:
1. Should omissions count as inconsistencies?
2. Should the risk note be neutral or defence-focused?
3. Should the output include follow-up actions?
```

## Decision Rule

Do not change the interview logic yet.

First, the owner should create at least 3–5 real skill ideas in the current UI
and judge whether the questions help or irritate.

If the current flow feels good in real use, keep it.

If it feels too generic, adjust the planner toward fewer, sharper,
assumption-led questions while keeping the legal safety posture intact.
