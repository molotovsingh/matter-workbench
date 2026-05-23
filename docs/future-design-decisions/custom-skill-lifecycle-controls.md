# Custom Skill Lifecycle Controls

Date: 2026-05-21
Status: Implementation contract draft

## Problem

Users can create custom/configurable skills, but they also need a safe way to
clean up experiments that should no longer appear in daily use.

The app needs three user-facing lifecycle actions:

- suspend;
- archive;
- delete.

Those actions must apply only to custom skills. Native skills are app-owned legal
workflows and must not be deleted, archived, suspended, edited, or hidden through
the custom-skill management surface.

The core rule:

```text
native skills are app-owned
custom skills are user-managed
old runs and artifacts remain audit history
```

## Current Repo Facts

Custom skills live in `configurable-skills.json` through the configurable skill
service.

Current custom skill statuses are:

- `draft`;
- `active`;
- `disabled`.

Only `active` custom skills are runnable. `services/configurable-skills-service.mjs`
looks up a runnable skill by slash and `status === "active"`.

Only active custom skills are projected into the app skill registry. The registry
projection is built through `activeSkillCards()` and `primaryActiveSkills()`.

Native skills come from `skills/registry.json` and `skills/builtins/*/skill.json`.
They are not stored in `configurable-skills.json` and should not participate in
this lifecycle.

## Design Decision

Add lifecycle controls to configurable skills only.

Do not overload native skill behavior. Do not add delete/archive/suspend buttons
to built-in skills. Do not add a native-skill status mutation path.

The server must enforce the boundary. Hiding buttons in React is useful, but it
is not the safety rule.

## Lifecycle Vocabulary

### Active

The skill is visible and runnable.

Rules:

- appears in custom skill list;
- appears in command routing and registry projection;
- can be run against a matter;
- can be suspended, archived, or deleted by the user.

### Suspended

The skill is paused temporarily.

Use this when a user is unsure about a custom skill but does not want to remove
it from management.

Rules:

- not runnable;
- not projected into `/api/skills`;
- not suggested by command routing;
- visible in a `Paused custom skills` area;
- can be resumed;
- can be archived;
- can be deleted.

Lawyer-facing copy:

```text
Paused
This custom skill is kept, but it will not run or appear in normal commands.
```

### Archived

The skill is retired from normal working surfaces but kept for reference.

Use this when a custom skill is no longer useful, duplicated by a native skill,
or belongs to an old experiment.

Rules:

- not runnable;
- not projected into `/api/skills`;
- hidden from the main custom skill list by default;
- visible under `Archived custom skills`;
- can be restored to suspended first;
- can be deleted.

Restoring to suspended first is intentional. It gives the user one extra check
before an old skill becomes runnable again.

Lawyer-facing copy:

```text
Archived
Kept for reference. It will not run unless you restore it.
```

### Deleted

The skill is removed from normal management.

For legal/audit safety, delete should be a **soft delete** in the first hosted
and local implementation. It should mark the custom skill as deleted, hide it
from normal UI, and preserve enough tombstone metadata to explain old run
receipts.

Rules:

- not runnable;
- not projected into `/api/skills`;
- hidden from normal custom skill management;
- old run receipts remain readable;
- old matter artifacts remain untouched;
- no automatic deletion of generated markdown or JSON artifacts;
- no automatic deletion of `configurable-skill-runs.json` entries;
- no restore from normal UI in first slice.

Lawyer-facing copy:

```text
Delete custom skill
This removes the custom skill from the workbench. Past run records and matter files are kept.
```

### Disabled

Keep `disabled` for existing version-history behavior.

Current code uses `disabled` when a newer validated version replaces an older
version. That should not become a user-facing "paused" state.

Recommended display label:

```text
Previous version
```

Rules:

- not user-managed in the first lifecycle-controls slice;
- not runnable;
- remains tied to version lineage;
- old run receipts can still point to it.

## State Model

Expand custom skill statuses to:

```text
draft
active
disabled
suspended
archived
deleted
```

Add optional lifecycle metadata:

```json
{
  "lifecycle": {
    "statusChangedAt": "2026-05-21T00:00:00.000Z",
    "statusChangedBy": "local-user",
    "reason": "User paused during beta cleanup.",
    "previousStatus": "active"
  }
}
```

For local V1, `statusChangedBy` can be a fixed local value. Hosted beta can later
replace that with a real user id.

Do not bump the JSON store into a new durable schema only for this unless the
implementation needs strict migration. Optional fields are enough for the first
slice.

## Allowed Transitions

```text
active -> suspended
active -> archived
active -> deleted

suspended -> active
suspended -> archived
suspended -> deleted

archived -> suspended
archived -> deleted

draft -> deleted

disabled -> no user lifecycle action in first slice
deleted -> terminal from normal UI
```

Why these transitions:

- Suspended is reversible and close to active.
- Archived is a deeper shelf, so restore should come back as suspended first.
- Deleted is intentionally terminal from normal UI.
- Disabled is version history, not a user management state.

## Native Skill Boundary

Native skills must not expose lifecycle actions.

The UI should show native skills as app-owned:

```text
Built-in
Managed by Matter Workbench
```

No menu should offer:

- Suspend;
- Archive;
- Delete;
- Rename;
- Edit prompt.

The backend should have no endpoint that mutates native skill status. Lifecycle
routes should accept only configurable skill ids from `configurable-skills.json`.
They should not accept slash commands as authority, because a slash could collide
with native or older custom versions.

## API Scheme

Add a custom-skill lifecycle route:

```text
POST /api/configurable-skills/:skillId/lifecycle
```

Request:

```json
{
  "action": "suspend",
  "reason": "Testing paused during beta cleanup."
}
```

Allowed actions:

```text
suspend
resume
archive
restore
delete
```

Response:

```json
{
  "schema_version": "configurable-skill-lifecycle/v1",
  "skill": {
    "id": "skill_123",
    "title": "Party and Officer Map",
    "slash": "/party_officer_map",
    "status": "suspended",
    "version": 2,
    "familyId": "skill_family_123"
  }
}
```

Server rules:

- Resolve by `skillId`, not slash.
- If the id is not found in configurable store, return 404.
- If the skill is `disabled`, return 409 with a message that previous versions
  are retained as history.
- If the action is not valid from the current status, return 409.
- If action is `resume` and another active custom skill already owns the same
  slash in the same family or signature, return 409.
- Never mutate native registry files.
- Never delete matter output artifacts.
- Never delete run receipts.

## Service Logic

Add a method to `createConfigurableSkillsService`:

```text
updateSkillLifecycle({ skillId, action, reason })
```

Internal logic:

1. Normalize `skillId`, `action`, and `reason`.
2. Load the configurable skill store.
3. Find the skill by id.
4. Reject if missing.
5. Normalize the current stored skill.
6. Compute next status through a small transition table.
7. Reject invalid transitions.
8. For `resume`, check that no other active custom skill blocks the same slash.
9. Set `status`, `updatedAt`, and `lifecycle`.
10. Persist the store.
11. Return `publicSkill(updatedSkill)`.

Use a transition table rather than scattered `if` branches:

```text
active:    suspend -> suspended, archive -> archived, delete -> deleted
suspended: resume -> active, archive -> archived, delete -> deleted
archived:  restore -> suspended, delete -> deleted
draft:     delete -> deleted
```

`disabled` and `deleted` have no normal user transition.

## List Behavior

`GET /api/configurable-skills` should remain the management endpoint.

Recommended response grouping:

```json
{
  "schema_version": "configurable-skills/v1",
  "skills": [],
  "counts": {
    "active": 2,
    "suspended": 1,
    "archived": 3,
    "draft": 1
  }
}
```

For backwards compatibility, `skills` can continue to include all non-deleted
custom skills in the first implementation. React can group by `status`.

Deleted skills should be omitted by default. A future admin/debug view may add:

```text
GET /api/configurable-skills?includeDeleted=1
```

Do not add that admin path unless it is actually needed.

## Run Behavior

`runSkill` should remain strict:

```text
only status === "active" can run
```

If a suspended or archived skill is requested directly by slash, return a clear
409:

```text
This custom skill is paused. Resume it before running.
```

or:

```text
This custom skill is archived. Restore it before running.
```

If the skill is deleted, behave as not found for normal user paths.

## Router And Registry Behavior

Only active custom skills should be projected into:

- `/api/skills`;
- command suggestions;
- skill router candidate cards;
- matter overview quick actions.

Native skills remain unaffected.

This keeps paused/archived/deleted custom skills from being selected by normal
workflows while preserving management visibility where appropriate.

## UI Scheme

### Built-In Skills Section

Native skill rows should show no destructive menu.

Recommended metadata:

```text
Built-in
Managed by Matter Workbench
```

This prevents the lawyer from thinking core workflows like Extract, Source
Labels, List of Dates, or Prepare Matter are removable personal experiments.

### Custom Skills Section

Custom skill rows should have a compact `Manage` menu.

For active skills:

- `Pause`;
- `Archive`;
- `Delete`.

For suspended skills:

- `Resume`;
- `Archive`;
- `Delete`.

For archived skills:

- `Restore to paused`;
- `Delete`.

For draft failed-validation skills:

- `Delete draft`.

Do not call the action `Disable`. The word is too close to existing internal
`disabled` version history and will confuse future maintenance.

### Confirmations

Pause:

```text
Pause this custom skill?
It will stop appearing in commands until you resume it.
```

Archive:

```text
Archive this custom skill?
It will be hidden from daily use, but past run records and matter files stay.
```

Delete:

```text
Delete this custom skill?
This removes it from the workbench. Past run records and matter files stay.
```

For delete, require one deliberate confirmation step. Do not require typing the
skill name in the first slice unless user testing shows accidental deletion is
likely.

## Artifact And Receipt Policy

Lifecycle actions must not delete:

- markdown outputs in matter folders;
- JSON metadata outputs;
- configurable skill run records;
- source samples;
- skill ideas;
- approved sample records.

Reason: those artifacts explain what the app produced in the past. A lawyer may
need to understand why a file exists even after the custom skill is retired.

Deletion is deletion of future availability, not erasure of history.

## Hosted Beta Notes

In hosted mode, lifecycle metadata should later capture:

- user id;
- workspace/tenant id;
- timestamp;
- reason;
- previous status;
- next status.

For local V1, do not introduce a database only for this. The JSON store can hold
the lifecycle metadata until hosted implementation starts.

## Testing Requirements

Backend tests:

- Native skill ids cannot be mutated through configurable lifecycle route.
- Active custom skill can be suspended.
- Suspended custom skill cannot run.
- Suspended custom skill can resume.
- Archived custom skill is hidden from normal registry projection.
- Archived custom skill restores only to suspended.
- Deleted custom skill is omitted from default configurable skill list.
- Disabled previous version rejects lifecycle mutation.
- Delete does not remove configurable skill run receipts.
- Delete does not remove matter output files.
- Resume rejects slash collision with another active custom skill.

Frontend tests:

- Built-in skill rows have no lifecycle menu.
- Active custom skill shows Pause, Archive, Delete.
- Suspended custom skill shows Resume, Archive, Delete.
- Archived custom skill appears only in archived/custom management area.
- Delete confirmation text says past run records and matter files stay.

## Recommended First Slice

Build only the management path:

1. Extend configurable skill normalization to accept `suspended`, `archived`,
   and `deleted`.
2. Add service-level lifecycle transition logic.
3. Add route under `/api/configurable-skills/:skillId/lifecycle`.
4. Add React API client method.
5. Add custom-skill management menus on the Skills page.
6. Keep native skill rows read-only.
7. Add focused tests.

Do not include:

- hard deletion from disk;
- deletion of matter artifacts;
- deletion of run receipts;
- database migration;
- native skill lifecycle controls;
- prompt editing;
- version editing.

## Open Product Question

Should archived custom skills be hidden behind a collapsed `Archived` section by
default, or should they live in a separate `Manage custom skills` view?

Recommendation for V1: use a collapsed section on the Skills page. It is cheaper,
visible enough for beta testers, and avoids adding a new management surface.
