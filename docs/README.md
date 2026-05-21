# Matter Workbench Docs

Status: Current documentation map

This page is the reading order for the repo. It exists so product notes,
contracts, releases, future decisions, and historical planning do not all look
equally authoritative.

## Start Here

| Need | Read |
| --- | --- |
| Current codebase map and lifecycle | [Codebase Diagram](codebase-diagram.md) |
| Plain-language project explanation | [FOR_AKSINGH.md](../FOR_AKSINGH.md) |
| Beta testing workflow | [Beta Testing List of Dates](beta-testing-list-of-dates.md) |
| Current release notes | [v1.0.0-beta.2](releases/v1.0.0-beta.2.md) |
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
| [v1.0.0-beta.2](releases/v1.0.0-beta.2.md) | Current beta release note. |
| [V1 Beta Mode A Acceptance](v1-beta-mode-a-acceptance-2026-05-17.md) | Clean-slate real-matter acceptance evidence. |

Historical model bakeoffs and runtime smokes are evidence notes. They are useful
for context, but they should not override current contracts or release notes.

## Archive

Archived planning notes live under [archive/](archive/README.md).

Do not implement from archived documents without checking the current code and
the current docs above. Archived notes may contain old assumptions, old routes,
or old product names.

## Maintenance Rules

- Add new current contracts under `docs/contracts/` when a repeated rule becomes
  implementation authority.
- Add new future decisions to
  [future-design-decisions/README.md](future-design-decisions/README.md).
- Add new historical planning notes under `docs/archive/` when they are no
  longer active.
- Keep `FOR_AKSINGH.md` as the engaging front door; move dense reference
  material into focused docs when it becomes too detailed.
- Run a relative markdown link check after moving or adding docs.
