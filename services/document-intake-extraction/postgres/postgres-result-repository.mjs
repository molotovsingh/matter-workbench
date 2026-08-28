import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSIONS,
  PIPELINE_VERSIONS,
  assertExtractionResultContract,
  assertReadyEventContract,
} from "../../../packages/extraction-contracts/index.mjs";
import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

export class PostgresResultRepository {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID(), assemblerVersion = PIPELINE_VERSIONS.assembler } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL result repository requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
    this.assemblerVersion = String(assemblerVersion);
  }

  async publishReadyIntake({ tenantId, intakeId } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const intakeResult = await client.query([
        "select intake_id::text, tenant_id, matter_id, status, expected_file_count, observed_page_count, custody_committed_at, result_id::text",
        "from document_intake_extraction.intakes",
        "where tenant_id = $1 and intake_id = $2::uuid",
        "for update",
      ].join("\n"), [tenantId, intakeId]);
      const intake = intakeResult.rows[0];
      if (!intake) throw repositoryError("intake not found", "intake.not_found");
      if (intake.result_id) {
        return { result: await readResultWithClient(client, tenantId, intake.result_id), event: null, published: false };
      }
      if (!intake.custody_committed_at) return null;
      const rows = await client.query([
        "select f.ordinal, f.file_id::text, f.document_id::text, f.original_name, f.relative_path, f.expected_bytes::text,",
        "       d.source_sha256, d.page_count, d.duplicate_of_document_id::text,",
        "       dp.page_number, pc.computation_id::text, pc.fingerprint, pc.provider, pc.model, pc.adapter_version, pc.routing_policy, pc.validator_version, pc.status as page_status, pc.output_json",
        "from document_intake_extraction.intake_files f",
        "join document_intake_extraction.documents d on d.tenant_id = f.tenant_id and d.document_id = f.document_id",
        "join document_intake_extraction.document_pages dp on dp.tenant_id = d.tenant_id and dp.document_id = d.document_id",
        "join document_intake_extraction.page_computations pc on pc.tenant_id = dp.tenant_id and pc.computation_id = dp.computation_id",
        "where f.tenant_id = $1 and f.intake_id = $2::uuid",
        "order by f.ordinal, dp.page_number",
      ].join("\n"), [tenantId, intakeId]);
      const documents = assembleDocuments(rows.rows);
      if (documents.length !== Number(intake.expected_file_count)) return null;
      if (documents.some((document) => document.pages.length !== document.pageCount)) return null;
      if (documents.some((document) => document.pages.some((page, index) => page.pageNumber !== index + 1))) return null;
      if (documents.some((document) => document.pages.some((page) => !["accepted", "review_required"].includes(page.outcome)))) return null;
      const pageCount = documents.reduce((sum, document) => sum + document.pageCount, 0);
      if (pageCount !== Number(intake.observed_page_count)) return null;
      const reviewPageCount = documents.reduce((sum, document) => sum + document.pages.filter((page) => page.outcome === "review_required").length, 0);
      const now = this.clock().toISOString();
      const resultId = this.idFactory();
      const result = {
        schemaVersion: CONTRACT_VERSIONS.extractionResult,
        resultId,
        intakeId,
        tenantId,
        matterId: intake.matter_id,
        version: 1,
        status: reviewPageCount ? "ready_with_review" : "ready",
        assemblerVersion: this.assemblerVersion,
        custodyCommittedAt: iso(intake.custody_committed_at),
        createdAt: now,
        documentCount: documents.length,
        pageCount,
        reviewPageCount,
        documents,
      };
      assertExtractionResultContract(result);
      const event = {
        schemaVersion: CONTRACT_VERSIONS.event,
        type: "extraction.result.ready",
        eventId: this.idFactory(),
        tenantId,
        matterId: intake.matter_id,
        intakeId,
        resultId,
        resultVersion: result.version,
        resultStatus: result.status,
        documentCount: result.documentCount,
        pageCount: result.pageCount,
        reviewPageCount,
        occurredAt: now,
      };
      assertReadyEventContract(event);
      await client.query([
        "insert into document_intake_extraction.extraction_results",
        "  (result_id, tenant_id, matter_id, intake_id, version, status, assembler_version, document_count, page_count, review_page_count, payload_json, created_at)",
        "values ($1::uuid, $2, $3, $4::uuid, 1, $5, $6, $7::int, $8::int, $9::int, $10::jsonb, $11::timestamptz)",
      ].join("\n"), [
        resultId, tenantId, intake.matter_id, intakeId, result.status, this.assemblerVersion,
        result.documentCount, result.pageCount, result.reviewPageCount, JSON.stringify(result), now,
      ]);
      await client.query([
        "update document_intake_extraction.intakes",
        "set result_id = $3::uuid, status = $4, ready_at = $5::timestamptz",
        "where tenant_id = $1 and intake_id = $2::uuid and result_id is null",
      ].join("\n"), [tenantId, intakeId, resultId, result.status, now]);
      await client.query([
        "insert into document_intake_extraction.outbox_events",
        "  (event_id, tenant_id, matter_id, intake_id, result_id, event_type, schema_version, payload_json, created_at)",
        "values ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, $8::jsonb, $9::timestamptz)",
      ].join("\n"), [event.eventId, tenantId, event.matterId, intakeId, resultId, event.type, event.schemaVersion, JSON.stringify(event), now]);
      return { result, event, published: true };
    });
  }

  async readResult({ tenantId, resultId } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await readResultWithClient(client, tenantId, resultId);
      if (!result) throw repositoryError("extraction result not found", "intake.result_not_found");
      return result;
    });
  }
}

function assembleDocuments(rows) {
  const documents = [];
  let current = null;
  for (const row of rows) {
    if (!current || current.documentId !== row.document_id) {
      current = {
        documentId: row.document_id,
        fileId: row.file_id,
        originalName: row.original_name,
        relativePath: row.relative_path,
        sourceSha256: row.source_sha256,
        sourceBytes: Number(row.expected_bytes),
        duplicateOfDocumentId: row.duplicate_of_document_id || "",
        pageCount: Number(row.page_count),
        pages: [],
      };
      documents.push(current);
    }
    const output = parseObject(row.output_json);
    current.pages.push({
      pageNumber: Number(row.page_number),
      outcome: row.page_status,
      text: String(output.text || ""),
      reviewReasons: Array.isArray(output.reviewReasons) ? output.reviewReasons.map(String) : [],
      provenance: {
        sourceSha256: row.source_sha256,
        fingerprint: row.fingerprint,
        computationId: row.computation_id,
        provider: row.provider,
        model: row.model,
        adapterVersion: row.adapter_version,
        routingPolicy: row.routing_policy,
        validatorVersion: output.validatorVersion || row.validator_version,
        attemptId: output.attemptId || "",
        requestId: output.requestId || "",
      },
    });
  }
  return documents;
}

async function readResultWithClient(client, tenantId, resultId) {
  const result = await client.query([
    "select payload_json from document_intake_extraction.extraction_results",
    "where tenant_id = $1 and result_id = $2::uuid",
  ].join("\n"), [tenantId, resultId]);
  return result.rows[0] ? parseObject(result.rows[0].payload_json) : null;
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
