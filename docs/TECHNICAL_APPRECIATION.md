# Matter Workbench - A Technical Appreciation

> *"The sophistication is not in any single algorithm. It is in the architecture of distrust — a system that treats AI output as suspect until locally validated, that refuses to confuse internal identifiers with lawyer-facing ones, and that makes every pipeline decision auditable by design."*

---

## The Architecture That Makes This Different

Most legal tech products are either thin wrappers around a chat API or monolithic enterprise systems with decade-old code. Matter Workbench is neither. It is a **deterministic pipeline with paid-AI checkpoints**, architected from first principles around a single constraint: **the AI must never be trusted with final output.**

### 1. The Two-Pass Chronology Pattern

This is the project's crown jewel — and it solves a real AI reliability problem elegantly.

**The problem:** Ask an LLM to produce a complete List of Dates from 20+ legal documents in one shot, and three things go wrong: it skips events buried in dense paragraphs, it hallucinates dates to fill gaps, and it can't reliably cross-reference corroborating sources.

**The solution:** Split the problem into two passes with a deterministic clustering layer between them:

```
Pass 1: Candidate Harvesting (gpt-4.1, verbose)
    "Extract every possible event candidate. Be exhaustive.
     Include source citations. We will filter later."
    ↓
Raw candidates (hundreds of potential events with citations)
    ↓
Deterministic Clustering (local, no AI)
    → single_event (one source)
    → corroborated_event (multiple sources agree)
    → payment_discrepancy (amounts don't match)
    → source_repeat (same source, different angle)
    → true_duplicate (remove)
    ↓
Pass 2: Editor Pass (gpt-5.4-mini, focused)
    "Here are clustered candidates. Merge duplicates.
     Drop noise. Write the final chronology.
     Every entry MUST cite its source."
    ↓
Final chronology (JSON + CSV + Markdown)
```

This pattern is clever for several reasons:
- **Pass 1 maximizes recall** — it biases toward including everything, because the clustering step will catch duplicates
- **Clustering adds deterministic safety** — local code decides what's corroborated vs what's noise, not the LLM
- **Pass 2 maximizes precision** — the editor only sees candidates, not raw documents, so it can't invent new events
- **Multi-chunk support** — large matters with 100+ documents are split into ~18K character source blocks, each independently harvested, then merged

### 2. Deterministic / Paid Split as Architectural Principle

The system cleanly distinguishes two categories of operations, enforced at the engine layer:

| Deterministic (never calls AI) | Paid (calls AI with guardrails) |
|-------------------------------|--------------------------------|
| matter-init (hash, classify, copy) | describe_sources (labeling) |
| extract (PDF/DOCX/XLSX/EML) | create_listofdates (chronology) |
| context_preview (packet build) | configurable skills |
| context_search (local grep) | skill interview planner |
| doctor (structure scan) | skill sample generator |

This matters because it gives the user a clear cost boundary. Intake and ordinary extraction are local. Provider-backed legal work is explicit, policy-routed, and recorded with provider/model metadata. Cost estimation is a planned surface, but the architectural point already holds: the system should not silently run paid legal work without a visible user action.

### 3. The Layered Policy Prompt System

Most AI products have one system prompt. Matter Workbench has five layers, composed at runtime:

```
legalWorkbenchSystemPrompt() =
    global workbench policy          <- source-backed legal discipline
  + source visibility policy         <- cite sources without exposing FILE-NNNN to lawyer
  + native skill policy              <- skill-specific rules, e.g. events must cite sources
  + copilot draft policy             <- drafting and amendment guardrails
  + custom skill policy              <- user-defined rules under app-level limits
```

This is **policy composition as function composition**. Each layer is a prompt fragment. The caller combines the relevant sections at invocation time. The result is that every covered AI call — regardless of which skill triggered it, which model it uses, or which provider routes it — inherits the same professional constraints.

### 4. Source Identity Dualism

This is a design decision so subtle it's easy to miss, but it solves a real problem:

- **Internal identity:** `FILE-0042`, paragraph 3, sentence 2-4 — machine-precise, auditable, never changes
- **Lawyer-visible identity:** "Sale Deed dated 12.03.2021 executed between Rajesh Kumar and Sunita Devi" — human-readable, legally meaningful

The system maintains both in parallel. The AI is instructed to use lawyer-visible labels in output but must always provide raw FILE-NNNN citations in structured fields. The policy prompt explicitly forbids exposing internal identifiers in lawyer-facing text.

Why this matters: without it, a lawyer reviewing a chronology sees "FILE-0042" and has to cross-reference a file register to understand what document that is — breaking flow and inviting error. With it, the chronology reads like a human-prepared document and the audit trail stays underneath.

### 5. The Configurable Skill Factory

This isn't just "custom prompts." It's a **skill lifecycle with AI-assisted authoring**:

```
Ideation → Interview → Sample → Approval → Authoring → Activation → Execution → Improvement
```

At each stage, the system does something interesting:

- **Interview:** The app interviews the user about their skill idea — what inputs, what outputs, what guardrails, what edge cases. It can use an AI planner or deterministic fallback. This produces a design brief.
- **Sample generation:** The AI generates sample output matching the design brief, using real matter context. The user reviews and approves before any code or prompt is written.
- **Authoring:** From the approved sample, the AI-assisted authoring path generates a full skill definition: prompt config, input/output contracts, and guardrails.
- **Validation:** The skill is validated against the skill creation overlap policy (MECE check — does it overlap with existing skills?).
- **Execution:** Skills run with the same layered policy prompt, paid rerun guardrails, and provider output validation as built-in skills.
- **Improvement:** After a run, the user can suggest improvements, which become new skill ideas — closing the loop.

This is a **code generation workflow for non-programmers**, mediated by AI, with lawyer-in-the-loop approval gates at every stage where creativity meets legal judgment.

### 6. Extraction Caching by Content Hash

Extraction is expensive — especially OCR on scanned PDFs. The system caches extraction results by SHA-256 file hash:

```
extract(file) →
    hash = sha256(file)
    if cache.has(hash):
        return cache.get(hash)
    result = extract_by_type(file)
    cache.set(hash, result)
    return result
```

This means:
- Uploading the same file again (duplicate) → instant skip
- Re-uploading a corrected version → only the changed file is re-extracted
- OCR results persist across restarts
- No cache invalidation problem (content-addressed, not name-addressed)

### 7. Fail-Closed Provider Posture

The system explicitly refuses automatic model fallback for lawyer-facing work. This is the opposite of "resilience" patterns in most SaaS products:

```javascript
// What Matter Workbench does NOT do:
if (primaryProviderFails) {
    fallbackToOpenRouter();  // ← This is forbidden
}

// What it DOES:
// model-policy.mjs maps each task to a specific model+provider
// If that fails, the run fails. The lawyer decides what to do.
```

The reasoning: different models have different failure modes, hallucination rates, and formatting quirks. A lawyer reviewing output needs to know which model produced it. Silent fallback breaks that audit chain.

### 8. Safe Path Containment Without a Sandbox

The system operates on the user's real filesystem — it reads and writes to disk. Without path containment, this would be dangerous. The solution is a **validated path API layer**:

```javascript
// Every file path goes through safe-paths.mjs
// before touching the filesystem
validatePath(candidate, matterRoot) →
    resolved = resolve(candidate)
    if (!resolved.startsWith(matterRoot)):
        throw PathTraversalError
    return resolved
```

All file system operations (read, write, copy, list) go through helpers that validate the resolved path stays within the matter root. This is a simple constraint that eliminates path traversal attacks entirely — no regex filtering, no blocklists, just a prefix check on resolved absolute paths.

### 9. Atomic Writes for Crash Safety

Critical JSON and store writes use atomic writes:

```javascript
writeAtomic(path, content) →
    tmp = path + '.tmp.' + random()
    write(tmp, content)
    rename(tmp, path)  // atomic on same filesystem
```

This is a small detail that prevents a large class of bugs: no partial JSON files from interrupted writes and no half-written matter metadata in the stores that use the shared atomic persistence path. Combined with the extraction cache, the system can often recover from interruption by re-running from saved state.

### 10. React Production Shell With Contract-Tested Legacy Lessons

The production frontend is now React/Vite. That matters because the app has
crossed from a prototype shell into a UI architecture that can carry more
screens, async state, and workflow-specific components without every feature
living in one browser file.

The old plain-JS shell is still valuable as a reference and migration inventory,
but it is no longer a product fallback. It taught the main lesson: even without
a framework, the command surface must be decomposed by workflow instead of
becoming one giant event handler.

```
React production shell
  ├── AppContext.tsx                 ← active matter and workspace refresh owner
  ├── CommandPanel.tsx               ← command panel and activity strip
  ├── workflows/*.tsx                ← native skill workflow views
  ├── RerunConfirmDialog.tsx         ← paid/replacing artifact guard
  └── filePreview.ts                 ← file loading + List of Dates preview

Retired plain-JS helper inventory
  ├── ai-command-box.js              ← facade
  ├── skill-idea-session-controller  ← interview → sample → approve
  ├── configurable-skill-run         ← run → review → replace
  └── report/copy helpers            ← sanitized diagnostics
```

The React migration was accepted only after API-contract fixes, typechecks,
backend tests, production smoke, and a browser check at `/`. The key engineering
lesson is not "React is better." It is that a legal workbench frontend must
faithfully speak the backend contract: matter identity, rerun advice, paid
confirmation, source-label refresh, sample approval, and workspace refresh are
product rules, not just component state.

---

## What This Represents

Matter Workbench is not impressive because it chases surface area. What it represents is significant:

**It is a proof of concept that you can build lawyer-caliber tools with small, composable, deterministic components — not by throwing a bigger model at the problem, but by designing architectures that constrain AI to its proper role: a smart clerk, not an autonomous lawyer.**

The two-pass chronology pattern, the layered policy prompt system, the determinism/paid split, the source identity dualism, the skill factory — these are not features you get by prompting GPT-4 harder. They are **system design decisions** that treat AI as one component in a larger pipeline, subject to the same validation, auditing, and guardrails as any other untrusted input.

That's what makes it worth studying.

---

*May 2026 - Aksingh*
