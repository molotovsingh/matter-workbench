# Matter Workbench Official Private Beta Release

Status: Official supervised private beta release checkpoint

Release: [`v1.0.0-beta.80`](releases/v1.0.0-beta.80.md)

Codename: **Timeline Lantern**

Date: 2026-06-29

## Release Decision

`v1.0.0-beta.80` is the official private beta release checkpoint.

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
- runtime DB migrations through `023_matter_archive_metadata` are applied/skipped current;
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
- beta.80 suppresses the global top readiness banner when Matter Assistant availability is the only degraded readiness check;
- service check, UI hardening, ops pack, local tests, typecheck, build, and smoke all passed.

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
- durable background workers;
- public self-service signup or password reset;
- unsupervised legal reliance;
- full in-app historical changelog browser.

Google Drive import remains parked because it needs a separate custody, OAuth, retention, and legal-hold design before implementation.

## Current Live Release

```text
release: v1.0.0-beta.80
codename: Timeline Lantern
deployed_commit: 2218fb9
release_doc_commit: this documentation commit
live_url: https://mwb-beta.139.59.74.9.sslip.io
rollback_candidate: 09be1e5 / v1.0.0-beta.79
```

Latest evidence:

```text
/home/aks/matter-workbench-backups/ui-hardening/private-beta-ui-hardening-2026-06-29T02-27-46-257Z/ui-hardening-report.md
/home/aks/matter-workbench-backups/ops-packs/private-vm-ops-pack-2026-06-29T02-28-33-240Z/ops-pack.md
```

## Operator Rule

For the next tester handoff, use this release as-is. Do not add convenience features during handoff preparation. Only change code if there is a blocker, a regression, a security/custody issue, or a deployment failure.

If a new improvement idea comes up, record it in feedback/Mothership and schedule it after this release checkpoint.
