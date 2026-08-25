import { createHash, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSIONS,
  SERVICE_LIMITS,
  assertPinnedProviderCapability,
  assertSha256,
  canonicalJson,
  validateCreateIntakeCommand,
} from "../../../packages/extraction-contracts/index.mjs";
import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

export class PostgresIntakeRepository {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL intake repository requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async createIntake(input = {}) {
    const command = validateCreateIntakeCommand(input);
    const requestFingerprint = fingerprintCommand(command);
    return withDocumentIntakeExtractionTenant(this.pool, command.tenantId, async (client) => {
      const intakeId = this.idFactory();
      const inserted = await client.query([
        "insert into document_intake_extraction.intakes",
        "  (intake_id, tenant_id, matter_id, idempotency_key, request_fingerprint, client_request_id, workload_class, status, expected_file_count, expected_bytes)",
        "values ($1::uuid, $2, $3, $4, $5, nullif($6, ''), $7, 'awaiting_upload', $8::int, $9::bigint)",
        "on conflict (tenant_id, idempotency_key) do nothing",
        "returning intake_id::text",
      ].join("\n"), [
        intakeId,
        command.tenantId,
        command.matterId,
        command.idempotencyKey,
        requestFingerprint,
        command.clientRequestId,
        command.workloadClass,
        command.files.length,
        command.expectedBytes,
      ]);
      const created = Boolean(inserted.rows[0]);
      const effectiveIntakeId = created
        ? inserted.rows[0].intake_id
        : (await client.query([
          "select intake_id::text, request_fingerprint",
          "from document_intake_extraction.intakes",
          "where tenant_id = $1 and idempotency_key = $2",
          "for update",
        ].join("\n"), [command.tenantId, command.idempotencyKey])).rows[0]?.intake_id;
      if (!effectiveIntakeId) throw repositoryError("idempotent intake lookup failed", "v4_postgres.intake_create_failed");
      if (!created) {
        const existing = await client.query([
          "select request_fingerprint from document_intake_extraction.intakes",
          "where tenant_id = $1 and intake_id = $2::uuid",
        ].join("\n"), [command.tenantId, effectiveIntakeId]);
        if (existing.rows[0]?.request_fingerprint !== requestFingerprint) {
          throw repositoryError("idempotency key was already used for a different intake manifest", "v4_postgres.idempotency_conflict");
        }
      } else {
        for (let ordinal = 0; ordinal < command.files.length; ordinal += 1) {
          const file = command.files[ordinal];
          await client.query([
            "insert into document_intake_extraction.intake_files",
            "  (file_id, tenant_id, intake_id, document_id, ordinal, client_file_id, original_name, relative_path, mime_type, expected_bytes, status)",
            "values ($1::uuid, $2, $3::uuid, $4::uuid, $5::int, nullif($6, ''), $7, $8, $9, $10::bigint, 'awaiting_upload')",
          ].join("\n"), [
            this.idFactory(), command.tenantId, effectiveIntakeId, this.idFactory(), ordinal,
            file.clientFileId, file.originalName, file.relativePath, file.mimeType, file.expectedBytes,
          ]);
        }
      }
      const intake = await readIntakeWithClient(client, command.tenantId, effectiveIntakeId);
      return { ...intake, idempotent: !created };
    });
  }

  async readIntake({ tenantId, intakeId } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const intake = await readIntakeWithClient(client, tenantId, intakeId);
      if (!intake) throw repositoryError("intake not found", "intake.not_found");
      return intake;
    });
  }

  async readProgressSnapshot({ tenantId, intakeId } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const intake = await readIntakeWithClient(client, tenantId, intakeId);
      if (!intake) throw repositoryError("intake not found", "intake.not_found");
      const work = await client.query([
        "select pc.status, pc.provider, pc.model, pc.adapter_version, count(*)::int as computations, coalesce(sum(pc.weight), 0)::text as weight",
        "from document_intake_extraction.computation_demands cd",
        "join document_intake_extraction.page_computations pc on pc.tenant_id = cd.tenant_id and pc.computation_id = cd.computation_id",
        "where cd.tenant_id = $1 and cd.intake_id = $2::uuid",
        "group by pc.status, pc.provider, pc.model, pc.adapter_version",
        "order by pc.provider, pc.model, pc.status",
      ].join("\n"), [tenantId, intakeId]);
      const queue = await client.query([
        "select coalesce(sum(pending.weight), 0)::text as weighted_page_operations",
        "from (",
        "  select distinct pc.computation_id, pc.weight",
        "  from document_intake_extraction.computation_demands cd",
        "  join document_intake_extraction.page_computations pc on pc.tenant_id = cd.tenant_id and pc.computation_id = cd.computation_id",
        "  where cd.tenant_id = $1 and cd.intake_id <> $2::uuid and cd.fulfilled_at is null and pc.status in ('queued', 'running')",
        ") pending",
      ].join("\n"), [tenantId, intakeId]);
      return {
        intake,
        work: work.rows.map((row) => ({
          status: row.status,
          provider: row.provider,
          model: row.model,
          adapterVersion: row.adapter_version,
          computations: Number(row.computations),
          weight: Number(row.weight),
        })),
        queueWeightedPageOperations: Number(queue.rows[0]?.weighted_page_operations || 0),
      };
    });
  }

  async commitBatchCustody({ tenantId, intakeId } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const locked = await client.query([
        "select intake_id::text, status, expected_file_count, committed_file_count, custody_committed_at",
        "from document_intake_extraction.intakes",
        "where tenant_id = $1 and intake_id = $2::uuid",
        "for update",
      ].join("\n"), [tenantId, intakeId]);
      const row = locked.rows[0];
      if (!row) throw repositoryError("intake not found", "intake.not_found");
      if (Number(row.committed_file_count) !== Number(row.expected_file_count)) {
        throw repositoryError("not every intake file has reached durable custody", "intake.files_incomplete");
      }
      if (!row.custody_committed_at) {
        await client.query([
          "update document_intake_extraction.intakes",
          "set status = 'processing', custody_committed_at = $3::timestamptz",
          "where tenant_id = $1 and intake_id = $2::uuid",
        ].join("\n"), [tenantId, intakeId, this.clock().toISOString()]);
      }
      return readIntakeWithClient(client, tenantId, intakeId);
    });
  }

  async recordInspectedDocument({
    tenantId,
    intakeId,
    fileId,
    sourceSha256,
    pageCount,
    inspectorVersion,
    pages,
  } = {}) {
    const sha256 = assertSha256(sourceSha256, "sourceSha256");
    const count = boundedInteger(pageCount, "pageCount", 1, SERVICE_LIMITS.maximumPages);
    if (!Array.isArray(pages) || pages.length !== count) throw new Error("pages must contain one routed computation per source page");
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const intakeResult = await client.query([
        "select intake_id::text, observed_page_count",
        "from document_intake_extraction.intakes",
        "where tenant_id = $1 and intake_id = $2::uuid",
        "for update",
      ].join("\n"), [tenantId, intakeId]);
      if (!intakeResult.rows[0]) throw repositoryError("intake not found", "intake.not_found");
      const fileResult = await client.query([
        "select document_id::text, original_name, relative_path, expected_bytes::text, source_sha256, status",
        "from document_intake_extraction.intake_files",
        "where tenant_id = $1 and intake_id = $2::uuid and file_id = $3::uuid",
        "for update",
      ].join("\n"), [tenantId, intakeId, fileId]);
      const file = fileResult.rows[0];
      if (!file) throw repositoryError("intake file not found", "intake.file_not_found");
      if (file.status !== "committed" || file.source_sha256 !== sha256) {
        throw repositoryError("document inspection requires matching verified custody", "v4_postgres.custody_required");
      }
      const existingDocument = await client.query([
        "select document_id::text, page_count",
        "from document_intake_extraction.documents",
        "where tenant_id = $1 and document_id = $2::uuid",
      ].join("\n"), [tenantId, file.document_id]);
      if (existingDocument.rows[0]) {
        if (Number(existingDocument.rows[0].page_count) !== count) throw repositoryError("document inspection replay changed page count", "v4_postgres.inspection_conflict");
        return readDocumentWithClient(client, tenantId, file.document_id);
      }
      const projectedPages = Number(intakeResult.rows[0].observed_page_count) + count;
      if (projectedPages > SERVICE_LIMITS.maximumPages) throw repositoryError("intake exceeds page envelope", "intake.page_limit_exceeded");
      const blobUpdated = await client.query([
        "update document_intake_extraction.source_blobs",
        "set page_count = coalesce(page_count, $2::int), inspector_version = coalesce(inspector_version, $3)",
        "where sha256 = $1 and integrity_status = 'verified' and (page_count is null or page_count = $2::int)",
        "returning sha256",
      ].join("\n"), [sha256, count, inspectorVersion]);
      if (!blobUpdated.rows[0]) throw repositoryError("verified blob inspection metadata conflicts", "v4_postgres.inspection_conflict");
      const duplicate = await client.query([
        "select document_id::text",
        "from document_intake_extraction.documents",
        "where tenant_id = $1 and source_sha256 = $2 and document_id <> $3::uuid",
        "order by created_at, document_id limit 1",
      ].join("\n"), [tenantId, sha256, file.document_id]);
      await client.query([
        "insert into document_intake_extraction.documents",
        "  (document_id, tenant_id, intake_id, file_id, source_sha256, page_count, inspector_version, duplicate_of_document_id)",
        "values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::int, $7, $8::uuid)",
      ].join("\n"), [file.document_id, tenantId, intakeId, fileId, sha256, count, inspectorVersion, duplicate.rows[0]?.document_id || null]);

      for (let index = 0; index < pages.length; index += 1) {
        const page = normalizeRoutedPage(pages[index], index + 1);
        let computation = await client.query([
          "insert into document_intake_extraction.page_computations",
          "  (computation_id, tenant_id, fingerprint, source_sha256, page_number, provider, model, adapter_version, routing_policy, validator_version, status, priority, weight)",
          "values ($1::uuid, $2, $3, $4, $5::int, $6, $7, $8, $9, $10, 'queued', $11::int, $12::numeric)",
          "on conflict (tenant_id, fingerprint) do nothing",
          "returning computation_id::text, provider, model, adapter_version, page_number",
        ].join("\n"), [
          this.idFactory(), tenantId, page.fingerprint, sha256, page.pageNumber,
          page.capability.provider, page.capability.model, page.capability.adapterVersion,
          page.routingPolicy, page.validatorVersion, page.priority, page.weight,
        ]);
        if (!computation.rows[0]) {
          computation = await client.query([
            "select computation_id::text, provider, model, adapter_version, page_number",
            "from document_intake_extraction.page_computations",
            "where tenant_id = $1 and fingerprint = $2",
          ].join("\n"), [tenantId, page.fingerprint]);
        }
        const computationRow = computation.rows[0];
        if (!computationRow
          || Number(computationRow.page_number) !== page.pageNumber
          || computationRow.provider !== page.capability.provider
          || computationRow.model !== page.capability.model
          || computationRow.adapter_version !== page.capability.adapterVersion) {
          throw repositoryError("page computation fingerprint collision", "v4_postgres.fingerprint_conflict");
        }
        // A reused computation may have been superseded by selective repair
        // (possibly more than once). Bind this intake's page and demand to the
        // lineage tip so a re-upload inherits repaired text and pending
        // repairs, never a stale terminal review outcome.
        const lineage = await client.query([
          "with recursive lineage (computation_id, depth) as (",
          "  select $2::uuid, 0",
          "  union all",
          "  select cs.replacement_computation_id, lineage.depth + 1",
          "  from document_intake_extraction.computation_supersessions cs",
          "  join lineage on cs.prior_computation_id = lineage.computation_id",
          "  where cs.tenant_id = $1 and lineage.depth < 16",
          ")",
          "select pc.computation_id::text, pc.status",
          "from lineage",
          "join document_intake_extraction.page_computations pc",
          "  on pc.tenant_id = $1 and pc.computation_id = lineage.computation_id",
          "order by lineage.depth desc",
          "limit 1",
        ].join("\n"), [tenantId, computationRow.computation_id]);
        const tip = lineage.rows[0];
        if (!tip) throw repositoryError("page computation lineage could not be resolved", "v4_postgres.lineage_unresolved");
        await client.query([
          "insert into document_intake_extraction.document_pages (tenant_id, document_id, page_number, computation_id)",
          "values ($1, $2::uuid, $3::int, $4::uuid)",
          "on conflict (tenant_id, document_id, page_number) do nothing",
        ].join("\n"), [tenantId, file.document_id, page.pageNumber, tip.computation_id]);
        await client.query([
          "insert into document_intake_extraction.computation_demands",
          "  (tenant_id, intake_id, computation_id, priority, virtual_finish, fulfilled_at)",
          "values ($1, $2::uuid, $3::uuid, $4::int, $5::numeric, case when $6::boolean then now() else null end)",
          "on conflict (tenant_id, intake_id, computation_id) do nothing",
        ].join("\n"), [
          tenantId, intakeId, tip.computation_id, page.priority, page.virtualFinish,
          ["accepted", "review_required"].includes(tip.status),
        ]);
      }
      await client.query([
        "update document_intake_extraction.intakes",
        "set observed_page_count = observed_page_count + $3::int",
        "where tenant_id = $1 and intake_id = $2::uuid",
      ].join("\n"), [tenantId, intakeId, count]);
      return readDocumentWithClient(client, tenantId, file.document_id);
    });
  }
}

async function readIntakeWithClient(client, tenantId, intakeId) {
  const result = await client.query([
    "select intake_id::text, tenant_id, matter_id, idempotency_key, request_fingerprint, client_request_id, workload_class, status, expected_file_count, expected_bytes::text, committed_file_count, committed_bytes::text, observed_page_count, custody_committed_at, ready_at, result_id::text, created_at, updated_at",
    "from document_intake_extraction.intakes",
    "where tenant_id = $1 and intake_id = $2::uuid",
  ].join("\n"), [tenantId, intakeId]);
  if (!result.rows[0]) return null;
  const files = await client.query([
    "select file_id::text, document_id::text, ordinal, client_file_id, original_name, relative_path, mime_type, expected_bytes::text, status, source_sha256, custody_receipt_json, committed_at",
    "from document_intake_extraction.intake_files",
    "where tenant_id = $1 and intake_id = $2::uuid",
    "order by ordinal",
  ].join("\n"), [tenantId, intakeId]);
  const row = result.rows[0];
  return {
    schemaVersion: CONTRACT_VERSIONS.intake,
    intakeId: row.intake_id,
    tenantId: row.tenant_id,
    matterId: row.matter_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    clientRequestId: row.client_request_id || "",
    workloadClass: row.workload_class,
    status: row.status,
    expectedFileCount: Number(row.expected_file_count),
    expectedBytes: Number(row.expected_bytes),
    committedFileCount: Number(row.committed_file_count),
    committedBytes: Number(row.committed_bytes),
    observedPageCount: Number(row.observed_page_count),
    custodyCommittedAt: iso(row.custody_committed_at),
    readyAt: iso(row.ready_at),
    resultId: row.result_id || "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    files: files.rows.map((file) => ({
      fileId: file.file_id,
      documentId: file.document_id,
      ordinal: Number(file.ordinal),
      clientFileId: file.client_file_id || "",
      originalName: file.original_name,
      relativePath: file.relative_path,
      mimeType: file.mime_type,
      expectedBytes: Number(file.expected_bytes),
      status: file.status,
      sourceSha256: file.source_sha256 || "",
      custodyReceipt: parseObject(file.custody_receipt_json),
      committedAt: iso(file.committed_at),
    })),
  };
}

async function readDocumentWithClient(client, tenantId, documentId) {
  const result = await client.query([
    "select d.document_id::text, d.intake_id::text, d.file_id::text, d.source_sha256, d.page_count, d.inspector_version, d.duplicate_of_document_id::text,",
    "       coalesce(jsonb_agg(jsonb_build_object('pageNumber', dp.page_number, 'computationId', dp.computation_id::text, 'fingerprint', pc.fingerprint, 'status', pc.status) order by dp.page_number) filter (where dp.page_number is not null), '[]'::jsonb) as pages",
    "from document_intake_extraction.documents d",
    "left join document_intake_extraction.document_pages dp on dp.tenant_id = d.tenant_id and dp.document_id = d.document_id",
    "left join document_intake_extraction.page_computations pc on pc.tenant_id = dp.tenant_id and pc.computation_id = dp.computation_id",
    "where d.tenant_id = $1 and d.document_id = $2::uuid",
    "group by d.document_id, d.intake_id, d.file_id, d.source_sha256, d.page_count, d.inspector_version, d.duplicate_of_document_id",
  ].join("\n"), [tenantId, documentId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    documentId: row.document_id,
    intakeId: row.intake_id,
    fileId: row.file_id,
    sourceSha256: row.source_sha256,
    pageCount: Number(row.page_count),
    inspectorVersion: row.inspector_version,
    duplicateOfDocumentId: row.duplicate_of_document_id || "",
    pages: Array.isArray(row.pages) ? row.pages : JSON.parse(row.pages || "[]"),
  };
}

function normalizeRoutedPage(page, expectedPageNumber) {
  const pageNumber = boundedInteger(page.pageNumber, "page.pageNumber", 1, SERVICE_LIMITS.maximumPages);
  if (pageNumber !== expectedPageNumber) throw new Error(`pages must be ordered and complete; expected page ${expectedPageNumber}`);
  return {
    pageNumber,
    fingerprint: assertSha256(page.fingerprint, "page.fingerprint"),
    capability: assertPinnedProviderCapability(page.capability),
    routingPolicy: required(page.routingPolicy, "page.routingPolicy"),
    validatorVersion: required(page.validatorVersion, "page.validatorVersion"),
    priority: Math.max(-100, Math.min(100, Math.trunc(Number(page.priority) || 0))),
    weight: positiveNumber(page.weight, "page.weight", 1),
    virtualFinish: nonNegativeNumber(page.virtualFinish, "page.virtualFinish", 0),
  };
}

function fingerprintCommand(command) {
  return createHash("sha256").update(canonicalJson({
    tenantId: command.tenantId,
    matterId: command.matterId,
    files: command.files,
    expectedBytes: command.expectedBytes,
  })).digest("hex");
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function positiveNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function nonNegativeNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function iso(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
