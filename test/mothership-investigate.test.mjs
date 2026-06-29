import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMothershipInvestigation,
  parseMothershipInvestigateArgs,
  renderMothershipInvestigationMarkdown,
  runMothershipInvestigate,
} from "../scripts/mothership-investigate.mjs";

const NOW = new Date("2026-06-29T14:00:00.000Z");

function fixtureDataset() {
  return {
    feedback: [
      {
        feedback_id: "feedback_large_files",
        classification: "bug",
        status: "new",
        matter_name: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
        occurred_at: new Date("2026-06-29T11:27:11.000Z"),
        received_at: new Date("2026-06-29T11:27:12.000Z"),
        payload: {
          tryingToDo: "Reading document still not working",
          happenedInstead: "Reading document still not working",
          context: {
            username: "shivangi@lawzeus.com",
            visibleError: "Reading document still not working",
            traceId: "trace_reading",
            recentActivity: [
              "16:42 rerun running: Extract Documents",
              "16:50 rerun failed: Extract Documents — The server could not complete this request (502 Bad Gateway). Please retry in a minute.",
            ],
          },
        },
      },
      {
        feedback_id: "feedback_archive",
        classification: "bug",
        status: "new",
        matter_name: "Oriental Insurance v MOTI CERAMICS",
        occurred_at: new Date("2026-06-29T12:32:43.000Z"),
        received_at: new Date("2026-06-29T12:36:11.000Z"),
        payload: {
          tryingToDo: "Archive is working",
          happenedInstead: "Archive is working",
          context: { username: "shivangi@lawzeus.com", visibleError: "Archive is working" },
        },
      },
      {
        feedback_id: "feedback_old",
        classification: "bug",
        status: "new",
        matter_name: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
        occurred_at: new Date("2026-06-20T11:27:11.000Z"),
        received_at: new Date("2026-06-20T11:27:12.000Z"),
        payload: { tryingToDo: "Larger files did not process", context: { username: "shivangi@lawzeus.com" } },
      },
    ],
    signals: [
      {
        signal_id: "signal_extract_failed",
        severity: "error",
        source: "job_status",
        matter_name: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
        occurrence_count: 1,
        first_seen_at: new Date("2026-06-29T11:26:00.000Z"),
        last_seen_at: new Date("2026-06-29T11:26:00.000Z"),
        received_at: new Date("2026-06-29T11:28:00.000Z"),
        payload: { title: "Extract Documents", detail: "502 Bad Gateway" },
      },
    ],
    heartbeats: [
      {
        heartbeat_id: "heartbeat_latest",
        captured_at: new Date("2026-06-29T13:55:00.000Z"),
        received_at: new Date("2026-06-29T13:55:01.000Z"),
        payload: {
          counters: { failedJobs: 0, slowStages: 0, openSignals: 5 },
          activeSessions: 0,
          matterHealth: [],
          journeys: [],
        },
      },
      {
        heartbeat_id: "heartbeat_latest_with_health",
        captured_at: new Date("2026-06-29T13:50:00.000Z"),
        received_at: new Date("2026-06-29T13:50:01.000Z"),
        payload: {
          counters: { failedJobs: 0, slowStages: 0, openSignals: 5 },
          activeSessions: 0,
          matterHealth: [
            {
              matter: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
              prepareState: "missing",
              nextStepLabel: "Label sources",
              attentionState: "clear",
              blockers: 0,
              warnings: 0,
              checkedAt: "2026-06-29T13:49:59.000Z",
            },
          ],
          journeys: [],
        },
      },
      {
        heartbeat_id: "heartbeat_nearby",
        captured_at: new Date("2026-06-29T11:16:02.000Z"),
        received_at: new Date("2026-06-29T11:16:03.000Z"),
        payload: {
          counters: { failedJobs: 1, slowStages: 2, openSignals: 5 },
          activeSessions: 0,
          journeys: [
            {
              jobId: "job_extract",
              traceId: "trace_extract",
              matter: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
              screen: "background_job",
              lastAction: "extract",
              currentStage: "Extract Documents",
              currentStageStatus: "running",
              patienceRisk: "low",
            },
          ],
          matterHealth: [
            {
              matter: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
              prepareState: "stale",
              nextStepLabel: "Extract documents",
              attentionState: "clear",
              blockers: 0,
              warnings: 0,
              checkedAt: "2026-06-29T11:16:01.000Z",
            },
          ],
        },
      },
    ],
  };
}

test("mothership investigate parses safe bounded options", () => {
  assert.deepEqual(parseMothershipInvestigateArgs([
    "--user", "shivangi",
    "--matter", "National Insurance",
    "--since-hours", "48",
    "--window-minutes", "30",
    "--limit", "5",
    "--format", "json",
  ]), {
    preset: "large-files",
    user: "shivangi",
    matter: "National Insurance",
    text: "",
    sinceHours: 48,
    windowMinutes: 30,
    limit: 5,
    format: "json",
  });
  assert.throws(() => parseMothershipInvestigateArgs(["--token", "secret"]), /does not accept secrets/i);
});

test("mothership investigate bundles large-file feedback with nearby evidence", () => {
  const report = buildMothershipInvestigation(fixtureDataset(), {
    now: NOW,
    user: "shivangi",
    matter: "National Insurance",
    sinceHours: 72,
    windowMinutes: 20,
  });

  assert.equal(report.schema_version, "mothership-investigation/v1");
  assert.equal(report.counts.feedbackMatched, 1);
  assert.equal(report.counts.openFeedbackMatched, 1);
  assert.equal(report.feedback[0].feedbackId, "feedback_large_files");
  assert.equal(report.feedback[0].relatedSignals[0].signalId, "signal_extract_failed");
  assert.equal(report.feedback[0].relatedHeartbeats[0].journeys[0].currentStage, "Extract Documents");
  assert.equal(report.latestHeartbeat.capturedAt, "2026-06-29T13:55:00.000Z");
  assert.equal(report.latestMatterHealthCapturedAt, "2026-06-29T13:50:00.000Z");
  assert.equal(report.latestMatterHealth[0].prepareState, "missing");

  const markdown = renderMothershipInvestigationMarkdown(report);
  assert.match(markdown, /Mothership Investigation/);
  assert.match(markdown, /Reading document still not working/);
  assert.match(markdown, /502 Bad Gateway/);
  assert.match(markdown, /health National Insurance Co\. Ltd/);
});

test("mothership investigate does not attach unrelated signals or health to text-only misses", () => {
  const report = buildMothershipInvestigation(fixtureDataset(), {
    now: NOW,
    preset: "all",
    text: "manish",
    sinceHours: 72,
  });

  assert.equal(report.counts.feedbackMatched, 0);
  assert.equal(report.counts.signalsMatched, 0);
  assert.deepEqual(report.latestMatterHealth, []);
});

test("mothership investigate does not attach generic signal matches to user-only misses", () => {
  const report = buildMothershipInvestigation(fixtureDataset(), {
    now: NOW,
    user: "manish raghav",
    sinceHours: 72,
  });

  assert.equal(report.counts.feedbackMatched, 0);
  assert.equal(report.counts.signalsMatched, 0);
  assert.deepEqual(report.latestMatterHealth, []);
});

test("mothership investigate runner uses one report query", async () => {
  const calls = [];
  const output = [];
  const store = {
    async queryReport(options) {
      calls.push(options);
      return fixtureDataset();
    },
  };

  const result = await runMothershipInvestigate({
    argv: ["--user", "shivangi", "--matter", "National Insurance", "--format", "json"],
    store,
    stdout: (line) => output.push(line),
    now: () => NOW,
  });

  assert.equal(result, 0);
  assert.deepEqual(calls, [{ sinceDays: 3 }]);
  const report = JSON.parse(output.join("\n"));
  assert.equal(report.counts.feedbackMatched, 1);
});

test("package exposes mothership investigate command", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["mothership:investigate"], "node scripts/mothership-investigate.mjs");
});
