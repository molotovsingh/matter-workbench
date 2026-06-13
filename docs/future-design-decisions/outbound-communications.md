# Outbound Communications

Date: 2026-06-13
Status: Parked future feature; high-risk because it can contact real people

## Problem

Matter Workbench may eventually need to send emails to:

- clients;
- internal teammates;
- supervising lawyers;
- clerks or operations staff;
- the Matter Workbench mothership/product team for feedback, bug reports, and
  support packets;
- possibly counterparties or external counsel, if a future product decision
  allows it.

This is useful because legal work does not stop at generating artifacts. Lawyers
often need to send:

- client update emails;
- document request lists;
- missing-document reminders;
- internal review notes;
- draft notices for approval;
- filing-preparation checklists;
- matter-status summaries.

But outbound communication is riskier than generating a draft. Once the app can
send email, a mistaken click can expose confidential work product or send an
unreviewed legal position to the wrong person.

## Product Principle

Outbound communication must be **draft-first and lawyer-controlled**.

The app can help prepare, address, package, and record an email, but it should
not silently send legal work product.

Default stance:

```text
prepare draft
show recipients
show attachments
require lawyer confirmation
record what was sent
```

## Recipient Classes

The app should distinguish recipient types because risk differs.

| Recipient type | Examples | Risk posture |
| --- | --- | --- |
| Client | client, authorized company officer | Allowed only after matter contact is verified. |
| Internal teammate | junior, senior, clerk, operations | Lower external risk, but still privileged/confidential. |
| Supervising lawyer | partner, reviewer | Useful for review/escalation workflows. |
| Mothership / product support | Matter Workbench support inbox, product team | Operational/support channel; should send app feedback, bug context, and selected diagnostic packets, not legal advice to clients. |
| External legal actor | opposing counsel, court filing desk, authority | Future decision only; highest guardrails. |
| Unknown/free-text recipient | manually entered address | Require stronger confirmation and audit. |

## Mothership Support Email Channel

The app should eventually support sending a feedback/support email to the
mothership.

This is different from client/team legal email:

- the purpose is product support, debugging, beta feedback, and operational
  triage;
- the recipient should be a fixed configured support address, not a free-text
  user-entered address;
- the payload can include a feedback report, selected diagnostic context, job
  ids, matter name, user email, app version, and relevant screenshots/log
  summaries;
- it should not automatically include raw source documents, full legal work
  product, provider secrets, or hidden prompt traces;
- the user should see what will be sent before it leaves the app.

When this feature is built, it should integrate with the existing private beta
feedback capture and mothership signal flow. A support email can be a human
readable escalation path for the same issue packet that is also recorded in the
mothership.

Suggested first support-email slice:

```text
send feedback/support packet to configured mothership inbox
```

Requirements:

- configured `MOTHERSHIP_SUPPORT_EMAIL`;
- fixed recipient shown to the user;
- subject includes install id, user email, and short issue category;
- body includes the user's feedback and app-generated context;
- attachments are opt-in and limited to screenshots or exported diagnostics;
- successful send records a matter/app audit event;
- failed send leaves the feedback saved locally and tells the user it was not
  emailed.

## First Safe Slice

Do not start with direct send.

First slice should be:

```text
create email draft package
```

The app should produce:

- recipient suggestion, if matter contacts are known;
- subject line;
- body draft;
- attachment list;
- source/reason note for why each attachment is included;
- review checklist;
- "copy to clipboard" or "download .eml draft" output.

No SMTP/Gmail/Microsoft send is needed for the first slice.

Exception: a future mothership-support email path may be implemented earlier
than client/team legal sending, because it is an operational feedback channel.
Even then, it should use a fixed configured recipient, visible preview, and
saved feedback fallback.

## Later Send Slice

Only after draft-package behavior is trusted, add controlled sending.

Requirements:

- explicit sender account selected;
- verified recipient list;
- attachment preview;
- final confirmation;
- no hidden auto-send from Copilot or skills;
- delivery result recorded;
- failure result recorded;
- sent copy preserved as a matter artifact;
- audit event records sender, recipients, subject, attachment names, timestamp,
  and provider delivery id if available.

## Matter Contacts

Outbound email depends on reliable contact metadata.

Before sending, the app needs a reviewed contact source:

- client email;
- authorized representative email;
- internal team member email;
- role;
- permission/relationship;
- last reviewed timestamp.

If contact metadata is missing or weak, the app should stop at a draft and ask
the lawyer to confirm recipients manually.

## Attachments And Work Product

The app should never attach files merely because they exist.

Attachment rules:

- generated drafts stay drafts unless reviewed;
- court/dispatch-ready documents should come from the proper dispatch boundary;
- raw source documents should only be attached when the lawyer chooses them;
- internal diagnostics, JSON, OCR logs, prompt traces, provider metadata, and
  hidden audit artifacts must not be attached to lawyer/client emails;
- every attachment should have a lawyer-facing label.

## Audit And Matter Record

Every outbound communication should become part of the matter record.

Minimum audit fields:

- matter id;
- sender account;
- recipients;
- cc/bcc;
- subject;
- attachment labels;
- linked matter artifacts;
- sent/draft status;
- provider message id if sent;
- timestamp;
- actor/user;
- failure reason if send failed.

For the current local/private beta, this can remain parked until database-backed
audit and contact state are mature enough.

## Relation To Existing Notes

This note is about **outbound communication**.

It is different from:

- [Communication Evidence Ingestion](communication-evidence-ingestion.md), which
  is about reading incoming emails/chats as evidence;
- [Artifact Visibility and Dispatch](../contracts/artifact-visibility-and-dispatch.md),
  which governs which artifacts are drafts, workshop material, or dispatch-ready;
- [Private Beta Feedback Capture](private-beta-feedback-capture.md), which is
  about tester feedback flowing back to the product team.

The mothership support-email channel should bridge this note and Private Beta
Feedback Capture when implemented.

## Non-Goals For Now

- no client/team/legal direct email sending in the current beta;
- no Gmail/Microsoft connector yet;
- no auto-send from Copilot;
- no free-form attachment automation;
- no court/counterparty sending until separately approved;
- no replacing lawyer review.

## Revisit Trigger

Revisit when beta users repeatedly ask for:

- client update emails;
- document request emails;
- sending generated notices/drafts to reviewers;
- internal handoff emails;
- one-click packaging of matter artifacts for client/team review.
- support asks where a tester expects the app to send feedback or diagnostics
  directly to the mothership/product team.

The first implementation should be draft packaging, not send automation.
