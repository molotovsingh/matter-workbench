# Future Design Decision: First-Class API And Provider Service Boundaries

Date: 2026-06-25
Status: Implementation contract draft
Priority: High for stability before more provider-backed workflows

## Decision

Matter Workbench should move toward one first-class API/use-case boundary for
product actions, with OCR and LLM calls behind task-specific provider services.

The goal is not one giant `api.mjs` or one god service. The goal is one public
boundary shape, with focused modules underneath:

```text
React views/hooks
  -> typed API client facade
    -> thin route handlers
      -> application use-case services
        -> focused domain services
          -> provider adapters / storage adapters
```

No workflow should own raw external-provider details. OCR and LLM calls should
be made only through app-owned services that enforce task policy, matter context,
timeouts, redaction, logging, and fail-closed behavior.

## Why This Exists

Recent Skill Factory sample generation exposed the failure mode: the UI showed
an active matter, but the sample request did not explicitly carry the selected
matter. The backend then had to infer from saved idea metadata or process active
matter, and a stale/missing matter could surface as `Matter not found`.

That bug class appears when these rules are not centralized:

- which actions are matter-bound;
- whether `matterName` is required;
- whether saved metadata can be used as fallback;
- whether runtime DB and filesystem paths resolve the same target;
- which provider, model, OCR engine, timeout, and retry policy apply;
- where provider errors are normalized for the UI.

The product is now broad enough that duplicating API calls and provider logic in
many places will keep creating correctness bugs.

## Non-Goals

This plan does not require:

- one 2,000-line service file;
- rewriting every route at once;
- moving all domain logic into the API client;
- letting the UI pick durable-work models;
- bypassing existing model task policy;
- introducing provider calls in components, hooks, or routes.

## Target Shape

### Frontend API Facade

The browser should import one API facade and use domain namespaces:

```ts
api.matters.switchMatter({ matterName });
api.skillIdeas.generateSample({ matterName, idea, feedback, previousSample });
api.skills.runCustomSkill({ matterName, slash, overwrite });
api.copilot.ask({ matterName, question, conversation });
api.research.ask({ matterName, question });
```

Matter-bound methods should require `matterName` in their request types. A
component may decide when to ask the user to choose a matter, but it should not
silently call a matter-bound endpoint without the selected matter.

### Thin Routes

Routes should do only route work:

```text
parse request
validate actor/auth
call use-case service
send JSON / map HTTP error
```

Routes should not duplicate runtime DB vs filesystem branching unless the
branching is route-specific. Shared branching belongs in use-case services.

### Application Use-Case Services

Use-case services own product actions:

```text
skillFactoryUseCases.generateSample({ actor, matterName, idea, feedback })
configurableSkillUseCases.run({ actor, matterName, slash, overwrite })
matterPreparationUseCases.prepare({ actor, matterName, mode })
```

A use-case service may call many focused domain services, but it should expose a
single product-level operation to the route.

### Focused Domain Services

Domain services should remain focused:

```text
matterResolver.resolveMatter({ actor, matterName })
workspaceReader.readWorkspace({ matter })
skillSamples.recordSample({ idea, sample })
modelTaskRunner.runJson({ task, input, schema })
ocrService.extractText({ matterName, documentId, fileBytes, mimeType })
```

The important rule is that callers use named app services rather than raw
provider APIs.

## OCR Boundary

OCR is a provider-backed capability and should have its own first-class service.

Target interface sketch:

```ts
ocrService.extractDocumentText({
  actor,
  matterName,
  documentId,
  sourcePath,
  fileBytes,
  mimeType,
  policy: 'source_extraction',
});
```

The OCR service owns:

- provider selection and keys;
- file-size/page limits;
- timeouts and retry posture;
- stable error codes;
- redaction of provider failures;
- OCR run metadata;
- custody-safe output shape;
- whether the call is allowed for the selected matter/document.

No extraction workflow should call an OCR provider endpoint directly.

## LLM Boundary

LLM calls should continue moving behind task policy and provider adapters.

Target interface sketch:

```ts
modelTaskRunner.run({
  task: 'skill_sample_output',
  actor,
  matterName,
  input,
  schema,
});
```

The model task runner owns:

- task-to-model policy resolution;
- provider selection;
- legal workbench policy prompt composition;
- structured output enforcement;
- timeouts and retry/fallback posture;
- provider metadata for audit;
- stable error mapping;
- no raw provider traces in lawyer-facing output.

This complements, and must not bypass,
[Model Task Boundaries](../contracts/model-task-boundaries.md).

## Matter Context Rule

Matter-bound actions must carry explicit matter context:

```text
If an action reads or writes matter data, its public request must include the
selected matter or be wrapped by a use-case that has already resolved one.
```

Fallback to process active matter should be treated as legacy compatibility, not
as the primary contract for new work.

Saved idea metadata, run receipts, or artifact metadata may be used for display
or validation, but they should not silently override the user's current selected
matter when a user is launching a new matter-bound action.

## Runtime DB / Filesystem Rule

Runtime DB and filesystem storage should share the same use-case boundary:

```text
use case resolves matter -> storage adapter reads/writes under that matter
```

The caller should not care whether the underlying matter is:

```text
/Users/.../matters/Foo
postgres:Foo
```

Provider-backed workflows should receive a normalized matter/context packet from
storage adapters, not reach through directly to storage internals.

## Migration Plan

### Phase 1: Stop New Duplication

- Keep `react-ui/src/api/client.ts` as the only browser transport layer.
- Add domain namespaces or domain files behind one exported `api` object.
- Add request types that require `matterName` for matter-bound work.
- Add tests/grep guards for no ad-hoc `fetch()` outside the API client.

### Phase 2: Centralize Matter-Bound Use Cases

Start with the bug-prone flows:

- Skill Factory sample generation;
- configurable custom skill runs;
- Matter Story generation;
- Copilot Ask and Research;
- preparation workflows.

Move route branching into use-case services while keeping route behavior stable.

### Phase 3: Provider Service Cleanup

- Ensure all LLM calls go through task policy and provider adapters.
- Introduce/standardize an OCR service boundary.
- Move provider-specific request construction out of workflow engines.
- Record provider/task metadata consistently where run ledgers or artifacts
  support it.

### Phase 4: Enforcement

Add lightweight checks:

- no direct provider endpoint strings in routes/components/workflow engines;
- no matter-bound API request types without `matterName` or a documented
  explicit resolver;
- no raw provider errors shown to users;
- no provider API keys outside provider service/adapters.

## Acceptance Criteria

This plan is working when:

- a new matter-bound action has one obvious request type and requires
  `matterName`;
- route handlers are mostly parse/call/respond;
- runtime DB and filesystem paths share a product-level use case;
- OCR and LLM provider calls are not scattered across workflow files;
- provider failures have stable, user-safe error messages;
- provider metadata is captured for audit without leaking secrets or raw traces;
- tests can assert the boundary without rendering the full UI.

## Current Related Contracts

- [Model Task Boundaries](../contracts/model-task-boundaries.md)
- [Model Routing](../model-routing.md)
- [Matter Context Reader](../matter-context-reader-contract.md)
- [Diagnostic Surfaces](../contracts/diagnostic-surfaces.md)
- [Custom Skill Governance](../contracts/custom-skill-governance.md)

## Open Questions

- Should the frontend API facade be one file with domain namespaces, or an
  `api/` directory with one exported aggregate?
- Should OCR get a new task policy enum alongside LLM tasks, or a parallel OCR
  policy namespace?
- Which existing provider call sites should be migrated first after Skill
  Factory sample generation?
- What lint/test rule is strict enough to prevent drift without blocking normal
  local development?
