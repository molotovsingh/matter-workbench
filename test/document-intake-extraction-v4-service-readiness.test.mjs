import assert from "node:assert/strict";
import test from "node:test";

import {
  createDocumentIntakeExtractionReadinessCheck,
  REQUIRED_V4_MIGRATIONS,
} from "../services/document-intake-extraction/readiness/service-readiness.mjs";

// V4-API-001 operational readiness evidence
test("service readiness requires database migrations, regional object storage, and certified provider capacity", async () => {
  const check = createDocumentIntakeExtractionReadinessCheck({
    pool: fakePool(REQUIRED_V4_MIGRATIONS),
    objectStore: { checkHealth: async () => ({ available: true, dataRegion: "ap-southeast-2" }) },
    providerCertification: { certified: true },
  });
  assert.deepEqual(await check(), { ready: true, reasons: [] });
});

test("service readiness fails closed with sanitized reasons and can relax provider certification only for isolated development", async () => {
  const unavailable = createDocumentIntakeExtractionReadinessCheck({
    pool: fakePool(REQUIRED_V4_MIGRATIONS.slice(0, -1)),
    objectStore: { checkHealth: async () => { throw new Error("bucket credential=secret"); } },
    providerCertification: { certified: false },
  });
  const result = await unavailable();
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ["database_migrations_incomplete", "object_storage_unavailable", "provider_capacity_uncertified"]);
  assert.doesNotMatch(JSON.stringify(result), /credential|secret|bucket/i);

  const development = createDocumentIntakeExtractionReadinessCheck({
    pool: fakePool(REQUIRED_V4_MIGRATIONS),
    objectStore: { checkHealth: async () => ({ available: true }) },
    requireProviderCertification: false,
  });
  assert.equal((await development()).ready, true);
});

function fakePool(migrations) {
  return {
    async connect() {
      return {
        async query(sql) {
          if (/schema_migrations/.test(sql)) return { rows: migrations.map((migration_name) => ({ migration_name })) };
          return { rows: [{ ready: 1 }] };
        },
        release() {},
      };
    },
  };
}
