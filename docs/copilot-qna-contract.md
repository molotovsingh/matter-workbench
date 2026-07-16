# Matter Co-pilot Product Policy

Date: 2026-05-12

Audience: main coding session for `matter-workbench`

Status: product policy and runtime contract. This document records the safe
future shape for matter Co-pilot behavior. The first runtime slice may still be
Q&A-only, but the product layer is broader than Q&A.

## Why This Exists

The current Command rail is intentionally deterministic. It can run known
skills, show status, open lanes, preview context, and search the bounded context
packet locally.

That is different from Matter Co-pilot.

The Skills tab is a governance surface for built-in and configurable skills. It
can explain capabilities, provider posture, sample history, and skill-factory
health, but it is not a Q&A/chat surface.

Matter Co-pilot should eventually let the user ask:

```text
what is the strongest limitation point?
what compensation can Mehta claim?
what documents contradict Skyline's reply?
prepare a table of issues from the record
where is the addendum agreement?
what is the best opening hook for first argument?
change para 8 of the grounds to add this case law
```

Those requests are useful, but they are not harmless. A poor answer can look
authoritative even when the record does not support it, and a poor amendment
can silently damage a lawyer-owned draft. The app therefore needs a contract
before provider-backed Co-pilot behavior becomes broad.

## Product Rule

Matter Co-pilot is the freeform matter-work layer over prepared matter context,
source-backed Library artifacts, and lawyer-owned drafts.

It is not the same thing as a native skill.

Native skills create governed, repeatable artifacts such as Source Labels /
Document Index and Case Timeline. Co-pilot helps the lawyer do transient matter
work: locate, explain, compare, strategize, test framing, draft small passages,
or amend an existing draft when an explicit draft/amendment workflow exists.

Co-pilot may not silently become an artifact writer, skill runner, dispatch
engine, or source of uncited legal conclusions.

The first Q&A version should stay explicit:

```text
/ask what compensation can Mehta claim?
ask what compensation can Mehta claim?
```

Do not start by letting arbitrary unsupported text auto-route into paid Q&A or
paid Co-pilot work.

## Product Layers

Use this separation when implementing future surfaces:

```text
native skills -> governed source-backed artifacts
co-pilot -> freeform active-matter thinking and transient help
draft amendment -> explicit proposed change to a lawyer-owned draft
dispatch -> frozen sent/filed snapshot
```

The practical meaning:

- Co-pilot can help find, explain, compare, and strategize from the active
  matter context.
- Co-pilot answers are not durable matter artifacts by default.
- Draft text in `30_Drafts` or outside the app is lawyer-owned working text.
- Surgical draft amendments should target a paragraph, section, issue, or
  selected passage and produce a preview/diff or new version.
- Human edits are authoritative. The app should not regenerate over them by
  default.
- `40_Dispatch` copies are frozen snapshots. Further changes require a new
  working draft.

## Relationship To Current Context Work

Co-pilot must use the existing bounded matter context packet:

```text
matter-context-packet/v1
```

The context reader decides what evidence is allowed into the model prompt. The
Co-pilot layer decides how to answer or propose work with that evidence.

Use [Matter Context Reader Contract](matter-context-reader-contract.md) before
implementing this runtime. If the context packet cannot be built or contains no
citable evidence, Co-pilot is not ready for source-backed matter answers.

## Work Classes

Co-pilot work should be classified before provider calls.

| Work class | Example | Artifact behavior |
| --- | --- | --- |
| Locate | `where is the addendum agreement?` | Prefer deterministic/local search first; no artifact. |
| Explain | `what does the State Commission say on limitation?` | Chat answer with cited support; no artifact. |
| Strategize | `what is the best hook for first argument?` | Chat answer with facts/inferences separated; no artifact. |
| Compare | `what contradicts the builder's reply?` | Chat answer or temporary table; no artifact unless exported. |
| Draft passage | `give me a tighter version of this ground` | Proposed text only; not a filed/sent draft. |
| Amend draft | `change para 8 of the grounds...` | Explicit preview/diff/new-version workflow; no silent overwrite. |

The first runtime implementation can support only the first two or three
classes. The policy still records the larger product direction so future slices
do not accidentally treat every Co-pilot request as either Q&A or custom-skill
creation.

## What V2 Proves

The useful v2 flow is:

```text
matter-workbench-v2/frontend/unibox.js
  -> POST /api/unibox
  -> services/unibox-service.mjs
  -> no-matter gate
  -> intent classifier
  -> matter-qa-service.mjs
  -> answer + sources + confidence
```

V2 proves these ideas are useful:

- one right-side surface can carry questions, search, and skills;
- no-matter checks should happen before provider calls;
- follow-up questions need conversation context;
- chat export is useful for review and sharing;
- Q&A should return `answer`, `sources`, and `confidence`;
- search and Q&A should remain separate paths.

What this repo should not copy blindly:

- broad AI intent classification as the first Q&A entry point;
- flat large text prompts as the only context boundary;
- trusting model-returned citations without local validation;
- allowing Q&A to look like a durable legal artifact.

## First Runtime Shape

The first Co-pilot runtime slice should be narrow:

```text
Command rail
  -> explicit /ask or ask <question>
  -> provider-backed answer
  -> chat-only result
  -> Copy Answer Report
```

No durable matter files should be written.

No `10_Library`, `20_Workshop`, `30_Drafts`, or `40_Dispatch` artifact should
be created.

If the user wants a durable output, the app should guide them toward an
explicit skill, export, or future draft/amendment workflow.

## Input Contract

Allowed first-version inputs:

```text
/ask <question>
ask <question>
```

Optional later aliases:

```text
question <question>
answer <question>
```

Do not overload `search <term>` or `find <term>`. Those should continue to mean
local context search, not provider-backed Q&A.

Unsupported free text should continue through the existing deterministic
command/router-check path until Q&A has enough guardrails to be the default.

## Output Contract

The answer should return structured data:

```json
{
  "schema_version": "matter-copilot-answer/v1",
  "question": "what compensation can Mehta claim?",
  "answer": "source-backed markdown answer",
  "sources": [
    {
      "raw_citation": "FILE-0001 p1.b2",
      "source_label": "Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026",
      "snippet": "bounded quoted or paraphrased support"
    }
  ],
  "confidence": 0.82,
  "answer_status": "answered",
  "warnings": [],
  "ai_run": {
    "provider": "openrouter",
    "model": "openai/gpt-4.1",
    "returnedProvider": "OpenAI"
  }
}
```

Possible `answer_status` values:

```text
answered
partial
not_found
blocked
failed
```

Use `not_found` when the current context packet does not contain enough cited
support.

Use `blocked` when the user asks for a durable artifact, final filing, dispatch,
uncited opinion, or unsafe instruction.

## Citation Validation

Model-returned citations are not trusted automatically.

After the provider returns an answer, the app must check:

- every source citation matches a citation in the context packet;
- every factual paragraph maps to at least one raw `FILE-NNNN pX.bY` citation
  internally;
- readable labels are display metadata only, not proof;
- normal lawyer-visible rendering should prefer source labels;
- raw citations must remain available in structured data, audit views, hover
  details, or copy reports;
- citation-free answers are allowed only for `not_found`, `blocked`, or purely
  operational messages.

If citation validation fails, the app should fail closed or show the answer as
unverified. The safer first version is to fail closed.

## Answer Style

The answer should be lawyer-friendly but disciplined:

- concise first answer;
- cite every factual point;
- distinguish facts, inferences, and legal assessment;
- say when the record is silent;
- avoid final conclusions like "proved fraud" unless the cited record directly
  supports that wording;
- preserve the user's side/client context without inventing facts.

Preferred pattern:

```text
Short answer.

Why it matters:
- cited point...
- cited point...

Limits / needs review:
- what the current record does not show...
```

## Conversation State

Product principle:

```text
Stateful for conversation, stateless for evidence.
```

Users reasonably expect Copilot to understand follow-ups such as "after that",
"what source supports it?", or "summarise the above". The app may use bounded
conversation state to understand those references. It must not use conversation
state as proof.

### Phase 1 - visible in-session thread

The lowest-risk UX improvement is a visible in-session transcript:

```text
User
Assistant
User
Assistant
```

This may be browser-local only. It does not need durable storage and does not
change the evidence contract.

Allowed:

- show prior turns in the UI;
- reset the thread from the UI;
- copy/export the visible thread for sharing;
- include provider/model and validated citations in the export.

### Phase 2 - bounded follow-up context

A later first real stateful version may send a capped conversation window to the
backend as disambiguation context:

```json
{
  "question": "What happened after that?",
  "matterName": "X",
  "conversation": [
    { "role": "user", "content": "What is the procedural history?" },
    { "role": "assistant", "content": "The record indicates..." }
  ]
}
```

Rules for bounded follow-up context:

- cap by turns and characters, e.g. last 4-6 turns or about 6k chars;
- use prior turns only to resolve references like `that`, `above`, `same party`,
  or `after this date`;
- re-ground every factual/legal answer in the current matter context packet;
- do not treat previous assistant answers as evidence;
- do not cite previous assistant answers;
- if the follow-up cannot be resolved safely, ask the user to restate.

The provider prompt must say:

```text
Use previous turns only to understand the user's reference. Do not rely on
previous assistant answers for facts. Do not cite previous assistant answers. If
the current matter record does not support the answer, say so.
```

### Phase 3 - durable conversation threads

Durable matter conversation threads are a separate future product decision. Do
not implement them as part of the first stateful Copilot work.

Durable threads would require decisions about:

- retention and deletion;
- tenant/user scoping;
- whether chats are matter records or only app activity;
- whether a thread can be converted into a draft, issue note, or research memo;
- how stale matter context invalidates old answers.

### Not allowed without a separate contract

- write chat history into the matter folder by default;
- include prior chat history in the matter context packet;
- treat prior assistant answers as evidence;
- let chat memory override extracted records;
- carry memory across matters;
- persist global Copilot memory;
- use a prior unsupported answer as support for a later answer.

## Provider And Cost Rules

Provider-backed Co-pilot work is a paid AI action unless it resolves through
deterministic local search. The UI should show:

- provider;
- model;
- chat-only/no-artifact status;
- whether citations were locally validated;
- whether the answer used a bounded context packet;
- approximate cost when provider metadata is available.

The first implementation should not add automatic fallback. Provider failure
should fail closed.

Recommended Q&A default can follow the beta list-of-dates model posture unless
a separate Co-pilot bakeoff says otherwise:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=openai/gpt-4.1
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
```

Do not reuse this blindly for draft amendment or external-facing drafting.
Q&A, strategy, and draft amendment are different risk classes even when they
share the same Co-pilot surface.

## Search Versus Q&A

Keep local context search and Co-pilot Q&A separate.

Local search:

```text
find payment
search legal notice
/context_search payment
```

- no provider call;
- no answer synthesis;
- returns matching blocks/snippets;
- read-only.

Co-pilot Q&A:

```text
ask what payments are disputed?
/ask what payments are disputed?
```

- provider call;
- answer synthesis;
- citation validation;
- chat-only output.

This distinction matters because search is evidence retrieval, while Q&A is
legal-language synthesis.

Surgical amendment is a third path. It should not be smuggled through local
search or Q&A. It needs draft selection, target passage identification, preview,
and acceptance/versioning semantics.

## No-Matter Rule

If no matter is active, Q&A must stop before provider calls:

```text
Pick a matter before asking a matter question.
```

Do not send user questions or empty context to a provider.

## Not In First Slice

Do not add these in the first Co-pilot runtime PR:

- semantic/vector search;
- document drafting or draft amendment;
- final pleading generation;
- dispatch/email;
- durable chat memory;
- autonomous multi-step plans;
- AI intent classifier for all free text;
- automatic skill execution from Q&A;
- configurable skill creation/modification inside Q&A;
- writing answers into `10_Library` or `30_Drafts`.

## Acceptance Criteria

Future runtime work should prove:

- `/ask <question>` requires an active matter;
- the provider receives `matter-context-packet/v1`, not raw files;
- answer citations are locally validated against the packet;
- unsupported questions return `not_found` rather than speculation;
- search commands still stay local and provider-free;
- no matter artifacts are written;
- provider/model metadata is visible;
- Copy Answer Report excludes secrets, raw source dumps, and full extraction
  records;
- tests use fake providers and fake matter fixtures;
- live smoke on a real matter checks for citation validity and legal tone.
