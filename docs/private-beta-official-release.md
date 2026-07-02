# Matter Workbench Official Private Beta Release

Status: Official supervised private beta release checkpoint

Release: [Current Matter Workbench Release](releases/current.md)

Date: see current release pointer

## Release Decision

The release named in [Current Matter Workbench Release](releases/current.md) is the official private beta release checkpoint.

All actionable tester feedback that could reasonably be solved in the current release window has been fixed, deployed, validated, and recorded. Remaining larger product requests are intentionally parked for future roadmap work rather than being added to this release.

From this point, the release posture is:

```text
feature-frozen unless a blocker or regression appears
```

Do not add new product features to this release line. If a tester reports a new issue, triage it as one of:

- blocker/regression: fix before broader handoff;
- non-blocking bug: record and schedule after release;
- feature request: park for roadmap;
- unclear report: request evidence, do not code immediately.

## Why This Release Is Acceptable

The release is acceptable for supervised private beta because:

- the live beta VM is deployed and reachable;
- runtime DB migrations through `025_processing_job_stage_kinds` are applied/skipped current;
- private beta auth is active;
- Mothership `new` tester feedback count is `0`;
- heavy-file upload feedback was addressed with clearer limits and a 256 MB private beta cap;
- long-running upload and document-reading UX now explains what is happening;
- matter archive/reopen is non-destructive;
- source removal is non-destructive and uses **Remove from active record** language;
- release nickname and What’s new messaging are visible to testers;
- beta.79 widened the left navigation rail without changing legal, custody, auth, upload, database, or model behavior;
- beta.80 presents the neutral chronology as Case Timeline while preserving internal List of Dates routes and artifact paths;
- beta.80 adds provisional Filing and Procedural Posture Diagnosis after Matter Story with lawyer confirmation/correction/not-sure controls;
- beta.82 restores Assistant readiness as a visible degraded-readiness signal while keeping provider/account details out of Ask answers;
- beta.83 centralizes user-facing AI error sanitization so provider/account failures stay out of API responses and command activity;
- beta.84 adds the AI error-boundary leak probe to the private VM service check;
- beta.85 routes the supervised beta runtime through OpenAI direct, including Source Index labels when selected;
- beta.86 centralizes Copilot strength presets in backend model policy and verifies all Low/Medium/High/Highest settings live;
- beta.87 routes Copilot settings checks through the shared AI provider service and fixes the async preset UI hardening check;
- beta.88 moves Settings-visible AI task status metadata into shared model policy;
- beta.89 adds a canned read-only mothership investigation command for repeatable complaint checks;
- beta.90 narrows that helper so text/user misses do not include unrelated evidence;
- beta.91 treats user as focus context while matter/text/preset/time define the evidence scope;
- beta.92 adds stage-one candidate signal collection and stage-two signal/feedback/matter focusing;
- beta.93 records interrupted upload attempts and upload jobs for create/add file intake;
- beta.94 makes DB workspace intake session-first and moves first-stage extraction to a backend worker;
- beta.95 centralizes upload payload-byte handling and processing-job row projections without changing product workflow;
- beta.96 adds browser-visible unfinished upload recovery, same-file resume, and upload-session cancel;
- beta.97 broadens runtime DB worker stage support without auto-queuing new preparation stages;
- beta.98 refactors upload recovery UI/workflow without changing behavior;
- beta.99 prevents stale `/api/config` release-badge responses;
- beta.100 adds client-side no-store/cache-busting for runtime config fetches;
- beta.101 refactors the runtime config freshness fetch without changing behavior;
- beta.102 fixes Matter Overview preparation readiness so **Prepared** includes Matter Story and Filing and Procedural Posture Diagnosis, changes the default action to **Run needed preparation**, and gates full rebuilds behind a reason plus `REBUILD` confirmation;
- beta.104 queues backend-owned post-upload preparation stages and applies the runtime DB job-kind migration needed for Case Timeline, Matter Story, and posture diagnosis jobs;
- beta.105 moves the default runtime DB **Run needed preparation** path onto backend processing jobs with React polling durable job status;
- beta.106 refactors that preparation queue path into shared runtime helper utilities without changing behavior;
- beta.107 makes backend preparation jobs observable in Matter Overview after refresh/reconnect, disables duplicate needed-preparation actions while relevant jobs are active, refreshes readiness when observed server jobs finish, and shows safe failed-job copy;
- beta.108 refactors that observer into a dedicated React hook and narrows the Overview failure contract so raw failed-job details are not passed to the UI surface;
- beta.109 standardizes Filing and Procedural Posture Diagnosis around simple case view, probable legal routes, recommended route, next best actions, statutory-reference prompts, markdown sections, and Matter Overview fallbacks;
- beta.110 refactors that posture output contract, schema, normalization, markdown renderer, prototype loop reuse, and Matter Overview summary into dedicated modules without changing beta.109 user-facing behavior;
- beta.111 shows Matter Overview blocked/stale preparation-stage reasons, avoids misleading empty-output copy for blocked downstream stages, and canonicalizes Case Timeline dependency-state internals while preserving List of Dates storage paths;
- beta.112 fixes stale Matter Story / procedural posture needed-preparation flow so stale Story and posture jobs can overwrite stale artifacts, and Matter Overview presents runnable upstream updates as **Needs update** rather than terminally **Blocked**;
- beta.113 adds the native Filing and Procedural Posture Diagnosis skill surface under Case Analysis;
- beta.114 adds audited native skill runner jobs/receipts, saved-diagnosis chat boundaries, targeted preparation starts, and row-level Matter Preparation actions;
- service check, UI hardening, local tests, typecheck, and build all passed.

## Fixed Or Closed Tester Feedback

Current release line includes fixes for:

- archive/close and reopen matter lifecycle;
- add-files handling for lawyer captions containing slash characters;
- `.jpg` and `.docx` upload acceptance validation;
- non-destructive source removal from active record;
- heavy/voluminous file upload limit expectations;
- clearer file-count and upload-limit guidance;
- long document-reading progress copy;
- visible matter creation/upload wait status;
- release visibility and tester “What’s new” guidance.

## Parked For Future Releases

The following is intentionally not part of this official private beta release:

- Google Drive import;
- full OAuth file-picker workflow;
- retention/legal-hold/export/purge workflow;
- chunked upload for very large individual files;
- public self-service signup or password reset;
- unsupervised legal reliance;
- full in-app historical changelog browser.

Google Drive import remains parked because it needs a separate custody, OAuth, retention, and legal-hold design before implementation.

## Current Live Release

See [Current Matter Workbench Release](releases/current.md) for the current beta number, release note, deployed commit, and live URL.

Latest deployment evidence is recorded in the release note linked from the current release pointer.

## Operator Rule

For the next tester handoff, use this release as-is. Do not add convenience features during handoff preparation. Only change code if there is a blocker, a regression, a security/custody issue, or a deployment failure.

If a new improvement idea comes up, record it in feedback/Mothership and schedule it after this release checkpoint.
