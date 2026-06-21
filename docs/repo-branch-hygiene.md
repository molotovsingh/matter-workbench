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
- If a branch changes retired legacy UI (`frontend/`, root `index.html`, root
  `styles.css`) and the current product is React-only, prefer archiving and
  deleting rather than absorbing.
- Do not delete `main` or active WIP branches.
