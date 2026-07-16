# Repo Branch And Worktree Hygiene

Date: 2026-06-21
Status: Current local operating note

## Current Integration Rule

`main` is the current product and deployment line.

As of this cleanup pass:

```text
main = origin/main = deployed private beta line
```

Historical integration branches such as `post-beta-3` should not be recreated
unless there is an explicit release-management reason. New product work should
start from `main`.

## Normal Working Shape

Keep the local checkout boring:

```text
/Users/aksingh/matter-workbench        main
/Users/aksingh/matter-workbench-email  feature/outbound-client-email   # WIP
```

Additional worktrees are allowed only for active WIP, isolated experiments, or
explicitly parked branches. Remove stale worktrees after their work is absorbed
or parked.

## Team Git Workflow Policy

This section is the default convention for humans and coding agents working on
Matter Workbench. The point is to avoid re-deciding branch, worktree, merge,
commit, push, and deploy rules on every task.

### 1. Source of truth

- `main` is the integration line and the private-beta deployment line.
- `origin/main` is the shared remote truth.
- The VM deployed commit is the live-beta truth.
- A claim such as "ready", "merged", or "deployed" must say which of these is
  true: local commit, pushed commit, tag, or VM deployed commit.

### 2. Branch naming

Use short, descriptive branches:

```text
feature/<topic>       # product feature or UI/workflow slice
hardening/<topic>     # bug fix, reliability, tests, defensive code
docs/<topic>          # documentation-only work
release/<version>     # release-note or release-marker preparation
hotfix/<topic>        # urgent live-beta fix
codex/<topic>         # coding-agent branch when useful for isolation
```

Avoid vague names such as `new-work`, `changes`, `fixes`, or `test-branch`.

### 3. Worktree rules

- Keep the main checkout at `/Users/aksingh/matter-workbench` on `main`.
- Put feature worktrees beside it, not inside it:

```text
/Users/aksingh/matter-workbench-<topic>
```

- Do not create embedded worktrees under the repo.
- One active worktree should have one active purpose.
- Remove a worktree when its work is merged, parked, or abandoned.
- If a worktree has useful untracked notes before deletion, preserve them under
  `.local/cleanup/` or commit them to an appropriate docs branch.

### 4. Starting work

Before starting a new branch or worktree:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
```

Then create the branch from current `main`:

```sh
git switch -c feature/<topic>
```

If local `main` is dirty, do not start feature work there. Commit, stash, or
park the dirty work first.

### 5. Commit policy

- Keep commits atomic: one product/engineering idea per commit.
- Use imperative commit messages:

```text
Route skill router via OpenRouter
Document Copilot research mode
Guard browser uploads before oversized submit
```

- Commit code, tests, and docs together when they are part of the same behavior
  change.
- Do not mix unrelated feature work with hardening or release-note commits.
- Do not commit secrets, `.env`, local VM credentials, private keys, local test
  ledgers, `node_modules`, build output, or Playwright artifacts.
- Generated evidence belongs in docs only when it is intentionally release or
  acceptance evidence. Local scratch evidence belongs under `.local/`.

### 6. Push policy

- Push branch work before asking another team/agent to review or continue it.
- If committing directly on `main` for a small accepted change, push `main`
  promptly after tests pass.
- Do not call committed-but-unpushed work preserved. It is local evidence only.
- Do not force-push `main`.
- Do not rebase a branch that another team/agent is actively using unless the
  branch owner agrees.

### 7. Merge policy

Before merging to `main`:

1. Rebase or merge latest `origin/main` into the branch.
2. Resolve conflicts locally.
3. Run focused tests for the touched area.
4. Run broader validation when runtime, provider, upload, DB, auth, or release
   behavior is touched.
5. Confirm `git diff --check` passes.

Merge style:

- Use a normal merge when the branch has meaningful commits worth preserving.
- Squash only noisy WIP commits whose intermediate states are not useful.
- For docs-only planning notes, a single direct commit on `main` is acceptable
  if the worktree is clean and the commit is pushed.

### 8. Deploy policy

Deploy only from a clean, pushed `main` commit unless there is an explicit
emergency note.

Before deploy:

```sh
git status --short
git log --oneline -1
git rev-parse --short HEAD
```

The deploy command must use the exact commit being deployed. After deploy,
record or report:

- deployed commit;
- release label/note;
- VM `current` symlink target;
- service check result;
- UI hardening result when relevant;
- ops-pack path and rollback candidate.

Never use `--allow-dirty` for normal private-beta deploys. If an emergency uses
it, document exactly what uncommitted diff was deployed and clean it up
immediately afterward.

### 9. WIP, stash, and handoff rules

- Prefer a WIP branch commit over a stash when work needs handoff.
- Stashes are allowed only for short-lived local surgery, such as temporarily
  cleaning the tree for a deploy.
- If you stash to deploy, restore or explicitly drop the stash before finishing
  the session and say what happened.
- Handoff notes should include:
  - branch/worktree name;
  - current status;
  - tests run;
  - known risks;
  - next command or next decision.

### 10. Review packet convention

Every review-ready change should include a short packet:

```text
What changed:
Files touched:
Tests run:
Risk areas:
Deploy needed: yes/no
Rollback note, if deployed:
```

For provider/model/routing changes, include the resolved route. For DB/runtime
changes, include migration and runtime-mode impact. For UI changes, include the
operator vs lawyer-facing visibility boundary.

### 11. Stop rules

Stop and ask before proceeding when:

- local `main` is dirty and the task is unrelated to that diff;
- a merge conflict touches legal artifacts, runtime DB custody, auth, provider
  policy, upload intake, or release scripts;
- a deploy target commit does not match local `HEAD`;
- a test failure is unrelated or not understood;
- a change needs new environment variables on the VM;
- a branch contains both feature work and release/hotfix work.

## Cleanup Policy

For every old worktree/branch, use this order:

1. Inspect actual commits and files, not just the branch name.
2. Decide one of:
   - absorb into `main`;
   - park as branch-only;
   - archive patch and delete;
   - keep as active WIP.
3. If absorbing, run the relevant tests before merging.
4. If deleting, preserve useful untracked notes or dirty diffs under
   `.local/cleanup/` first.
5. Remove the worktree.
6. Delete local and remote branch labels only when safe.

## Current Parked Branches

These are intentionally not worktrees right now:

| Branch | Why parked |
| --- | --- |
| `codex/credit-metering-shadow` | Shadow credit metering has product/business dependencies before enforcement. Keep branch as reference. |
| `codex/beta-3-runtime-db-read-side` | Older runtime DB storage refactor ideas; current `main` has a newer helper split. Keep as reference only. |
| `codex/private-beta-2-operational-hardening` | Operational hardening/audit branch with real unique commits. Do not absorb wholesale into stable production without a focused pass. |

## Current WIP Branches

| Branch | Worktree | Note |
| --- | --- | --- |
| `feature/outbound-client-email` | `/Users/aksingh/matter-workbench-email` | Active WIP. Do not clean automatically. |

## Recently Archived Then Removed

Patch/archive records are under:

```text
.local/cleanup/
```

This folder may contain local-only records such as:

- absorbed branch deletion logs;
- obsolete branch patches;
- preserved dirty diffs from removed scratch worktrees;
- branch announcement notes.

These are local cleanup evidence, not product docs and not deployment inputs.

## Rules Of Thumb

- If a branch is fully contained in `main`, delete the branch label after the
  worktree is removed.
- If a branch is patch-equivalent to `main` but not ancestry-merged, preserve a
  patch only if the branch name carries useful context, then delete the local
  label.
- If a branch has unique code that affects runtime DB, telemetry, billing,
  outbound communication, or legal artifacts, keep it parked until a focused
  review.
- If a branch recreates the retired plain-JS shell or root shell files, prefer
  archiving and deleting it rather than absorbing a second browser product.
- Do not delete `main` or active WIP branches.
