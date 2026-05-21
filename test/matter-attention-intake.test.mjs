import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIntakeAttentionItems } from "../services/matter-attention-intake.mjs";

test("matter attention intake reports missing setup and intake folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-intake-empty-"));
  const items = await buildIntakeAttentionItems({
    root,
    matterStore: { listIntakeFolders: async () => [] },
  });

  assert.deepEqual(items.map((item) => item.code), ["matter_json_missing", "no_intake_folders"]);
});

test("matter attention intake reads registers and extraction logs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-intake-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  const workingDir = path.join(intakeDir, "By Type", "Text Notes");
  await mkdir(workingDir, { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(workingDir, "FILE-0001__facts.txt"), "Facts\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,working_copy_path,category,status,notes",
    "FILE-0001,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,unique,",
    "FILE-0002,INTAKE-01,,Needs Review,unique,classification uncertain",
    "",
  ].join("\n"));
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), [
    "file_id,intake_id,status,low_confidence_pages,needs_review_pages,provider_warnings_count,notes",
    "FILE-0001,INTAKE-01,failed,0,0,0,parser error",
    "FILE-0002,INTAKE-01,ocr-required-all,0,0,0,scan only",
    "FILE-0003,INTAKE-01,skipped-unsupported-format,0,0,0,legacy msg",
    "FILE-0004,INTAKE-01,skipped-duplicate,0,0,0,duplicate",
    "FILE-0005,INTAKE-01,extracted,2,3,1,weak OCR",
    "",
  ].join("\n"));

  const items = await buildIntakeAttentionItems({
    root,
    matterStore: { listIntakeFolders: async () => [{ name: "Intake 01 - Initial" }] },
  });

  assert.deepEqual(items.map((item) => item.code), [
    "files_need_review",
    "working_copy_missing",
    "extraction_failed",
    "ocr_required_all",
    "ocr_low_confidence",
    "extraction_skipped",
  ]);
  assert.equal(items.find((item) => item.code === "working_copy_missing").severity, "blocker");
  assert.match(items.find((item) => item.code === "ocr_low_confidence").detail, /Low-confidence pages: 2\. Pages needing review: 3/);
  assert.equal(items.find((item) => item.code === "extraction_skipped").evidence[0].row, "FILE-0003");
});

test("matter attention separates OCR quality warnings from text-layer layout warnings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-intake-layout-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  await mkdir(intakeDir, { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), "file_id,status\nFILE-0001,unique\n");
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), [
    "file_id,intake_id,status,ocr_applied,low_confidence_pages,needs_review_pages,provider_warnings_count,multi_column_pages,notes",
    "FILE-0001,INTAKE-01,extracted,no,0,2,0,2,layout risk",
    "FILE-0002,INTAKE-01,extracted,yes,1,1,0,0,weak OCR",
    "",
  ].join("\n"));

  const items = await buildIntakeAttentionItems({
    root,
    matterStore: { listIntakeFolders: async () => [{ name: "Intake 01 - Initial" }] },
  });

  assert.ok(items.some((item) => item.code === "text_layout_needs_review"));
  assert.ok(items.some((item) => item.code === "ocr_low_confidence"));
  assert.equal(items.find((item) => item.code === "text_layout_needs_review").title, "Extracted text layout needs review");
  assert.equal(items.find((item) => item.code === "ocr_low_confidence").title, "OCR output needs review");
});

test("matter attention intake reports empty registers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-intake-empty-register-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  await mkdir(intakeDir, { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), "file_id,status\n");

  const items = await buildIntakeAttentionItems({
    root,
    matterStore: { listIntakeFolders: async () => [{ name: "Intake 01 - Initial" }] },
  });

  assert.equal(items[0].code, "file_register_empty");
  assert.equal(items[0].severity, "warning");
});
