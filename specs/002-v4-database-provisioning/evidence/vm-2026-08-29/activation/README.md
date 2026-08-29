# Beta VM activation evidence — 2026-08-29

Repository-safe evidence for flag-last activation of `v1.0.0-beta.133` at deployed commit `8a5e970`.

- `readiness-final.json`: final activation-ready posture, generated from the exact deployed code before the flag edit.
- `provision-final.json`: idempotent final provisioning run; no database creation and zero new migrations.
- `activation.json`: successful flag-only activation and deliberate runtime restart; no database change.
- `post-activation-state.txt`: non-secret deployed commit, flag, service, connection-budget, restore-cleanup, and V4 status summary.
- `service-check.txt`: authenticated legacy Matter Workbench service check after activation.
- `ui-smoke.txt`: authenticated post-activation React/API smoke output (89/89).
- `speed-acceptance.json`: one-page synthetic PDF acceptance result, including custody/extraction timings and persisted filing report.

SQL dumps, credentials, operator environments, cookies, provider payloads, and database contents are deliberately excluded.
