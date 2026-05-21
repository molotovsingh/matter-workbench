import path from "node:path";
import {
  evidence,
  fileExists,
  normalizeText,
  readCsvFile,
  readJsonFile,
  sampleRowEvidence,
} from "./matter-attention-helpers.mjs";

export async function buildIntakeAttentionItems({ root, matterStore } = {}) {
  const items = [];
  const matterJsonPath = path.join(root, "matter.json");
  const matterJson = await readJsonFile(matterJsonPath);
  if (!matterJson.exists) {
    addItem(items, {
      severity: "blocker",
      category: "intake",
      code: "matter_json_missing",
      title: "matter.json is missing",
      detail: "Matter setup has not produced the root metadata file.",
      action: "Run matter setup or inspect the matter folder.",
      evidence: [evidence("matter.json")],
    });
  } else if (!matterJson.valid) {
    addItem(items, {
      severity: "blocker",
      category: "intake",
      code: "matter_json_invalid",
      title: "matter.json is unreadable",
      detail: matterJson.error,
      action: "Fix matter.json or rerun matter setup from a known-good source.",
      evidence: [evidence("matter.json")],
    });
  }

  const intakeFolders = await matterStore.listIntakeFolders(root);
  if (!intakeFolders.length) {
    addItem(items, {
      severity: "blocker",
      category: "intake",
      code: "no_intake_folders",
      title: "No intake folders found",
      detail: "The matter has no Intake NN folders under 00_Inbox.",
      action: "Add files through the matter intake flow.",
      evidence: [evidence("00_Inbox")],
    });
    return items;
  }

  for (const folder of intakeFolders) {
    await collectRegisterAttention({ root, items }, folder);
    await collectExtractionLogAttention({ root, items }, folder);
  }
  return items;
}

async function collectRegisterAttention({ root, items }, folder) {
  const registerRelative = `00_Inbox/${folder.name}/File Register.csv`;
  const registerPath = path.join(root, registerRelative);
  const register = await readCsvFile(registerPath);
  if (!register.exists) {
    addItem(items, {
      severity: "blocker",
      category: "intake",
      code: "file_register_missing",
      title: "File Register.csv is missing",
      detail: `Intake ${folder.name} cannot be reconciled with source files.`,
      action: "Rerun matter setup or run doctor before extraction.",
      evidence: [evidence(registerRelative)],
    });
    return;
  }
  if (!register.valid) {
    addItem(items, {
      severity: "blocker",
      category: "intake",
      code: "file_register_unreadable",
      title: "File Register.csv is unreadable",
      detail: register.error,
      action: "Fix the register CSV or regenerate the intake.",
      evidence: [evidence(registerRelative)],
    });
    return;
  }
  if (!register.rows.length) {
    addItem(items, {
      severity: "warning",
      category: "intake",
      code: "file_register_empty",
      title: "File register has no rows",
      detail: `Intake ${folder.name} exists but records no source files.`,
      action: "Confirm whether the intake was created with files.",
      evidence: [evidence(registerRelative)],
    });
  }

  const needsReviewRows = register.rows.filter((row) => normalizeText(row.category) === "Needs Review");
  if (needsReviewRows.length) {
    addItem(items, {
      severity: "warning",
      category: "intake",
      code: "files_need_review",
      title: "Some files need intake review",
      detail: `${needsReviewRows.length} file(s) could not be confidently classified during intake.`,
      action: "Inspect these files before relying on downstream artifacts.",
      evidence: sampleRowEvidence(registerRelative, needsReviewRows, "file_id"),
    });
  }

  const missingWorkingCopies = [];
  for (const row of register.rows) {
    if (normalizeText(row.status) !== "unique") continue;
    const workingCopy = normalizeText(row.working_copy_path);
    if (!workingCopy) {
      missingWorkingCopies.push(row);
      continue;
    }
    if (!(await fileExists(path.join(root, workingCopy)))) missingWorkingCopies.push(row);
  }
  if (missingWorkingCopies.length) {
    addItem(items, {
      severity: "blocker",
      category: "intake",
      code: "working_copy_missing",
      title: "Working copies referenced by the register are missing",
      detail: `${missingWorkingCopies.length} unique file(s) point to missing working copies.`,
      action: "Restore the files or rerun matter setup before extraction.",
      evidence: sampleRowEvidence(registerRelative, missingWorkingCopies, "file_id"),
    });
  }
}

async function collectExtractionLogAttention({ root, items }, folder) {
  const logRelative = `00_Inbox/${folder.name}/Extraction Log.csv`;
  const logPath = path.join(root, logRelative);
  const log = await readCsvFile(logPath);
  if (!log.exists) return;
  if (!log.valid) {
    addItem(items, {
      severity: "blocker",
      category: "extraction",
      code: "extraction_log_unreadable",
      title: "Extraction Log.csv is unreadable",
      detail: log.error,
      action: "Fix the extraction log or rerun extraction.",
      evidence: [evidence(logRelative)],
    });
    return;
  }

  const failed = log.rows.filter((row) => normalizeText(row.status) === "failed");
  const ocrRequired = log.rows.filter((row) => normalizeText(row.status) === "ocr-required-all");
  const reviewRows = log.rows.filter((row) => (
    positiveInteger(row.low_confidence_pages) > 0
    || positiveInteger(row.needs_review_pages) > 0
    || positiveInteger(row.provider_warnings_count) > 0
  ));
  const lowConfidenceOcr = reviewRows.filter((row) => isOcrReviewRow(row));
  const textLayoutReview = reviewRows.filter((row) => isTextLayerReviewRow(row));
  const skipped = log.rows.filter((row) => {
    const status = normalizeText(row.status);
    return status.startsWith("skipped-") && status !== "skipped-duplicate";
  });
  if (failed.length) {
    addItem(items, {
      severity: "blocker",
      category: "extraction",
      code: "extraction_failed",
      title: "Extraction failed for some files",
      detail: `${failed.length} file(s) have failed extraction rows.`,
      action: "Inspect extraction notes and rerun extraction after fixing the source issue.",
      evidence: sampleRowEvidence(logRelative, failed, "file_id"),
    });
  }
  if (ocrRequired.length) {
    addItem(items, {
      severity: "warning",
      category: "extraction",
      code: "ocr_required_all",
      title: "Some files produced OCR placeholders only",
      detail: `${ocrRequired.length} file(s) require OCR before they can be trusted as readable sources.`,
      action: "Run extraction with OCR support or replace the scans with better copies.",
      evidence: sampleRowEvidence(logRelative, ocrRequired, "file_id"),
    });
  }
  if (lowConfidenceOcr.length) {
    const lowConfidencePages = sumIntegerField(lowConfidenceOcr, "low_confidence_pages");
    const needsReviewPages = sumIntegerField(lowConfidenceOcr, "needs_review_pages");
    addItem(items, {
      severity: "warning",
      category: "extraction",
      code: "ocr_low_confidence",
      title: "OCR output needs review",
      detail: `${lowConfidenceOcr.length} extracted file(s) include OCR warnings, low-confidence pages, or pages marked for review. Low-confidence pages: ${lowConfidencePages}. Pages needing review: ${needsReviewPages}.`,
      action: "Compare the OCR text against the scans or replace poor copies before relying on source-backed outputs.",
      evidence: sampleRowEvidence(logRelative, lowConfidenceOcr, "file_id"),
    });
  }
  if (textLayoutReview.length) {
    const layoutPages = sumIntegerField(textLayoutReview, "multi_column_pages") || sumIntegerField(textLayoutReview, "needs_review_pages");
    addItem(items, {
      severity: "warning",
      category: "extraction",
      code: "text_layout_needs_review",
      title: "Extracted text layout needs review",
      detail: `${textLayoutReview.length} extracted file(s) used an embedded text layer with layout or reading-order warnings. Pages needing review: ${layoutPages}.`,
      action: "Run OCR-first extraction or compare the extracted text against the scans before relying on source-backed outputs.",
      evidence: sampleRowEvidence(logRelative, textLayoutReview, "file_id"),
    });
  }
  if (skipped.length) {
    addItem(items, {
      severity: "warning",
      category: "extraction",
      code: "extraction_skipped",
      title: "Some unsupported files were skipped during extraction",
      detail: `${skipped.length} file(s) were skipped due to unsupported or otherwise non-extractable formats.`,
      action: "Review whether the skipped files are material to the matter.",
      evidence: sampleRowEvidence(logRelative, skipped, "file_id"),
    });
  }
}

function isOcrReviewRow(row = {}) {
  const explicit = normalizeText(row.ocr_applied);
  if (explicit === "yes") return true;
  if (positiveInteger(row.ocr_required_pages) > 0) return true;
  if (normalizeText(row.ocr_provider_model)) return true;
  if (explicit === "no") return false;
  return positiveInteger(row.multi_column_pages) === 0;
}

function isTextLayerReviewRow(row = {}) {
  return normalizeText(row.ocr_applied) === "no"
    && (positiveInteger(row.needs_review_pages) > 0 || positiveInteger(row.multi_column_pages) > 0);
}

function addItem(items, item) {
  items.push(item);
}

function positiveInteger(value) {
  const number = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sumIntegerField(rows, field) {
  return rows.reduce((sum, row) => sum + positiveInteger(row[field]), 0);
}
