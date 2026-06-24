# Copilot Interaction Receipts

Date: 2026-06-24
Status: Planned feature / first local slice

## Product Idea

Copilot interactions are a high-value improvement signal. They show what firm
lawyers actually ask, whether the app routed the work to Skill / Ask / Research,
which sources supported the answer, where the answer was partial or failed, and
what follow-up the user needed.

The product principle is:

```text
Persist interaction receipts, not raw memory.
```

Receipts help improve the product. They are not evidence and are not durable
legal work product by default.

## Why This Matters

A question such as:

```text
looking at the NCLT and IBC code and company law what are the options for Sunrise, return with sections
```

is more useful than a one-off chat turn. It tells us:

- the user needed a legal-options map;
- Ask-to-Research escalation was appropriate;
- Research produced a partial answer;
- public sources were useful but needed verification;
- matter facts still controlled the forum/route analysis;
- follow-up and source-quality UX matter.

Over time, these receipts can improve:

- routing between Skill / Ask / Research;
- Research query generation;
- NCLT / IBC / company-law answer structures;
- source-quality evaluation;
- prompt/eval test cases;
- smaller/faster model bakeoffs;
- firm-specific workflow intelligence.

## Receipt Boundary

A receipt may record compact, redacted metadata:

```json
{
  "interaction_id": "uuid",
  "matter_name": "Sunrise vs Ansal Landmark",
  "mode": "research",
  "question": "what are the NCLT options...",
  "answer_status": "partial",
  "answer_preview": "Research answer from public sources...",
  "source_summary": {
    "matter_source_count": 3,
    "public_source_count": 4,
    "matter_source_ids": ["FILE-0001"],
    "public_source_ids": ["WEB-0001", "WEB-0002"],
    "public_urls": ["https://..."]
  },
  "warnings": ["Verify authorities before relying or filing."],
  "ai_run": {
    "provider": "openrouter",
    "model": "openai/gpt-5.4",
    "task": "copilot_web_research"
  },
  "context": {
    "runtime_mode": "postgres",
    "conversation_turns": 2
  }
}
```

The first slice should persist only bounded text and metadata. It should not
store full matter context packets or raw provider payloads.

## Not Evidence

Receipts must not be treated as matter evidence.

Rules:

- prior assistant answers are not proof;
- receipts do not become source records;
- receipts do not satisfy citation requirements;
- receipts do not write to `10_Library`, `20_Workshop`, `30_Drafts`, or
  `40_Dispatch`;
- receipts may support product improvement, audits, and eval design only.

## What To Persist In The First Slice

Persist compact receipts for:

- Ask answers;
- Research answers;
- Ask / Research failures;
- answer status;
- source counts and source IDs;
- public source URLs for Research;
- warnings;
- model/provider metadata;
- bounded answer preview;
- conversation-turn count.

Use a local/private-beta ledger first:

```text
.local/copilot-interaction-receipts.json
```

or a configured path:

```text
MWB_COPILOT_INTERACTION_RECEIPTS_PATH=
```

Runtime DB persistence can come later if receipts become part of hosted
analytics or matter audit surfaces.

## What Not To Persist By Default

Do not persist these in the first slice:

- full extracted matter text;
- full matter context packet;
- full public page text;
- raw provider request or response bodies;
- chain-of-thought or hidden reasoning;
- secrets, API keys, cookies, bearer tokens, database URLs;
- durable cross-matter chat memory.

## Access And Use

The first slice should be operator-readable only. A simple API is enough:

```text
GET /api/copilot-interaction-receipts?matter=<name>&mode=ask|research&limit=100
```

Normal lawyers do not need a receipt browser yet. The command transcript remains
the user-facing experience.

## Future Use

Later slices may add:

- user reaction signals: copied, retried, used Research after Ask, sent feedback;
- conversion signals: turned into draft, skill, issue note, or research memo;
- eval dataset export;
- mothership sync;
- DB-backed receipt storage with tenant/user scoping;
- deletion/retention controls;
- report views for recurring legal-question clusters.

## Acceptance Criteria For First Slice

- Ask and Research route successes write compact receipts.
- Ask and Research failures write compact failure receipts.
- Receipt writes are best-effort and never break user-facing routes.
- Receipts redact secrets.
- Receipts do not include full matter context or raw provider payloads.
- Operator API lists recent receipts.
- Tests cover normalization, redaction, route capture, and operator access.
