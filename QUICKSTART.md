# Matter Workbench Quickstart

This is the shortest safe path from a fresh checkout to a local/private beta smoke.
For broader operating rules, see [`docs/beta-user-runbook.md`](docs/beta-user-runbook.md) and [`docs/beta-operator-checklist.md`](docs/beta-operator-checklist.md).

## Prerequisites

- Node.js 25+ recommended for this beta branch.
- npm installed with Node.
- PostgreSQL `psql` client installed if using runtime DB scripts.
- Provider keys only if you will run provider-backed AI tasks:
  - `OPENAI_API_KEY`
  - `OPENROUTER_API_KEY`

## 1. Install dependencies

```sh
npm install
```

## 2. Check local health

```sh
npm run system-health:report
```

For machine-readable output:

```sh
npm --silent run system-health:report -- --json
```

This report is read-only. It does not call providers, run skills, write matter artifacts, or mutate settings. For a completed report, it exits non-zero only when the overall health status is `error`.

## 3. Start the app

```sh
npm start
```

Open the printed local URL. In Settings, confirm:

- System Health is ready or has only understood warnings.
- Matter storage is configured or runtime DB mode is active.
- AI task routes are ready before provider-backed tasks are run.

## Common beta commands

```sh
npm test
npm run ui:typecheck
npm run private-web:readiness-check
npm run db:migrations:check
npm run db:doctor
```

## Stop rules

Stop and collect evidence before changing code if:

- System Health reports a configuration/runtime error.
- Multiple matters fail the same provider-backed workflow.
- A provider quota/auth/key error appears.
- A tester reports legal-output quality concerns.
- Runtime DB smoke/write-smoke fails.

Use the private beta bug evidence pack for one issue at a time:

```sh
npm run private-beta:bug-evidence-pack
```
