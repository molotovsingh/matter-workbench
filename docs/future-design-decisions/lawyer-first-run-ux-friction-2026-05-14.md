# Lawyer First-Run UX Friction Report

Date: 2026-05-14
Status: Parked UX backlog; not an implementation contract
App target: `http://127.0.0.1:4190/`
Walkthrough role: lawyer opening the app for the first time
Test matter: `Mehta vs Skyline`
Method: UI-only browser walkthrough. No source code was inspected. No matter was created, no files were uploaded, no AI or paid action was run, and no generated artifact was copied, downloaded, or regenerated.

## Executive Read

The app already has the bones of a lawyer-friendly workbench: it can load a matter, show core matter metadata, expose a visible processing pipeline, and open a generated List of Dates with citations. The main friction is not that the app lacks capability. The friction is that the first screen still talks partly like an internal file system and partly like a legal product.

A new lawyer can understand that something useful exists here, but they have to translate too many labels: `EX`, `SK`, `AC`, `SE`, `00_Inbox`, `10_Library`, `_extracted`, `create-listofdates-v1-ai`, `FILE-0001 p1.b6`, and provider/model names. Those details may be true and valuable, but on first run they make the product feel less like a legal assistant and more like a technical console wrapped around legal documents.

## What I Did

- Opened the running app at `http://127.0.0.1:4190/`.
- Observed the landing and remembered-session behavior.
- Used the existing `Mehta vs Skyline` matter.
- Inspected the matter overview, workspace tree, pipeline, activity log, action list, matter search, command box, and `List of Dates.md`.
- Performed only read-only/navigation actions: selected an existing matter, opened an existing markdown artifact, expanded the matter actions list, filtered matter search, and typed into the command box without submitting.

## Findings

### P1 - The app exposes a risky rerun message without enough lawyer-safe framing

Visible evidence:

- `Stale newer extraction records or Source Index changes were found`
- `Rerun recommended; no confirmation will be shown.`
- `Create List of Dates`
- `/create_listofdates`

Why this creates friction:

This is the highest-trust moment in the app. A lawyer is looking at a chronology that may support a filing, client advice, or hearing prep. The text says the chronology may be stale, then immediately says rerun is recommended and no confirmation will be shown. Even if this is technically correct for the current implementation, the UX reads like a footgun: it suggests that a meaningful legal work product could be overwritten or updated without a deliberate lawyer checkpoint.

Lawyer impact:

- Trust risk: the lawyer may hesitate to rely on the chronology.
- Accidental-action risk: the lawyer may avoid the feature because the safety boundary is unclear.
- Review burden: the lawyer does not know what changed, what would be rerun, or whether current work would be preserved.

Suggested direction:

Make the default message lawyer-safe: "Newer source material exists. Keep current chronology or review changes before regenerating." If no confirmation truly appears, the UI should say why that is safe, or the action should be moved behind an explicit confirmation.

### P1 - Test/demo matters are mixed with real-looking matters

Visible evidence:

- `11 matters`
- `Ayesha Vs Japan Airlines`
- `Dummy 20260429T1324 01 - Krishnan v Lumen`
- `Dummy 20260429T1324 02 - Devi v Patel`
- `Dummy 20260429T1324 03 - Audit v Vector`
- `Dummy 20260429T1324 07 - Sharma v Raheja`
- `Kamran vs NCT`
- `Mehta vs Skyline`

Why this creates friction:

On first run, the matter list is the user's front door. Mixing obvious dummy matters with plausible litigation-style names makes the environment feel less clean and less confidential. A lawyer's first thought is not "nice demo data"; it is "am I in the right workspace, and what else is in here?"

Lawyer impact:

- Confidence risk: the workspace feels like a shared test bench rather than a professional matter room.
- Selection friction: the real matter is harder to identify.
- Confidentiality anxiety: lawyers are trained to notice odd matter names and unexplained workspaces.

Suggested direction:

Separate sample/demo matters from active matters. A small `Sample matters` grouping is enough. If this is a beta environment, label it as such in the UI rather than relying on matter names to signal that.

### P2 - The left rail uses internal abbreviations instead of recognizable navigation

Visible evidence:

- `LW`
- `EX`
- `SK`
- `AC`
- `SE`

Why this creates friction:

These labels are compact but not self-explanatory. A first-time lawyer can guess that `LW` means Legal Workbench, but `EX`, `SK`, `AC`, and `SE` require hovering, prior training, or trial and error. The rest of the app is trying to be a matter workspace; the rail still feels like a developer placeholder.

Lawyer impact:

- Discoverability friction: users do not know where to go next.
- Training burden: basic navigation needs explanation.
- Professional polish issue: abbreviations make the product feel unfinished.

Suggested direction:

Use icons with tooltips, or use full labels where space allows: `Matters`, `Actions`, `Activity`, `Setup`. If abbreviations stay, the selected page header should make the rail meaning unmistakable.

### P2 - The workspace tree mixes lawyer language with raw folder codes

Visible evidence:

- `Case Record`
- `Original Documents 00_Inbox`
- `Intake 01 - Initial/`
- `Originals/`
- `Source Files/`
- `Source Record 10_Library`
- `Case Analysis 20_Workshop`
- `Drafts 30_Drafts`
- `Ready to Send 40_Dispatch`
- `10_Library/List of Dates.md`

Why this creates friction:

The human labels are good: `Case Record`, `Original Documents`, `Source Record`, `Case Analysis`, `Drafts`, and `Ready to Send` are understandable. The folder codes next to them pull the user back into implementation detail. A lawyer should not need to know `10_Library` to read a chronology.

Lawyer impact:

- Cognitive load: every label carries both legal meaning and storage meaning.
- Terminology mismatch: "library", "workshop", and numbered folders are not normal legal-workflow labels.
- Trust issue: the app looks like it is exposing its filing cabinet rather than presenting a controlled matter view.

Suggested direction:

Keep raw paths available behind `Show technical files`, but hide codes in the default lawyer view. For example, show `Source Record` by default and expose `10_Library` only in details, tooltips, or technical mode.

### P2 - The pipeline is useful but too technical for a first-time lawyer

Visible evidence:

- `Matter Pipeline`
- `Derived from files in the active matter folder. Missing artifacts are shown as not run.`
- `/matter-init`
- `/extract`
- `/describe_sources`
- `/create_listofdates`
- `00_Inbox/Intake 01 - Initial/_extracted (10 records)`
- `OpenAI`
- `openai/gpt-4.1-2025-04-14`
- `AkashML`
- `meta-llama/llama-3.3-70b-instruct`

Why this creates friction:

The pipeline gives valuable status, but it is written for someone who understands slash commands, artifact paths, and model providers. A lawyer wants to know: "Are my documents loaded? Are sources labeled? Is the chronology current? What should I review next?" The current pipeline answers those questions, but it makes the lawyer parse operational details first.

Lawyer impact:

- Slower onboarding: users must learn app mechanics before understanding matter status.
- Trust burden: provider/model names can be relevant, but first-run exposure may distract from legal review.
- Action uncertainty: it is not always clear which steps are read-only, paid, destructive, or recommended.

Suggested direction:

Use lawyer-first status labels as the primary line: `Documents loaded`, `Sources labeled`, `Chronology created`, `Review recommended`. Put slash commands, model names, and paths in secondary details or an expanded technical section.

### P2 - The command box gives examples but little preview before action

Visible evidence:

- `Quick Actions`
- `Run a matter action`
- `Find information, open matter areas, or run known matter actions.`
- `find payment`
- `open library`
- `create list of dates`
- `Type a command`
- `Go`
- `Paid AI actions ask before running. New skill ideas are saved for review; they do not run automatically.`

Observed behavior:

Typing `create list` into the command box did not surface a visible suggestion or preview in the panel before submission. I did not press `Go`.

Why this creates friction:

The command box is promising, but a lawyer has to trust the parser before seeing what the app thinks the command means. The note about paid AI actions is helpful, but it does not replace a pre-submit preview like "This will open the existing List of Dates" versus "This will run `/create_listofdates`."

Lawyer impact:

- Action anxiety: users may avoid the command box because they cannot predict the result.
- Accidental paid-action concern: the text mentions paid AI actions, but the next step is still a generic `Go`.
- Discoverability gap: examples are useful, but typed intent does not visibly resolve into a safe action.

Suggested direction:

Show a preview while typing: matched action, read/write nature, whether it may call a provider, and whether confirmation will appear. For example: `Create list of dates - existing output found - review current chronology or regenerate with confirmation.`

### P2 - The generated List of Dates is valuable but visually hard to review

Visible evidence:

- `List of Dates.md`
- `10_Library/List of Dates.md`
- `Copy Markdown`
- `Download Markdown`
- `Generated by create-listofdates-v1-ai. Review before relying on this chronology.`
- Table columns: `Date`, `Event`, `Legal Relevance`, `Source`
- Citations such as `FILE-0001 p1.b6`

Why this creates friction:

The content is strong: dates, events, relevance, and sources are exactly what a lawyer needs. The presentation is still raw markdown. Long source labels, `<br>` breaks, and citation codes make it hard to scan. The warning to review before relying is appropriate, but it is not paired with review affordances such as filters, source opening, issue flags, or "needs lawyer review" markers.

Lawyer impact:

- Review speed suffers: long table rows are hard to compare.
- Citation confidence is partial: source labels are readable, but `FILE-0001 p1.b6` is not immediately meaningful.
- Export bias: `Copy Markdown` and `Download Markdown` are useful, but the in-app review experience should be comfortable before export.

Suggested direction:

Render the chronology as a legal review table rather than a markdown block. Keep markdown export, but default to wrapped rows, clearer source chips, contradiction flags, and one-click source opening.

### P3 - The activity log leaks implementation noise into the lawyer's workspace

Visible evidence:

- `Activity`
- `19:01:03 [folder] loaded /Users/aksingh/matters-matter-workbench/Mehta vs Skyline`
- `19:01:03 [folder] visible scan: 68 files, 17 folders`
- `19:01:03 [explorer] indexed 68 files and 17 folders`
- `Explorer Ready`
- `File Preview`

Why this creates friction:

The activity log is useful for debugging and reassuring power users, but the visible messages are machine-oriented. A lawyer does not need the local filesystem path or the indexing terminology on first run.

Lawyer impact:

- Professional polish issue: the app feels like a local developer tool.
- Privacy concern: full local paths look sensitive and unnecessary.
- Comprehension gap: "Explorer Ready" and "indexed" do not say what the lawyer can safely do next.

Suggested direction:

Default activity copy should be human: `Matter loaded`, `68 files available`, `Source record ready`. Keep full paths and indexing logs behind a technical/debug toggle.

### P3 - First-run state is inconsistent depending on remembered browser state

Visible evidence from the walkthrough:

- Initial no-selection state observed earlier: `No matter selected`, `You have 11 matters available. Pick a matter from the sidebar to begin.`
- On later reopen, the same app URL restored `Mehta vs Skyline` directly and showed `Mehta vs Skyline > overview`.

Why this creates friction:

Remembering the last matter is useful for repeat work, but first-run onboarding and returning-session behavior need different treatment. If the app restores a matter automatically, the user may miss the mental model of selecting a matter first.

Lawyer impact:

- Orientation friction: users may not know whether they are looking at a default dashboard or an active matter.
- Safety concern: lawyers need clear active-matter context to avoid working in the wrong file.

Suggested direction:

When restoring a matter, show a clear but unobtrusive banner: `Restored your last matter: Mehta vs Skyline`. Include a quick `Switch matter` affordance.

## What Already Works Well

- The matter overview gives immediate legal metadata: `Client`, `Matter Name`, `Opposite Party`, `Matter Type`, and `Jurisdiction`.
- The pipeline answers an important lawyer question: which work products are present and which are missing.
- Matter search worked cleanly: typing `Mehta` narrowed the list to `1 of 11 matters`.
- The workspace tree has the right high-level categories: `Original Documents`, `Source Record`, `Case Analysis`, `Drafts`, and `Ready to Send`.
- The List of Dates content is substantively useful because each row connects date, event, legal relevance, and source.
- The note `Review before relying on this chronology` is the right legal posture; the app should keep that discipline.

## Quick Wins

1. Replace `EX`, `SK`, `AC`, and `SE` with recognizable icons or full labels plus tooltips.
2. Group `Dummy...` matters under `Sample matters` or hide them by default.
3. Hide raw folder codes in the default view; leave them behind `Show technical files`.
4. Rewrite pipeline primary labels in lawyer language: `Documents loaded`, `Sources labeled`, `Chronology created`, `Review recommended`.
5. Add command preview before `Go`, especially for actions that may regenerate output or call paid providers.
6. Change activity log copy from paths and indexing events to lawyer-readable status updates.
7. Add a restored-session cue when the app auto-loads the last matter.

## Bigger Product Questions

1. Should the app default to "review current work product" rather than "run or rerun action" whenever an output already exists?
2. Should provider/model names be visible to lawyers by default, or moved into an audit/details drawer?
3. Should citations such as `FILE-0001 p1.b6` become clickable source chips in the first-class review UI?
4. Should `Show technical files` be off by default and treated as an advanced/debug mode?
5. Should the app have a dedicated "lawyer review mode" for generated artifacts, separate from raw markdown preview?

## Bottom Line

The app is close to being credible for a lawyer because it organizes matter files, shows work-product status, and generates a useful chronology. The first-run friction is mostly language, hierarchy, and safety framing. The product should stop making the lawyer read the machine room first. Show the legal task, the current work product, the review risk, and the next safe action; let technical paths, model names, and slash commands sit one layer deeper.
