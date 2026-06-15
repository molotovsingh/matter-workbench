# Engineering Quality Pass — Run index

Immutable, timestamped snapshots of each review pass, newest last. The latest
*working* report is [`../engineering-quality-pass.md`](../engineering-quality-pass.md);
each run below is frozen for side-by-side comparison. **Never edit a prior run's file.**

| Run | Date (IST) | Commit | Warnings | P1 | P2 | P3 | Snapshot |
|---|---|---|---|---|---|---|---|
| 1 | 2026-06-06 11:46 | `8fa0b3e` | 8 | 8 | 4 | 16 | [2026-06-06-run1-8fa0b3e.md](2026-06-06-run1-8fa0b3e.md) |
| 2 | 2026-06-06 15:18 | `bf6d8fb` | 6 | 7 | 3 | 18 | [2026-06-06-run2-bf6d8fb.md](2026-06-06-run2-bf6d8fb.md) |

## Deltas

- **Run 1 → Run 2** (9 commits): 2 warnings **cleared**, 0 new.
  - `source-descriptors-engine` — brittle/P1 → right-sized/P3. Resilience fixed in
    `5fe04cc` (per-batch quarantine + `needs_review` fallback + retry widened to
    429/500/503/504).
  - `workspace-service` — right-sized*/P2 → right-sized/P3. Twin-drift fixed in
    `ed978eb` (shared `workspace-preview-policy.mjs` imported by both backends).
  - Still open at the seam: `matter-store`, `upload-service`, `matter-status`,
    `matter-rerun-advice` (+ `ai-settings` secret check, `runtime-db-sql-safety`
    write-smoke).
  - New surfaces not yet reviewed (out of core-services scope):
    `scripts/start-runtime-server.mjs`, `scripts/private-vm-service-check.mjs`,
    `deployment/`.

## How to add a run

1. Snapshot the working report:
   `cp ../engineering-quality-pass.md <YYYY-MM-DD>-run<N>-<commit>.md`
2. Banner the copy as frozen (date + commit), then update **only the changed
   services** plus the scoreboard/tally/P1 queue/themes/run-log.
3. Mirror the same updates into `../engineering-quality-pass.md` (the latest).
4. Add a row + delta here.

Prior runs are append-only history — never overwrite them.
