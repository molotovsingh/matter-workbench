import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractSearchQuery } from "../services/unibox-service.mjs";
import { isLocalOnlyIntent } from "../shared/local-intent.mjs";
import { createMatterSearchService } from "../services/matter-search-service.mjs";
import { createMatterQaService } from "../services/matter-qa-service.mjs";
import { createConfigService } from "../services/config-service.mjs";
import { createMatterStore } from "../services/matter-store.mjs";

test("extractSearchQuery strips search-verb prefixes", () => {
  assert.equal(extractSearchQuery("find Skyline"), "Skyline");
  assert.equal(extractSearchQuery("search for termination clause"), "termination clause");
  assert.equal(extractSearchQuery("look for emails from plaintiff"), "emails from plaintiff");
  assert.equal(extractSearchQuery("locate the contract"), "the contract");
  assert.equal(extractSearchQuery("show me all invoices"), "all invoices");
  assert.equal(extractSearchQuery("search Skyline"), "Skyline");
});

test("extractSearchQuery passes clean inputs through unchanged", () => {
  assert.equal(extractSearchQuery("Skyline"), "Skyline");
  assert.equal(extractSearchQuery("rent agreement"), "rent agreement");
  assert.equal(extractSearchQuery("FILE-0006"), "FILE-0006");
});

test("extractSearchQuery does not strip non-search verbs", () => {
  assert.equal(extractSearchQuery("what is the contract about"), "what is the contract about");
  assert.equal(extractSearchQuery("who is the plaintiff"), "who is the plaintiff");
});

test("extractSearchQuery returns original when strip leaves nothing", () => {
  assert.equal(extractSearchQuery("find"), "find");
  assert.equal(extractSearchQuery("search"), "search");
});

test("isLocalOnlyIntent identifies slash commands", () => {
  assert.equal(isLocalOnlyIntent("/extract"), true);
  assert.equal(isLocalOnlyIntent("/create_listofdates"), true);
});

test("isLocalOnlyIntent identifies greetings", () => {
  assert.equal(isLocalOnlyIntent("hello"), true);
  assert.equal(isLocalOnlyIntent("hey there"), true);
  assert.equal(isLocalOnlyIntent("good morning"), true);
});

test("isLocalOnlyIntent identifies short casual remarks", () => {
  assert.equal(isLocalOnlyIntent("thanks"), true);
  assert.equal(isLocalOnlyIntent("ok"), true);
  assert.equal(isLocalOnlyIntent("bye"), true);
});

test("isLocalOnlyIntent rejects matter-requiring inputs", () => {
  assert.equal(isLocalOnlyIntent("what is the contract about"), false);
  assert.equal(isLocalOnlyIntent("find Skyline"), false);
  assert.equal(isLocalOnlyIntent("search for termination clause"), false);
  assert.equal(isLocalOnlyIntent("extract the PDFs"), false);
  assert.equal(isLocalOnlyIntent("I need a skill for drafting motions"), false);
});

test("isLocalOnlyIntent rejects long casual-like sentences", () => {
  assert.equal(isLocalOnlyIntent("thanks for the detailed analysis of the contract"), false);
});

test("isLocalOnlyIntent handles edge cases", () => {
  assert.equal(isLocalOnlyIntent(""), false);
  assert.equal(isLocalOnlyIntent(null), false);
  assert.equal(isLocalOnlyIntent(undefined), false);
});

test("search service skips Originals directories", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-search-test-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Test Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Originals"), { recursive: true });
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "By Type", "Text Notes"), { recursive: true });
  await mkdir(appDir, { recursive: true });

  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Originals", "contract.txt"),
    "Skyline Apartments lease agreement",
  );
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "By Type", "Text Notes", "notes.txt"),
    "Skyline Apartments meeting notes",
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const searchService = createMatterSearchService({ matterStore });

  const results = await searchService.search({ query: "Skyline" });
  assert.equal(results.totalResults, 1);
  assert.ok(results.results[0].path.includes("By Type"));
  assert.ok(!results.results[0].path.includes("Originals"));
});

test("search service skips non-record file extensions", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-search-ext-test-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Ext Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "By Type", "Needs Review"), { recursive: true });
  await mkdir(appDir, { recursive: true });

  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "By Type", "Needs Review", "generate-docs.py"),
    "Skyline document generator script",
  );
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "By Type", "Needs Review", "notes.txt"),
    "Skyline Apartments discussion notes",
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const searchService = createMatterSearchService({ matterStore });

  const results = await searchService.search({ query: "Skyline" });
  assert.equal(results.totalResults, 1);
  assert.ok(results.results[0].path.endsWith(".txt"));
});

test("search service still finds JSON extraction records", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-search-json-test-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Json Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(appDir, { recursive: true });

  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"),
    JSON.stringify({ file_id: "FILE-0001", pages: [{ blocks: [{ id: "p1.b1", text: "Skyline lease clause" }] }] }),
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const searchService = createMatterSearchService({ matterStore });

  const results = await searchService.search({ query: "Skyline" });
  assert.equal(results.totalResults, 1);
  assert.ok(results.results[0].path.includes("_extracted"));
});

test("QA service discovers intakes dynamically via matterStore", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-qa-dynamic-test-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Dynamic Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "matter.json"),
    JSON.stringify({ matter_name: "Dynamic", intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }] }),
  );
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    "file_id,original_name,category,status\nFILE-0001,lease.txt,Text Notes,active\n",
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const qaService = createMatterQaService({ matterStore, env: {} });

  const context = await qaService.getConversation(matterRoot);
  assert.ok(Array.isArray(context));
});

test("QA service discovers library content without hardcoding 10_Library", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-qa-lib-test-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Lib Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "matter.json"),
    JSON.stringify({ matter_name: "Lib", intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }] }),
  );
  await writeFile(
    path.join(matterRoot, "10_Library", "List of Dates.json"),
    JSON.stringify({ file_id: "DATES-01", pages: [{ blocks: [{ id: "p1.b1", text: "Event on 2026-04-20" }] }] }),
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const qaService = createMatterQaService({ matterStore, env: {} });

  const context = await qaService.getConversation(matterRoot);
  assert.ok(Array.isArray(context));
});
