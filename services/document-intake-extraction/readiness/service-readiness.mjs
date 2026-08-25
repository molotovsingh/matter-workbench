export const REQUIRED_V4_MIGRATIONS = Object.freeze([
  "001_control_plane.sql",
  "002_document_local_claims.sql",
  "003_selective_repair_lineage.sql",
  "004_capacity_outcomes.sql",
  "005_worker_capacity_requests.sql",
  "006_intake_workload_class.sql",
  "007_append_only_audit.sql",
]);

export function createDocumentIntakeExtractionReadinessCheck({
  pool,
  objectStore,
  providerCertification = null,
  requireProviderCertification = true,
  requiredMigrations = REQUIRED_V4_MIGRATIONS,
} = {}) {
  if (!pool?.connect) throw new Error("readiness check requires a PostgreSQL pool");
  if (!objectStore?.checkHealth) throw new Error("readiness check requires objectStore.checkHealth");
  return async function checkReadiness() {
    const reasons = [];
    let client;
    try {
      client = await pool.connect();
      await client.query("select 1 as ready");
      const migrations = await client.query([
        "select migration_name from document_intake_extraction.schema_migrations",
        "where migration_name = any($1::text[])",
      ].join("\n"), [requiredMigrations]);
      const applied = new Set(migrations.rows.map((row) => row.migration_name));
      if (requiredMigrations.some((migration) => !applied.has(migration))) reasons.push("database_migrations_incomplete");
    } catch {
      reasons.push("database_unavailable");
    } finally {
      client?.release?.();
    }
    try {
      const storage = await objectStore.checkHealth();
      if (storage?.available !== true) reasons.push("object_storage_unavailable");
    } catch {
      reasons.push("object_storage_unavailable");
    }
    if (requireProviderCertification && providerCertification?.certified !== true) reasons.push("provider_capacity_uncertified");
    return { ready: reasons.length === 0, reasons };
  };
}
