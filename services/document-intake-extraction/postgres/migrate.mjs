import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;
const DEFAULT_MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const ADVISORY_LOCK_KEY = "442019840241";

export async function runDocumentIntakeExtractionMigrations({ pool, migrationsDirectory = DEFAULT_MIGRATIONS } = {}) {
  if (!pool?.connect) throw new Error("V4 PostgreSQL migration runner requires a pool");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint)`);
    await client.query("create schema if not exists document_intake_extraction");
    await client.query([
      "create table if not exists document_intake_extraction.schema_migrations (",
      "  migration_name text primary key,",
      "  sha256 char(64) not null check (sha256 ~ '^[a-f0-9]{64}$'),",
      "  applied_at timestamptz not null default now()",
      ")",
    ].join("\n"));
    const appliedRows = await client.query("select migration_name, sha256 from document_intake_extraction.schema_migrations order by migration_name");
    const applied = new Map(appliedRows.rows.map((row) => [row.migration_name, String(row.sha256)]));
    const migrationNames = (await readdir(migrationsDirectory)).filter((name) => MIGRATION_NAME.test(name)).sort();
    const completed = [];
    for (const migrationName of migrationNames) {
      const sql = await readFile(path.join(migrationsDirectory, migrationName), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      if (applied.has(migrationName)) {
        if (applied.get(migrationName) !== sha256) {
          const error = new Error(`V4 migration checksum changed after application: ${migrationName}`);
          error.code = "v4_migration.checksum_mismatch";
          throw error;
        }
        completed.push({ migrationName, sha256, status: "already_applied" });
        continue;
      }
      await client.query(sql);
      await client.query(
        "insert into document_intake_extraction.schema_migrations (migration_name, sha256) values ($1, $2)",
        [migrationName, sha256],
      );
      completed.push({ migrationName, sha256, status: "applied" });
    }
    await client.query("commit");
    return { schemaVersion: "document-intake-extraction.postgres-migration-result/v1", migrations: completed };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
