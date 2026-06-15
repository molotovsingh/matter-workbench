# Live Mothership Triage - 2026-06-13

Commit inspected locally: `31761f3`

Live report source: DigitalOcean mothership report generated `2026-06-12T23:51:26.831Z`, last 1 day.

This is a triage artifact, not a product source of truth. Each item should be verified against current runtime state before code changes.

## Summary

- Total live items: 12
- Critical diagnostic signals: 2
- Tester-reported bugs: 9
- Confusing UX: 1
- Latest backend suitability: 100/100
- Latest deployment portability: 50/100
- Latest user patience risk: low
- P95 request latency: 154ms
- Max silent wait: 44ms
- Disk free: 91.5%

## Fix Now

### 1. Copilot unsupported citation should not surface as a raw failure

Evidence:

- Matter: `ITEMPERANCE V VEATIVE LABS PVT LTD`
- Tester report: `failed: Matter copilot returned unsupported citation: FILE-0008 p1.b2`
- Code path: `services/matter-copilot-service.mjs` fails closed when provider citations are outside the bounded matter packet.

Assessment:

The fail-closed rule is legally correct, but the user-facing result is too technical. A lawyer should see a short safe answer such as: "I could not verify the sources for this answer. Please run preparation again or ask the question more narrowly." The internal unsupported citation should remain in activity/diagnostics.

Next action:

- Keep backend fail-closed validation.
- Add a lawyer-facing error translation in the command panel for this specific Copilot citation failure.
- Keep the diagnostic signal intact for operators.

### 2. Preparation integrity: downstream stages attempted without visible extraction records

Evidence:

- Critical signal: `Label Sources` on `Gionee India Pvt Ltd v Shri Bharat Nagpal`: `No extraction records found. Run /extract before creating a source index.`
- Critical signal: `Create List of Dates` on `ITEMPERANCE V VEATIVE LABS PVT LTD`: `No extraction records found. Run /extract before /create_listofdates.`

Assessment:

This can be either a real preparation failure, a matter-scoping issue, or a user-triggered downstream action before extraction completed. It is high priority because source labels and List of Dates depend on extraction quality.

Next action:

- Verify the current runtime DB rows for the affected matter before changing code.
- If extraction truly failed, improve the matter home card to say "Reading documents failed" and route the user to "Run preparation again."
- If extraction exists but the later stage cannot see it, treat as a runtime DB/read-model defect.

### 3. Repeated login friction

Evidence:

- Tester report: `ASKING LOGIN MULTIPLE TIMES`

Assessment:

This can happen after deploy restarts, cookie/session expiry, switching between IP/localhost URLs, or a real auth-session bug. It is high priority for beta confidence even if the security model is working.

Next action:

- Verify session persistence across reload, tab close/reopen, and service restart.
- If only deploy restart logs users out, document it as beta behavior.
- If normal reload logs users out, fix the auth session/cookie path.

## Next Polish

### 4. Feedback form "saved but still blocking"

Evidence:

- Tester report: `Saved. Message is still blocking my matter assistance`

Assessment:

Current React code closes the feedback form after successful save. This may be an older deployment observation, a failed-save path, or a different overlay/state issue.

Next action:

- Browser-smoke current deployment: save feedback as a tester and confirm the form closes.
- If it does not close on DigitalOcean, fix the deployed UI state.

### 5. Add-files UX: copy/paste and archive intake

Evidence:

- Tester report: `Adding new files resulting in error while copying paste`
- Tester report: `It should be capable of Unzipping the files`

Assessment:

This is valid beta friction. Lawyers will receive ZIPs and may drag/copy from file managers in inconsistent ways. ZIP intake is not a one-line fix because it affects file custody, duplicate detection, and matter preparation triggers.

Next action:

- Treat ZIP intake as a planned feature.
- Improve the upload error copy first: say exactly which file failed and what the user should do.

### 6. Onboarding copy is not useful enough

Evidence:

- Tester report: `learn how it works doesn't help at all`
- Tester report: `understand the app`

Assessment:

This is a product-writing issue, not a backend defect. First-time users need a concrete "what happens after I upload a matter?" explanation, not a generic learn-more surface.

Next action:

- Replace vague onboarding with a three-step "Upload matter -> app prepares record -> ask or run skills" explanation.
- Tie the explanation to the actual preparation card.

### 7. Output copy/export affordances

Evidence:

- Tester report: `add Copy button for direct copying`
- Tester report: `Copy Markdown should encapsulated options for the document format word, pdf , etc`

Assessment:

This is likely valuable but should not precede source/preparation reliability. It belongs after the main legal-output workflow is stable.

Next action:

- Add a direct copy button where generated outputs are shown.
- Park Word/PDF export as a follow-up; do not overload the first fix.

## Watch

### Metrics are healthy, but portability is still low

Evidence:

- Backend Suitability: 100/100
- Deployment Portability: 50/100
- Restore Confidence: 40/100

Assessment:

The app is running acceptably for current private beta load, but portability/restore confidence remain the cloud-readiness weak points.

Next action:

- Continue treating backup/restore and object storage separation as widening blockers, not immediate beta blockers.
