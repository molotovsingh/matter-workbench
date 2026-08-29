# Contract: Degraded V4 Status

## Disabled

When `MWB_V4_INTAKE` is not `1`, V4 owns no route. Existing behaviour remains:

```text
GET /api/v4/status → 404 through the host router
```

## Ready or starting normally

The existing V4 mount owns the route and returns its current status. No change to the ready
contract.

## Flagged on but failed to start

Matter Workbench remains live. The failed mount stops all V4 workers and relinquishes every
V4 route except discovery status.

```text
GET /api/v4/status
HTTP 503
Cache-Control: no-store
Content-Type: application/json

{
  "ok": false,
  "enabled": true,
  "started": false,
  "code": "v4.database_unavailable"
}
```

Allowed codes:
- `v4.database_unavailable`
- `v4.migration_invalid`
- `v4.privileges_missing`
- `v4.initialization_failed`

All other V4 routes remain unavailable. The existing panel probe returns null because
`ok !== true`, so the panel stays hidden without learning infrastructure language.

## Security

No raw message, database name, host, username, SQL state, stack, or connection string crosses
the endpoint. Full errors remain in redacted operator logs.

## Recovery

The degraded state does not retry or clear itself. It remains until the process exits.
Operator runs readiness, then deliberately restarts Matter Workbench. A successful restart
returns the normal ready status; a failed one recreates degraded status.
