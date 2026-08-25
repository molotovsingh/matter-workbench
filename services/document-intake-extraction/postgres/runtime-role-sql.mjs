const ROLE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function buildDocumentIntakeExtractionRuntimeRoleSql({ roleName } = {}) {
  const role = quoteRole(roleName);
  return [
    `grant usage on schema document_intake_extraction to ${role};`,
    `grant select, insert, update on document_intake_extraction.source_blobs to ${role};`,
    `grant select, insert, update on document_intake_extraction.intakes to ${role};`,
    `grant select, insert, update on document_intake_extraction.intake_files to ${role};`,
    `grant select, insert, update on document_intake_extraction.blob_tenant_references to ${role};`,
    `grant select, insert, update on document_intake_extraction.documents to ${role};`,
    `grant select, insert, update on document_intake_extraction.page_computations to ${role};`,
    `grant select, insert, update on document_intake_extraction.document_pages to ${role};`,
    `grant select, insert, update on document_intake_extraction.computation_demands to ${role};`,
    `grant select, insert on document_intake_extraction.computation_supersessions to ${role};`,
    `grant select, insert, update on document_intake_extraction.provider_attempts to ${role};`,
    `grant select, insert on document_intake_extraction.cost_events to ${role};`,
    `grant select, insert on document_intake_extraction.extraction_results to ${role};`,
    `grant select, insert, update on document_intake_extraction.outbox_events to ${role};`,
    `grant select, insert on document_intake_extraction.capacity_observations to ${role};`,
    `grant execute on function document_intake_extraction.current_tenant_id() to ${role};`,
    `grant execute on function document_intake_extraction.expire_page_leases() to ${role};`,
    `grant execute on function document_intake_extraction.claim_page_work(text, integer) to ${role};`,
    `grant execute on function document_intake_extraction.claim_document_local_page_work(text, integer, integer) to ${role};`,
    `grant execute on function document_intake_extraction.renew_page_lease(uuid, uuid, integer) to ${role};`,
  ].join("\n");
}

export function buildDocumentIntakeExtractionReadRoleSql({ roleName } = {}) {
  const role = quoteRole(roleName);
  return [
    `grant usage on schema document_intake_extraction to ${role};`,
    `grant select on document_intake_extraction.intakes to ${role};`,
    `grant select on document_intake_extraction.intake_files to ${role};`,
    `grant select on document_intake_extraction.documents to ${role};`,
    `grant select on document_intake_extraction.document_pages to ${role};`,
    `grant select on document_intake_extraction.computation_supersessions to ${role};`,
    `grant select on document_intake_extraction.extraction_results to ${role};`,
    `grant execute on function document_intake_extraction.current_tenant_id() to ${role};`,
  ].join("\n");
}

function quoteRole(value) {
  const normalized = String(value || "").trim();
  if (!ROLE_IDENTIFIER.test(normalized)) {
    const error = new Error("V4 database role name must be a lowercase PostgreSQL identifier");
    error.code = "v4_postgres.role_invalid";
    throw error;
  }
  return `"${normalized}"`;
}
