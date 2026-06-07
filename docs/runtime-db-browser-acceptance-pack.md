# Runtime DB Browser Acceptance Pack

Status: runtime DB beta acceptance evidence

Run:

```bash
npm run db:runtime:browser-accept
```

Optional:

```bash
npm run db:runtime:browser-accept -- --out-dir .local/runtime-db-browser-acceptance-packs
```

Latest checked-in acceptance evidence:

- [2026-06-07 runtime DB browser acceptance Markdown](runtime-db-browser-acceptance-packs/runtime-db-browser-acceptance-pack-2026-06-07T07-02-32-214Z.md)
- [2026-06-07 runtime DB browser acceptance JSON](runtime-db-browser-acceptance-packs/runtime-db-browser-acceptance-pack-2026-06-07T07-02-32-214Z.json)

The pack answers one narrow beta question:

> Can the React product shell run against runtime DB custody in a real browser,
> not only through API/unit tests?

It starts a temporary Matter Workbench server in explicit runtime DB mode,
runs the runtime DB write smoke, drives the React app through a browser driver,
and writes:

- `runtime-db-browser-acceptance-pack.md`
- `runtime-db-browser-acceptance-pack.json`

## What It Proves

The pack combines two kinds of evidence.

First, it runs the existing runtime DB write smoke. That proves the boring but
critical custody path:

- the runtime DB role is not a superuser and does not bypass RLS;
- a disposable matter can be uploaded;
- workspace, preview, and raw file reads work from DB custody;
- DB rows and payload bytes are verified;
- rollback behavior is tested;
- cleanup removes the disposable matter.

Second, it opens the React app through a browser driver and checks:

- private beta login when configured;
- React root render;
- runtime DB matter listing;
- matter selection;
- DB-backed workspace preview;
- Matter Attention / Preparation Advisory readability;
- Activity page;
- Settings page;
- browser console/page errors.

## Browser Driver Requirement

This pack is intentionally stricter than `ui:smoke`.

`ui:smoke` checks API and React/backend contract health. This pack checks a
rendered browser path. For that reason, it needs Playwright in the Node runtime
that runs the script.

If Playwright is unavailable, the pack fails closed and records:

```text
browser_driver: missing-playwright
```

That is expected. It means the machine can run API smoke but has not yet proven
browser acceptance.

On Codex desktop, Playwright may be available through the bundled runtime rather
than the project `node_modules`. In that case run with `NODE_PATH` pointing at
the bundled Node packages. The driver will also use an installed Chrome/Chromium
binary when Playwright's downloaded browser is not present. A custom browser can
be supplied with `MWB_PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## What This Does Not Do

The pack does not:

- call paid AI providers;
- rerun Source Labels or List of Dates;
- create a new product feature;
- replace the recoverability pack or ops pack;
- prove public-cloud readiness.

It is a local/private beta acceptance harness for runtime DB mode. Public cloud
still needs hosted auth, HTTPS, object-storage custody, worker recovery, and
tenant authorization hardening.

## Expected Operator Meaning

A useful pass means:

- runtime DB write custody works;
- the React shell can actually render and navigate while DB mode is active;
- DB-backed matter data is visible from the browser;
- the operator gets JSON and Markdown evidence for the run.

A failure should be treated as actionable beta evidence, not a vague "browser
looked weird" report. The JSON file is the main artifact to attach to a bug.
