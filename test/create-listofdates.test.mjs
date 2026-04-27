import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCreateListOfDates, createOpenAiProvider } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { parseCsv } from "../shared/csv.mjs";

async function makeMatterRoot(name = "matter") {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-listofdates-test-"));
  const root = path.join(tmp, name);
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  return root;
}

async function writeSource(root, name, content) {
  const filePath = path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files", name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

function metadata() {
  return {
    clientName: "Mehta",
    matterName: "Mehta vs Skyline",
    oppositeParty: "Skyline",
    matterType: "Civil",
    jurisdiction: "India",
    briefDescription: "Chronology test matter",
  };
}

async function prepareExtractedMatter() {
  const root = await makeMatterRoot();
  await writeSource(root, "facts.txt", [
    "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
    "",
    "Notice was issued on 01 May 2026 after the inspection.",
  ].join("\n"));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });
  return root;
}

test("create-listofdates calls an AI provider and writes cited chronology outputs", async () => {
  const root = await prepareExtractedMatter();
  const calls = [];

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async ({ matter, chunk, chunkIndex, chunkCount, schema }) => {
      calls.push({ matter, chunk, chunkIndex, chunkCount, schema });
      assert.equal(matter.matter_name, "Mehta vs Skyline");
      assert.equal(chunkIndex, 1);
      assert.equal(chunkCount, 1);
      assert.equal(schema.properties.entries.type, "array");
      assert.ok(chunk.some((block) => block.citation === "FILE-0001 p1.b1"));
      assert.ok(chunk.some((block) => block.citation === "FILE-0001 p1.b2"));
      return {
        entries: [
          {
            date_iso: "2026-04-20",
            date_text: "20 April 2026",
            event: "Agreement was signed by Mehta and Skyline.",
            citation: "FILE-0001 p1.b1",
            needs_review: false,
            confidence: 0.94,
          },
          {
            date_iso: "2026-05-01",
            date_text: "01 May 2026",
            event: "Notice was issued after the inspection.",
            citation: "FILE-0001 p1.b2",
            needs_review: false,
            confidence: 0.89,
          },
          {
            date_iso: "2026-06-01",
            date_text: "01 June 2026",
            event: "This candidate has no supplied source citation.",
            citation: "FILE-9999 p1.b1",
            needs_review: true,
            confidence: 0.2,
          },
        ],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.counts.recordsRead, 1);
  assert.equal(result.counts.aiRequests, 1);
  assert.equal(result.counts.candidateEntries, 3);
  assert.equal(result.counts.entries, 2);
  assert.equal(result.counts.rejectedEntries, 1);
  assert.deepEqual(result.entries.map((entry) => entry.date_iso), ["2026-04-20", "2026-05-01"]);

  await stat(path.join(root, "10_Library", "List of Dates.json"));
  await stat(path.join(root, "10_Library", "List of Dates.csv"));
  await stat(path.join(root, "10_Library", "List of Dates.md"));

  const csvRows = parseCsv(await readFile(path.join(root, "10_Library", "List of Dates.csv"), "utf8"));
  assert.equal(csvRows.length, 2);
  assert.equal(csvRows[0].citation, "FILE-0001 p1.b1");
  assert.equal(csvRows[1].source_path, "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt");

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.match(markdown, /Agreement was signed/);
  assert.match(markdown, /FILE-0001 p1\.b2/);
});

test("create-listofdates reports missing extraction records before calling AI", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "facts.txt", "Agreement was signed on 20 April 2026.");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  let called = false;

  await assert.rejects(
    () => runCreateListOfDates({
      matterRoot: root,
      aiProvider: async () => {
        called = true;
        return { entries: [] };
      },
    }),
    /Run \/extract before \/create_listofdates/,
  );
  assert.equal(called, false);
});

test("OpenAI provider requires an API key", async () => {
  const provider = createOpenAiProvider({ apiKey: "" });
  await assert.rejects(
    () => provider({ matter: {}, chunk: [], chunkIndex: 1, chunkCount: 1, schema: {} }),
    /OPENAI_API_KEY is required/,
  );
});

test("OpenAI provider sends bounded structured output requests", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output_text: JSON.stringify({ entries: [] }) }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const provider = createOpenAiProvider({
      apiKey: "sk-test",
      endpoint: `http://${address.address}:${address.port}/v1/responses`,
      maxOutputTokens: 1234,
    });
    await provider({
      matter: {},
      chunk: [],
      chunkIndex: 1,
      chunkCount: 1,
      schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].max_output_tokens, 1234);
  assert.equal(bodies[0].text.format.type, "json_schema");
  assert.equal(bodies[0].text.format.strict, true);
});
