# Private Beta Access Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private-beta login gate so the VM app is not only private-network reachable but also app-access controlled.

**Architecture:** Keep this as local/private beta middleware, not full hosted SaaS auth. Add one server-side auth service that reads protected env credentials, issues HttpOnly session cookies, blocks product APIs when auth is required, and exposes only auth status/login/logout without a session. React renders a simple login screen when `/api/auth/status` says login is required or any API call returns 401.

**Tech Stack:** Node HTTP server, in-memory session store, HMAC-like random session tokens, React state gate, existing node:test coverage.

---

## Files

- Create: `services/private-beta-auth-service.mjs`
- Create: `routes/private-beta-auth-routes.mjs`
- Create: `test/private-beta-auth-service.test.mjs`
- Create: `test/private-beta-auth-routes.test.mjs`
- Modify: `server.mjs`
- Modify: `react-ui/src/api/client.ts`
- Modify: `react-ui/src/App.tsx`
- Modify: `react-ui/src/styles/global.css`
- Modify: `scripts/react-ui-smoke.mjs`
- Modify: `scripts/private-vm-service-check.mjs`
- Modify: `deployment/private-vm/README.md`
- Modify: `docs/database-transition-handoff.md`
- Modify: `FOR_AKSINGH.md`

## Tasks

- [x] Add failing service tests for disabled, required, login, session, logout, and missing credential behavior.
- [x] Implement `private-beta-auth-service.mjs`.
- [x] Add failing route/server tests proving anonymous product APIs return 401 while auth routes work.
- [x] Wire server middleware and auth routes.
- [x] Add React API helpers and a login gate.
- [x] Teach smoke/service-check scripts to authenticate when env credentials are supplied.
- [x] Update docs and operator runtime env guidance.
- [x] Run focused tests, full tests, build, smoke, and git hygiene checks.

## Boundaries

- No public internet security claim.
- No database session persistence in this slice.
- No OAuth, SSO, passkeys, or hosted tenant-user provisioning.
- No secrets committed or echoed into docs.
