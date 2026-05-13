# Copilot Q&A Contract

Date: 2026-05-12

Audience: main coding session for `matter-workbench`

Status: planning note only. This document records the safe future shape for
matter Q&A / Copilot behavior. It does not add runtime behavior.

## Why This Exists

The current Command rail is intentionally deterministic. It can run known
skills, show status, open lanes, preview context, and search the bounded context
packet locally.

That is different from Copilot Q&A.

The Skills tab is a governance surface for built-in and configurable skills. It
can explain capabilities, provider posture, sample history, and skill-factory
health, but it is not a Q&A/chat surface.

Copilot Q&A would let the user ask:

```text
what is the strongest limitation point?
what compensation can Mehta claim?
what documents contradict Skyline's reply?
prepare a table of issues from the record
```

Those questions are useful, but they are not harmless. A poor answer can look
authoritative even when the record does not support it. The app therefore needs
a contract before provider-backed Q&A enters the product.

## Product Rule

Copilot may answer questions about the active matter. It may not silently
become a drafting engine, artifact writer, skill runner, or source of uncited
legal conclusions.

The first version should be explicit:

```text
/ask what compensation can Mehta claim?
ask what compensation can Mehta claim?
```

Do not start by letting arbitrary unsupported text auto-route into paid Q&A.

## Relationship To Current Context Work

Copilot Q&A must use the existing bounded matter context packet:

```text
matter-context-packet/v1
```

The context reader decides what evidence is allowed into the model prompt. The
Copilot layer decides how to answer with that evidence.

Use [Matter Context Reader Contract](matter-context-reader-contract.md) before
implementing this runtime. If the context packet cannot be built or contains no
citable evidence, Copilot Q&A is not ready for that matter.

## What V2 Proves

The useful v2 flow is:

```text
frontend/unibox.js
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

The first Copilot runtime slice should be narrow:

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

If the user wants a durable output, the app should guide them toward an explicit
skill or future draft-producing workflow.

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
      "citation": "FILE-0001 p1.b2",
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
- every factual paragraph has at least one raw `FILE-NNNN pX.bY` citation;
- readable labels are display metadata only;
- no answer hides raw citations behind source labels;
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

## Conversation Memory

First version memory should be browser-local and exportable, not durable matter
state.

Allowed:

- include recent conversation turns in the next provider call;
- reset conversation from the UI;
- copy/export the chat for sharing;
- include provider/model and citations in the export.

Not allowed:

- write chat history into the matter folder by default;
- include prior chat history in the matter context packet;
- treat prior assistant answers as evidence;
- let chat memory override extracted records.

## Provider And Cost Rules

Provider-backed Q&A is a paid AI action. The UI should show:

- provider;
- model;
- chat-only/no-artifact status;
- whether citations were locally validated;
- whether the answer used a bounded context packet;
- approximate cost when provider metadata is available.

The first implementation should not add automatic fallback. Provider failure
should fail closed.

Recommended default can follow the beta list-of-dates model posture unless a
separate Q&A bakeoff says otherwise:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=openai/gpt-4.1
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
```

Do not reuse this blindly for final legal drafting. Q&A and drafting are
different risk classes.

## Search Versus Q&A

Keep local context search and Copilot Q&A separate.

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

Copilot Q&A:

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

## No-Matter Rule

If no matter is active, Q&A must stop before provider calls:

```text
Pick a matter before asking a matter question.
```

Do not send user questions or empty context to a provider.

## Not In First Slice

Do not add these in the first Q&A runtime PR:

- semantic/vector search;
- document drafting;
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
