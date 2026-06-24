import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";
import { toCsv } from "../shared/csv.mjs";

const HASH_ONE = "1".repeat(64);

async function withServer(run, options = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-copilot-receipts-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const receiptsPath = path.join(tmp, "receipts.json");
  await mkdir(appDir, { recursive: true });
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome, COPILOT_WEB_RESEARCH_ENABLED: "1", EXA_API_KEY: "exa-test", ...(options.env || {}) },
    host: "127.0.0.1",
    port: 0,
    copilotInteractionReceiptsPath: receiptsPath,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
    ...(options.serverOptions || {}),
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    await run({ app, baseUrl, mattersHome, receiptsPath });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function postJsonRaw(baseUrl, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("Copilot Research route writes compact interaction receipt", async () => {
  await withServer(async ({ baseUrl, mattersHome }) => {
    const matterRoot = path.join(mattersHome, "Receipt Matter");
    await mkdir(matterRoot, { recursive: true });
    await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({ matter_name: "Receipt Matter" }, null, 2));

    const result = await postJsonRaw(baseUrl, "/api/matter-copilot/research", {
      question: "Which NCLT sections apply?",
      matterName: "Receipt Matter",
    });
    assert.equal(result.response.status, 200);

    const receipts = await getJson(baseUrl, "/api/copilot-interaction-receipts?matter=Receipt%20Matter&mode=research");
    assert.equal(receipts.schema_version, "copilot-interaction-receipts-ledger/v1");
    assert.equal(receipts.receipts.length, 1);
    assert.equal(receipts.receipts[0].mode, "research");
    assert.equal(receipts.receipts[0].matterName, "Receipt Matter");
    assert.equal(receipts.receipts[0].outcome, "partial");
    assert.deepEqual(receipts.receipts[0].sourceSummary.publicSourceIds, ["WEB-0001"]);
    assert.equal(receipts.receipts[0].aiRun.task, "copilot_web_research");
    assert.doesNotMatch(JSON.stringify(receipts), /matter-context-packet|Section 60\(5\)\./);
  }, {
    serverOptions: {
      copilotWebResearchAnswerProvider: async ({ publicSources }) => ({
        answer_status: "partial",
        answer_markdown: "Research answer from public sources",
        public_sources: [{ id: publicSources[0].id }],
        warnings: ["Verify authorities before relying or filing."],
        ai_run: { provider: "openrouter", model: "openai/gpt-5.4", task: "copilot_web_research" },
      }),
      copilotWebResearchProvider: async () => ({
        query: "NCLT IBC",
        sources: [{ id: "WEB-0001", title: "IBC", url: "https://example.test/ibc", sourceType: "official", snippet: "Section 60(5)." }],
      }),
    },
  });
});

test("Copilot Ask route writes compact interaction receipt", async () => {
  await withServer(async ({ baseUrl, mattersHome }) => {
    await makeMatterRoot(mattersHome, "Ask Matter");
    const result = await postJsonRaw(baseUrl, "/api/matter-copilot/answer", {
      question: "Which date started the lis?",
      matterName: "Ask Matter",
      conversation: [{ role: "user", mode: "ask", content: "What is the procedural history?" }],
    });
    assert.equal(result.response.status, 200);

    const receipts = await getJson(baseUrl, "/api/copilot-interaction-receipts?matter=Ask%20Matter&mode=ask");
    assert.equal(receipts.receipts.length, 1);
    assert.equal(receipts.receipts[0].mode, "ask");
    assert.equal(receipts.receipts[0].outcome, "answered");
    assert.deepEqual(receipts.receipts[0].sourceSummary.matterSourceIds, ["FILE-0001 p1.b1"]);
    assert.equal(receipts.receipts[0].context.conversationTurns, 1);
  }, {
    serverOptions: {
      matterCopilotProvider: async () => ({
        answer_status: "answered",
        answer_markdown: "The record points to 21 January 2013.",
        confidence: 0.8,
        sources: [{ raw_citation: "FILE-0001 p1.b1", source_label: "Consumer complaint filing record", snippet: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013." }],
        warnings: [],
      }),
    },
  });
});

test("Copilot receipt route can record failures without breaking the original error", async () => {
  await withServer(async ({ baseUrl }) => {
    const result = await postJsonRaw(baseUrl, "/api/matter-copilot/research", {
      question: "Which NCLT sections apply?",
      matterName: "Missing Matter",
    });
    assert.equal(result.response.status, 404);

    const receipts = await getJson(baseUrl, "/api/copilot-interaction-receipts?mode=research");
    assert.equal(receipts.receipts.length, 1);
    assert.equal(receipts.receipts[0].outcome, "error");
    assert.equal(receipts.receipts[0].errorCode, "matter_store.not_found");
  }, {
    serverOptions: {
      copilotWebResearchAnswerProvider: async () => ({ answer_status: "not_found", public_sources: [] }),
      copilotWebResearchProvider: async () => ({ query: "NCLT", sources: [{ id: "WEB-0001" }] }),
    },
  });
});

async function makeMatterRoot(mattersHome, name) {
  const root = path.join(mattersHome, name);
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: name,
    client_name: "Client",
    opposite_party: "Opposite",
    matter_type: "consumer dispute",
    jurisdiction: "India",
    intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
  }, null, 2)}\n`);
  await writeFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    toCsv([{
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/complaint.pdf",
      original_path: "00_Inbox/Intake 01 - Initial/Originals/FILE-0001__complaint.pdf",
      working_copy_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__complaint.pdf",
      category: "PDFs",
      original_name: "complaint.pdf",
      sha256: HASH_ONE,
      size_bytes: "128",
      duplicate_of: "",
      status: "unique",
    }], ["file_id", "intake_id", "source_path", "original_path", "working_copy_path", "category", "original_name", "sha256", "size_bytes", "duplicate_of", "status"]),
  );
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), `${JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: HASH_ONE,
    source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__complaint.pdf",
    page_count: 1,
    pages: [{ page: 1, blocks: [{ id: "p1.b1", text: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013." }] }],
    warnings: [],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    schema_version: "source-index/v1",
    sources: [{ file_id: "FILE-0001", sha256: HASH_ONE, source_id: "FILE-0001", display_label: "Consumer complaint filing record", short_label: "Complaint filing record", needs_review: false }],
  }, null, 2)}\n`);
}
