import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CLOSED_PRIVATE_BETA_SIGNAL_STATUSES,
  PRIVATE_BETA_SIGNAL_STATUSES,
  normalizePrivateBetaSignalStatus,
  shouldReopenPrivateBetaSignalOnRecurrence,
} from "../shared/private-beta-signal-lifecycle.mjs";

const migrationUrl = new URL("../mothership/db/migrations/004_signal_lifecycle.sql", import.meta.url);

test("private beta signal lifecycle has one JS vocabulary and SQL parity", async () => {
  assert.deepEqual(PRIVATE_BETA_SIGNAL_STATUSES, ["active", "resolved", "superseded", "suppressed"]);
  assert.deepEqual([...CLOSED_PRIVATE_BETA_SIGNAL_STATUSES], ["resolved", "superseded", "suppressed"]);
  assert.equal(normalizePrivateBetaSignalStatus(" RESOLVED "), "resolved");
  assert.equal(normalizePrivateBetaSignalStatus("unknown"), "active");

  const migration = await readFile(migrationUrl, "utf8");
  for (const status of PRIVATE_BETA_SIGNAL_STATUSES) assert.match(migration, new RegExp(`'${status}'`, "i"));
});

test("private beta signal recurrence policy reopens live signals without reviving stale jobs or suppression", () => {
  assert.equal(shouldReopenPrivateBetaSignalOnRecurrence({ status: "resolved", source: "client_event" }), true);
  assert.equal(shouldReopenPrivateBetaSignalOnRecurrence({ status: "superseded", source: "matter_attention" }), true);
  assert.equal(shouldReopenPrivateBetaSignalOnRecurrence({ status: "resolved", source: "job_status" }), false);
  assert.equal(shouldReopenPrivateBetaSignalOnRecurrence({ status: "suppressed", source: "client_event" }), false);
});
