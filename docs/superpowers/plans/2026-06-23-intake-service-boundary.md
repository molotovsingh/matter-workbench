# Intake Service Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a first-class internal intake boundary for current browser uploads while preserving existing Matter Workbench upload behavior.

**Architecture:** Keep this inside the same Node repo and runtime. The new `services/intake/` boundary owns source-candidate contracts and browser-upload adapter logic; existing filesystem and runtime DB persistence continue to consume the same shared upload planners. This is a behavior-preserving extraction, not ZIP/email/connector support.

**Tech Stack:** Node.js ESM, `node:test`, existing multipart upload flow, existing runtime DB upload planners, existing shared upload path and matter identity policies.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-23-intake-service-boundary-design.md`.

In scope:

- Name the intake boundary as `services/intake/`.
- Introduce a stable internal candidate/batch contract for browser-uploaded files.
- Move browser-upload field parsing and upload planning into an intake adapter.
- Rewire `services/upload-service.mjs` to ask the adapter for upload plans instead of doing raw field parsing itself.
- Keep public routes, response shapes, storage behavior, telemetry behavior, and preparation behavior unchanged.
- Add tests proving stable error codes and parity with existing planning behavior.
- Update docs so future ZIP/email/connectors know they must feed the same intake boundary.

Out of scope for this plan:

- ZIP extraction.
- `.eml`, Gmail, Drive, Dropbox, WhatsApp, or email connector ingestion.
- Separate Python service, separate Node service, queue worker, or object storage switch.
- UI progress bars or resumable upload.
- New provider/model calls.
- Runtime DB schema migration.
- Public API route changes.

## File Map

- Create `services/intake/intake-contracts.mjs`
  - Owns internal intake schema versions and browser upload candidate normalization.
  - Pure functions only. No filesystem, DB, provider, or route access.

- Create `services/intake/browser-upload-adapter.mjs`
  - Owns multipart field parsing for current browser upload requests after `services/multipart-upload.mjs` has produced `{ fields, files, tempDir }`.
  - Calls existing shared planners so behavior remains canonical.

- Modify `services/upload-file-intake.mjs`
  - Stop owning JSON field parsing and path-list validation.
  - Re-export those functions from `services/intake/browser-upload-adapter.mjs` for compatibility during the extraction.
  - Keep `writeUploadedFiles()` here because it is filesystem persistence, not intake planning.

- Modify `services/upload-service.mjs`
  - Use `planBrowserNewMatterUpload()` and `planBrowserAddFilesUpload()` from the intake adapter.
  - Keep storage-mode branching, duplicate matter checks, write queues, and `runMatterInit()` where they are.

- Modify `services/runtime-db-upload-intake-planner.mjs`
  - No behavior fork. Add tests first; only add fields if needed to preserve the candidate boundary in runtime plans.

- Create `test/intake-contracts.test.mjs`
  - Tests candidate normalization, stable schema versions, path validation, and stable error codes.

- Create `test/browser-upload-adapter.test.mjs`
  - Tests new matter and add-files planning from multipart fields.
  - Tests invalid JSON and no-file behavior through the adapter.

- Modify `test/upload-intake-planner-parity.test.mjs`
  - Add a test proving browser adapter output matches shared planner output.

- Modify `test/upload-api.test.mjs`
  - Add a source-level contract test that `upload-service` imports the browser adapter.
  - Keep the existing end-to-end multipart tests as behavioral proof.

- Modify `docs/contracts/upload-intake-contract.md`
  - Name `services/intake/` as the service-shaped boundary.
  - Clarify that source adapters feed candidates; persistence remains separate.

- Modify `docs/superpowers/specs/2026-06-23-intake-service-boundary-design.md`
  - Change status from `Draft design for user review` to `Accepted design; Phase 1 planned`.
  - Add a short implementation note pointing to this plan.

## Task 1: Add Pure Intake Candidate Contracts

**Files:**
- Create: `services/intake/intake-contracts.mjs`
- Create: `test/intake-contracts.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/intake-contracts.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  INTAKE_BATCH_SCHEMA_VERSION,
  INTAKE_CANDIDATE_SCHEMA_VERSION,
  INTAKE_SOURCE_BROWSER_UPLOAD,
  browserUploadBatchFromFiles,
  browserUploadCandidatesFromFiles,
} from "../services/intake/intake-contracts.mjs";

const files = [
  {
    index: 0,
    filename: "notice.pdf",
    tempPath: "/tmp/matter-upload-001/upload-00000",
    bytes: 1234,
  },
  {
    index: 1,
    filename: "Evidence/FIR.pdf",
    tempPath: "/tmp/matter-upload-001/upload-00001",
    bytes: 4567,
  },
];

test("browser upload candidates preserve source identity and normalized paths", () => {
  const candidates = browserUploadCandidatesFromFiles({
    files,
    relativePaths: ["notice.pdf", "Evidence/FIR.pdf"],
    action: "creating a matter",
  });

  assert.deepEqual(candidates, [
    {
      schema_version: INTAKE_CANDIDATE_SCHEMA_VERSION,
      sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
      index: 0,
      originalName: "notice.pdf",
      relativePath: "notice.pdf",
      tempPath: "/tmp/matter-upload-001/upload-00000",
      sizeBytes: 1234,
    },
    {
      schema_version: INTAKE_CANDIDATE_SCHEMA_VERSION,
      sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
      index: 1,
      originalName: "Evidence/FIR.pdf",
      relativePath: "Evidence/FIR.pdf",
      tempPath: "/tmp/matter-upload-001/upload-00001",
      sizeBytes: 4567,
    },
  ]);
});

test("browser upload batch wraps candidates without adding side effects", () => {
  const batch = browserUploadBatchFromFiles({
    action: "creating a matter",
    files,
    relativePaths: ["notice.pdf", "Evidence/FIR.pdf"],
  });

  assert.equal(batch.schema_version, INTAKE_BATCH_SCHEMA_VERSION);
  assert.equal(batch.sourceKind, INTAKE_SOURCE_BROWSER_UPLOAD);
  assert.equal(batch.action, "creating a matter");
  assert.equal(batch.candidateCount, 2);
  assert.deepEqual(
    batch.candidates.map((candidate) => candidate.relativePath),
    ["notice.pdf", "Evidence/FIR.pdf"],
  );
});

test("candidate contract keeps upload validation failures stable", () => {
  assert.throws(
    () => browserUploadCandidatesFromFiles({
      files: [{ index: 0 }, { index: 1 }],
      relativePaths: ["same.pdf", "SAME.pdf"],
    }),
    (error) => error.statusCode === 400
      && error.code === "upload.duplicate_paths"
      && /conflicts with/i.test(error.message),
  );

  assert.throws(
    () => browserUploadCandidatesFromFiles({
      files: [],
      relativePaths: [],
      action: "creating a matter",
    }),
    (error) => error.statusCode === 400
      && error.code === "upload.no_files_attached"
      && /creating a matter/i.test(error.message),
  );
});
```

- [ ] **Step 2: Run tests and verify the expected failure**

Run:

```bash
node --test test/intake-contracts.test.mjs
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

or:

```text
SyntaxError: The requested module '../services/intake/intake-contracts.mjs' does not provide an export named ...
```

- [ ] **Step 3: Implement the contract module**

Create `services/intake/intake-contracts.mjs`:

```js
import { validateUploadInputs } from "../../shared/upload-intake-planner.mjs";

export const INTAKE_CANDIDATE_SCHEMA_VERSION = "intake-candidate/v1";
export const INTAKE_BATCH_SCHEMA_VERSION = "intake-batch/v1";
export const INTAKE_SOURCE_BROWSER_UPLOAD = "browser_upload";

export function browserUploadCandidatesFromFiles({
  files = [],
  relativePaths = [],
  action = "uploading files",
} = {}) {
  const normalizedPaths = validateUploadInputs({ files, relativePaths, action });
  return files.map((file, fallbackIndex) => {
    const index = normalizedIndex(file?.index, fallbackIndex);
    return {
      schema_version: INTAKE_CANDIDATE_SCHEMA_VERSION,
      sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
      index,
      originalName: stringValue(file?.filename),
      relativePath: normalizedPaths[index],
      tempPath: stringValue(file?.tempPath),
      sizeBytes: normalizedBytes(file?.bytes),
    };
  });
}

export function browserUploadBatchFromFiles({
  action = "uploading files",
  files = [],
  relativePaths = [],
} = {}) {
  const candidates = browserUploadCandidatesFromFiles({ files, relativePaths, action });
  return {
    schema_version: INTAKE_BATCH_SCHEMA_VERSION,
    sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
    action,
    candidateCount: candidates.length,
    candidates,
  };
}

function normalizedIndex(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return number;
}

function normalizedBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/intake-contracts.test.mjs
```

Expected:

```text
# pass 3
```

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add services/intake/intake-contracts.mjs test/intake-contracts.test.mjs
git commit -m "Add intake candidate contract"
```

## Task 2: Add Browser Upload Adapter

**Files:**
- Create: `services/intake/browser-upload-adapter.mjs`
- Create: `test/browser-upload-adapter.test.mjs`

- [ ] **Step 1: Write the failing adapter tests**

Create `test/browser-upload-adapter.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseUploadJsonField,
  planBrowserAddFilesUpload,
  planBrowserNewMatterUpload,
  validateUploadPathList,
} from "../services/intake/browser-upload-adapter.mjs";

const files = [
  {
    index: 0,
    filename: "notice.pdf",
    tempPath: "/tmp/upload-00000",
    bytes: 10,
  },
];

test("browser adapter plans new matter upload from multipart fields", () => {
  const result = planBrowserNewMatterUpload({
    fields: {
      name: "State/Rajesh Mehra",
      metadata: JSON.stringify({
        matterName: "State/Rajesh Mehra",
        clientName: "Rajesh Mehra",
        oppositeParty: "State",
      }),
      paths: JSON.stringify(["evidence/notice.pdf"]),
    },
    files,
  });

  assert.equal(result.submittedMatterName, "State/Rajesh Mehra");
  assert.equal(result.identityPlan.storageName, "State - Rajesh Mehra");
  assert.equal(result.uploadPlan.storageName, "State - Rajesh Mehra");
  assert.equal(result.metadata.clientName, "Rajesh Mehra");
  assert.deepEqual(result.relativePaths, ["evidence/notice.pdf"]);
  assert.equal(result.batch.sourceKind, "browser_upload");
  assert.equal(result.batch.candidateCount, 1);
});

test("browser adapter plans add-files upload from multipart fields", () => {
  const result = planBrowserAddFilesUpload({
    fields: {
      label: "Follow Up",
      paths: JSON.stringify(["receipt.pdf"]),
    },
    files,
  });

  assert.equal(result.label, "Follow Up");
  assert.deepEqual(result.relativePaths, ["receipt.pdf"]);
  assert.equal(result.batch.action, "adding files");
  assert.equal(result.batch.candidateCount, 1);
});

test("browser adapter preserves invalid JSON and no-file error codes", () => {
  assert.throws(
    () => parseUploadJsonField({ metadata: "{" }, "metadata", {}),
    (error) => error.statusCode === 400
      && error.code === "upload.invalid_json"
      && /Invalid metadata JSON/.test(error.message),
  );

  assert.throws(
    () => validateUploadPathList({ paths: JSON.stringify([]) }, [], { action: "creating a matter" }),
    (error) => error.statusCode === 400
      && error.code === "upload.no_files_attached",
  );
});
```

- [ ] **Step 2: Run tests and verify the expected failure**

Run:

```bash
node --test test/browser-upload-adapter.test.mjs
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement the adapter**

Create `services/intake/browser-upload-adapter.mjs`:

```js
import { validateIntakeLabel } from "../../shared/matter-contract.mjs";
import { makeHttpError } from "../../shared/safe-paths.mjs";
import {
  planNewMatterIdentity,
  planNewMatterUpload,
  validateUploadInputs,
} from "../../shared/upload-intake-planner.mjs";
import { browserUploadBatchFromFiles } from "./intake-contracts.mjs";

export function parseUploadJsonField(fields = {}, name, fallback) {
  if (!fields[name]) return fallback;
  try {
    return JSON.parse(fields[name]);
  } catch {
    throw makeHttpError(`Invalid ${name} JSON`, 400, "upload.invalid_json");
  }
}

export function validateUploadPathList(fields = {}, files = [], { action = "uploading files" } = {}) {
  const relativePaths = parseUploadJsonField(fields, "paths", []);
  return validateUploadInputs({ files, relativePaths, action });
}

export function planBrowserNewMatterUpload({ fields = {}, files = [] } = {}) {
  const submittedMatterName = String(fields.name || "").trim();
  const metadata = parseUploadJsonField(fields, "metadata", {});
  const rawRelativePaths = parseUploadJsonField(fields, "paths", []);
  const identityPlan = planNewMatterIdentity({ name: submittedMatterName });
  const uploadPlan = planNewMatterUpload({
    name: submittedMatterName,
    metadata,
    files,
    relativePaths: rawRelativePaths,
    action: "creating a matter",
  });
  const batch = browserUploadBatchFromFiles({
    action: "creating a matter",
    files,
    relativePaths: uploadPlan.relativePaths,
  });

  return {
    submittedMatterName,
    identityPlan,
    uploadPlan,
    metadata: uploadPlan.metadata,
    relativePaths: uploadPlan.relativePaths,
    batch,
  };
}

export function planBrowserAddFilesUpload({ fields = {}, files = [] } = {}) {
  const label = validateIntakeLabel(fields.label);
  const relativePaths = validateUploadPathList(fields, files, { action: "adding files" });
  const batch = browserUploadBatchFromFiles({
    action: "adding files",
    files,
    relativePaths,
  });

  return {
    label,
    relativePaths,
    batch,
  };
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/intake-contracts.test.mjs test/browser-upload-adapter.test.mjs
```

Expected:

```text
# pass 6
```

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add services/intake/browser-upload-adapter.mjs test/browser-upload-adapter.test.mjs
git commit -m "Add browser upload intake adapter"
```

## Task 3: Move Upload Field Parsing Behind The Adapter

**Files:**
- Modify: `services/upload-file-intake.mjs`
- Test: `test/browser-upload-adapter.test.mjs`
- Test: `test/upload-api.test.mjs`

- [ ] **Step 1: Add source-level compatibility test**

Append this test to `test/browser-upload-adapter.test.mjs`:

```js
import { readFile } from "node:fs/promises";

test("legacy upload-file-intake re-exports adapter parsing functions", async () => {
  const source = await readFile("services/upload-file-intake.mjs", "utf8");
  assert.match(source, /from "\.\/intake\/browser-upload-adapter\.mjs"/);
  assert.match(source, /parseUploadJsonField/);
  assert.match(source, /validateUploadPathList/);
});
```

- [ ] **Step 2: Run tests and verify the expected failure**

Run:

```bash
node --test test/browser-upload-adapter.test.mjs
```

Expected:

```text
not ok ... legacy upload-file-intake re-exports adapter parsing functions
```

- [ ] **Step 3: Modify `services/upload-file-intake.mjs`**

Replace the current imports and parsing functions with this structure:

```js
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isInsideRoot, makeHttpError } from "../shared/safe-paths.mjs";
import { validateUploadRelativePath } from "../shared/upload-path-policy.mjs";

export {
  parseUploadJsonField,
  validateUploadPathList,
} from "./intake/browser-upload-adapter.mjs";
```

Keep the existing `writeUploadedFiles()` function unchanged below those exports:

```js
export async function writeUploadedFiles(files = [], relativePaths = [], destinationRoot, {
  escapeMessage = "Resolved destination escapes upload root",
} = {}) {
  await mkdir(destinationRoot, { recursive: true });
  for (const file of [...files].sort((a, b) => a.index - b.index)) {
    const safeRel = validateUploadRelativePath(relativePaths[file.index]);
    const destination = path.resolve(destinationRoot, safeRel);
    if (!isInsideRoot(destinationRoot, destination)) {
      throw makeHttpError(escapeMessage, 400, "upload.path_escapes_root");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file.tempPath, destination);
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/browser-upload-adapter.test.mjs test/upload-api.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add services/upload-file-intake.mjs test/browser-upload-adapter.test.mjs
git commit -m "Route upload field parsing through intake adapter"
```

## Task 4: Rewire Upload Service To Use The Intake Adapter

**Files:**
- Modify: `services/upload-service.mjs`
- Modify: `test/upload-api.test.mjs`
- Modify: `test/upload-intake-planner-parity.test.mjs`

- [ ] **Step 1: Add failing source-level import test**

Append this test to `test/upload-api.test.mjs`:

```js
test("upload service delegates browser upload planning to intake adapter", async () => {
  const source = await readFile("services/upload-service.mjs", "utf8");
  assert.match(source, /planBrowserNewMatterUpload/);
  assert.match(source, /planBrowserAddFilesUpload/);
  assert.match(source, /from "\.\/intake\/browser-upload-adapter\.mjs"/);
});
```

- [ ] **Step 2: Add adapter parity test**

Append this test to `test/upload-intake-planner-parity.test.mjs`:

```js
import { planBrowserNewMatterUpload } from "../services/intake/browser-upload-adapter.mjs";

test("browser adapter output matches shared new-matter planner", () => {
  const shared = planNewMatterUpload({
    name: "State/Rajesh Mehra",
    metadata: {
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
    },
    files,
    relativePaths: ["Evidence/FIR.pdf"],
  });

  const adapter = planBrowserNewMatterUpload({
    fields: {
      name: "State/Rajesh Mehra",
      metadata: JSON.stringify({
        matterName: "State/Rajesh Mehra",
        clientName: "Rajesh Mehra",
        oppositeParty: "State",
      }),
      paths: JSON.stringify(["Evidence/FIR.pdf"]),
    },
    files,
  });

  assert.equal(adapter.uploadPlan.storageName, shared.storageName);
  assert.deepEqual(adapter.metadata, shared.metadata);
  assert.deepEqual(adapter.relativePaths, shared.relativePaths);
  assert.deepEqual(
    adapter.batch.candidates.map((candidate) => candidate.relativePath),
    shared.relativePaths,
  );
});
```

- [ ] **Step 3: Run tests and verify the expected failure**

Run:

```bash
node --test test/upload-api.test.mjs test/upload-intake-planner-parity.test.mjs
```

Expected:

```text
not ok ... upload service delegates browser upload planning to intake adapter
```

- [ ] **Step 4: Modify imports in `services/upload-service.mjs`**

Replace:

```js
import {
  planAddFilesIntake,
  planNewMatterIdentity,
  planNewMatterUpload,
} from "../shared/upload-intake-planner.mjs";
```

with:

```js
import { planAddFilesIntake } from "../shared/upload-intake-planner.mjs";
import {
  planBrowserAddFilesUpload,
  planBrowserNewMatterUpload,
} from "./intake/browser-upload-adapter.mjs";
```

Replace:

```js
import {
  parseUploadJsonField,
  validateUploadPathList,
  writeUploadedFiles,
} from "./upload-file-intake.mjs";
```

with:

```js
import { writeUploadedFiles } from "./upload-file-intake.mjs";
```

- [ ] **Step 5: Modify `createMatter()` planning block**

Inside `createMatter()`, replace this block:

```js
const submittedMatterName = String(fields.name || "").trim();
const identityPlan = planNewMatterIdentity({ name: submittedMatterName });
const { name, matterPath } = useRuntimeDbStorage
  ? { name: identityPlan.storageName, matterPath: null }
  : matterStore.matterPathForName(identityPlan.storageName);
```

with:

```js
const browserPlan = planBrowserNewMatterUpload({ fields, files });
const { identityPlan, uploadPlan } = browserPlan;
const { name, matterPath } = useRuntimeDbStorage
  ? { name: identityPlan.storageName, matterPath: null }
  : matterStore.matterPathForName(identityPlan.storageName);
```

Then replace:

```js
const uploadPlan = planNewMatterUpload({
  name: submittedMatterName,
  metadata: parseUploadJsonField(fields, "metadata", {}),
  files,
  relativePaths: parseUploadJsonField(fields, "paths", []),
  action: "creating a matter",
});
const metadata = uploadPlan.metadata;
const relativePaths = uploadPlan.relativePaths;
```

with:

```js
const metadata = browserPlan.metadata;
const relativePaths = browserPlan.relativePaths;
```

The duplicate-matter collision block remains between those two sections.

- [ ] **Step 6: Modify `addFilesToMatter()` planning block**

Inside `addFilesToMatter()`, replace:

```js
const label = validateIntakeLabel(fields.label);
const relativePaths = validateUploadPathList(fields, files, { action: "adding files" });
```

with:

```js
const browserPlan = planBrowserAddFilesUpload({ fields, files });
const { label, relativePaths } = browserPlan;
```

Keep the later `planAddFilesIntake()` call for filesystem allocation, because intake numbering still depends on storage-specific state.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test test/intake-contracts.test.mjs test/browser-upload-adapter.test.mjs test/upload-intake-planner-parity.test.mjs test/upload-api.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add services/upload-service.mjs test/upload-api.test.mjs test/upload-intake-planner-parity.test.mjs
git commit -m "Use intake adapter in upload service"
```

## Task 5: Strengthen Runtime Upload Parity Around The Boundary

**Files:**
- Modify: `test/upload-intake-planner-parity.test.mjs`
- Modify: `services/runtime-db-upload-intake-planner.mjs` only if the new tests require a field that should be part of runtime handoff.

- [ ] **Step 1: Add runtime boundary parity test**

Append this test to `test/upload-intake-planner-parity.test.mjs`:

```js
test("browser adapter and runtime planner preserve candidate path ordering", () => {
  const browser = planBrowserNewMatterUpload({
    fields: {
      name: "Atibir Industries v State Bank of India",
      metadata: JSON.stringify({
        matterName: "Atibir Industries v State Bank of India",
        clientName: "Atibir Industries",
        oppositeParty: "State Bank of India",
      }),
      paths: JSON.stringify(["sbi6.pdf", "sbi5.pdf", "sbi4.pdf"]),
    },
    files: [
      { index: 0, filename: "sbi6.pdf", tempPath: "/tmp/upload-00000", bytes: 6 },
      { index: 1, filename: "sbi5.pdf", tempPath: "/tmp/upload-00001", bytes: 5 },
      { index: 2, filename: "sbi4.pdf", tempPath: "/tmp/upload-00002", bytes: 4 },
    ],
  });

  const runtime = planNewRuntimeMatterUpload({
    name: "Atibir Industries v State Bank of India",
    metadata: browser.metadata,
    files: [
      { index: 0, filename: "sbi6.pdf", tempPath: "/tmp/upload-00000", bytes: 6 },
      { index: 1, filename: "sbi5.pdf", tempPath: "/tmp/upload-00001", bytes: 5 },
      { index: 2, filename: "sbi4.pdf", tempPath: "/tmp/upload-00002", bytes: 4 },
    ],
    relativePaths: browser.relativePaths,
    actor: { id: "tester-user-id" },
    now: new Date("2026-06-23T09:00:00.000Z"),
  });

  assert.deepEqual(
    browser.batch.candidates.map((candidate) => candidate.relativePath),
    runtime.relativePaths,
  );
  assert.deepEqual(runtime.buildIntakeArgs.relativePaths, runtime.relativePaths);
});
```

- [ ] **Step 2: Run the parity tests**

Run:

```bash
node --test test/upload-intake-planner-parity.test.mjs
```

Expected:

```text
# fail 0
```

If this test fails because runtime planning normalizes a path differently, do not patch around the test. Fix the runtime planner to call the same shared validation path as the browser adapter, then rerun the test.

- [ ] **Step 3: Commit Task 5**

Run:

```bash
git add test/upload-intake-planner-parity.test.mjs services/runtime-db-upload-intake-planner.mjs
git commit -m "Prove runtime upload intake boundary parity"
```

If `services/runtime-db-upload-intake-planner.mjs` did not change, run this instead:

```bash
git add test/upload-intake-planner-parity.test.mjs
git commit -m "Prove runtime upload intake boundary parity"
```

## Task 6: Update Contract And Design Docs

**Files:**
- Modify: `docs/contracts/upload-intake-contract.md`
- Modify: `docs/superpowers/specs/2026-06-23-intake-service-boundary-design.md`

- [ ] **Step 1: Update `docs/contracts/upload-intake-contract.md`**

In the `Planner Boundary` section, replace:

```markdown
`shared/upload-intake-planner.mjs` owns the shared upload-intake rules.
```

with:

```markdown
`services/intake/` is the internal intake boundary for source candidates and
browser-upload adapter behavior.

`shared/upload-intake-planner.mjs` still owns the canonical deterministic upload
planning rules used by that boundary.
```

Add this paragraph after the bullet list that begins `Allowed inputs are plain values`:

```markdown
The current browser upload path enters the boundary through
`services/intake/browser-upload-adapter.mjs`. Future source adapters must produce
the same candidate/batch shape before they ask storage-specific code to persist
bytes or allocate source numbers.
```

- [ ] **Step 2: Update the design status**

In `docs/superpowers/specs/2026-06-23-intake-service-boundary-design.md`, replace:

```markdown
Status: Draft design for user review
```

with:

```markdown
Status: Accepted design; Phase 1 implementation planned
```

Add this after the `Branch:` line:

```markdown
Implementation plan: `docs/superpowers/plans/2026-06-23-intake-service-boundary.md`
```

- [ ] **Step 3: Run docs checks**

Run:

```bash
git diff --check
rg -n "T[B]D|F[I]XME|implement [l]ater|fill in [d]etails|Similar to [T]ask" docs/contracts/upload-intake-contract.md docs/superpowers/specs/2026-06-23-intake-service-boundary-design.md
```

Expected:

```text
git diff --check
# no output
rg ...
# no output
```

- [ ] **Step 4: Commit Task 6**

Run:

```bash
git add docs/contracts/upload-intake-contract.md docs/superpowers/specs/2026-06-23-intake-service-boundary-design.md
git commit -m "Document intake service boundary"
```

## Task 7: Full Verification And Branch Closeout

**Files:**
- No new files expected.
- Verify all files touched by Tasks 1-6.

- [ ] **Step 1: Run focused intake/upload tests**

Run:

```bash
node --test \
  test/intake-contracts.test.mjs \
  test/browser-upload-adapter.test.mjs \
  test/upload-intake-planner-parity.test.mjs \
  test/upload-api.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test --silent
npm run ui:typecheck --silent
npm run ui:build --silent
npm run console:build --silent
git diff --check
```

Expected:

```text
npm test --silent
# all tests pass
npm run ui:typecheck --silent
# exits 0
npm run ui:build --silent
# exits 0
npm run console:build --silent
# exits 0
git diff --check
# no output
```

- [ ] **Step 3: Confirm no route or schema changes slipped in**

Run:

```bash
git diff --name-only main...HEAD
git diff main...HEAD -- server.mjs react-ui/src routes db migrations mothership
```

Expected:

```text
git diff --name-only main...HEAD
# only intake/upload/test/docs files from this plan
git diff main...HEAD -- server.mjs react-ui/src routes db migrations mothership
# no output, unless a future task intentionally documented and tested a required import-only change
```

- [ ] **Step 4: Final commit if verification docs were updated**

If no files changed during verification, do not create an empty commit.

If a verification note was added to a docs file, run:

```bash
git add <changed-doc-file>
git commit -m "Record intake boundary verification"
```

- [ ] **Step 5: Report closeout**

Report these facts:

```text
Worktree: /Users/aksingh/matter-workbench-intake-service-boundary
Branch: codex/intake-service-boundary
Behavior changed: no public route or response-shape change
Boundary added: services/intake/
Focused tests: passed
Full tests: passed
UI build: passed
Console build: passed
Next phase: large browser upload hardening, ZIP adapter, or email adapter
```

## Self-Review

### Spec Coverage

- Phase 1 names the boundary through `services/intake/`: Tasks 1-4.
- Current browser upload behavior stays unchanged: Tasks 3-4 plus `test/upload-api.test.mjs`.
- Shared contract types for candidates and batches: Task 1.
- Browser adapter uses current shared planners: Task 2.
- Runtime parity remains guarded: Task 5.
- Docs explain boundary separation: Task 6.
- No ZIP/email/connectors/service split in this plan: Scope and Task 7 route/schema check.

### Placeholder Scan

The plan intentionally avoids open-ended implementation language. Each code-changing step names the exact file, code shape, command, and expected result.

### Type Consistency

The plan uses these stable function and property names consistently:

- `browserUploadCandidatesFromFiles()`
- `browserUploadBatchFromFiles()`
- `planBrowserNewMatterUpload()`
- `planBrowserAddFilesUpload()`
- `parseUploadJsonField()`
- `validateUploadPathList()`
- `schema_version`
- `sourceKind`
- `candidateCount`
- `relativePaths`
