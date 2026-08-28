# Agent Review — Run Index

Chronological history of all review runs, by review type. Newest last. Each type's `latest.md` is always its current report.

> **Home note (2026-08-28):** runs 1–12 of the engineering quality pass were written to the legacy home `claude_review/quality-pass/` (runs 1–2 to `claude_tests/quality-pass/`). New runs live here, in `agent_review/quality-pass/`. The legacy reports remain readable in place and are the baseline history for deltas.

## Skills user-journey reviews (`skills-journey/`)

| Run | Date (IST) | Commit | High | Med | Low | Snapshot |
|---|---|---|---|---|---|---|
| 1 | 2026-06-12 15:56 (+16:01 addendum) | `5e3ffcd` | 2 (SJ1 resumable ideas, SJ2 validation dead end) | 4 (SJ3-SJ5, SJ9) | 4 (SJ6-SJ8, SJ10) | [skills-journey/2026-06-12-5e3ffcd.md](../claude_review/skills-journey/2026-06-12-5e3ffcd.md) |

Verdict (Run 1): run journey fine (1 click); creation journey too complicated in surface + exits, not steps — 3 contract beats drifted to ~7 visible, ~12-14 concepts vs ~4 budgeted; funnel: 21 ideas → 12 stuck `incomplete` → 8 skills (57% structural abandonment). Addendum: live UX test independently confirmed the SJ3/SJ5 discoverability cluster on builtins (all 8 slashes exist; labels ≠ slash names, 4 hidden from autocomplete, unknown slashes silently route to copilot) + 2 new findings (SJ9 "setup matter" alias runs the wrong workflow; SJ10 suggestions never reload after login).

## Engineering quality passes (`quality-pass/`)

| Run | Date (IST) | Commit | P1 | P2 | P3 | Snapshot |
|---|---|---|---|---|---|---|
| 1 | 2026-06-06 11:46 | `8fa0b3e` | 8 | 4 | 16 | [legacy: claude_tests/quality-pass/2026-06-06-run1-8fa0b3e.md](../claude_tests/quality-pass/2026-06-06-run1-8fa0b3e.md) |
| 2 | 2026-06-06 15:18 | `bf6d8fb` | 7 | 3 | 18 | [legacy: claude_tests/quality-pass/2026-06-06-run2-bf6d8fb.md](../claude_tests/quality-pass/2026-06-06-run2-bf6d8fb.md) |
| 3 | 2026-06-07 20:15 | `05b67ce` | 4 | 6 | 23 | (initial review, same-commit revised below) |
| 3r | 2026-06-07 21:30 | `05b67ce` | 4 | 8 | 27 | [legacy: claude_review/quality-pass/2026-06-07-05b67ce.md](../claude_review/quality-pass/2026-06-07-05b67ce.md) |
| 4 | 2026-06-09 21:16 | `c75c6d1` | 3 | 12 | ~16 | [legacy: claude_review/quality-pass/2026-06-09-c75c6d1.md](../claude_review/quality-pass/2026-06-09-c75c6d1.md) |
| 5 | 2026-06-10 07:27 | `30c0a37` | 1 | 11 | ~17 | [legacy: claude_review/quality-pass/2026-06-10-30c0a37.md](../claude_review/quality-pass/2026-06-10-30c0a37.md) |
| 6 | 2026-06-12 13:13 | `5d64a13` | 2 | ~21 | ~25 | [legacy: claude_review/quality-pass/2026-06-12-5d64a13.md](../claude_review/quality-pass/2026-06-12-5d64a13.md) |
| 7 | 2026-06-12 18:00 | `5e3ffcd` | **0** | ~19 | ~28 | [legacy: claude_review/quality-pass/2026-06-12-5e3ffcd.md](../claude_review/quality-pass/2026-06-12-5e3ffcd.md) |
| 8 | 2026-06-12 19:25 | `53cdf62` ⁽ᵇ⁾ | **0** | ~13 | ~30 | [legacy: claude_review/quality-pass/2026-06-12-53cdf62.md](../claude_review/quality-pass/2026-06-12-53cdf62.md) |
| 9 | 2026-06-15 19:40 | `20ec21a` ⁽ᶜ⁾ | **1** | ~13 | ~22 | [legacy: claude_review/quality-pass/2026-06-15-20ec21a.md](../claude_review/quality-pass/2026-06-15-20ec21a.md) |
| 10 | 2026-06-21 21:31 | `5470212` | **0** | ~12 | ~25 | [legacy: claude_review/quality-pass/2026-06-21-5470212.md](../claude_review/quality-pass/2026-06-21-5470212.md) |
| 11 | 2026-07-15 19:52 | `de9452f` | **2** | ~22 | ~40 | [legacy: claude_review/quality-pass/2026-07-15-de9452f.md](../claude_review/quality-pass/2026-07-15-de9452f.md) |
| 12 | 2026-07-18 08:03 | `1e324d0` | **0** | ~11 | ~16 | [legacy: claude_review/quality-pass/2026-07-18-1e324d0.md](../claude_review/quality-pass/2026-07-18-1e324d0.md) |
| 13 | 2026-08-28 17:55 | `0db1265` ⁽ᵈ⁾ | **0** | ~7 | ~9 | [quality-pass/2026-08-28-0db1265.md](quality-pass/2026-08-28-0db1265.md) |

⁽ᵇ⁾ authoring-branch run; ⁽ᶜ⁾ codex line; ⁽ᵈ⁾ feature worktree `matter-workbench-v4` on `feature/document-intake-extraction-v4` — first run in the `agent_review/` home; baseline was the legacy Run 12 at `1e324d0` (delta: 98 commits, 195 files, +28,635/−327 — the V4 document-intake/extraction subsystem).

**Run 13 headline:** the new V4 subsystem is flagship-quality and correctly flag-gated — fenced DB-function claims, forced RLS, streamed-hash custody, SigV4 on AWS test vectors, fail-closed readiness. Both Run 12 P2 code fixes verified cleared (persistMatterJson lock+merge; terminal-row enqueue reset) plus the CI Postgres suite. New: auth stub at the single composition site (P2, gated by readiness control), slug/enum drift across the V4↔legacy seam (T16, one instance already found-and-fixed by the author), unbounded outbox retry + unwired scratch reaper + still-missing upload-session reaper (T17). Frozen carried debt (routes/App god-modules, multipart buffering, idempotency key) untouched for 3+ runs — now the highest-leverage item.

## Open P1 queue (as of Run 13)

**Empty** — second consecutive run.

## Open P2 queue (as of Run 13)

**R13-1** V4 mount auth/matter-authorization stubs (`app-mount.mjs:161-162`) — must be wired before any multi-account enablement; readiness gate tracks the control · **R11-7 residual** client idempotency key random per attempt → mid-mutation 409-lockout; no doctor tooling · **R11-16** multipart eager heap buffering (one-line delete, five runs old) · **R11-17** no upload-session reaper · **R11-18 residual** telemetry awaited on legacy prep critical path; zero AbortSignal in legacy react-ui · **R11-3** matter-workflow-routes god-module + dead legacy branches · **R11-25** App/MatterOverview guarded-run duplication (MatterOverview grew to 1,334 lines) · **R11-20/21/22** operator-error boundary / MW LOD truncation / soften-language rewrites · **F16/F3/F19** auth boundary, parked for dedicated security pass (8 runs standing)
