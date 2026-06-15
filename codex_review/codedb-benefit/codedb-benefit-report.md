# codedb Benefit Benchmark

Generated: 2026-06-14T05:50:32.190Z

Scope: Matter Workbench orientation benchmark. This measures source-code discovery efficiency, not implementation quality.

Method: each command is warmed once, then measured once. Candidate/noise scoring excludes docs, tests, evals, legacy vanilla frontend, and this review folder so the metric focuses on current source-code owner files. codedb is capped to the top 12 path hits, matching how it should be used for orientation instead of broad grep replacement.

## Summary

| Metric | codedb | rg baseline | Result |
| --- | ---: | ---: | --- |
| Tasks | 10 | 10 | Real repo owner-file tasks |
| Total latency | 18.32ms | 91.22ms | codedb 5.0x faster in this run |
| Total output | 6348 bytes | 11071 bytes | 43% fewer bytes from codedb |
| Avg owner-file recall | 60% | 65% | Higher is better |
| Total noise files | 27 | 19 | 42% more noise from codedb |

## Interpretation

- codedb helps most as a first-pass map: fast path/file/symbol discovery with small output.
- rg remains useful for exact-text verification and for catching files codedb did not surface.
- This benchmark intentionally uses simple one-query discovery. Real development should still read source ranges and run tests.

## Per-Task Results

| Task | Query | codedb recall/noise | rg recall/noise | codedb bytes | rg bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| skill-workspace-ux | `SkillIdeaSession` | 100% / 1 | 100% / 4 | 685 | 5231 |
| skills-page-progress | `Skills in Progress` | 100% / 3 | 100% / 0 | 555 | 171 |
| new-matter-upload | `No files attached` | 0% / 1 | 50% / 1 | 1525 | 387 |
| feedback-capture | `Have a problem` | 0% / 3 | 50% / 1 | 592 | 321 |
| runtime-db-storage | `createMatterFromUploadedFiles` | 100% / 1 | 100% / 1 | 438 | 416 |
| copilot-selector | `Copilot strength` | 100% / 5 | 50% / 2 | 606 | 433 |
| list-of-dates | `createListOfDates` | 0% / 3 | 50% / 4 | 554 | 1036 |
| ocr-repair | `ocr_repair_status` | 50% / 2 | 50% / 2 | 203 | 194 |
| custom-skill-receipts | `receiptState` | 50% / 3 | 50% / 4 | 577 | 2644 |
| private-beta-auth | `Login required` | 100% / 5 | 50% / 0 | 613 | 238 |

## Misses To Remember

- new-matter-upload: codedb missing [react-ui/src/views/NewMatterForm.tsx, services/runtime-db-storage-service.mjs]; rg missing [react-ui/src/views/NewMatterForm.tsx]
- feedback-capture: codedb missing [react-ui/src/components/command/CommandPanel.tsx, services/private-beta-feedback-service.mjs]; rg missing [services/private-beta-feedback-service.mjs]
- copilot-selector: codedb missing [none]; rg missing [react-ui/src/lib/copilotModels.ts]
- list-of-dates: codedb missing [create-listofdates-engine.mjs, services/create-listofdates-service.mjs]; rg missing [services/create-listofdates-service.mjs]
- ocr-repair: codedb missing [services/chained-ocr-provider.mjs]; rg missing [services/chained-ocr-provider.mjs]
- custom-skill-receipts: codedb missing [services/configurable-skill-runs-service.mjs]; rg missing [services/configurable-skill-runs-service.mjs]
- private-beta-auth: codedb missing [none]; rg missing [services/private-beta-auth-service.mjs]

## Raw Data

See `codedb-benefit-results.json`.
