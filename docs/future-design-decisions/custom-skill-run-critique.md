# Future Design Decision: Custom Skill Run Critique

Date: 2026-05-14
Status: Parked for staged implementation

## Why This Exists

Custom skills are now real runnable app objects. A lawyer can create a skill,
approve a sample, activate the skill, and run it on more than one matter.

The next trust question appears after a run:

```text
Was this output good enough for this matter?
```

If the answer is no, the user should not have to know whether the fix is a
prompt issue, a sample issue, a matter-context issue, or a versioning issue.
The app should give a simple critique path beside the result.

## Target User Experience

After a custom skill run, the user should see the output and a small set of
plain actions near the run result:

```text
Looks good
Improve this skill
Run again
Open output
```

Later, a more explicit critique action may be added:

```text
Something is wrong
```

That action should ask a few targeted follow-up questions and then feed the
existing skill-improvement/version path.

## Product Rules

### Weak Output Does Not Mutate The Skill

If a skill works well on one matter but poorly on another, the app must not
silently rewrite the active skill.

The safe lifecycle is:

```text
run active skill
-> user critiques output
-> app creates improvement feedback
-> generate revised sample
-> user approves sample
-> validate new version
-> activate new version
```

The old active version should remain usable until the replacement version is
validated and activated.

### "Looks Good" Is A Run Judgment, Not Skill Validation

`Looks good` means:

```text
This output is acceptable for this run.
```

It does not mean:

```text
This skill is permanently correct for every matter.
```

The first implementation may keep this as a local UI/report status only. A
durable quality ledger can come later if the signal proves useful.

### "Run Again" Reuses The Active Version

`Run again` should rerun the current active skill version with normal output
replacement guardrails. The prompt should make clear that it only replaces this
matter's output document; it should not create a draft version or change the
skill.

### "Improve This Skill" Starts The Existing Version Flow

`Improve this skill` should start the governed improvement path. It may use the
current run context as evidence, but it must not edit the active skill in place.

### Output And Run Metadata Stay Visible

The user should be able to see:

- which matter was used;
- which skill slash command ran;
- provider/model;
- output document path;
- whether an existing output document was replaced or kept;
- latest run status.

This belongs near the run result and in the Skills supervision surface.

## Suggested V0

Add buttons beside a completed custom skill run:

- `Looks good`;
- `Improve this skill`;
- `Run again`;
- `Open output`.

Behavior:

- `Looks good` updates the Command rail status/report only.
- `Improve this skill` reuses the current non-mutating improvement flow.
- `Run again` reuses the existing configurable-skill run path and output
  replacement guardrails.
- `Open output` opens the generated matter artifact.

## Later Critique Flow

A later `Something is wrong` path can ask:

```text
What should improve?
```

Possible choices:

- missed facts;
- wrong legal framing;
- missing citations;
- wrong tone;
- poor structure;
- too much or too little detail;
- output should be more client-facing or more internal.

The app should turn that critique into feedback for a revised sample, not a
direct prompt edit.

## Non-Goals

This parked decision does not authorize:

- editing active prompt/config in place;
- exposing prompt editing in the run result;
- direct JSON editing;
- rollback controls;
- mutating built-in skill stubs;
- writing new matter artifacts merely because the user critiques a run;
- changing provider/model policy;
- bypassing sample approval and validation;
- treating one bad output as automatic proof that the skill should change.

## Acceptance Rule

The user-facing promise should stay simple:

```text
If the output is good, mark it good.
If it is weak, improve the skill through the sample/version flow.
```

The system promise should stay stricter:

```text
No active skill changes until a new version is sampled, approved, validated,
and activated.
```
