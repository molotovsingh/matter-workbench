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
| Current release notes | [v1.0.0-beta.108](releases/v1.0.0-beta.108.md) |
| Official private beta release | [Official Private Beta Release](private-beta-official-release.md) |
| Release codenames | [Release Codenames](release-codenames.md) |
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
| [Active Source Set And Suppression](contracts/active-source-set-and-suppression.md) | Current read-side suppression contract before any source-removal UI or write-side tombstone workflow. |
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
| [v1.0.0-beta.1](releases/v1.0.0-beta.1.md) | First beta release note. **Codename:** Clerk's Lantern. |
| [v1.0.0-beta.2](releases/v1.0.0-beta.2.md) | React production-shell beta release note. **Codename:** React Gavel. |
| [v1.0.0-beta.3](releases/v1.0.0-beta.3.md) | Owner-accepted React local beta release note. **Codename:** Barrister's Compass. |
| [v1.0.0-beta.4](releases/v1.0.0-beta.4.md) | Runtime DB local/private cutover release note. **Codename:** Postgres Portico. |
| [v1.0.0-beta.5](releases/v1.0.0-beta.5.md) | Private beta release-candidate closure pack note. **Codename:** Closure Bell. |
| [v1.0.0-beta.6](releases/v1.0.0-beta.6.md) | Private beta ops-loop and bug evidence note. **Codename:** Evidence Satchel. |
| [v1.0.0-beta.7](releases/v1.0.0-beta.7.md) | Local durable job-status first-slice note. **Codename:** Docket Ember. |
| [v1.0.0-beta.8](releases/v1.0.0-beta.8.md) | Private-VM release marker and handoff correction note. **Codename:** Handoff Harbormaster. |
| [v1.0.0-beta.9](releases/v1.0.0-beta.9.md) | Feedback-first tester handoff release marker. **Codename:** Feedback Falcon. |
| [v1.0.0-beta.10](releases/v1.0.0-beta.10.md) | Named-tester-account private beta release marker. **Codename:** Named Witness. |
| [v1.0.0-beta.11](releases/v1.0.0-beta.11.md) | First tagged Beta 3 public-private deployment marker. **Codename:** Public Hearth. |
| [v1.0.0-beta.12](releases/v1.0.0-beta.12.md) | Runtime DB query-helper private-cloud checkpoint. **Codename:** Query Quill. |
| [v1.0.0-beta.15](releases/v1.0.0-beta.15.md) | Beta 3 System Health / feedback / credit-shadow release marker. **Codename:** Health Beacon. |
| [v1.0.0-beta.16](releases/v1.0.0-beta.16.md) | Beta 3 diagnostic-closeout release marker. **Codename:** Diagnostic Seal. |
| [v1.0.0-beta.17](releases/v1.0.0-beta.17.md) | Beta 3 diagnostic-hardening release marker. **Codename:** Sentinel Ledger. |
| [v1.0.0-beta.18](releases/v1.0.0-beta.18.md) | Beta 3 feedback-triage release marker. **Codename:** Triage Sparrow. |
| [v1.0.0-beta.19](releases/v1.0.0-beta.19.md) | Beta 3 feedback-triage audit release marker. **Codename:** Audit Loom. |
| [v1.0.0-beta.20](releases/v1.0.0-beta.20.md) | Beta 3 misfiled-feedback triage release marker. **Codename:** Misfiled Map. |
| [v1.0.0-beta.21](releases/v1.0.0-beta.21.md) | Beta 3 successful-slow feedback triage release marker. **Codename:** Slow Courier. |
| [v1.0.0-beta.22](releases/v1.0.0-beta.22.md) | Beta 3 operator feedback context release marker. **Codename:** Operator Periscope. |
| [v1.0.0-beta.23](releases/v1.0.0-beta.23.md) | Beta 3 operator feedback status-disposition release marker. **Codename:** Disposition Stamp. |
| [v1.0.0-beta.24](releases/v1.0.0-beta.24.md) | Beta 3 closure release marker. **Codename:** Closing Bell. |
| [v1.0.0-beta.25](releases/v1.0.0-beta.25.md) | Post-Beta-3 upload and intake hardening release marker. **Codename:** Intake Anvil. |
| [v1.0.0-beta.26](releases/v1.0.0-beta.26.md) | Beta 3 upload failure hardening release marker. **Codename:** Upload Shield. |
| [v1.0.0-beta.27](releases/v1.0.0-beta.27.md) | Beta 3 upload visibility hardening release marker. **Codename:** Visibility Torch. |
| [v1.0.0-beta.28](releases/v1.0.0-beta.28.md) | Beta 3 upload batch-cap hardening release marker. **Codename:** Batch Gate. |
| [v1.0.0-beta.29](releases/v1.0.0-beta.29.md) | Beta 3 Copilot Research mode release marker. **Codename:** Research Raven. |
| [v1.0.0-beta.30](releases/v1.0.0-beta.30.md) | Beta 3 Ask-to-Research escalation release marker. **Codename:** Escalation Compass. |
| [v1.0.0-beta.31](releases/v1.0.0-beta.31.md) | Beta 3 Copilot Research observability and UX hardening release marker. **Codename:** Observability Lens. |
| [v1.0.0-beta.32](releases/v1.0.0-beta.32.md) | Beta 3 bounded Copilot follow-up release marker. **Codename:** Follow-up Fence. |
| [v1.0.0-beta.33](releases/v1.0.0-beta.33.md) | Beta 3 Copilot interaction receipts release marker. **Codename:** Receipt Ribbon. |
| [v1.0.0-beta.34](releases/v1.0.0-beta.34.md) | Beta 3 Copilot thread-helper hardening release marker. **Codename:** Thread Needle. |
| [v1.0.0-beta.35](releases/v1.0.0-beta.35.md) | Beta 3 resizable Matter Assistant rail release marker. **Codename:** Railwright. |
| [v1.0.0-beta.36](releases/v1.0.0-beta.36.md) | Beta 3 GPT 5.5 Copilot preset release marker. **Codename:** Copper Copilot. |
| [v1.0.0-beta.37](releases/v1.0.0-beta.37.md) | Beta 3 Matter Assistant composition hardening release marker. **Codename:** Composition Brace. |
| [v1.0.0-beta.38](releases/v1.0.0-beta.38.md) | Beta 3 actionable Skills page release marker. **Codename:** Skills Lantern. |
| [v1.0.0-beta.39](releases/v1.0.0-beta.39.md) | Beta 3 draft skill title cleanup release marker. **Codename:** Draft Finch. |
| [v1.0.0-beta.40](releases/v1.0.0-beta.40.md) | Beta 3 built-in workflow label cleanup release marker. **Codename:** Workflow Bell. |
| [v1.0.0-beta.41](releases/v1.0.0-beta.41.md) | Beta 3 actionable Skills matter chooser release marker. **Codename:** Chooser Compass. |
| [v1.0.0-beta.42](releases/v1.0.0-beta.42.md) | Beta 3 Skills matter chooser continuation release marker. **Codename:** Chooser Tide. |
| [v1.0.0-beta.43](releases/v1.0.0-beta.43.md) | Beta 3 Skill Factory sample matter hotfix release marker. **Codename:** Sample Harbor. |
| [v1.0.0-beta.44](releases/v1.0.0-beta.44.md) | Beta 3 AI provider service foundation release marker. **Codename:** Provider Forge. |
| [v1.0.0-beta.45](releases/v1.0.0-beta.45.md) | Beta 3 AI provider service planner/research migration release marker. **Codename:** Planner Bridge. |
| [v1.0.0-beta.46](releases/v1.0.0-beta.46.md) | Beta 3 AI provider service configurable/source-descriptor migration release marker. **Codename:** Descriptor Loom. |
| [v1.0.0-beta.47](releases/v1.0.0-beta.47.md) | Beta 3 AI provider service List of Dates migration release marker. **Codename:** Chronology Engine. |
| [v1.0.0-beta.48](releases/v1.0.0-beta.48.md) | Beta 3 Skill Factory OpenRouter default release marker. **Codename:** Router Star. |
| [v1.0.0-beta.49](releases/v1.0.0-beta.49.md) | Beta 3 Skill Factory sample warning cleanup release marker. **Codename:** Warning Whisper. |
| [v1.0.0-beta.50](releases/v1.0.0-beta.50.md) | Beta 3 sidebar account footer UX release marker. **Codename:** Account Hearth. |
| [v1.0.0-beta.51](releases/v1.0.0-beta.51.md) | Beta 3 runtime DB skill sample approval hotfix release marker. **Codename:** Approval Key. |
| [v1.0.0-beta.52](releases/v1.0.0-beta.52.md) | Beta 3 Skill Factory matter-boundary hardening release marker. **Codename:** Boundary Stone. |
| [v1.0.0-beta.53](releases/v1.0.0-beta.53.md) | Beta 3 Skill Factory post-create refresh release marker. **Codename:** Refresh Wheel. |
| [v1.0.0-beta.54](releases/v1.0.0-beta.54.md) | Beta 3 Skill Factory creation toast release marker. **Codename:** Toast Bell. |
| [v1.0.0-beta.55](releases/v1.0.0-beta.55.md) | Beta 3 Matter Log preview release marker. **Codename:** Matter Ledger. |
| [v1.0.0-beta.56](releases/v1.0.0-beta.56.md) | Beta 3 Matter Events foundation release marker. **Codename:** Event Grove. |
| [v1.0.0-beta.57](releases/v1.0.0-beta.57.md) | Beta 3 custom-skill canonical event release marker. **Codename:** Canon Bell. |
| [v1.0.0-beta.58](releases/v1.0.0-beta.58.md) | Beta 3 active source suppression foundation release marker. **Codename:** Suppression Gate. |
| [v1.0.0-beta.59](releases/v1.0.0-beta.59.md) | Beta 3 context artifact source suppression release marker. **Codename:** Context Veil. |
| [v1.0.0-beta.60](releases/v1.0.0-beta.60.md) | Beta 3 runtime DB inactive source status release marker. **Codename:** Inactive Seal. |
| [v1.0.0-beta.61](releases/v1.0.0-beta.61.md) | Beta 3 active-source currentness advice release marker. **Codename:** Currentness Compass. |
| [v1.0.0-beta.62](releases/v1.0.0-beta.62.md) | Beta 3 runtime DB inactive source derived-payload filter release marker. **Codename:** Payload Sieve. |
| [v1.0.0-beta.63](releases/v1.0.0-beta.63.md) | Beta 3 artifact-currentness foundation release marker. **Codename:** Artifact Sextant. |
| [v1.0.0-beta.64](releases/v1.0.0-beta.64.md) | Beta 3 source-removal backend foundation release marker. **Codename:** Custody Chisel. |
| [v1.0.0-beta.65](releases/v1.0.0-beta.65.md) | Beta 3 read-only source-removal impact preview release marker. **Codename:** Impact Lantern. |
| [v1.0.0-beta.66](releases/v1.0.0-beta.66.md) | Beta 3 non-destructive matter archive lifecycle release marker. **Codename:** Archive Lighthouse. |
| [v1.0.0-beta.67](releases/v1.0.0-beta.67.md) | Beta 3 visible matter archive confirmation hotfix release marker. **Codename:** Confirmation Drum. |
| [v1.0.0-beta.68](releases/v1.0.0-beta.68.md) | Beta 3 archive confirmation backend hotfix release marker. **Codename:** Backend Rivet. |
| [v1.0.0-beta.69](releases/v1.0.0-beta.69.md) | Beta 3 archived matter reopen UX release marker. **Codename:** Reopen Bridge. |
| [v1.0.0-beta.70](releases/v1.0.0-beta.70.md) | Beta 3 archive reason metadata release marker. **Codename:** Reason Seal. |
| [v1.0.0-beta.71](releases/v1.0.0-beta.71.md) | Beta 3 archive confirmation sidebar expansion release marker. **Codename:** Sidebar Bellows. |
| [v1.0.0-beta.72](releases/v1.0.0-beta.72.md) | Beta 3 runtime matter caption add-files fix release marker. **Codename:** Caption Compass. |
| [v1.0.0-beta.73](releases/v1.0.0-beta.73.md) | Beta 3 non-destructive source-removal release marker. **Codename:** Custody Lily. |
| [v1.0.0-beta.74](releases/v1.0.0-beta.74.md) | Beta 3 larger upload batch limit release marker. **Codename:** Upload Atlas. |
| [v1.0.0-beta.75](releases/v1.0.0-beta.75.md) | Beta 3 long-wait progress UX release marker. **Codename:** Patience Lantern. |
| [v1.0.0-beta.76](releases/v1.0.0-beta.76.md) | Beta 3 closure evidence hardening release marker. **Codename:** Closure Sextant. |
| [v1.0.0-beta.77](releases/v1.0.0-beta.77.md) | Beta 3 tester What’s new notice release marker. **Codename:** Notice Bell. |
| [v1.0.0-beta.78](releases/v1.0.0-beta.78.md) | Official private beta handoff checkpoint. **Codename:** Nameplate Lantern. |
| [v1.0.0-beta.79](releases/v1.0.0-beta.79.md) | Shallow UI polish release checkpoint. **Codename:** Column Compass. |
| [v1.0.0-beta.80](releases/v1.0.0-beta.80.md) | Case Timeline and posture diagnosis release checkpoint. **Codename:** Timeline Lantern. |
| [v1.0.0-beta.82](releases/v1.0.0-beta.82.md) | Assistant readiness signal hotfix. **Codename:** Assistant Signal. |
| [v1.0.0-beta.83](releases/v1.0.0-beta.83.md) | AI error boundary hardening hotfix. **Codename:** Error Firewall. |
| [v1.0.0-beta.84](releases/v1.0.0-beta.84.md) | AI error boundary service-check hotfix. **Codename:** Boundary Gauge. |
| [v1.0.0-beta.85](releases/v1.0.0-beta.85.md) | OpenAI-direct provider routing hotfix. **Codename:** OpenAI Relay. |
| [v1.0.0-beta.86](releases/v1.0.0-beta.86.md) | Centralized Copilot preset hotfix. **Codename:** Preset Spine. |
| [v1.0.0-beta.87](releases/v1.0.0-beta.87.md) | Copilot provider-check refactor. **Codename:** Provider Spine. |
| [v1.0.0-beta.88](releases/v1.0.0-beta.88.md) | AI task model-policy metadata refactor. **Codename:** Policy Spine. |
| [v1.0.0-beta.89](releases/v1.0.0-beta.89.md) | Canned mothership investigation helper. **Codename:** Boring Queries. |
| [v1.0.0-beta.90](releases/v1.0.0-beta.90.md) | Mothership investigation query narrowing. **Codename:** Quiet Query. |
| [v1.0.0-beta.91](releases/v1.0.0-beta.91.md) | Mothership focus-user investigation semantics. **Codename:** Focus Lens. |
| [v1.0.0-beta.92](releases/v1.0.0-beta.92.md) | Two-stage mothership investigation workflow. **Codename:** Signal Ladder. |
| [v1.0.0-beta.93](releases/v1.0.0-beta.93.md) | Upload interruption tracking. **Codename:** Upload Beacon. |
| [v1.0.0-beta.94](releases/v1.0.0-beta.94.md) | First-class upload intake backbone. **Codename:** Intake Spine. |
| [v1.0.0-beta.95](releases/v1.0.0-beta.95.md) | Upload payload handling refactor. **Codename:** Payload Loom. |
| [v1.0.0-beta.96](releases/v1.0.0-beta.96.md) | Resumable upload session recovery. **Codename:** Resume Thread. |
| [v1.0.0-beta.97](releases/v1.0.0-beta.97.md) | Broader runtime DB worker stage support. **Codename:** Worker Loom. |
| [v1.0.0-beta.98](releases/v1.0.0-beta.98.md) | Upload recovery refactor. **Codename:** Recovery Weave. |
| [v1.0.0-beta.99](releases/v1.0.0-beta.99.md) | Runtime config no-store freshness fix. **Codename:** Fresh Badge. |
| [v1.0.0-beta.100](releases/v1.0.0-beta.100.md) | Client/server runtime config freshness hardening. **Codename:** Config Belt. |
| [v1.0.0-beta.101](releases/v1.0.0-beta.101.md) | Runtime config fetch refactor. **Codename:** Fresh Path. |
| [v1.0.0-beta.102](releases/v1.0.0-beta.102.md) | Preparation readiness and safe rerun fix. **Codename:** Preparation Gate. |
| [v1.0.0-beta.104](releases/v1.0.0-beta.104.md) | Backend-owned post-upload preparation queue migration. **Codename:** Relay Key. |
| [v1.0.0-beta.105](releases/v1.0.0-beta.105.md) | Backend-owned needed-preparation run queue and React job polling. **Codename:** Queue Helm. |
| [v1.0.0-beta.106](releases/v1.0.0-beta.106.md) | Preparation queue helper refactor. **Codename:** Queue Spindle. |
| [v1.0.0-beta.107](releases/v1.0.0-beta.107.md) | Backend preparation job observer. **Codename:** Queue Watch. |
| [v1.0.0-beta.108](releases/v1.0.0-beta.108.md) | Current preparation observer hook refactor. **Codename:** Watch Loom. |
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
