# Full Runtime DB Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Matter Workbench capable of running active matter read surfaces from Postgres-backed runtime state and DB-held payload custody, so matter folders are no longer the live source of truth for matter selection, workspace tree, file previews, and raw file delivery.

**Architecture:** Keep the existing React and API contracts stable while replacing the live storage adapter behind them. Postgres owns tenant-scoped matter rows, storage object rows, and runtime payload bytes in a local/private `storage_object_payloads` table; filesystem folders remain an import source and emergency export path, not the runtime authority when DB storage mode is enabled.

**Tech Stack:** Node ESM services, built-in `node:test`, Postgres migrations with RLS, `psql` CLI adapters, React/Vite for final browser verification.

---

## Success Criteria

- `/api/matters` and `/api/switch-matter` read active matter identity from Postgres in runtime DB mode.
- `/api/workspace`, `/api/file`, and `/api/file-raw` can serve a matter from Postgres storage payloads even if the corresponding local matter folder is absent.
- DB storage mode fails closed when a requested object has metadata but no payload row.
- Local hydration can copy filesystem bytes into Postgres payload custody without changing the existing storage object metadata contract.
- The old hybrid mode remains available unless `MWB_RUNTIME_DB_STORAGE=postgres` is explicitly enabled.
- Verification passes: focused runtime DB tests, `npm test --silent`, `npm run ui:typecheck --silent`, `npm run ui:build --silent`, live VM DB smoke.

## File Structure

- Create `db/migrations/015_storage_object_payloads.sql` for tenant-scoped byte custody linked to `storage_objects`.
- Create `test/database-storage-payloads-migration.test.mjs` for structural migration coverage.
- Modify `scripts/db-hydrate-local-storage.mjs` to optionally collect and write DB payload rows.
- Modify `test/db-hydrate-local-storage.test.mjs` for payload hydration SQL and package scripts.
- Create `services/runtime-db-storage-service.mjs` for workspace tree, text preview, and raw payload reads from Postgres.
- Create `test/runtime-db-storage-service.test.mjs` for service behavior using stubbed `spawn`.
- Modify `services/runtime-db-matter-index.mjs` to expose `storageMode`.
- Modify `services/matter-store.mjs` to support virtual DB-backed active matter roots in DB storage mode.
- Modify `services/workspace-service.mjs` or server wiring so workspace/file APIs use the DB storage service when enabled.
- Modify `routes/app-shell-routes.mjs` as needed to pass matter names instead of only filesystem roots.
- Modify `server.mjs` to create and inject the runtime DB storage service.
- Modify `test/runtime-db-api.test.mjs` and `test/runtime-db-matter-store.test.mjs` for folder-missing DB runtime acceptance.
- Modify `package.json` to add payload hydration and full DB smoke commands.
- Update `FOR_AKSINGH.md` and the DB transition docs after implementation.

## Tasks

### Task 1: Add DB Payload Custody Schema

**Files:**
- Create: `db/migrations/015_storage_object_payloads.sql`
- Create: `test/database-storage-payloads-migration.test.mjs`

- [ ] **Step 1: Write failing migration tests**

Run: `node --test test/database-storage-payloads-migration.test.mjs`

Expected: FAIL because migration `015_storage_object_payloads.sql` does not exist.

- [ ] **Step 2: Add migration**

Create `storage_object_payloads` with `tenant_id`, `storage_object_id`, optional `matter_id`, `payload bytea`, `sha256`, `size_bytes`, timestamps, `(tenant_id, storage_object_id)` uniqueness, tenant FK links, RLS, and payload hash/size checks.

- [ ] **Step 3: Verify focused migration test**

Run: `node --test test/database-storage-payloads-migration.test.mjs`

Expected: PASS.

### Task 2: Hydrate Local File Bytes Into DB Payload Rows

**Files:**
- Modify: `scripts/db-hydrate-local-storage.mjs`
- Modify: `test/db-hydrate-local-storage.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for payload hydration**

Add tests proving `--include-payloads` plans payload rows, writes `decode(..., 'hex')` SQL into `storage_object_payloads`, verifies payload counts, and exposes scripts `db:storage:payloads:*`.

Run: `node --test test/db-hydrate-local-storage.test.mjs`

Expected: FAIL because payload collection is missing.

- [ ] **Step 2: Implement payload collection and SQL**

Read bytes from known local object paths, compute `sha256`/size, include payload rows only when requested, and preserve existing metadata-only behavior by default.

- [ ] **Step 3: Verify focused tests**

Run: `node --test test/db-hydrate-local-storage.test.mjs`

Expected: PASS.

### Task 3: Add Runtime DB Storage Adapter

**Files:**
- Create: `services/runtime-db-storage-service.mjs`
- Create: `test/runtime-db-storage-service.test.mjs`

- [ ] **Step 1: Write failing service tests**

Cover tree building from `storage_objects`, text preview from payload bytes, raw file response with content type/size, tenant scoping SQL, and fail-closed missing payload behavior.

Run: `node --test test/runtime-db-storage-service.test.mjs`

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement service**

Use `psqlConnectionArgs`, query JSON from Postgres, decode base64 payload output, reuse existing preview extension and raw content-type semantics, and reject hidden/unsafe paths.

- [ ] **Step 3: Verify focused tests**

Run: `node --test test/runtime-db-storage-service.test.mjs`

Expected: PASS.

### Task 4: Wire Matter Store And API Routes To DB Storage Mode

**Files:**
- Modify: `services/runtime-db-matter-index.mjs`
- Modify: `services/matter-store.mjs`
- Modify: `server.mjs`
- Modify: `routes/app-shell-routes.mjs`
- Modify: `test/runtime-db-matter-store.test.mjs`
- Modify: `test/runtime-db-api.test.mjs`

- [ ] **Step 1: Write failing tests for folderless DB runtime**

Prove `MWB_RUNTIME_DB_STORAGE=postgres` lets a DB-listed matter switch without a local folder and that `/api/switch-matter`, `/api/workspace`, `/api/file`, and `/api/file-raw` are served by the DB storage adapter.

Run: `node --test test/runtime-db-matter-store.test.mjs test/runtime-db-api.test.mjs`

Expected: FAIL because matter store currently requires a local storage folder.

- [ ] **Step 2: Implement storage mode switch**

Expose `storageMode`, set virtual active matter state for DB storage mode, and route read APIs through the DB storage adapter while leaving upload/preparation/write routes in existing filesystem mode until their DB job slice lands.

- [ ] **Step 3: Verify focused tests**

Run: `node --test test/runtime-db-matter-store.test.mjs test/runtime-db-api.test.mjs`

Expected: PASS.

### Task 5: Live VM DB Verification

**Files:**
- Modify: `scripts/db-runtime-smoke.mjs`
- Modify: `package.json`
- Update: `FOR_AKSINGH.md`

- [ ] **Step 1: Add full DB runtime smoke assertion**

The smoke should prove `runtime_db_storage: postgres`, payload rows exist, and workspace/file APIs work without relying on local matter folders.

- [ ] **Step 2: Apply migrations and payload hydration against the VM DB**

Run the migration, hydrate metadata plus payloads, and inspect counts. Do not print credentials.

- [ ] **Step 3: Run full verification**

Run focused tests, full tests, typecheck, build, and VM runtime smoke.

Expected: all pass.

## Self-Review

- Spec coverage: The plan covers schema, hydration, runtime adapter, route wiring, and live DB smoke. It does not migrate long-running preparation engines into DB jobs in this slice; that remains the next write-side DB slice after read-side runtime custody is proven.
- Placeholder scan: No `TBD`, `TODO`, or unbounded “add tests” instructions remain.
- Type consistency: The runtime storage flag is consistently named `MWB_RUNTIME_DB_STORAGE=postgres`, and the payload table is consistently named `storage_object_payloads`.
