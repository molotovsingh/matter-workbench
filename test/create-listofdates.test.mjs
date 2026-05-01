import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
  runCreateListOfDates,
  createOpenAiProvider,
  createOpenRouterProvider,
} from "../create-listofdates-engine.mjs";
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

async function readExtractionRecord(root, fileId = "FILE-0001") {
  return JSON.parse(await readFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", `${fileId}.json`),
    "utf8",
  ));
}

async function writeSourceIndex(root, sources) {
  const outputDir = path.join(root, "10_Library");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "Source Index.json"),
    `${JSON.stringify({
      schema_version: "source-index/v1",
      generated_at: "2026-04-28T00:00:00.000Z",
      sources,
    }, null, 2)}\n`,
  );
}

function lawyerFields(overrides = {}) {
  return {
    event_type: "other",
    legal_relevance: "Supports the client's chronology because the cited source records the event.",
    issue_tags: ["chronology"],
    perspective: "client_favourable",
    ...overrides,
  };
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
      assert.ok(schema.properties.entries.items.required.includes("legal_relevance"));
      assert.ok(schema.properties.entries.items.required.includes("event_type"));
      assert.ok(schema.properties.entries.items.required.includes("issue_tags"));
      assert.ok(schema.properties.entries.items.required.includes("perspective"));
      assert.deepEqual(schema.properties.entries.items.properties.perspective.enum, ["client_favourable"]);
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
            ...lawyerFields({
              event_type: "agreement",
              legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
              issue_tags: ["agreement"],
            }),
          },
          {
            date_iso: "2026-05-01",
            date_text: "01 May 2026",
            event: "Notice was issued after the inspection.",
            citation: "FILE-0001 p1.b2",
            needs_review: false,
            confidence: 0.89,
            ...lawyerFields({
              event_type: "notice",
              legal_relevance: "Supports the client's notice timeline because the cited block records that notice followed inspection.",
              issue_tags: ["notice", "inspection"],
            }),
          },
          {
            date_iso: "2026-06-01",
            date_text: "01 June 2026",
            event: "This candidate has no supplied source citation.",
            citation: "FILE-9999 p1.b1",
            needs_review: true,
            confidence: 0.2,
            ...lawyerFields({
              legal_relevance: "Should be rejected because the citation is not supplied.",
              issue_tags: ["evidence_gap"],
            }),
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
  assert.deepEqual(result.aiRun, {
    policyVersion: "model-policy/v1-current",
    task: "source_backed_analysis",
    tier: "source_backed_analysis",
    provider: "openai-direct",
    model: DEFAULT_OPENAI_MODEL,
    maxOutputTokens: DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
    fallback: "fail_closed",
  });

  await stat(path.join(root, "10_Library", "List of Dates.json"));
  await stat(path.join(root, "10_Library", "List of Dates.csv"));
  await stat(path.join(root, "10_Library", "List of Dates.md"));

  const jsonOutput = JSON.parse(await readFile(path.join(root, "10_Library", "List of Dates.json"), "utf8"));
  assert.deepEqual(jsonOutput.ai_run, result.aiRun);
  assert.equal(jsonOutput.entries.length, 2);
  assert.equal(jsonOutput.entries[0].event_type, "agreement");
  assert.equal(jsonOutput.entries[0].perspective, "client_favourable");
  assert.deepEqual(jsonOutput.entries[0].issue_tags, ["agreement"]);
  assert.match(jsonOutput.entries[0].legal_relevance, /contract chronology/);

  const csvRows = parseCsv(await readFile(path.join(root, "10_Library", "List of Dates.csv"), "utf8"));
  assert.equal(csvRows.length, 2);
  assert.equal(csvRows[0].citation, "FILE-0001 p1.b1");
  assert.equal(csvRows[0].event_type, "agreement");
  assert.match(csvRows[0].legal_relevance, /contract chronology/);
  assert.equal(csvRows[0].issue_tags, "agreement");
  assert.equal(csvRows[0].perspective, "client_favourable");
  assert.equal(csvRows[0].source_file_id, "FILE-0001");
  assert.equal(csvRows[0].source_label, "");
  assert.equal(csvRows[1].source_path, "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt");

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.match(markdown, /\| Date \| Event \| Legal Relevance \| Source \|/);
  assert.match(markdown, /Agreement was signed/);
  assert.match(markdown, /contract chronology/);
  assert.match(markdown, /FILE-0001 p1\.b2/);
});

test("create-listofdates enriches entries with Source Index labels without changing citations", async () => {
  const root = await prepareExtractedMatter();
  const record = await readExtractionRecord(root);
  await writeSourceIndex(root, [
    {
      file_id: record.file_id,
      sha256: record.sha256,
      source_path: record.source_path,
      display_label: "Agreement note dated 20 April 2026",
      short_label: "Agreement note",
    },
  ]);

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2026-04-20",
          date_text: "20 April 2026",
          event: "Agreement was signed by Mehta and Skyline.",
          citation: "FILE-0001 p1.b1",
          needs_review: false,
          confidence: 0.94,
          ...lawyerFields({
            event_type: "agreement",
            legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
            issue_tags: ["agreement"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].citation, "FILE-0001 p1.b1");
  assert.equal(result.entries[0].source_file_id, "FILE-0001");
  assert.equal(result.entries[0].source_label, "Agreement note dated 20 April 2026");
  assert.equal(result.entries[0].source_short_label, "Agreement note");

  const jsonOutput = JSON.parse(await readFile(path.join(root, "10_Library", "List of Dates.json"), "utf8"));
  assert.equal(jsonOutput.entries[0].citation, "FILE-0001 p1.b1");
  assert.equal(jsonOutput.entries[0].source_file_id, "FILE-0001");
  assert.equal(jsonOutput.entries[0].source_label, "Agreement note dated 20 April 2026");
  assert.equal(jsonOutput.entries[0].source_short_label, "Agreement note");

  const csvRows = parseCsv(await readFile(path.join(root, "10_Library", "List of Dates.csv"), "utf8"));
  assert.equal(csvRows[0].citation, "FILE-0001 p1.b1");
  assert.equal(csvRows[0].source_file_id, "FILE-0001");
  assert.equal(csvRows[0].source_label, "Agreement note dated 20 April 2026");
  assert.equal(csvRows[0].source_short_label, "Agreement note");

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.match(markdown, /Agreement note dated 20 April 2026 \(FILE-0001 p1\.b1\)/);
  assert.match(markdown, /FILE-0001 p1\.b1/);
});

test("create-listofdates ignores stale Source Index labels and keeps current citation behavior", async () => {
  const root = await prepareExtractedMatter();
  const record = await readExtractionRecord(root);
  await writeSourceIndex(root, [
    {
      file_id: record.file_id,
      sha256: "stale-sha",
      source_path: record.source_path,
      display_label: "Stale label that should not appear",
      short_label: "Stale label",
    },
  ]);

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2026-05-01",
          date_text: "01 May 2026",
          event: "Notice was issued after the inspection.",
          citation: "FILE-0001 p1.b2",
          needs_review: false,
          confidence: 0.89,
          ...lawyerFields({
            event_type: "notice",
            legal_relevance: "Supports the client's notice timeline because the cited block records that notice followed inspection.",
            issue_tags: ["notice", "inspection"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].citation, "FILE-0001 p1.b2");
  assert.equal(result.entries[0].source_file_id, "FILE-0001");
  assert.equal(Object.hasOwn(result.entries[0], "source_label"), false);
  assert.equal(Object.hasOwn(result.entries[0], "source_short_label"), false);

  const csvRows = parseCsv(await readFile(path.join(root, "10_Library", "List of Dates.csv"), "utf8"));
  assert.equal(csvRows[0].citation, "FILE-0001 p1.b2");
  assert.equal(csvRows[0].source_file_id, "FILE-0001");
  assert.equal(csvRows[0].source_label, "");
  assert.equal(csvRows[0].source_short_label, "");

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.doesNotMatch(markdown, /Stale label that should not appear/);
  assert.match(markdown, /facts\.txt/);
  assert.match(markdown, /FILE-0001 p1\.b2/);
});

test("create-listofdates ignores Source Index labels that contain file identifiers", async () => {
  const root = await prepareExtractedMatter();
  const record = await readExtractionRecord(root);
  await writeSourceIndex(root, [
    {
      file_id: record.file_id,
      sha256: record.sha256,
      source_path: record.source_path,
      display_label: "FILE-0001: Agreement note dated 20 April 2026",
      short_label: "FILE-0001 agreement note",
    },
  ]);

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2026-04-20",
          date_text: "20 April 2026",
          event: "Agreement was signed by Mehta and Skyline.",
          citation: "FILE-0001 p1.b1",
          needs_review: false,
          confidence: 0.94,
          ...lawyerFields({
            event_type: "agreement",
            legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
            issue_tags: ["agreement"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].citation, "FILE-0001 p1.b1");
  assert.equal(result.entries[0].source_file_id, "FILE-0001");
  assert.equal(Object.hasOwn(result.entries[0], "source_label"), false);
  assert.equal(Object.hasOwn(result.entries[0], "source_short_label"), false);

  const csvRows = parseCsv(await readFile(path.join(root, "10_Library", "List of Dates.csv"), "utf8"));
  assert.equal(csvRows[0].citation, "FILE-0001 p1.b1");
  assert.equal(csvRows[0].source_file_id, "FILE-0001");
  assert.equal(csvRows[0].source_label, "");
  assert.equal(csvRows[0].source_short_label, "");

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.doesNotMatch(markdown, /FILE-0001: Agreement note/);
  assert.match(markdown, /facts\.txt/);
  assert.match(markdown, /FILE-0001 p1\.b1/);
});

test("create-listofdates rejects entries missing lawyer-facing fields", async () => {
  const root = await prepareExtractedMatter();

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2026-04-20",
          date_text: "20 April 2026",
          event: "Agreement was signed by Mehta and Skyline.",
          citation: "FILE-0001 p1.b1",
          needs_review: false,
          confidence: 0.94,
        },
      ],
    }),
  });

  assert.equal(result.counts.candidateEntries, 1);
  assert.equal(result.counts.entries, 0);
  assert.equal(result.counts.rejectedEntries, 1);
});

test("create-listofdates softens event and relevance conclusion language", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "breach-note.txt", "Skyline alleged breach on 20 April 2026.");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2026-04-20",
          date_text: "20 April 2026",
          event: "Proves breach by Skyline FILE-0001 p1.b1.",
          citation: "FILE-0001 p1.b1",
          needs_review: false,
          confidence: 0.94,
          ...lawyerFields({
            event_type: "agreement",
            legal_relevance: "Proves breach by Skyline FILE-0001 p1.b1.",
            issue_tags: ["agreement"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.counts.candidateEntries, 1);
  assert.equal(result.counts.entries, 1);
  assert.equal(result.counts.rejectedEntries, 0);
  assert.doesNotMatch(result.entries[0].event, /\b(FILE-\d{4,}|proves?|breach)\b/i);
  assert.match(result.entries[0].event, /supports default issue by Skyline/i);
  assert.doesNotMatch(result.entries[0].legal_relevance, /\b(proves?|breach)\b/i);
  assert.match(result.entries[0].legal_relevance, /supports default issue by Skyline/i);
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

test("create-listofdates excludes reference and case-summary records from AI input", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "GOLDEN_LIST_OF_DATES.md", "Expected event on 01 January 2026.");
  await writeSource(root, "README_CASE.txt", "CASE SUMMARY: Payment mismatch on 02 February 2026.");
  await writeSource(root, "notice.txt", "Demand notice was issued on 03 March 2026.");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const calls = [];
  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async ({ chunk }) => {
      calls.push(chunk);
      assert.ok(chunk.length > 0);
      assert.equal(chunk.some((block) => /GOLDEN_LIST_OF_DATES|README_CASE/i.test(block.original_name)), false);
      assert.equal(chunk.every((block) => block.original_name === "notice.txt"), true);
      return {
        entries: [{
          date_iso: "2026-03-03",
          date_text: "03 March 2026",
          event: "Demand notice was issued.",
          citation: chunk[0].citation,
          needs_review: false,
          confidence: 0.9,
          ...lawyerFields({
            event_type: "notice",
            legal_relevance: "Supports the client's notice chronology because the cited block records the demand notice date.",
            issue_tags: ["notice"],
          }),
        }],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.counts.recordsRead, 3);
  assert.equal(result.counts.blocksSent, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].original_name, "notice.txt");
});

test("create-listofdates prunes dense same-source same-date micro-events", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "inspection.txt", [
    "On 12 February 2024 inspection recorded Tower B approximately 55% complete.",
    "",
    "On 12 February 2024 inspection found local vitrified tiles instead of Italian marble.",
    "",
    "On 12 February 2024 Annexure A recorded 28 site photographs.",
    "",
    "On 12 February 2024 the inspection report was signed by the allottee.",
  ].join("\n"));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async ({ chunk }) => ({
      entries: chunk.map((block, index) => ({
        date_iso: "2024-02-12",
        date_text: "12 February 2024",
        event: [
          "Inspection recorded Tower B approximately 55% complete.",
          "Inspection found local vitrified tiles instead of Italian marble.",
          "Annexure A recorded 28 site photographs.",
          "The inspection report was signed by the allottee.",
        ][index],
        citation: block.citation,
        needs_review: false,
        confidence: 0.9,
        ...lawyerFields({
          event_type: index < 2 ? "inspection" : "other",
          legal_relevance: "Supports the client's inspection chronology because the cited block records a site inspection fact.",
          issue_tags: ["inspection"],
        }),
      })),
    }),
  });

  assert.equal(result.counts.candidateEntries, 4);
  assert.equal(result.counts.entries, 2);
  assert.deepEqual(
    result.entries.map((entry) => entry.event),
    [
      "Inspection recorded Tower B approximately 55% complete.",
      "Inspection found local vitrified tiles instead of Italian marble.",
    ],
  );
});

test("create-listofdates prunes dense rows per source file, not display name", async () => {
  const root = await makeMatterRoot();
  for (const dir of ["site-a", "site-b"]) {
    await writeSource(root, `${dir}/inspection.txt`, [
      `On 12 February 2024 ${dir} inspection recorded Tower B approximately 55% complete.`,
      "",
      `On 12 February 2024 ${dir} inspection found local vitrified tiles instead of Italian marble.`,
      "",
      `On 12 February 2024 ${dir} Annexure A recorded 28 site photographs.`,
      "",
      `On 12 February 2024 ${dir} inspection report was signed by the allottee.`,
    ].join("\n"));
  }
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async ({ chunk }) => ({
      entries: chunk.map((block) => ({
        date_iso: "2024-02-12",
        date_text: "12 February 2024",
        event: block.text,
        citation: block.citation,
        needs_review: false,
        confidence: 0.9,
        ...lawyerFields({
          event_type: /signed|Annexure/i.test(block.text) ? "other" : "inspection",
          legal_relevance: "Supports the client's inspection chronology because the cited block records a site inspection fact.",
          issue_tags: ["inspection"],
        }),
      })),
    }),
  });

  assert.equal(result.counts.candidateEntries, 8);
  assert.equal(result.counts.entries, 4);
  assert.deepEqual(
    [...new Set(result.entries.map((entry) => entry.file_id))].sort(),
    ["FILE-0001", "FILE-0002"],
  );
  assert.equal(result.entries.filter((entry) => entry.file_id === "FILE-0001").length, 2);
  assert.equal(result.entries.filter((entry) => entry.file_id === "FILE-0002").length, 2);
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
  assert.match(bodies[0].input[0].content, /lawyer-facing, client-favourable/);
  assert.match(bodies[0].input[0].content, /Every legal_relevance sentence must be supported/);
  assert.match(bodies[0].input[0].content, /Prefer primary evidence/);
  assert.match(bodies[0].input[0].content, /golden answers/);
  assert.match(bodies[0].input[0].content, /receipt mismatches/);
  assert.match(bodies[0].input[0].content, /objections or protests/);
  assert.match(bodies[0].input[0].content, /not an index of every dated sentence/);
  assert.match(bodies[0].input[1].content, /allowed_event_types/);
  assert.match(bodies[0].input[1].content, /client_favourable/);
  const userPayload = JSON.parse(bodies[0].input[1].content);
  assert.ok(userPayload.instructions.some((instruction) => /README case summary/.test(instruction)));
  assert.ok(userPayload.instructions.some((instruction) => /legal notice or demand/.test(instruction)));
  assert.ok(userPayload.instructions.some((instruction) => /demands an addendum/.test(instruction)));
  assert.ok(userPayload.instructions.some((instruction) => /different legally material deadline/.test(instruction)));
  assert.ok(userPayload.instructions.some((instruction) => /contradiction or mismatch/.test(instruction)));
  assert.ok(userPayload.instructions.some((instruction) => /same source document on the same date/.test(instruction)));
  assert.ok(userPayload.instructions.some((instruction) => /report formalities/.test(instruction)));
});

test("OpenRouter provider sends strict no-fallback structured output requests", async () => {
  const requests = [];
  const provider = createOpenRouterProvider({
    apiKey: "sk-openrouter-test",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "qwen/qwen3-source-backed",
    maxOutputTokens: 1800,
    timeoutMs: 45000,
    providerSort: "price",
    maxPrice: {
      prompt: 0.15,
      completion: 0.6,
    },
    fetchImpl: async (endpoint, init) => {
      requests.push({
        endpoint,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return {
        ok: true,
        json: async () => ({
          model: "qwen/qwen3-source-backed",
          provider: "openrouter-test-provider",
          usage: {
            prompt_tokens: 12,
            completion_tokens: 5,
            total_tokens: 17,
            cost: 0.0002,
          },
          choices: [{ message: { content: JSON.stringify({ entries: [] }) } }],
        }),
      };
    },
  });

  const response = await provider({
    matter: {},
    chunk: [],
    chunkIndex: 1,
    chunkCount: 1,
    schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requests[0].headers.authorization, "Bearer sk-openrouter-test");
  assert.equal(requests[0].body.model, "qwen/qwen3-source-backed");
  assert.equal(requests[0].body.max_tokens, 1800);
  assert.deepEqual(requests[0].body.provider, {
    require_parameters: true,
    allow_fallbacks: false,
    sort: "price",
    max_price: {
      prompt: 0.15,
      completion: 0.6,
    },
  });
  assert.equal(requests[0].body.response_format.type, "json_schema");
  assert.equal(requests[0].body.response_format.json_schema.strict, true);
  assert.equal(requests[0].body.response_format.json_schema.name, "list_of_dates_chunk");
  assert.match(requests[0].body.messages[0].content, /lawyer-facing, client-favourable/);
  assert.match(requests[0].body.messages[0].content, /Every legal_relevance sentence must be supported/);
  assert.match(requests[0].body.messages[1].content, /allowed_event_types/);
  assert.match(requests[0].body.messages[1].content, /client_favourable/);
  assert.deepEqual(response.ai_run, {
    returnedModel: "qwen/qwen3-source-backed",
    returnedProvider: "openrouter-test-provider",
    usage: {
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      cost: 0.0002,
    },
  });
});

test("OpenRouter provider maps malformed JSON to provider error", async () => {
  const provider = createOpenRouterProvider({
    apiKey: "sk-openrouter-test",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "qwen/qwen3-source-backed",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "{not-json" } }],
      }),
    }),
  });

  await assert.rejects(
    () => provider({
      matter: {},
      chunk: [],
      chunkIndex: 1,
      chunkCount: 1,
      schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /OpenRouter response did not include valid JSON message content/);
      return true;
    },
  );
});

test("create-listofdates can opt into OpenRouter source-backed analysis provider", async () => {
  const root = await prepareExtractedMatter();
  const requests = [];

  const result = await runCreateListOfDates({
    matterRoot: root,
    env: {
      SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-openrouter-test",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "qwen/qwen3-source-backed",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS: "1800",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS: "45000",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT: "price",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_PROMPT_PRICE: "0.15",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_COMPLETION_PRICE: "0.60",
    },
    fetchImpl: async (endpoint, init) => {
      requests.push({ endpoint, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({
          model: "qwen/qwen3-source-backed",
          provider: "openrouter-test-provider",
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
            cost: 0.001,
          },
          choices: [{
            message: {
              content: JSON.stringify({
                entries: [{
                  date_iso: "2026-04-20",
                  date_text: "20 April 2026",
                  event: "Agreement was signed by Mehta and Skyline.",
                  citation: "FILE-0001 p1.b1",
                  needs_review: false,
                  confidence: 0.94,
                  ...lawyerFields({
                    event_type: "agreement",
                    legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
                    issue_tags: ["agreement"],
                  }),
                }],
              }),
            },
          }],
        }),
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.model, "qwen/qwen3-source-backed");
  assert.equal(requests[0].body.max_tokens, 1800);
  assert.equal(requests[0].body.provider.allow_fallbacks, false);
  assert.equal(requests[0].body.provider.require_parameters, true);
  assert.equal(requests[0].body.provider.sort, "price");
  assert.deepEqual(requests[0].body.provider.max_price, {
    prompt: 0.15,
    completion: 0.6,
  });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.aiRun, {
    policyVersion: "model-policy/v1-current",
    task: "source_backed_analysis",
    tier: "source_backed_analysis",
    provider: "openrouter",
    model: "qwen/qwen3-source-backed",
    maxOutputTokens: 1800,
    fallback: "fail_closed",
    returnedModel: "qwen/qwen3-source-backed",
    returnedProvider: "openrouter-test-provider",
    usage: {
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      cost: 0.001,
    },
  });
  const jsonOutput = JSON.parse(await readFile(path.join(root, "10_Library", "List of Dates.json"), "utf8"));
  assert.deepEqual(jsonOutput.ai_run, result.aiRun);
});

test("create-listofdates default provider uses model policy env overrides", async () => {
  const root = await prepareExtractedMatter();
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_MAX_OUTPUT_TOKENS: process.env.OPENAI_MAX_OUTPUT_TOKENS,
  };
  const requests = [];

  globalThis.fetch = async (endpoint, init) => {
    requests.push({
      endpoint,
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return {
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ entries: [] }) }),
    };
  };
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_MODEL = "policy-listofdates-model";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "3456";

  try {
    const result = await runCreateListOfDates({ matterRoot: root, maxOutputTokens: "invalid" });
    const jsonOutput = JSON.parse(await readFile(path.join(root, "10_Library", "List of Dates.json"), "utf8"));

    assert.equal(result.aiRun.model, "policy-listofdates-model");
    assert.equal(result.aiRun.maxOutputTokens, 3456);
    assert.equal(result.aiRun.provider, "openai-direct");
    assert.deepEqual(jsonOutput.ai_run, result.aiRun);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].headers.authorization, "Bearer sk-test");
  assert.equal(requests[0].body.model, "policy-listofdates-model");
  assert.equal(requests[0].body.max_output_tokens, 3456);
  assert.equal(requests[0].body.text.format.name, "list_of_dates_chunk");
});
