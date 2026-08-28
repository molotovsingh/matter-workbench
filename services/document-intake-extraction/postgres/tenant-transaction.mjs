export async function withDocumentIntakeExtractionTenant(pool, tenantId, operation) {
  if (!pool?.connect) throw new Error("V4 PostgreSQL tenant transaction requires a pool");
  if (typeof operation !== "function") throw new Error("V4 PostgreSQL tenant transaction requires an operation");
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId || normalizedTenantId.length > 200 || /[\u0000-\u001f\u007f]/.test(normalizedTenantId)) {
    const error = new Error("V4 tenant identifier is invalid");
    error.code = "v4_postgres.tenant_invalid";
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('document_intake_extraction.tenant_id', $1, true)", [normalizedTenantId]);
    const result = await operation(client, normalizedTenantId);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original operation failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
