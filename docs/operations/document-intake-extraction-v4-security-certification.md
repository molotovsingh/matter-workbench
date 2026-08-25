# V4 Security Certification Packet

Status: **pending independent review**. Automated unit/integration evidence is necessary but not sufficient.

The executable packet checker is `services/document-intake-extraction/readiness/security-certification.mjs`. It requires real, non-secret artifact and reviewer identifiers, production-shaped or production evidence, unexpired review, and no open/mitigated/accepted critical or high finding.

## Required controls

1. **Object storage versioning** — exact staging version is hashed and copied; versioning cannot be disabled by the workload role.
2. **Object immutability** — blob prefix is create-only through bucket policy and/or Object Lock; overwrite/delete drills fail.
3. **Encryption key management** — approved KMS keys, rotation, workload grants, and recovery.
4. **Regional data residency** — bucket, database, workers, provider endpoints, backups, and logs remain in approved regions.
5. **PostgreSQL TLS/RLS/backup/PITR** — forced tenant RLS under non-bypass roles, TLS verification, encrypted backup, and restore drill.
6. **Short-lived direct upload authorization** — scoped PUT, no byte proxy, raw token never persisted, expiration and replay tests.
7. **Service authentication/matter authorization** — trusted identity injection, tenant not-found behavior, matter authorization, bounded bodies.
8. **Event auth/rotation/replay** — HTTPS, receiver auth rotation, stable idempotency key, replay and dead-letter drills.
9. **Encrypted scratch/cleanup** — encrypted ephemeral volumes, private permissions, digest verification, normal/failure/stale cleanup.
10. **Worker egress** — only object store, PostgreSQL, approved providers, telemetry, DNS/time endpoints; metadata/administration blocked.
11. **Retention/deletion/legal hold** — approved policy, tenant-reference safety, legal hold, staged lifecycle, deletion audit, restore limitations.
12. **Audit/cost/provenance** — attempts, failures, retries, cost uncertainty, publication, administration, and custody events are retained.
13. **Secret management/rotation** — workload identities or secret manager, no repository/env snapshots, rotation and revocation drill.
14. **Independent security review** — architecture, threat model, infrastructure, dependencies, penetration results, and open findings.

## Existing automated inputs

- forced tenant RLS and fail-closed unset tenant context on real PostgreSQL;
- authenticated/matter-authorized HTTP behavior and cross-tenant not-found responses;
- versioned S3 staging, exact-version hashing, create-only promotion intent, bounded reads, and post-checkpoint cleanup;
- fenced page and outbox leases;
- encrypted-volume-compatible bounded scratch with SHA-256 recheck and cleanup;
- redacted provider and event errors; and
- deployment exclusion and zero production caller checks.

These inputs do not prove production bucket policy, KMS, region, TLS, backups, network policy, identity rotation, retention, or penetration posture. Keep `V4-SECURITY-001` pending until reviewers attach and sign every required artifact.
