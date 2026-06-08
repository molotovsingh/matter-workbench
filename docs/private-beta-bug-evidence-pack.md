# Private Beta Bug Evidence Pack

Status: private beta bug handoff evidence

Run this after a private beta tester submits an in-app feedback note, or after
the operator receives a direct report about a confusing UI state, missing
output, failed skill run, bad preparation behavior, or service/runtime concern.

```bash
npm run private-beta:bug-evidence-pack -- \
  --base-url http://127.0.0.1:4191 \
  --matter "Matter Name" \
  --note "Short description of what the tester saw"
```

On the private VM:

```bash
set -a; . "$HOME/.config/matter-workbench/runtime.env"; set +a
npm run private-beta:bug-evidence-pack -- \
  --base-url http://127.0.0.1:4191 \
  --out-dir "$HOME/matter-workbench-backups/bug-evidence" \
  --matter "Matter Name" \
  --note "Short description of what the tester saw"
```

## What It Captures

The pack writes:

- `bug-evidence-pack.md` - readable handoff summary;
- `bug-evidence-pack.json` - redacted machine-readable evidence;
- a nested private VM ops pack with deployment, service, logs, rollback, disk,
  and memory posture.

The bug evidence pack includes:

- the operator's short issue note, ideally copied from the Activity feedback
  record;
- the target matter name, if supplied;
- the private VM service smoke result;
- runtime DB enabled/disabled posture;
- current deployment and rollback candidate from the ops pack;
- recent command-panel interactions from `.local/command-interactions.jsonl`;
- visible matter names when the supplied matter name does not match the runtime
  list, so typos or stale names are easy to correct;
- a short list of attachments and next actions for developer handoff.

## What It Avoids

It does not attach raw client documents, `.env`, provider keys, database
passwords, or generated legal work-product bodies. It redacts common secret
shapes, including API keys, bearer tokens, password-like environment variables,
and PostgreSQL passwords.

Still review the generated Markdown/JSON before sharing outside the trusted
private beta circle. Redaction is a guardrail, not a substitute for judgment.

## When To Use It

Use `private-beta:bug-evidence-pack` for one bug or quality concern after the
tester feedback record exists, or when the app is unavailable and direct
operator capture is the only option.

If the pack fails with `Matter not found`, check the `Available matters` line in
the generated evidence and rerun with the exact runtime matter name. The pack is
strict about matter names so it does not silently collect evidence from the
wrong matter.

Use `private-vm:ops-pack` for daily service health and rollback posture.

Use `private-vm:recoverability-pack` for backup/restore proof.

Use `private-beta:rc-closure-pack` when deciding whether a release checkpoint is
acceptable for beta.

## Handoff Pattern

The preferred private beta bug report is now:

```text
1. Activity feedback packet, or a direct note if the app was unavailable.
2. Matter name and rough time.
3. Screenshot, if visual.
4. bug-evidence-pack.md.
5. bug-evidence-pack.json.
6. Nested ops-pack.md/json if the issue may involve service health or deploy state.
```

This keeps bug reports grounded in evidence without turning every beta report
into a broad client-data dump.
