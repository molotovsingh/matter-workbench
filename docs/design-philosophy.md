# Matter Workbench North Star Design Philosophy

Status: Durable product and engineering policy

This is a durable North Star for Matter Workbench. Future product, UX,
engineering, and documentation changes should comply with it within reasonable
implementation boundaries.

When a local implementation constraint forces a trade-off, the preferred move
is to keep the user-facing surface simple while preserving the rigorous spine,
then record the exception or follow-up explicitly.

## One Sentence

Matter Workbench should feel simple to a lawyer while remaining rigorous,
auditable, and conservative underneath.

The working shorthand is:

```text
simple surface, rigorous spine
```

This is not a slogan for making the app less capable. It is a rule for deciding
where complexity belongs.

## Geometric And Algebraic Thinking

Great Matter Workbench work comes from a productive tension between two kinds
of engineering judgment.

**Geometric thinking** asks about shape:

- Where does this responsibility live?
- What touches what?
- Which surface owns the user flow?
- Is this module becoming a gravity well?
- Does the UI feel like one clear place, or does it jump between surfaces?

**Algebraic thinking** asks about rules:

- What invariant must always hold?
- What input should produce the same output across storage modes?
- What status must imply what next action?
- What contract proves this behavior?
- Which tests would catch a quiet fork in the rule?

The shorthand is:

```text
geometry gives the architecture a sane shape
algebra gives the shape enforceable rules
```

If we use only geometry, we get attractive diagrams and strong instincts but
weak guarantees. If we use only algebra, we get correct small pieces that can
still feel fragmented, over-engineered, or confusing to users.

The best work keeps both:

- design the boundary so the app feels natural;
- name the rule so it can be tested;
- keep the lawyer-facing surface calm;
- keep the engineering spine provable.

## Why This Exists

Matter Workbench is doing legal work in a messy setting: scanned files,
incomplete records, uncertain OCR, source labels, chronology generation,
matter-bounded Copilot answers, custom skills, provider routing, telemetry, and
private beta operations.

If all of that complexity leaks into the lawyer-facing surface, the product
becomes intimidating. If we hide the complexity by weakening the rules, the
product becomes unsafe.

The correct answer is neither:

- a technical dashboard that expects lawyers to understand implementation
  details; nor
- a friendly wrapper that silently cuts corners.

The app should make the next useful action obvious, while preserving the legal
and engineering discipline needed to trust the output.

## What Users Should Feel

A first-time beta lawyer should not need to understand JSON, routes, schemas,
model policies, extraction records, provider payloads, or database custody.

They should feel:

- I know what to do next.
- I know which matter I am working in.
- I can tell whether preparation is still running, blocked, or complete.
- I can ask one concrete question and understand the answer's limits.
- I can report a problem without diagnosing it.
- I can create or run a skill without learning internal app architecture.
- I am not being asked to make technical decisions I do not understand.

This is especially important for a young advocate or first-time user. The UI
should assume intelligence, but not assume product knowledge.

## What The System Must Preserve

Under the simple surface, the system must keep its hard boundaries:

- source discipline;
- citation truth;
- raw source identity for audit;
- lawyer-facing labels for comprehension;
- no invented facts;
- no silent mutation of durable skills or artifacts;
- clear task boundaries between Copilot, skill creation, skill execution, and
  native workflows;
- private beta user isolation;
- telemetry and feedback that help developers fix real problems;
- explicit failure when the app is not safe to continue.

The lawyer should not have to see all of this machinery. But the app must not
abandon it.

## Design Rules

### 1. The surface explains actions, not internals

Use labels like:

- Add a new matter;
- Run needed preparation;
- Case Timeline;
- Source Labels;
- Have a problem? Tell us what happened.

Avoid making lawyers read terms like:

- JSON;
- provider payload;
- artifact registry;
- validation lifecycle;
- route;
- schema;
- extraction block.

Internal terms can remain in developer or operator surfaces when they help
debugging.

### 2. Simple does not mean vague

Plain language must still be precise.

Bad:

```text
Something went wrong.
```

Better:

```text
Reading documents failed. The app could not finish preparation for this matter.
Try again, or report the problem.
```

Best, when space allows:

```text
Reading documents failed. Preparation stopped before Source Labels and List of
Dates could be rebuilt. Report this problem if retrying does not work.
```

The user does not need stack traces, but they do need the consequence.

### 3. The app should guide, not interrogate

Questions should move the user forward.

For skill creation, the app should ask for what it needs in the language of the
work:

- What should this skill help the lawyer decide or prepare?
- What record should it read?
- Should the output be internal analysis or a draft for sharing?
- What should this skill be called?

The final name question should be based on the intent the app has learned, not a
mechanical text transformation.

### 4. Generated work is never final legal work

The product should make lawyer review feel natural, not optional.

Generated outputs can be useful, but the app should preserve:

- preparation advisories;
- OCR warnings;
- source-label review states;
- activity receipts;
- feedback reports;
- matter-bounded answer limits.

The app should not sound apologetic for being cautious. It should be calm,
specific, and helpful.

### 5. Hide technical detail by default, but keep it recoverable

The normal lawyer surface should show the legal workflow.

Operator, developer, or audit surfaces may show:

- provider and model;
- raw citation handles;
- database workspace status;
- job identifiers;
- technical logs;
- file custody and telemetry details.

This lets the app serve two needs: simple usage and serious debugging.

### 6. When in doubt, preserve user trust over speed

For legal work, a fast wrong answer is worse than a slower transparent one.

This applies especially to:

- OCR quality;
- source labels;
- List of Dates;
- Copilot answers;
- custom skill outputs;
- matter/user isolation.

The user can tolerate a visible wait. They should not have to tolerate hidden
uncertainty.

## Examples

### Uploading A Matter

The user should see:

```text
Add a new matter
Attach source files
Create matter
Preparation starts automatically
```

The system should still handle:

- file custody;
- checksums;
- source identity;
- extraction;
- OCR repair;
- advisory generation;
- telemetry if something fails.

### Copilot

The user should see:

```text
Ask about this matter
Using Low / Medium / High
```

The system should still enforce:

- matter-bounded context;
- no chat memory unless explicitly implemented;
- source-backed answers;
- model switch ping checks;
- task boundaries so Copilot model choice does not affect durable workflows.

### Skills

The user should see:

```text
Your Skills
Skills in Progress
Built-in Workflows
History
```

The system should still enforce:

- skill idea lifecycle;
- sample approval;
- overlap checks;
- validation;
- versioning;
- pause/archive/delete controls;
- run receipts and output custody.

### Feedback

The user should see:

```text
Have a problem? Tell us what happened
```

The system should still capture:

- user;
- matter;
- current screen;
- recent activity;
- failure signals;
- telemetry useful for triage.

The user reports experience. The system collects evidence.

## Decision Test

Before adding or changing a surface, ask:

1. Is the lawyer being asked to understand an implementation detail?
2. Can the same control be phrased as a legal-work action?
3. Does simplifying the UI weaken any legal-output rule?
4. If something fails, will the user know what stopped and what to do next?
5. Can an operator or developer still recover the technical evidence?
6. Does this make first use easier without making later audit weaker?

If the answer to question 3 is yes, the design is wrong. Simplify the surface,
not the spine.

## Non-Goals

This philosophy does not mean:

- hiding important warnings;
- removing audit trails;
- making AI outputs sound more certain than they are;
- turning every workflow into a chat interaction;
- deleting developer tools needed for beta operations;
- letting model choice override app policy;
- treating legal review as a formality.

## Relationship To Existing Contracts

This document is a product and engineering lens. It does not replace current
contracts.

When there is a conflict, the more specific contract controls. Important
contracts include:

- `docs/contracts/source-identity-and-labels.md`;
- `docs/contracts/artifact-visibility-and-dispatch.md`;
- `docs/contracts/custom-skill-governance.md`;
- `docs/contracts/model-task-boundaries.md`;
- `docs/contracts/diagnostic-surfaces.md`;
- `docs/copilot-qna-contract.md`;
- `docs/ocr-strategy.md`.

The philosophy explains how those rules should feel in the product.
