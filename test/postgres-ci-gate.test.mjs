import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/quality-gates.yml", import.meta.url);

test("quality pipeline runs the disposable real-PostgreSQL integration gate", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /image:\s*postgres:16/);
  assert.match(workflow, /MWB_POSTGRES_TEST_ADMIN_URL:\s*postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/postgres/);
  assert.match(workflow, /- run:\s*npm run test:postgres/);
  assert.match(workflow, /- run:\s*npm test/);
  assert.match(workflow, /- run:\s*npm run ui:build/);
});
