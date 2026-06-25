# Matter Workbench Docs

Status: Current documentation map

This page is the reading order for the repo. It exists so product notes,
contracts, releases, future decisions, and historical planning do not all look
equally authoritative.

## Start Here

| Need | Read |
| --- | --- |
| Durable product and engineering North Star | [Matter Workbench North Star Design Philosophy](design-philosophy.md) |
| Current codebase map and lifecycle | [Codebase Diagram](codebase-diagram.md) |
| Current engineering risk radar | [Matter Workbench Engineering Risk Radar](engineering-risk-radar.md) |
| Fast local/private beta start | [Quickstart](../QUICKSTART.md) |
| Plain-language project explanation | [FOR_AKSINGH.md](../FOR_AKSINGH.md) |
| Archived root technical README | [Engineering README Archive](engineering-readme-archive.md) |
| Beta user/operator runbook | [Beta User Runbook](beta-user-runbook.md) |
| Beta operator checklist | [Beta Operator Checklist](beta-operator-checklist.md) |
| Private beta tester brief | [Private Beta Tester Brief](private-beta-tester-brief.md) |
| Private web beta readiness | [Private Web Beta Readiness Pack](private-web-beta-readiness-pack.md) |
| Codex private beta deployment pack | [Codex Private Beta Deployment Pack](private-beta-codex-deployment.md) |
| Private beta bug-fix loop | [Private Beta Bug-Fix Loop](private-beta-bug-fix-loop.md) |
| Beta testing workflow | [Beta Testing List of Dates](beta-testing-list-of-dates.md) |
| Database transition handoff | [Database Transition Handoff](database-transition-handoff.md) |
| Database transition scorecard | [Database Transition Scorecard](database-transition-scorecard.md) |
| Runtime DB cutover rehearsal | [Runtime DB Cutover Rehearsal](runtime-db-cutover-rehearsal.md) |
| Private VM runtime rehearsal | [Private VM Runtime Deployment Rehearsal](private-vm-runtime-deployment-rehearsal.md) |
| Private VM service pack | [Private VM Service Pack](../deployment/private-vm/README.md) |
| Release policy | [Matter Workbench Release Policy](release-policy.md) |
| Branch/worktree hygiene | [Repo Branch And Worktree Hygiene](repo-branch-hygiene.md) |
| Current release notes | [v1.0.0-beta.46](releases/v1.0.0-beta.46.md) |
| Private beta bug evidence | [Private Beta Bug Evidence Pack](private-beta-bug-evidence-pack.md) |
| Mode A clean-slate acceptance evidence | [V1 Beta Mode A Acceptance](v1-beta-mode-a-acceptance-2026-05-17.md) |
| Product feature brief | [Product Features and Differentiation](product-features-and-differentiation.md) |

## Current Contracts

These describe behavior that current code or current acceptance depends on.
Treat edits here as contract edits.

| Contract | Purpose |
| --- | --- |
| [Extraction Record v1](extraction-record.v1.md) | Source text record shape and citation handles. |
| [Matter Context Reader](matter-context-reader-contract.md) | What Copilot/search/skills may read from a matter. |
| [Copilot Q&A](copilot-qna-contract.md) | Transient matter Q&A boundaries. |
| [Source Descriptors](source-descriptors.md) | Source Index and lawyer-readable labels. |
| [Source Identity and Labels](contracts/source-identity-and-labels.md) | Canonical split between internal source identity and lawyer-facing labels. |
| [Upload Intake](contracts/upload-intake-contract.md) | Canonical shared planning rules for matter upload and add-files intake across filesystem/runtime DB storage. |
| [Artifact Visibility and Dispatch](contracts/artifact-visibility-and-dispatch.md) | Canonical classes for generated artifacts, drafts, technical files, and dispatch copies. |
| [Dependency States and Staleness](contracts/dependency-states-and-staleness.md) | Canonical List of Dates dependency states for label refresh, review, and regeneration. |
| [Custom Skill Governance](contracts/custom-skill-governance.md) | Canonical no-silent-mutation path for skill ideas, samples, validation, and versions. |
| [Diagnostic Surfaces](contracts/diagnostic-surfaces.md) | Canonical boundary between matter-level attention and app/system health. |
| [Model Task Boundaries](contracts/model-task-boundaries.md) | Canonical boundary between Copilot model choice and app-owned model policy. |
| [Create List of Dates Two-Pass](create-listofdates-two-pass-contract.md) | Two-pass chronology behavior and artifact safety. |
| [Model Routing](model-routing.md) | Provider/task routing and model policy. |
| [OCR Strategy](ocr-strategy.md) | OCR-first PDF extraction posture. |

## Future Decisions

Future product decisions live in
[Future Design Decisions](future-design-decisions/README.md).

That folder has its own ledger. A future-design note is not implementation
permission unless its status says it is a current contract or an accepted
implementation plan.

## Releases And Evidence

| Document | Role |
| --- | --- |
| [v1.0.0-beta.1](releases/v1.0.0-beta.1.md) | First beta release note. |
| [v1.0.0-beta.2](releases/v1.0.0-beta.2.md) | React production-shell beta release note. |
| [v1.0.0-beta.3](releases/v1.0.0-beta.3.md) | Owner-accepted React local beta release note. |
| [v1.0.0-beta.4](releases/v1.0.0-beta.4.md) | Runtime DB local/private cutover release note. |
| [v1.0.0-beta.5](releases/v1.0.0-beta.5.md) | Private beta release-candidate closure pack note. |
| [v1.0.0-beta.6](releases/v1.0.0-beta.6.md) | Private beta ops-loop and bug evidence note. |
| [v1.0.0-beta.7](releases/v1.0.0-beta.7.md) | Local durable job-status first-slice note. |
| [v1.0.0-beta.8](releases/v1.0.0-beta.8.md) | Private-VM release marker and handoff correction note. |
| [v1.0.0-beta.9](releases/v1.0.0-beta.9.md) | Feedback-first tester handoff release marker. |
| [v1.0.0-beta.10](releases/v1.0.0-beta.10.md) | Named-tester-account private beta release marker. |
| [v1.0.0-beta.11](releases/v1.0.0-beta.11.md) | First tagged Beta 3 public-private deployment marker. |
| [v1.0.0-beta.12](releases/v1.0.0-beta.12.md) | Runtime DB query-helper private-cloud checkpoint. |
| [v1.0.0-beta.15](releases/v1.0.0-beta.15.md) | Beta 3 System Health / feedback / credit-shadow release marker. |
| [v1.0.0-beta.16](releases/v1.0.0-beta.16.md) | Beta 3 diagnostic-closeout release marker. |
| [v1.0.0-beta.17](releases/v1.0.0-beta.17.md) | Beta 3 diagnostic-hardening release marker. |
| [v1.0.0-beta.18](releases/v1.0.0-beta.18.md) | Beta 3 feedback-triage release marker. |
| [v1.0.0-beta.19](releases/v1.0.0-beta.19.md) | Beta 3 feedback-triage audit release marker. |
| [v1.0.0-beta.20](releases/v1.0.0-beta.20.md) | Beta 3 misfiled-feedback triage release marker. |
| [v1.0.0-beta.21](releases/v1.0.0-beta.21.md) | Beta 3 successful-slow feedback triage release marker. |
| [v1.0.0-beta.22](releases/v1.0.0-beta.22.md) | Beta 3 operator feedback context release marker. |
| [v1.0.0-beta.23](releases/v1.0.0-beta.23.md) | Beta 3 operator feedback status-disposition release marker. |
| [v1.0.0-beta.24](releases/v1.0.0-beta.24.md) | Beta 3 closure release marker. |
| [v1.0.0-beta.25](releases/v1.0.0-beta.25.md) | Post-Beta-3 upload and intake hardening release marker. |
| [v1.0.0-beta.26](releases/v1.0.0-beta.26.md) | Beta 3 upload failure hardening release marker. |
| [v1.0.0-beta.27](releases/v1.0.0-beta.27.md) | Beta 3 upload visibility hardening release marker. |
| [v1.0.0-beta.28](releases/v1.0.0-beta.28.md) | Beta 3 upload batch-cap hardening release marker. |
| [v1.0.0-beta.29](releases/v1.0.0-beta.29.md) | Beta 3 Copilot Research mode release marker. |
| [v1.0.0-beta.30](releases/v1.0.0-beta.30.md) | Beta 3 Ask-to-Research escalation release marker. |
| [v1.0.0-beta.31](releases/v1.0.0-beta.31.md) | Beta 3 Copilot Research observability and UX hardening release marker. |
| [v1.0.0-beta.32](releases/v1.0.0-beta.32.md) | Beta 3 bounded Copilot follow-up release marker. |
| [v1.0.0-beta.33](releases/v1.0.0-beta.33.md) | Beta 3 Copilot interaction receipts release marker. |
| [v1.0.0-beta.34](releases/v1.0.0-beta.34.md) | Beta 3 Copilot thread-helper hardening release marker. |
| [v1.0.0-beta.35](releases/v1.0.0-beta.35.md) | Beta 3 resizable Matter Assistant rail release marker. |
| [v1.0.0-beta.36](releases/v1.0.0-beta.36.md) | Beta 3 GPT 5.5 Copilot preset release marker. |
| [v1.0.0-beta.37](releases/v1.0.0-beta.37.md) | Beta 3 Matter Assistant composition hardening release marker. |
| [v1.0.0-beta.38](releases/v1.0.0-beta.38.md) | Beta 3 actionable Skills page release marker. |
| [v1.0.0-beta.39](releases/v1.0.0-beta.39.md) | Beta 3 draft skill title cleanup release marker. |
| [v1.0.0-beta.40](releases/v1.0.0-beta.40.md) | Beta 3 built-in workflow label cleanup release marker. |
| [v1.0.0-beta.41](releases/v1.0.0-beta.41.md) | Beta 3 actionable Skills matter chooser release marker. |
| [v1.0.0-beta.42](releases/v1.0.0-beta.42.md) | Beta 3 Skills matter chooser continuation release marker. |
| [v1.0.0-beta.43](releases/v1.0.0-beta.43.md) | Beta 3 Skill Factory sample matter hotfix release marker. |
| [v1.0.0-beta.44](releases/v1.0.0-beta.44.md) | Beta 3 AI provider service foundation release marker. |
| [v1.0.0-beta.45](releases/v1.0.0-beta.45.md) | Beta 3 AI provider service planner/research migration release marker. |
| [v1.0.0-beta.46](releases/v1.0.0-beta.46.md) | Current Beta 3 AI provider service configurable/source-descriptor migration release marker. |
| [Beta User Runbook](beta-user-runbook.md) | Short supervised-beta operating guide and stop rules. |
| [Beta Operator Checklist](beta-operator-checklist.md) | Practical supervised local/private beta runbook. |
| [Private Beta Tester Brief](private-beta-tester-brief.md) | Concise trusted-tester instructions and stop rules. |
| [Private Beta Bug-Fix Loop](private-beta-bug-fix-loop.md) | Operating rule for bug-fix-only supervised beta work. |
| [Private Beta Bug Evidence Pack](private-beta-bug-evidence-pack.md) | One-bug private beta handoff evidence. |
| [V1 Beta Mode A Acceptance](v1-beta-mode-a-acceptance-2026-05-17.md) | Clean-slate real-matter acceptance evidence. |
| [Release Policy](release-policy.md) | Rules for tags, release notes, deployed commits, and current-release pointers. |

Historical model bakeoffs and runtime smokes are evidence notes. They are useful
for context, but they should not override current contracts or release notes.

## Archive

Archived planning notes live under [archive/](archive/README.md).

Do not implement from archived documents without checking the current code and
the current docs above. Archived notes may contain old assumptions, old routes,
or old product names.

## Maintenance Rules

- Keep `main` as the current integration/deployment line; see
  [Repo Branch And Worktree Hygiene](repo-branch-hygiene.md).
- Add new current contracts under `docs/contracts/` when a repeated rule becomes
  implementation authority.
- Add new future decisions to
  [future-design-decisions/README.md](future-design-decisions/README.md).
- Add new historical planning notes under `docs/archive/` when they are no
  longer active.
- Keep `FOR_AKSINGH.md` as the engaging front door; move dense reference
  material into focused docs when it becomes too detailed.
- Run a relative markdown link check after moving or adding docs.
