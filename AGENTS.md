## Spec-Kit

This repository uses the [spec-kit](https://github.com/github/spec-kit) workflow for AI-assisted feature development.
Spec-kit is a convention for structuring feature specs, plans, and tasks in a `.specify/` directory so that AI agents can read and act on them.
This project uses an opinionated local tooling layer to generate the artifacts that live there — the source of truth for the workflow itself is the spec-kit repo linked above.

### `.specify/` directory

| Path | Purpose |
|------|---------|
| `.specify/templates/` | Markdown templates for specs, plans, tasks, and checklists |
| `.specify/memory/` | Long-lived context files (e.g. `constitution.md`) read by agents |
| `.specify/scripts/` | Helper shell scripts for common workflow steps |
| `.specify/hooks.yml` | CI/automation hook definitions |

### Branching: make the worktree first

This repository uses one git worktree per feature branch (`matter-workbench-<name>`),
with `main` permanently checked out in `matter-workbench/`. The `create_branch` hook is
disabled in `.specify/hooks.yml` because `git checkout -b` would move the invoking
worktree onto the new branch — and the VM deploy script rsyncs `git ls-files` from its
working directory, so a silently moved worktree could ship feature code under a
maintenance-checkpoint label.

Create the worktree yourself, then run speckit inside it:

```bash
git worktree add ../matter-workbench-<name> -b feature/<name>
cd ../matter-workbench-<name>
```

Specs resolve against the invoking worktree, so the spec lands beside its branch.
Never run `/speckit-specify` from `matter-workbench/` expecting it to branch for you.

### How to use it

- Start a new feature: `/speckit-specify` — creates a spec from a template and opens a clarification loop.
- Generate a plan: `/speckit-plan` — converts an approved spec into a structured plan.
- Break into tasks: `/speckit-tasks` — decomposes a plan into trackable tasks.
- Implement: `/speckit-implement` — works through tasks and updates checklists.
