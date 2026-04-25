# Legal Workbench Summary

## Where We Are Now (Phase 1)

### What We Built

A minimal VS Code-like shell prototype with:

- **Activity bar** (left): App identity + explorer access
- **Sidebar**: Matter entry controls + workspace tree
- **Main editor**: Typed slash-skill strip + results view
- **Inspector**: Matter metadata + skill contract + status
- **Bottom panel**: Output log + status bar

### What We Simplified

**Removed:**
- Rounded cards, shadows, gradients
- Decorative hero sections
- Complex title bar chrome
- Artifact grids and spec cards
- Extra visual "eye candy"

**Kept:**
- Flat, neutral color palette
- Sharp edges (no border-radius)
- Essential layout only
- Clear typography hierarchy

### Sidebar Entry Points

Placed at the **top of the sidebar**:

- **`Open Folder`** — `New matter` (yellow italic hint)
  - Pick a folder from disk, start fresh

- **`Switch Matter`** — `Existing matter` (yellow italic hint)
  - Restores the known Naveen Vs Mohit sample matter

### Slash Skill Entry

Commands go in the **top command strip**, directly under the title bar.
The sidebar lists available slash skills; the command strip is where the
lawyer/operator types the chosen skill and runs it against the open matter.

### Matter Metadata

Before `/matter-init` runs, the inspector prompts for required matter identity:

- Client name
- Matter name
- Opposite party
- Matter type
- Jurisdiction

The brief description is optional. These fields are part of the future
`matter.json` contract and are not inferred silently.

### Why This Design

| Decision | Reason |
|----------|--------|
| VS Code metaphor | Lawyers recognize the environment immediately |
| Minimalism | Legal work requires focus; decoration is noise |
| Clear entry points | Folder intake is fundamental, needs prominence |
| Guidance text | Distinguishes "new" vs "existing" without confusion |
| Flat aesthetic | Professional, utilitarian, stays out of the way |

### Current Limitations

This is now a **local-first prototype**:
- `Open Folder` uses browser folder access for local testing
- Matter metadata validation is active in the UI
- `/matter-init` calls a local Node endpoint when served with `server.mjs`
- The deterministic engine hashes files, preserves originals, arranges copies by extension, and writes review logs
- Source files are copied only; they are not moved or modified
- No cloud persistence

The UI shows the intake result and the files on disk are ready for lawyer review.

---

## Where We Are Going

### Full Vision: 5-Stage Pipeline

```
Raw Client Files
      ↓
   00_Inbox        ← organize by format (emails, screenshots, PDFs)
      ↓
   10_Library      ← chronological backbone (dates + sources)
      ↓
   20_Workshop     ← analysis: lists of dates, facts, claims
      ↓
   30_Drafting     ← petitions, notices, replies, court documents
      ↓
   40_Outbox       ← client-facing documents awaiting approval
```

### Slash-Skill Driven, Not Chat-Driven

Every stage has **specific invokable slash skills** designed with subject matter experts:

| Slash skill | Purpose |
|---------|---------|
| `/matter-init` | Intake and organize (Phase 1) |
| `/create_listofdates` | Build chronological backbone |
| `/extract_claims` | Identify legal claims from facts |
| `/draft_petition` | Generate court documents |
| `/prepare_outbox` | Stage documents for client review |

**Why slash skills:** deterministic, repeatable, auditable. Lawyer steers explicitly rather than hoping AI chat guesses correctly.

### Core Design Principles

| Principle | Meaning |
|-----------|---------|
| **Deterministic where possible** | Slash skills produce predictable outputs; cheap LLM or rule-based |
| **Human-in-the-loop always** | Lawyer reviews, approves, steers every stage |
| **Source-backed facts** | Every extracted fact links to original source document |
| **Preserve raw intake** | Original client files untouched; all work on copies |
| **Local-first** | Privacy and confidentiality; no cloud dependency |

### Roadmap

**Phase 1** (current): VS Code-like shell + mocked `/matter-init`

**Next phases:**
- Real folder picker and matter persistence
- Actual `/matter-init` (organize by format)
- Chronological sorting in Library
- List-of-dates generation with source citations
- Workshop slash skills for claim extraction
- Drafting layer with document generation
- Outbox with approval workflow

### Ultimate Destination

A **workflowed legal operating system** where:
- Lawyer opens messy client folder
- Runs slash skills to transform it into structured, reviewable, source-backed legal work
- Every stage is explicit, auditable, under lawyer control
- The tool stays out of the way until invoked

**Not an AI assistant. A legal workbench.**
