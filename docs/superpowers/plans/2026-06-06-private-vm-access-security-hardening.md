# Private VM Access And Security Hardening Pack

## Goal

Make the private Debian VM runtime safer to operate by adding repeatable checks
for network exposure, runtime secret file permissions, service template safety,
runtime DB least-privilege proof, npm audit disposition, and operator shutdown
guidance.

## Success Criteria

- A single repo command can check private-network posture, runtime env file
  permissions, the user-level systemd template, the live service, runtime DB
  role proof references, and npm audit evidence.
- The command never prints raw database URLs, API keys, passwords, or provider
  secrets.
- Docs clearly say this is private-VM local beta hardening, not public hosting.
- Operator docs include status, restart, stop, logs, service check, security
  check, recoverability pack, and credential-rotation guidance.
- Tests cover the new check logic and docs/script wiring.
- Existing runtime DB, service, UI, and repository tests still pass.

## Implementation Plan

1. Add `scripts/private-vm-security-check.mjs`.
2. Add `test/private-vm-security-check.test.mjs` before relying on the script.
3. Wire `private-vm:security-check` into `package.json`.
4. Update `deployment/private-vm/README.md`,
   `docs/database-transition-handoff.md`, and `FOR_AKSINGH.md`.
5. Run focused tests, full tests, UI checks, npm audit, and a live VM service
   check where network access allows it.

## Boundaries

- No backend route changes.
- No database schema changes.
- No public exposure, auth, TLS, or cloud hosting implementation in this slice.
- No secret values are committed or echoed into docs.
