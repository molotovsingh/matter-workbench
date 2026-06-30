# Matter Workbench Private Beta Tester Brief

Status: tester-facing brief for the official supervised private beta

This brief is for trusted testers using Matter Workbench `v1.0.0-beta.109`,
codename **Route Compass**, with an operator nearby. It is not a public
product page, and it is not a promise that the app is ready for public web use.

## What You Are Testing

Matter Workbench is a legal matter preparation workspace.

It helps you:

- upload or select a matter;
- let the app read and prepare the source record;
- review Source Labels / Document Index;
- review a List of Dates;
- ask one-question-at-a-time Copilot questions from the matter record;
- create, run, and manage custom skills;
- inspect Activity when a run appears slow, skipped, or failed.

The useful mental model is:

```text
Original files -> extraction -> source labels -> chronology -> advisory -> lawyer review
```

The app can produce useful working material. It does not replace lawyer review.

## What To Try

For each matter, try this flow:

1. Open the app at the URL given by the operator.
2. Sign in with the username and temporary password given by the operator.
3. Read the **What’s new** note, or type `/whats_new` later to reopen it.
4. Select a matter or create a small disposable matter.
5. If you upload files, wait for automatic preparation to finish.
6. Read the Preparation Advisory before trusting generated output.
7. Open Source Labels / Document Index.
8. Open List of Dates.
9. Ask Copilot one specific question from the matter record.
10. Run one custom skill only on a matter where replacing generated output is acceptable.
11. Open Activity if anything seems to hang, skip, or fail.
12. If something is confusing, wrong, slow, or legally weak, click
    **Have a problem? Tell us what happened** and write a short plain-language
    note.

Good tester questions:

- Did the app make the matter state clear?
- Did the advisory warn you about the right files?
- Did Source Labels use lawyer-readable names?
- Did List of Dates miss central events?
- Did Copilot stay inside the matter record?
- Did custom-skill output go to the expected place?
- Did Activity explain what ran and what failed?

## What Not To Do

Do not treat beta output as final legal work.

Do not use this beta to:

- file or send a final draft without lawyer review;
- rely on bad OCR without checking the scans;
- ignore Source Labels marked needs review;
- use advanced Force full rebuild on an important matter without a backup;
- share client documents, screenshots, or generated output outside the trusted
  beta circle;
- assume the Copilot remembers earlier chat messages;
- treat the app as public web software.

## Stop And Tell The Operator

Stop testing and report the issue if:

- the app shows the wrong active matter;
- Copilot answers from outside the selected matter;
- List of Dates omits an obviously central event;
- Source Labels or OCR warnings affect important documents;
- a custom skill says output exists but gives no way to continue;
- Activity shows missing output or a failed job;
- the page looks stuck after a long run;
- Settings shows provider configuration problems;
- any output appears to cite or use the wrong matter.

## How To Report A Bug

Use the in-app **Have a problem? Tell us what happened** button first. You do
not need to know whether the issue is a bug, feature idea, OCR problem, legal
quality concern, or setup problem. Pick the closest simple choice and write:

- what you were trying to do;
- what happened instead;
- the matter name if it is not obvious from the screen.

The app stores that note with useful context for the operator, such as the
current screen, selected matter, and recent activity. If the app is unavailable
or the operator asks for more detail, give the operator:

- matter name;
- time of the issue;
- what you clicked or typed;
- exact error or warning text;
- screenshot if the issue is visual;
- whether the issue is about upload, preparation, advisory, Source Labels,
  List of Dates, Copilot, Skills, Activity, Settings, or output quality.

Do not manually export diagnostic files. Do not send raw client files unless
the operator specifically asks and confirms the sharing boundary.

The operator can then review Activity feedback and run the private beta bug
evidence pack if developer handoff needs more evidence. Your job is to report
what happened clearly, not to diagnose the app.

## Current Beta Boundary

This official private beta release is suitable for supervised testing by trusted users. Actionable feedback from the current release window has been fixed or intentionally parked for future roadmap work.

It is not yet:

- public SaaS;
- public web deployment;
- self-service user signup or password reset;
- cloud object storage;
- durable background-worker execution;
- unsupervised legal reliance.

That boundary is a strength, not a weakness. The beta is meant to reveal the
right legal and workflow problems before the product is opened more broadly.
