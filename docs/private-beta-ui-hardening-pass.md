# Private Beta UI Hardening Pass

Status: repeatable rendered-UI sanity check for supervised private beta

Run:

```bash
npm run private-beta:ui-hardening-pass
```

Useful options:

```bash
npm run private-beta:ui-hardening-pass -- --base-url http://172.16.37.128:4191
npm run private-beta:ui-hardening-pass -- --out-dir .local/private-beta-ui-hardening-passes
npm run private-beta:ui-hardening-pass -- --auth-username <operator>
npm run private-beta:ui-hardening-pass -- --auth-password <password>
```

On the private VM, load the runtime env first so the command uses the same URL
and credentials as the service:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-beta:ui-hardening-pass -- --base-url http://127.0.0.1:4191
```

## What it checks

The pass opens the live React app in Playwright and checks:

- private beta login, when the login screen is present;
- Home shell and command rail render;
- matter selection or an active matter overview is visible;
- Copilot strength choices are available as Low, Medium, and High;
- the tester feedback entry is visible;
- `/api/private-beta/feedback` is readable from the authenticated browser
  session;
- Skills opens and shows the simplified sections;
- Activity opens;
- Settings opens without secret-looking values;
- narrow mobile viewport does not produce meaningful horizontal overflow;
- no browser console errors or page errors occur.

It writes:

- `ui-hardening-report.md`;
- `ui-hardening-report.json`;
- screenshots for Home, Skills, Activity, Settings, and mobile Home.

## What a pass means

A pass means the visible beta shell is still coherent enough for a tester to
start work. It is especially useful after React polish, route changes, auth
changes, or deployment updates.

## What it does not prove

The pass does not:

- run paid AI workflows;
- prove OCR or legal-output quality;
- replace the RC closure pack;
- replace human browser testing;
- prove public-web readiness.

Treat it as the repeatable version of the old manual "open the app and check
the important first screens" routine.
