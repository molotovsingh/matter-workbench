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

test("extractSearchQuery handles varied search phrasing and whitespace", () => {
  assert.equal(extractSearchQuery("find   Skyline"), "Skyline");
  assert.equal(extractSearchQuery("Search FOR   MCLR interest rate"), "MCLR interest rate");
  assert.equal(extractSearchQuery("LOOK for the rent agreement"), "the rent agreement");
  assert.equal(extractSearchQuery("Locate FILE-0006"), "FILE-0006");
  assert.equal(extractSearchQuery("Show me Italian marble clause"), "Italian marble clause");
  assert.equal(extractSearchQuery("Find  notice served to opposite party"), "notice served to opposite party");
});

test("extractSearchQuery passes clean inputs through unchanged", () => {
  assert.equal(extractSearchQuery("Skyline"), "Skyline");
  assert.equal(extractSearchQuery("rent agreement"), "rent agreement");
  assert.equal(extractSearchQuery("FILE-0006"), "FILE-0006");
  assert.equal(extractSearchQuery("MCLR plus 2 percent"), "MCLR plus 2 percent");
  assert.equal(extractSearchQuery("Rs. 5,00,000"), "Rs. 5,00,000");
});

test("extractSearchQuery does not strip non-search verbs", () => {
  assert.equal(extractSearchQuery("what is the contract about"), "what is the contract about");
  assert.equal(extractSearchQuery("who is the plaintiff"), "who is the plaintiff");
  assert.equal(extractSearchQuery("how much compensation was demanded"), "how much compensation was demanded");
  assert.equal(extractSearchQuery("why was possession delayed"), "why was possession delayed");
  assert.equal(extractSearchQuery("when is the possession deadline"), "when is the possession deadline");
});

test("extractSearchQuery returns original when strip leaves nothing", () => {
  assert.equal(extractSearchQuery("find"), "find");
  assert.equal(extractSearchQuery("search"), "search");
  assert.equal(extractSearchQuery("locate"), "locate");
});

test("isLocalOnlyIntent identifies slash commands", () => {
  assert.equal(isLocalOnlyIntent("/extract"), true);
  assert.equal(isLocalOnlyIntent("/create_listofdates"), true);
  assert.equal(isLocalOnlyIntent("/doctor"), true);
  assert.equal(isLocalOnlyIntent("/matter-init"), true);
});

test("isLocalOnlyIntent identifies greetings", () => {
  assert.equal(isLocalOnlyIntent("hello"), true);
  assert.equal(isLocalOnlyIntent("hey there"), true);
  assert.equal(isLocalOnlyIntent("good morning"), true);
  assert.equal(isLocalOnlyIntent("good evening"), true);
  assert.equal(isLocalOnlyIntent("howdy"), true);
  assert.equal(isLocalOnlyIntent("hi"), true);
});

test("isLocalOnlyIntent identifies short casual remarks", () => {
  assert.equal(isLocalOnlyIntent("thanks"), true);
  assert.equal(isLocalOnlyIntent("ok"), true);
  assert.equal(isLocalOnlyIntent("bye"), true);
  assert.equal(isLocalOnlyIntent("cool"), true);
  assert.equal(isLocalOnlyIntent("nice"), true);
  assert.equal(isLocalOnlyIntent("thank you"), true);
  assert.equal(isLocalOnlyIntent("see you"), true);
});

test("isLocalOnlyIntent rejects matter-requiring inputs", () => {
  assert.equal(isLocalOnlyIntent("what is the contract about"), false);
  assert.equal(isLocalOnlyIntent("find Skyline"), false);
  assert.equal(isLocalOnlyIntent("search for termination clause"), false);
  assert.equal(isLocalOnlyIntent("extract the PDFs"), false);
  assert.equal(isLocalOnlyIntent("I need a skill for drafting motions"), false);
  assert.equal(isLocalOnlyIntent("summarize the notice"), false);
  assert.equal(isLocalOnlyIntent("who is the opposite party"), false);
  assert.equal(isLocalOnlyIntent("show me the compensation details"), false);
});

test("isLocalOnlyIntent rejects long casual-like sentences", () => {
  assert.equal(isLocalOnlyIntent("thanks for the detailed analysis of the contract"), false);
  assert.equal(isLocalOnlyIntent("ok let's look at the Skyline agreement"), false);
});

test("isLocalOnlyIntent handles edge cases", () => {
  assert.equal(isLocalOnlyIntent(""), false);
  assert.equal(isLocalOnlyIntent(null), false);
  assert.equal(isLocalOnlyIntent(undefined), false);
  assert.equal(isLocalOnlyIntent("   "), false);
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

test("search service finds results across diverse queries", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-search-diverse-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Diverse Matter");
  const appDir = path.join(tmp, "app");

  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  await mkdir(path.join(intakeDir, "By Type", "Text Notes"), { recursive: true });
  await mkdir(path.join(intakeDir, "By Type", "Emails"), { recursive: true });
  await mkdir(path.join(intakeDir, "_extracted"), { recursive: true });
  await mkdir(appDir, { recursive: true });

  await writeFile(path.join(intakeDir, "By Type", "Text Notes", "notice.txt"), "Legal notice served to Skyline Builders on 15 Jan 2024.");
  await writeFile(path.join(intakeDir, "By Type", "Emails", "correspondence.txt"), "Email from Mehta regarding Italian marble specification.");
  await writeFile(path.join(intakeDir, "_extracted", "FILE-0001.json"), JSON.stringify({
    file_id: "FILE-0001", pages: [{ blocks: [{ id: "p1.b1", text: "MCLR plus 2 percent delay compensation clause" }] }],
  }));

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const searchService = createMatterSearchService({ matterStore });

  const skylineResults = await searchService.search({ query: "Skyline" });
  assert.ok(skylineResults.totalResults >= 1);

  const mclrResults = await searchService.search({ query: "MCLR" });
  assert.ok(mclrResults.totalResults >= 1);
  assert.match(mclrResults.results[0].snippet, /\*\*MCLR\*\*/i);

  const marbleResults = await searchService.search({ query: "Italian marble" });
  assert.ok(marbleResults.totalResults >= 1);

  const noResults = await searchService.search({ query: "xyznonexistent123" });
  assert.equal(noResults.totalResults, 0);
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
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "By Type", "Needs Review", "deploy.sh"),
    "Skyline deployment helper",
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

test("search service handles multi-intake matter with dot-directories skipped", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-search-multi-intake-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Multi Intake Matter");
  const appDir = path.join(tmp, "app");

  const intake1 = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  const intake2 = path.join(matterRoot, "00_Inbox", "Intake 02 - Follow Up");
  await mkdir(path.join(intake1, "By Type", "Text Notes"), { recursive: true });
  await mkdir(path.join(intake2, "By Type", "Text Notes"), { recursive: true });
  await mkdir(path.join(matterRoot, ".git", "objects"), { recursive: true });
  await mkdir(appDir, { recursive: true });

  await writeFile(path.join(intake1, "By Type", "Text Notes", "notice.txt"), "Initial notice to Skyline Builders.");
  await writeFile(path.join(intake2, "By Type", "Text Notes", "reply.txt"), "Reply from Skyline Builders rejecting compensation.");
  await writeFile(path.join(matterRoot, ".git", "objects", "pack.txt"), "Skyline index pack data");

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const searchService = createMatterSearchService({ matterStore });

  const results = await searchService.search({ query: "Skyline" });
  assert.equal(results.totalResults, 2);
  assert.ok(!results.results.some((r) => r.path.includes(".git")));
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

test("QA service discovers extraction records across multiple intakes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-qa-multi-intake-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Multi QA Matter");
  const appDir = path.join(tmp, "app");

  const intake1 = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  const intake2 = path.join(matterRoot, "00_Inbox", "Intake 02 - Follow Up");
  await mkdir(path.join(intake1, "_extracted"), { recursive: true });
  await mkdir(path.join(intake2, "_extracted"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "matter.json"),
    JSON.stringify({
      matter_name: "Multi QA",
      intakes: [
        { intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" },
        { intake_id: "INTAKE-02", intake_dir: "00_Inbox/Intake 02 - Follow Up" },
      ],
    }),
  );
  await writeFile(
    path.join(intake1, "File Register.csv"),
    "file_id,original_name,category,status\nFILE-0001,notice.txt,Text Notes,active\n",
  );
  await writeFile(
    path.join(intake2, "File Register.csv"),
    "file_id,original_name,category,status\nFILE-0002,reply.txt,Text Notes,active\n",
  );
  await writeFile(
    path.join(intake1, "_extracted", "FILE-0001.json"),
    JSON.stringify({ file_id: "FILE-0001", pages: [{ blocks: [{ id: "p1.b1", text: "Initial notice about Skyline" }] }] }),
  );
  await writeFile(
    path.join(intake2, "_extracted", "FILE-0002.json"),
    JSON.stringify({ file_id: "FILE-0002", pages: [{ blocks: [{ id: "p1.b1", text: "Reply from Skyline rejecting claim" }] }] }),
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const qaService = createMatterQaService({ matterStore, env: {} });

  const context = await qaService.getConversation(matterRoot);
  assert.ok(Array.isArray(context));
});

test("QA service works with employment dispute matter", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-qa-employment-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Sharma Employment");
  const appDir = path.join(tmp, "app");

  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  await mkdir(path.join(intakeDir, "_extracted"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "matter.json"),
    JSON.stringify({
      matter_name: "Sharma Employment Dispute",
      matter_type: "employment",
      client_name: "Priya Sharma",
      opposite_party: "TechCorp India",
      jurisdiction: "India",
      brief_description: "Wrongful termination and unpaid bonus dispute.",
      intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
    }),
  );
  await writeFile(
    path.join(intakeDir, "File Register.csv"),
    "file_id,original_name,category,status\nFILE-0001,offer-letter.txt,Text Notes,active\n",
  );
  await writeFile(
    path.join(intakeDir, "_extracted", "FILE-0001.json"),
    JSON.stringify({ file_id: "FILE-0001", pages: [{ blocks: [{ id: "p1.b1", text: "TechCorp offered Rs. 18 LPA with annual bonus clause" }] }] }),
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const qaService = createMatterQaService({ matterStore, env: {} });

  const context = await qaService.getConversation(matterRoot);
  assert.ok(Array.isArray(context));
});

test("QA service handles matter with no extraction records yet", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-qa-empty-ext-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Empty Extract Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "matter.json"),
    JSON.stringify({ matter_name: "Empty Extract", intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }] }),
  );
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    "file_id,original_name,category,status\nFILE-0001,contract.pdf,PDFs,active\n",
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const qaService = createMatterQaService({ matterStore, env: {} });

  const context = await qaService.getConversation(matterRoot);
  assert.ok(Array.isArray(context));
});

test("QA service discovers custom-named library directory", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-qa-custom-lib-"));
  const mattersHome = tmp;
  const matterRoot = path.join(mattersHome, "Custom Lib Matter");
  const appDir = path.join(tmp, "app");

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(path.join(matterRoot, "20_Analysis"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "matter.json"),
    JSON.stringify({ matter_name: "Custom Lib", intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }] }),
  );
  await writeFile(
    path.join(matterRoot, "20_Analysis", "risk-assessment.json"),
    JSON.stringify({ file_id: "RISK-01", pages: [{ blocks: [{ id: "p1.b1", text: "High risk clause on indemnification" }] }] }),
  );

  const configService = createConfigService({ appDir, env: { MATTERS_HOME: mattersHome } });
  await configService.load();
  const matterStore = createMatterStore({ configService, initialMatterRoot: matterRoot });
  const qaService = createMatterQaService({ matterStore, env: {} });

  const context = await qaService.getConversation(matterRoot);
  assert.ok(Array.isArray(context));
});
