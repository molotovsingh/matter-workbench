import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMatterEventsService, normalizeMatterEvent } from "../services/matter-events-service.mjs";


test("local matter events service appends idempotent JSONL events", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-matter-events-"));
  const eventsPath = path.join(tmp, "matter-events.jsonl");
  const service = createMatterEventsService({
    eventsPath,
    now: () => new Date("2026-06-26T12:00:00.000Z"),
    idFactory: () => "11111111-1111-4111-8111-111111111111",
  });

  const first = await service.appendEvent({
    eventType: "custom_skill.created",
    matterName: "Taori vs Roma Builder",
    summaryKey: "custom_skill_created",
    object: { type: "custom_skill", id: "skill_123", label: "Issue Discovery" },
    payload: { slash: "/issue_discovery", title: "Issue Discovery" },
    idempotencyKey: "custom_skill.created:skill_123:v1",
  });
  const second = await service.appendEvent({
    eventType: "custom_skill.created",
    matterName: "Taori vs Roma Builder",
    summaryKey: "custom_skill_created",
    object: { type: "custom_skill", id: "skill_123", label: "Issue Discovery" },
    payload: { slash: "/issue_discovery", title: "Issue Discovery" },
    idempotencyKey: "custom_skill.created:skill_123:v1",
  });

  assert.equal(first.eventId, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(second, first);
  const raw = await readFile(eventsPath, "utf8");
  assert.equal(raw.trim().split(/\r?\n/).length, 1);

  const ledger = await service.listEvents({ matterName: "Taori vs Roma Builder" });
  assert.equal(ledger.schema_version, "matter-events/v1");
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].eventType, "custom_skill.created");
  assert.equal(ledger.events[0].matterName, "Taori vs Roma Builder");
});

test("matter event normalization rejects unsafe event types and requires idempotency", () => {
  assert.throws(
    () => normalizeMatterEvent({ eventType: "source_file.deleted", idempotencyKey: "x" }),
    (error) => error.statusCode === 400 && error.code === "matter_events.event_type_required",
  );
  assert.throws(
    () => normalizeMatterEvent({ eventType: "custom_skill.created" }),
    (error) => error.statusCode === 400 && error.code === "matter_events.idempotency_key_required",
  );
});
