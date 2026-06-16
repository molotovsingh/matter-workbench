# Matter Workbench Beta User Runbook

Status: Current private/local beta operator guide

This runbook is for a supervised beta operator or developer helping a tester. It is not a public support manual and it is not a substitute for release notes.

## Before a session

1. Pull the intended branch/commit and confirm the release note or worktree under review.
2. Install dependencies if needed:

   ```sh
   npm install
   ```

3. Run read-only system health:

   ```sh
   npm run system-health:report
   ```

4. Confirm any warnings are understood. Do not start a tester session with unresolved errors.
5. If using runtime DB mode, also run the relevant DB checks:

   ```sh
   npm run db:migrations:check
   npm run db:doctor
   ```

6. Start the app:

   ```sh
   npm start
   ```

## During a session

- Keep the tester on normal matter work: upload, prepare, source labels, List of Dates, Copilot, and custom skills only when in scope.
- Use Settings → System Health when failures look broad rather than matter-specific.
- Treat Matter Attention as matter-local. Treat System Health as app/runtime-wide.
- Ask testers to use the in-app feedback button for confusing UX, bugs, or missing features.
- Do not ask testers to classify reports as bugs versus feature requests.

## What System Health means

System Health is read-only. It checks configuration, provider posture, recent global failures, command-log readability, and storage access.

It does **not**:

- call provider APIs;
- run legal skills;
- mutate `.env`;
- write matter artifacts;
- enforce credits or billing;
- replace per-matter attention.

## If something fails

1. Do not immediately change code.
2. Capture the visible error, matter name, current tab, and approximate time.
3. Check System Health for provider/config/runtime issues.
4. Check Matter Attention for matter-local blockers.
5. Generate a one-bug evidence pack:

   ```sh
   npm run private-beta:bug-evidence-pack
   ```

6. Triage one issue at a time. Avoid combining unrelated beta complaints into one fix.

## Provider-backed task cautions

Provider-backed tasks can fail because of keys, quota, routing, model availability, or timeout. If multiple matters fail similarly, check System Health before treating the issue as matter-specific.

Do not paste API keys, provider prompts, source text, or generated legal work product into bug reports.

## Runtime DB cautions

Runtime DB mode can run without a local matters folder. In that mode, System Health should report DB workspace storage. Use runtime DB smoke and write-smoke evidence before accepting a deployment handoff.

## After a session

- Sync queued feedback/signals when configured.
- Review mothership/operator report if this is a private VM/web beta.
- File only evidence-backed fixes.
- Update release notes or worktree handoff notes before asking another reviewer to test.

## Escalation stop rules

Stop beta testing and escalate if:

- login/session isolation fails;
- source-backed legal output cites unsupported sources;
- system health reports storage/config errors;
- data appears under the wrong matter;
- runtime DB write smoke fails;
- provider secrets or raw work product appear in telemetry/output.
