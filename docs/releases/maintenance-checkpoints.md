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

No Tier 2 maintenance checkpoints have been recorded under this policy yet.
Historical beta tags before this policy revision remain official Tier 1 release
checkpoints unless their release note says otherwise.
