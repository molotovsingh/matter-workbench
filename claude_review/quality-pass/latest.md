# Matter Workbench — Engineering Quality Pass · Run 8

> **Run 8 · 2026-06-12 19:25 IST · branch `claude/elastic-pasteur-e2c8c1` · commit `53cdf62`**
> Baseline: Run 7 (`5e3ffcd`, 2026-06-12 18:00 IST). Delta: 5 commits, 30 files, ~857 insertions / ~296 deletions.
> Clean worktree. **Note:** this commit lives on the Claude worktree branch only — it is not yet merged into `codex/matter-workbench-checkpoint-2026-05-17` (which is still at `5e3ffcd`, where Run 7 stands).
> **Disclosure:** the 5 commits under review were authored by the same agent writing this report, in this session. The pass was run adversarially against that conflict: every claimed fix re-read in code, two suspicions raised against the new code were chased to ground (one downgraded twice), and one finding below directly contradicts the delta's own commit message.
> Stable entry: `latest.md` · history: `../INDEX.md` · home: `claude_review/`.

A **fix-wave verification pass** over the batch that worked Run 7's queue: quick-wins (F13/F17/perms/CLI), shared redactor adoption (F14), telemetry lock-scope completion (F11), custody supersession (F2, migration 017), and the prepare-plan de-twin (F15's user-visible half). **1,223 tests pass at HEAD; `tsc --noEmit` clean.** One fix is load-bearing-verified by sabotage (the stream test hangs forever without the fix — it cannot false-pass).

---

## Carried queue — resolution

| Item | Run 7 verdict | Run 8 verdict | Evidence |
|---|---|---|---|
| **F2** — tombstone gap (`extraction_records`, `source_descriptors`) — 4th run on the queue | P2 brittle | ✅ **Fixed, with one honest caveat** | Migration `db/migrations/017_custody_supersession.sql` adds `superseded_at` + partial live-row indexes to both tables; `materializedFileTombstoneSql` (`runtime-db-storage-service.mjs:1789-1825`) supersedes both custody tables in the same transaction that tombstones `storage_objects`; the test that codified the gap now asserts the fix. **Adversarial check passed:** the RLS policies for both tables are command-unrestricted (`USING` + `WITH CHECK`, no `FOR` clause — `002_tenant_rls.sql:81-101`), so the UPDATEs are permitted under the transaction's `app.tenant_id` — the silent-no-op failure mode I suspected does not exist. **Caveat:** the SQL is verified by the string-tier tests only (T10); migration 017 has not executed against a live Postgres. Run `scripts/db-runtime-smoke.mjs` before the next cutover. |
| **F11r** — telemetry syncs inside store-mutation locks; no retry-tick deadline | P2 brittle | ✅ **Fixed** | Two-phase helpers in `telemetry-sync-client.mjs:155-228` (queue under lock → sync outside → one short write-back mutation); all three services' create paths and drains use them; per-service drain loops and comparators deleted. Retry tick gets a 4-minute deadline that releases the re-entrancy guard (`private-beta-telemetry-retry-service.mjs:22-60`), with a hung-drain test proving the next tick is not starved. The lock discipline is asserted *behaviorally*: `test/telemetry-sync-client.test.mjs:88-125` fails if a sync ever runs while a mutation is active. **Adversarial check passed:** the new unlocked drain snapshots read ledgers written via `writeFileAtomic` (temp+rename, `json-store-persistence.mjs:26`), so a torn read is impossible — suspicion downgraded. **Residual (P3, watch):** a *first-occurrence* signal still syncs awaited inside user request paths (`private-beta-signal-service.mjs:167-179`) — bounded at 10s and now lock-free, but a brand-new failure fingerprint still adds latency to the poll that captured it. Fix if it ever bites: mark fresh signals queued and let the tick send them. |
| **F13** — mothership pg pool, no error handler | P2 brittle | ✅ **Fixed** | `pool.on("error")` with redacted logging, pool factory injectable (`mothership/store.mjs:238-253`); behavioral fake-pool test asserts the handler exists and the log line carries no credential (`test/mothership-store.test.mjs:7-30`). |
| **F14** — redactor divergence (5+ copies) | P2 risky* | ⚠️ **Mostly closed — 3 stragglers found, contradicting the fix's own commit message** | The shared module now carries the union (postgres/postgresql URLs, `mwb_ing_`, generic env pairs, password/token/secret, plus `redactSensitiveValues` for verbatim JSON) and seven copies were deleted/delegated — mothership http/report/operator, three telemetry services, retry, and the React twin (parity-tested with extended fixtures, `test/react-secret-redaction.test.mjs:21-41`). The `--format json` bypass is closed at build time (`mothership/report.mjs:144-147`). **But the commit message claimed "every sanitizer" and that is false:** private pattern lists survive in `private-beta-observability-service.mjs:207-209` and `job-status-service.mjs:266-268` (neither knows postgres URLs), and `scripts/private-beta-ui-hardening-pass.mjs:434` knows a Google-key pattern (`AIza…`) that the *shared* redactor lacks — divergence in both directions. Downgraded P2→**P3** (operator-facing views, ~15-line fix). **Fix:** delegate all three to `shared/secret-redaction.mjs` and fold the `AIza` pattern into the shared list. |
| **F15** — prepare-plan twin divergence (user-visible) + god-module | P2 overgrown | ✅ **Divergence fixed · size carries** | `shared/preparation-stages.mjs` is the single home for stage definitions, missing-metadata, and plan warnings; the DB twin's private copy is deleted; DB-mode plans compute real `metadata.missing`/`complete` (was hardcoded complete) and real warnings (was `[]`) — `runtime-db-storage-service.mjs:377-420`. A parity test pins the cross-mode contract and would fail on re-divergence (`test/prepare-plan-parity.test.mjs`). Bonus: status+plan now share one workspace query instead of two. **Carries:** the file is still ~2,100 lines (overgrown, P2) and the N+1 psql-spawn read pattern is untouched. |
| **F17** — headersSent / stream error listeners | P2 brittle* | ✅ **Fixed, sabotage-verified** | Catch guard at `server.mjs:322-331`; the twin raw-stream blocks collapsed into `sendRawFileStream` with an error listener (`app-shell-routes.mjs:285-294`). The regression test boots a real server, injects a mid-stream failure, and asserts the next request still answers; with the listener removed, the test *hangs* rather than passes — it cannot false-green. **New P3 from re-reading my own helper:** a *client* disconnect mid-stream doesn't destroy the source stream, so a filesystem read stream holds its fd until GC (`sendRawFileStream:292-293`). **Fix:** one line — `response.on("close", () => raw.stream.destroy?.())`. |
| creds file perms · operator CLI exit code · sync-client untested (N3) | P3 | ✅ **All fixed** | 0600 asserted via `stat` (`test/private-beta-users-service.test.mjs:33`); unknown command → stderr + exit 1, `help` stays stdout + 0 (`mothership-operator.mjs:69-76`); the sync client has 6 direct tests including the abort-on-timeout branch with a hanging fake fetch. |
| **N1** — tester identity off-VM in safe telemetry | P2 risky* (product call) | **Open — awaiting the user's decision** | Unchanged; the question (keep-and-document vs strip `displayName` from sync payloads) was put to the user and is pending. |
| F16 · F3 · F18 · F19 · F20 · F21 · F22 · F23-residue · write race · mtime residual · F4/F5/F7/F8 | P2/P3 | **Carried, files untouched** | None of these units changed in this delta (verified by diff). F16/F19 deliberately deferred to the recommended dedicated security pass. F23 improved at the margins again (this delta added a behavioral parity test for redaction and one for prepare plans), but the duplicated visibility fixtures remain. |

## New findings (this delta)

**R8-1 — Redactor stragglers (P3, was F14's tail; see table above).** `private-beta-observability-service.mjs:207-209`, `job-status-service.mjs:266-268`, `scripts/private-beta-ui-hardening-pass.mjs:434`. The third knows `AIza` keys, which the shared list doesn't — fold it in when delegating.

**R8-2 — Raw-file source stream survives client disconnects (P3).** `routes/app-shell-routes.mjs:292-293` destroys the *response* on stream error but never destroys the *stream* on response close; repeated client aborts on large filesystem files retain fds until GC. **Fix:** `response.on("close", () => raw.stream.destroy?.())` inside `sendRawFileStream`.

**R8-3 — Behavior change, recorded as an improvement (no action).** `createFeedback` now persists the item (queued) *before* attempting sync, so a sync failure can no longer lose feedback — and a `buildPayload` throw is caught inside the sync client's try (`telemetry-sync-client.mjs:43-78`), landing as `queued`, not a request error. Net: the durability story got strictly better; noting it because it is observably different (a ledger briefly holds `queued` before flipping to `sent`).

**Suspicions raised and retired (the downgrade record):** (a) RLS might silently filter the supersession UPDATEs → disproved, policies are FOR-ALL (`002_tenant_rls.sql`); (b) unlocked drain snapshots might read torn ledgers → disproved, writes are atomic temp+rename. Both recorded per the verify-don't-trust stance — toward this review's own delta.

---

## Audit view

**P1 queue: empty** (second consecutive run).

| Unit | Mode | Blast radius | Verdict | Theme | Action | Sev |
|---|---|---|---|---|---|---|
| N1 tester identity off-VM (awaiting user) | filesystem | staff names + matter names off-VM | risky* | — | watch | **P2** |
| `runtime-db-storage-service` (size + N+1 reads + write race) | DB | DB-mode storage engine | overgrown | T8 | refactor | **P2** |
| auth-service trio (F16) + sync read ×3 (F3) — deferred to security pass | config | authn boundary | risky* | T5 | refactor | **P2** |
| F18 · F19 · F20 · F21 · F23-residue · mtime residual (carried, untouched) | various | — | (carried) | — | — | **P2** |
| F4 · F5 · F7 · F8 (carried, not re-verified since Run 5) | — | — | (carried) | — | — | **P2** |
| redactor stragglers (R8-1) | — | operator-view redaction gaps | right-sized* | T7 ▼ | refactor | P3 |
| `sendRawFileStream` fd retention (R8-2) | bridge | slow fd leak under client aborts | right-sized* | — | refactor | P3 |
| fresh-signal inline sync residual | filesystem | ≤10s poll latency, lock-free | right-sized* ▲ | T9 ▼ | watch | P3 |
| feedback client/server draft twin (N2, untouched) | bridge | intake drift | right-sized* | T7 | watch | P3 |
| `shared/preparation-stages` · `telemetry-sync-client` two-phase · migration 017 (new units) | bridge/DB | prepare contract / telemetry egress / custody | right-sized ▲ | T7 ▼ | ignore | P3 |
| react `secretRedaction.ts` (deliberate mirrored twin, parity-tested) | — | client-side redaction | right-sized* | T7 | watch | P3 |

**Tally (Run 8):** 10 delta units re-reviewed inline (the 5 batches + their tests); everything else carries Run 7.
**Severity: 0×P0 · 0×P1 · ~13×P2** (down from ~19 — F2, F11r, F13, F14→P3, F15-divergence, F17 cleared) · **~30×P3** (+R8-1/R8-2, several ▲ improvements).
_(Run 7: 0×P1, ~19×P2, ~28×P3.)_

---

## Evidence & verification notes

- Single reviewer — the same agent that authored the delta; compensations: sabotage-testing the most safety-critical fix (stream listener — test hangs without it), actively hunting downgrades against the new code (two found and recorded), and grepping for evidence against the delta's own commit messages (found: the "every sanitizer" overclaim, R8-1).
- **Executed:** full suite 1,223 tests at `53cdf62`, all passing; `tsc --noEmit` clean; the hung-drain deadline test and abort-timeout test exercise real timers.
- **Taken on report / not executed:** migration 017 against a live Postgres (string-tier only — run the runtime smoke before cutover); pg pool error semantics (documented EventEmitter behavior, exercised via fake pool).
- The two-phase telemetry design deliberately accepts double-sends (concurrent drains) because mothership ingest is replay-safe — that trade is documented in code (`telemetry-sync-client.mjs:155-158`), not just here.

## Themes (movement only)

- **T7 — twin drift: best run on record.** Five twin families deleted this delta (sync plumbing ×3 services, drain loops ×3, prepare stage definitions, prepare warnings, raw-stream blocks ×2) and the two deliberate remaining twins (React redaction, React feedback draft) are both parity-tested. The census shrank more this run than any prior. Remaining seeds: R8-1 stragglers, `deterministicUuid` ×3 (F18), route-helper `runtimeDbMatterForQuery` ×2 (observed in passing at `app-shell-routes.mjs:375` vs `matter-workflow-routes.mjs:502` — known from Run 3r).
- **T9 — telemetry egress: closed.** Deadlines everywhere, no network under locks, tick deadline, direct tests. The only residue is the fresh-signal inline await (P3 watch).
- **T8 — write-path integrity: shrinking.** F2 closed (pending live-PG execution); the materialized write race and users-service races carry.
- **T10 — string-matching tests: the honest asterisk.** The F2 fix itself is verified at the string tier — the same tier this theme warns about. The migration content test and tombstone regex test would not catch an RLS or SQL-semantics failure; only the opt-in smoke executes it. This is the single most important follow-through item from this delta.

**Meta-observation:** the fix-wave held the line it needed to hold — every fix de-twinned rather than mirrored, and the new shared modules (`preparation-stages`, the sync client's two-phase core, the redactor) each *deleted* more code than they added. The risk that remains is concentrated in exactly two places: things only a live Postgres can prove (migration 017, the smoke), and things only the user can decide (N1).

## Highest-leverage next moves

1. **Run the real-Postgres smoke** against a migrated database — it is the only thing standing between "F2 fixed" and "F2 proven fixed."
2. **Decide N1** (keep-and-document vs strip `displayName`) — last P2 that needs no code investigation.
3. **15-line sweep:** delegate the three R8-1 stragglers to the shared redactor (fold `AIza` in); add the one-line `response.on("close", …)` for R8-2.
4. **Merge or PR the worktree branch** — Run 7's and Run 8's verified state diverge until `claude/elastic-pasteur-e2c8c1` lands on the main line; the longer it floats, the staler both reports get.
5. The standing item: the **dedicated security scan** (F16/F19 are parked against it).

---

> **⏳ Currentness.** Valid only for commit `53cdf62` (clean worktree) at 2026-06-12 19:25 IST, on branch `claude/elastic-pasteur-e2c8c1` — not yet merged to the main development line. A source edit or merge-with-changes invalidates these findings — re-run `/quality-pass` after.
