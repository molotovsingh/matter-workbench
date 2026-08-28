# Matter Workbench Maintenance Checkpoints

Status: Tier 2 deployment log

This log records behavior-preserving deployments that are intentionally not new
official supervised beta releases. Use it only when
[the release policy](../release-policy.md) classifies a deployed change as a
Tier 2 maintenance checkpoint.

Official tester releases remain under `docs/releases/v1.0.0-beta.N.md` and are
checked with `npm run release:position-check`.

## Entry Template

```text
## YYYY-MM-DD — <short title>

- Base official release: v1.0.0-beta.N / <codename>
- Deployed commit: <shortsha> <subject>
- Deployment surface: <URL or host>
- Why Tier 2: <why this is behavior-preserving and deployed now>
- Validation: <tests/build/checks>
- Live evidence: <service check, config smoke, UI hardening if run>
- Rollback: v1.0.0-beta.N / <tag target>
```

## Recorded Checkpoints

Historical beta tags before this policy revision remain official Tier 1 release
checkpoints unless their release note says otherwise.

## 2026-08-28 — V4 intake shipped dormant

- Base official release: v1.0.0-beta.132 / Timeline Recovery
- Deployed commit: `34de07b` Correct the beta.133 rollback target and deployed-code baseline
- Previous deployed commit: `5cf4447` Show elapsed time for matter preparation
- Deployment surface: https://mwb-beta.139.59.74.9.sslip.io
- Why Tier 2: ships V4 executable source to the VM for the first time, but with
  `MWB_V4_INTAKE` unset the mount is never constructed and testers see no
  change. No legacy runtime migrations differ from the previously deployed
  commit. The only existing user-facing component touched is `AddFilesForm`,
  which mounts `V4IntakePanel`; that component returns null unless the flag-gated
  status probe answers. Enabling the flag is a separate Tier 1 release
  (`v1.0.0-beta.133`), because that is what makes V4 visible to testers.
- Validation: `npm test` 1,908 passed; `npm run ui:build` typecheck and
  production build passed; `git diff --check` clean; V4 acceptance matrix 18/23
  gates automated and passing.
- Live evidence: all ten deploy steps ok; both processing drain guards passed;
  runtime and Mothership services active; Mothership console check passed;
  private-vm service check passed; rendered UI hardening 12/12 with zero console
  errors at `/home/aks/matter-workbench-backups/ui-hardening/private-beta-ui-hardening-2026-08-28T14-46-24-321Z/ui-hardening-report.md`;
  runtime startup log contains no V4 mount lines, confirming V4 stayed dormant;
  V4 architecture/acceptance/operations docs confirmed absent from the box.
- Housekeeping in the same window: pruned 318 stale deployment directories
  (77 GB). Disk went from 90% to 24% used. Retained the newest ten, which
  includes the live commit and the beta.126–132 tag targets. Five
  non-commit-named directories were left in place pending review.
- Rollback: `5cf4447` (the commit running before this checkpoint). Not the
  beta.132 tag target `1647f3c`, which is eleven commits behind what was
  deployed and would remove live tester-visible behavior.
