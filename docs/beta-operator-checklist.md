# Matter Workbench Beta Operator Checklist

Status: Current checklist for `v1.0.0-beta.3` supervised local beta

This is the practical runbook for operating Matter Workbench as a private local
beta. It is written for one trusted operator, not for public SaaS support.

## Beta Boundary

Use this release for supervised legal-matter testing.

Do not present it as:

- a filing-ready drafting system;
- an unsupervised legal decision-maker;
- a hosted multi-user system;
- a replacement for lawyer review of source documents, citations, labels, or
  final drafts.

The app can prepare useful work product, but the lawyer owns legal judgment and
final dispatch.

## Before Starting

Confirm the repo is on the tagged release:

```bash
git fetch origin --tags
git checkout v1.0.0-beta.3
```

Install dependencies if this is a fresh machine:

```bash
npm install
```

Create local config:

```bash
cp .env.example .env
```

Fill only the provider keys you intend to use. Do not commit `.env`.

Recommended minimum for full beta testing:

```text
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
MISTRAL_API_KEY=...
GEMINI_API_KEY=...
```

Provider behavior is task-scoped. The Copilot model selector is for transient
chat only. Durable skill creation, source-backed skills, validation, OCR, and
List of Dates follow app policy and environment settings.

## Start The App

Recommended local beta command:

```bash
PORT=4191 npm start
```

Open:

```text
http://127.0.0.1:4191/
```

The root path serves the React shell. `/react/` is only a compatibility alias.

## Pre-Flight Checks

Run these before a serious test session:

```bash
npm run ui:smoke --silent
npm run db:doctor
```

Expected posture:

- `ui:smoke` should pass.
- `db:doctor` may report that no database URL is configured. That is acceptable
  for local beta because the database is not yet the runtime backend.
- Settings in the app should show provider routes clearly and should not expose
  API key values.

For a release-confidence check:

```bash
npm run ui:typecheck --silent
npm run ui:build --silent
npm test --silent
```

## Matter Data And Backups

Matter files live under the configured matters home or pinned matter root.

Before destructive or broad tests:

1. Back up the matter folder.
2. Keep the original source documents.
3. Treat generated folders and artifacts as reproducible unless the test is
   specifically about generated legal quality.

Do not run broad real-matter preparation reruns casually. `Run preparation
again` can call paid providers and can replace generated source labels and List
of Dates artifacts.

## Normal Beta Flow

For a matter test:

1. Create or select a matter.
2. Upload original files.
3. Let automatic preparation run.
4. Review the Preparation Advisory.
5. Open Source Labels / Document Index.
6. Open List of Dates.
7. Ask one or two bounded Copilot questions from the matter record.
8. Check Activity receipts for any custom-skill run outputs.
9. Record anything that is confusing, wrong, slow, or legally weak.

The advisory is not noise. It is the current local surface for OCR warnings,
source-label review, skipped files, run warnings, and matter-scoped failures.

## Safe Write Testing

Safe write paths for beta:

- create a disposable matter;
- add files to a disposable or backed-up matter;
- create a custom skill from a test matter;
- run a custom skill on a backed-up matter;
- pause, resume, archive, restore, or soft-delete custom skills.

Use care with:

- `Run preparation again`;
- Source Labels / Document Index reruns;
- List of Dates reruns;
- OCR force refresh;
- any path involving weak scans or provider repair.

Those operations are expected beta paths, but they can take time, use paid AI,
and replace generated artifacts.

## What To Report

For every bug or quality concern, capture:

- matter name;
- time of run;
- command/button clicked;
- active model/provider if visible;
- exact error text or warning text;
- whether the problem is UI, extraction, source labels, List of Dates,
  Copilot, custom skill, Activity receipt, or Settings;
- screenshot if the issue is visual;
- generated artifact path if output quality is the problem.

Useful paths to inspect during local beta:

```text
00_Inbox/
10_Library/Source Index.json
10_Library/List of Dates.md
10_Library/List of Dates.json
20_Workshop/
30_Drafts/
.local/command-interactions.jsonl
```

Do not share `.env`, raw API keys, or private client documents in bug reports.

## Stop Rules

Stop and investigate before relying on output if:

- extraction reports OCR warnings on material files;
- Source Labels are missing or marked needs review;
- List of Dates omits obviously central events;
- Activity says a custom-skill output is missing;
- Copilot answers outside the matter record;
- Settings reports provider configuration issues;
- the app shows a stale matter after switching matters;
- any generated output appears to cite the wrong matter.

## Recovery

If the app appears stuck:

1. Wait for the current provider call if a long AI stage is running.
2. Refresh the browser once.
3. Check Recent Activity and Preparation Advisory.
4. Restart the server with `PORT=4191 npm start`.
5. Rerun `npm run ui:smoke --silent`.
6. Restore from matter-folder backup if a destructive test produced bad
   generated artifacts.

For database checks, use only read-only doctor commands unless you are
explicitly working on the database transition:

```bash
npm run db:doctor
npm run db:migrations:check
```

If you are explicitly working on the database transition track, the shadow-only
read-side checks are:

```bash
npm run db:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:inspect
npm run db:skills:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:skills:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:skills:shadow:inspect
npm run db:advisory:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:advisory:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:advisory:shadow:inspect
npm run db:storage:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:storage:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:storage:shadow:inspect
npm run db:provider-runs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:shadow:inspect
npm run db:jobs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:jobs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:jobs:shadow:inspect
npm run db:costs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:costs:shadow:inspect
npm run db:audit:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:audit:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:audit:shadow:inspect
npm run db:shadow:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:shadow:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:report
MWB_DATABASE_URL="postgres://..." npm run db:shadow:snapshot
```

`db:shadow:snapshot` writes a timestamped Markdown/JSON handoff bundle under
`docs/shadow-db-snapshots/`. Treat it as one-run evidence, not live truth. Use
it after a VM shadow hydration or verify pass when you want a developer to see
the exact control-plane mirror report without rerunning the database commands.
Refresh it after meaningful repo changes, local matter folder or skill-ledger
changes, or another shadow hydration / verify pass.

## Current Known Risks

- Bad scans can still produce advisory warnings and require fresh copies from
  the client.
- Long-running jobs are still local/foreground; the hosted durable-job system is
  future work.
- The database migrations are preparatory; local beta still primarily uses file
  artifacts and JSON ledgers.
- Copilot is one-question-at-a-time and does not own durable legal work.
- Custom skills are useful beta tooling, but the native spine remains the legal
  reliability baseline.

## Release Reference

Current accepted local beta:

[Matter Workbench v1.0.0-beta.3](releases/v1.0.0-beta.3.md)
