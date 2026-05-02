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

async function readFileRegister(root) {
  return parseCsv(await readFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    "utf8",
  ));
}

async function fileIdForOriginalName(root, originalName) {
  const rows = await readFileRegister(root);
  const row = rows.find((candidate) => candidate.original_name === originalName);
  assert.ok(row, `Expected File Register row for ${originalName}`);
  return row.file_id;
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

test("create-listofdates filters manifest records before AI while preserving substantive duplicate events", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "README_MANIFEST.txt", [
    "Case bundle manifest.",
    "Agreement was signed on 20 April 2026.",
  ].join("\n"));
  await writeSource(root, "agreement.txt", "Agreement was signed on 20 April 2026 by Mehta and Skyline.");
  await writeSource(root, "email.txt", "Agreement was signed on 20 April 2026 and circulated by email.");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const manifestId = await fileIdForOriginalName(root, "README_MANIFEST.txt");
  const agreementId = await fileIdForOriginalName(root, "agreement.txt");
  const emailId = await fileIdForOriginalName(root, "email.txt");
  const manifestRecord = await readExtractionRecord(root, manifestId);
  const agreementRecord = await readExtractionRecord(root, agreementId);
  const emailRecord = await readExtractionRecord(root, emailId);
  await writeSourceIndex(root, [
    {
      file_id: manifestId,
      sha256: manifestRecord.sha256,
      source_path: manifestRecord.source_path,
      display_label: "Readme Manifest - Case Bundle",
      short_label: "Readme Manifest",
      document_type: "unknown",
    },
    {
      file_id: agreementId,
      sha256: agreementRecord.sha256,
      source_path: agreementRecord.source_path,
      display_label: "Agreement note dated 20 April 2026",
      short_label: "Agreement note",
      document_type: "agreement",
    },
    {
      file_id: emailId,
      sha256: emailRecord.sha256,
      source_path: emailRecord.source_path,
      display_label: "Email note dated 20 April 2026",
      short_label: "Email note",
      document_type: "email",
    },
  ]);

  const calls = [];
  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async ({ chunk }) => {
      calls.push(chunk);
      assert.equal(chunk.some((block) => block.file_id === manifestId), false);
      assert.ok(chunk.some((block) => block.file_id === agreementId));
      assert.ok(chunk.some((block) => block.file_id === emailId));
      return {
        entries: [
          {
            date_iso: "2026-04-20",
            date_text: "20 April 2026",
            event: "Agreement was signed by Mehta and Skyline.",
            citation: `${agreementId} p1.b1`,
            needs_review: false,
            confidence: 0.94,
            ...lawyerFields({
              event_type: "agreement",
              legal_relevance: "Supports the client's contract chronology because the agreement note records the signing date.",
              issue_tags: ["agreement"],
            }),
          },
          {
            date_iso: "2026-04-20",
            date_text: "20 April 2026",
            event: "Agreement was signed by Mehta and Skyline.",
            citation: `${emailId} p1.b1`,
            needs_review: false,
            confidence: 0.9,
            ...lawyerFields({
              event_type: "other",
              legal_relevance: "Supports the client's contract chronology because the email note separately records circulation of the signed agreement.",
              issue_tags: ["agreement", "email"],
            }),
          },
        ],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.counts.blocksFiltered, manifestRecord.pages[0].blocks.length);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].cluster_type, "corroborated_event");
  assert.deepEqual(result.entries[0].supporting_sources.map((source) => source.citation), [
    `${agreementId} p1.b1`,
    `${emailId} p1.b1`,
  ]);
  assert.deepEqual(result.entries[0].supporting_sources.map((source) => source.source_label), [
    "Agreement note dated 20 April 2026",
    "Email note dated 20 April 2026",
  ]);

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.doesNotMatch(markdown, /Readme Manifest/);
  assert.match(markdown, new RegExp(`Agreement note dated 20 April 2026 \\(${agreementId} p1\\.b1\\)`));
  assert.match(markdown, new RegExp(`Email note dated 20 April 2026 \\(${emailId} p1\\.b1\\)`));
});

test("create-listofdates classifies corroboration, payment discrepancies, and true duplicates", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "bank.txt", [
    "On 30 April 2023 Mehta paid Rs.10,00,000 to Skyline.",
    "On 12 September 2023 Mehta paid Rs.15,70,000 to Skyline.",
  ].join("\n\n"));
  await writeSource(root, "receipt.txt", [
    "Receipt dated 30 April 2023 acknowledged Rs.10,00,000 from Mehta.",
    "Receipt dated 12 September 2023 acknowledged Rs.12,25,000 from Mehta.",
  ].join("\n\n"));
  await writeSource(root, "agreement.txt", "Possession deadline was 30 September 2024.");
  await writeSource(root, "interview.txt", "Client interview confirms possession deadline was 30 September 2024.");
  await writeSource(root, "notice.txt", "Legal notice was issued on 01 May 2026.");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const sourceNames = ["bank.txt", "receipt.txt", "agreement.txt", "interview.txt", "notice.txt"];
  const fileIds = Object.fromEntries(await Promise.all(sourceNames.map(async (name) => [name, await fileIdForOriginalName(root, name)])));
  const records = Object.fromEntries(await Promise.all(Object.entries(fileIds).map(async ([name, fileId]) => [name, await readExtractionRecord(root, fileId)])));
  await writeSourceIndex(root, sourceNames.map((name) => ({
    file_id: fileIds[name],
    sha256: records[name].sha256,
    source_path: records[name].source_path,
    display_label: `${name} label`,
    short_label: name,
    document_type: name.includes("agreement") ? "agreement" : "unknown",
  })));

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2023-04-30",
          date_text: "30 April 2023",
          event: "Mehta paid Rs.10,00,000 to Skyline.",
          citation: `${fileIds["bank.txt"]} p1.b1`,
          needs_review: false,
          confidence: 0.94,
          ...lawyerFields({
            event_type: "payment",
            legal_relevance: "Supports the client's payment chronology because the bank statement records Rs.10,00,000.",
            issue_tags: ["payment"],
          }),
        },
        {
          date_iso: "2023-04-30",
          date_text: "30 April 2023",
          event: "Receipt acknowledged Rs.10,00,000 from Mehta.",
          citation: `${fileIds["receipt.txt"]} p1.b1`,
          needs_review: false,
          confidence: 0.91,
          ...lawyerFields({
            event_type: "payment",
            legal_relevance: "Corroborates the client's payment chronology because the receipt records Rs.10,00,000.",
            issue_tags: ["payment", "receipt"],
          }),
        },
        {
          date_iso: "2023-09-12",
          date_text: "12 September 2023",
          event: "Mehta paid Rs.15,70,000 to Skyline.",
          citation: `${fileIds["bank.txt"]} p1.b2`,
          needs_review: false,
          confidence: 0.94,
          ...lawyerFields({
            event_type: "payment",
            legal_relevance: "Supports the client's payment discrepancy issue because the bank statement records Rs.15,70,000.",
            issue_tags: ["payment", "contradiction"],
          }),
        },
        {
          date_iso: "2023-09-12",
          date_text: "12 September 2023",
          event: "Receipt acknowledged Rs.12,25,000 from Mehta.",
          citation: `${fileIds["receipt.txt"]} p1.b2`,
          needs_review: false,
          confidence: 0.91,
          ...lawyerFields({
            event_type: "payment",
            legal_relevance: "Supports the client's payment discrepancy issue because the receipt records Rs.12,25,000, with a discrepancy of Rs.3,45,000.",
            issue_tags: ["payment", "contradiction"],
          }),
        },
        {
          date_iso: "2024-09-30",
          date_text: "30 September 2024",
          event: "Possession deadline was 30 September 2024.",
          citation: `${fileIds["agreement.txt"]} p1.b1`,
          needs_review: false,
          confidence: 0.9,
          ...lawyerFields({
            event_type: "deadline",
            legal_relevance: "Supports the client's possession delay issue because the agreement records the possession deadline.",
            issue_tags: ["possession", "deadline"],
          }),
        },
        {
          date_iso: "2024-09-30",
          date_text: "30 September 2024",
          event: "Client interview confirms possession deadline was 30 September 2024.",
          citation: `${fileIds["interview.txt"]} p1.b1`,
          needs_review: false,
          confidence: 0.86,
          ...lawyerFields({
            event_type: "deadline",
            legal_relevance: "Corroborates the client's possession delay issue because the interview records the same possession deadline.",
            issue_tags: ["possession", "deadline"],
          }),
        },
        {
          date_iso: "2026-05-01",
          date_text: "01 May 2026",
          event: "Legal notice was issued.",
          citation: `${fileIds["notice.txt"]} p1.b1`,
          needs_review: false,
          confidence: 0.92,
          ...lawyerFields({
            event_type: "notice",
            legal_relevance: "Supports the client's notice chronology because the source records the notice date.",
            issue_tags: ["notice"],
          }),
        },
        {
          date_iso: "2026-05-01",
          date_text: "01 May 2026",
          event: "Legal notice was issued.",
          citation: `${fileIds["notice.txt"]} p1.b1`,
          needs_review: false,
          confidence: 0.9,
          ...lawyerFields({
            event_type: "notice",
            legal_relevance: "Supports the client's notice chronology because the source records the notice date.",
            issue_tags: ["notice"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.counts.acceptedEntries, 8);
  assert.equal(result.counts.entries, 4);
  assert.equal(result.counts.clusteredEntries, 4);

  const entriesByDate = Object.fromEntries(result.entries.map((entry) => [entry.date_iso, entry]));
  assert.equal(entriesByDate["2023-04-30"].cluster_type, "corroborated_event");
  assert.deepEqual(entriesByDate["2023-04-30"].supporting_sources.map((source) => source.citation), [
    `${fileIds["bank.txt"]} p1.b1`,
    `${fileIds["receipt.txt"]} p1.b1`,
  ]);

  assert.equal(entriesByDate["2023-09-12"].cluster_type, "payment_discrepancy");
  assert.equal(entriesByDate["2023-09-12"].event_type, "contradiction");
  assert.match(entriesByDate["2023-09-12"].event, /Rs\.12,25,000 vs Rs\.15,70,000/);
  assert.deepEqual(entriesByDate["2023-09-12"].supporting_sources.map((source) => source.citation), [
    `${fileIds["bank.txt"]} p1.b2`,
    `${fileIds["receipt.txt"]} p1.b2`,
  ]);

  assert.equal(entriesByDate["2024-09-30"].cluster_type, "corroborated_event");
  assert.deepEqual(entriesByDate["2024-09-30"].supporting_sources.map((source) => source.source_file_id), [
    fileIds["agreement.txt"],
    fileIds["interview.txt"],
  ]);

  assert.equal(entriesByDate["2026-05-01"].cluster_type, "true_duplicate");
  assert.deepEqual(entriesByDate["2026-05-01"].supporting_sources.map((source) => source.citation), [
    `${fileIds["notice.txt"]} p1.b1`,
  ]);

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.match(markdown, /Payment discrepancy: same-date sources record inconsistent amounts/);
  assert.match(markdown, new RegExp(`bank\\.txt label \\(${fileIds["bank.txt"]} p1\\.b2\\)<br>receipt\\.txt label \\(${fileIds["receipt.txt"]} p1\\.b2\\)`));
  assert.equal((markdown.match(/Legal notice was issued/g) || []).length, 1);
});

test("create-listofdates keeps separate same-day payments out of discrepancy clusters", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "booking-payment.txt", "On 30 April 2023 Mehta paid Rs.10,00,000 as booking amount to Skyline.");
  await writeSource(root, "maintenance-deposit.txt", "On 30 April 2023 Mehta paid Rs.2,50,000 as maintenance deposit to Skyline.");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const bookingId = await fileIdForOriginalName(root, "booking-payment.txt");
  const maintenanceId = await fileIdForOriginalName(root, "maintenance-deposit.txt");

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2023-04-30",
          date_text: "30 April 2023",
          event: "Mehta paid Rs.10,00,000 as booking amount to Skyline.",
          citation: `${bookingId} p1.b1`,
          needs_review: false,
          confidence: 0.94,
          ...lawyerFields({
            event_type: "payment",
            legal_relevance: "Supports the client's payment chronology because the source records a Rs.10,00,000 booking amount.",
            issue_tags: ["payment"],
          }),
        },
        {
          date_iso: "2023-04-30",
          date_text: "30 April 2023",
          event: "Mehta paid Rs.2,50,000 as maintenance deposit to Skyline.",
          citation: `${maintenanceId} p1.b1`,
          needs_review: false,
          confidence: 0.91,
          ...lawyerFields({
            event_type: "payment",
            legal_relevance: "Supports the client's payment chronology because the source records a Rs.2,50,000 maintenance deposit.",
            issue_tags: ["payment"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.counts.acceptedEntries, 2);
  assert.equal(result.counts.entries, 2);
  assert.equal(result.counts.clusteredEntries, 0);
  assert.deepEqual(result.entries.map((entry) => entry.cluster_type), ["single_event", "single_event"]);
  assert.deepEqual(result.entries.map((entry) => entry.citation).sort(), [
    `${bookingId} p1.b1`,
    `${maintenanceId} p1.b1`,
  ].sort());

  const markdown = await readFile(path.join(root, "10_Library", "List of Dates.md"), "utf8");
  assert.doesNotMatch(markdown, /Payment discrepancy/);
  assert.match(markdown, /Rs\.10,00,000 as booking amount/);
  assert.match(markdown, /Rs\.2,50,000 as maintenance deposit/);
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

test("create-listofdates filters non-merits rows and sharpens legal relevance", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "mixed-chronology.txt", [
    "Client interview transcript recorded on 05 May 2026.",
    "",
    "Email correspondence exported from client's Gmail account on 06 May 2026.",
    "",
    "Vakalatnama executed by Mehta on 07 May 2026.",
    "",
    "Skyline replied on 14 March 2024 demanding payment despite Mehta's complaint and request for milestone confirmation. Mehta's wife was hospitalized after the dispute.",
  ].join("\n"));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });

  const result = await runCreateListOfDates({
    matterRoot: root,
    aiProvider: async () => ({
      entries: [
        {
          date_iso: "2026-05-05",
          date_text: "05 May 2026",
          event: "Client interview transcript recorded.",
          citation: "FILE-0001 p1.b1",
          needs_review: false,
          confidence: 0.9,
          ...lawyerFields({
            event_type: "other",
            legal_relevance: "This event is relevant to the client's case because the transcript was recorded.",
            issue_tags: ["procedure"],
          }),
        },
        {
          date_iso: "2026-05-06",
          date_text: "06 May 2026",
          event: "Email correspondence exported from client's Gmail account.",
          citation: "FILE-0001 p1.b2",
          needs_review: false,
          confidence: 0.9,
          ...lawyerFields({
            event_type: "other",
            legal_relevance: "This event is relevant because email correspondence was exported.",
            issue_tags: ["procedure"],
          }),
        },
        {
          date_iso: "2026-05-07",
          date_text: "07 May 2026",
          event: "Vakalatnama executed by Mehta.",
          citation: "FILE-0001 p1.b3",
          needs_review: false,
          confidence: 0.9,
          ...lawyerFields({
            event_type: "filing",
            legal_relevance: "This event is relevant because the vakalatnama was executed.",
            issue_tags: ["procedure"],
          }),
        },
        {
          date_iso: "2024-03-14",
          date_text: "14 March 2024",
          event: "Skyline replied demanding payment despite Mehta's complaint.",
          citation: "FILE-0001 p1.b4",
          needs_review: false,
          confidence: 0.92,
          ...lawyerFields({
            event_type: "reply",
            legal_relevance: "This event is relevant to the client's case because Skyline's response shows their willingness to resolve it and demonstrates emotional and financial impact.",
            issue_tags: ["notice", "hardship"],
          }),
        },
      ],
    }),
  });

  assert.equal(result.counts.candidateEntries, 4);
  assert.equal(result.counts.acceptedEntries, 1);
  assert.equal(result.counts.rejectedEntries, 3);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].citation, "FILE-0001 p1.b4");
  assert.doesNotMatch(result.entries[0].event, /transcript|exported|vakalatnama/i);
  assert.doesNotMatch(result.entries[0].legal_relevance, /This event is relevant|willingness|demonstrates/i);
  assert.match(result.entries[0].legal_relevance, /Supports the client's case/i);
  assert.match(result.entries[0].legal_relevance, /records the opposing party's stated response/i);
  assert.match(result.entries[0].legal_relevance, /may support hardship and consequential prejudice, subject to proof/i);
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
  assert.match(bodies[0].input[0].content, /lawyer-facing, client-favourable/);
  assert.match(bodies[0].input[0].content, /Every legal_relevance sentence must be supported/);
  assert.match(bodies[0].input[1].content, /allowed_event_types/);
  assert.match(bodies[0].input[1].content, /client_favourable/);
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

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["entries"],
    properties: {
      entries: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["citation", "confidence", "issue_tags"],
          properties: {
            citation: {
              type: "string",
              pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            issue_tags: {
              type: "array",
              maxItems: 8,
              items: {
                type: "string",
                minLength: 1,
                maxLength: 64,
              },
            },
          },
        },
      },
    },
  };

  const response = await provider({
    matter: {},
    chunk: [],
    chunkIndex: 1,
    chunkCount: 1,
    schema,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requests[0].headers.authorization, "Bearer sk-openrouter-test");
  assert.equal(requests[0].body.model, "qwen/qwen3-source-backed");
  assert.equal(requests[0].body.max_tokens, 1800);
  assert.equal(Object.hasOwn(requests[0].body, "temperature"), false);
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
  const requestSchema = requests[0].body.response_format.json_schema.schema;
  assert.equal(Object.hasOwn(requestSchema.properties.entries, "minItems"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries, "maxItems"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries.items.properties.citation, "pattern"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries.items.properties.confidence, "minimum"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries.items.properties.confidence, "maximum"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries.items.properties.issue_tags, "maxItems"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries.items.properties.issue_tags.items, "minLength"), false);
  assert.equal(Object.hasOwn(requestSchema.properties.entries.items.properties.issue_tags.items, "maxLength"), false);
  assert.equal(schema.properties.entries.maxItems, 3);
  assert.equal(schema.properties.entries.items.properties.confidence.maximum, 1);
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

test("OpenRouter provider surfaces upstream provider error details", async () => {
  const provider = createOpenRouterProvider({
    apiKey: "sk-openrouter-test",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-sonnet-4.6",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Provider returned error",
          code: 400,
          metadata: {
            provider_name: "Anthropic",
            raw: JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "output_config.format.schema: For 'number' type, properties maximum, minimum are not supported",
              },
            }),
          },
        },
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
      assert.equal(error.providerName, "Anthropic");
      assert.match(error.message, /Provider returned error/);
      assert.match(error.message, /provider: Anthropic/);
      assert.match(error.message, /maximum, minimum are not supported/);
      return true;
    },
  );
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
