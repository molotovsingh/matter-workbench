import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../shared/csv.mjs";
import { buildCustomSkillRunAttentionItems } from "./matter-attention-custom-runs.mjs";
import {
  normalizeAttentionItem,
  sortAttentionItems,
  summarizeAttentionItems,
} from "./matter-attention-items.mjs";
import {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import { buildCommandFailureAttentionItems } from "./matter-attention-command-failures.mjs";

export const MATTER_ATTENTION_SCHEMA_VERSION = "matter-attention/v1";

export function createMatterAttentionService({
  matterStore,
  matterStatusService = null,
  configurableSkillRunsService = null,
  commandInteractionLogService = null,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readMatterAttention(root = matterStore.ensureMatterRoot(), options = {}) {
    const matterName = normalizeText(options.matterName)
      || matterStore.activeMatterNameWithinHome?.()
      || path.basename(root);
    const items = [];
    const context = {
      root,
      matterName,
      items,
      status: await readMatterStatus(root),
    };

    await collectIntakeAttention(context);
    await collectSourceIndexAttention(context);
    await collectChronologyAttention(context);
    await collectCustomSkillRunAttention(context);
    await collectCommandFailureAttention(context);

    const orderedItems = sortAttentionItems(items);
    return {
      schema_version: MATTER_ATTENTION_SCHEMA_VERSION,
      generated_at: now().toISOString(),
      matterName,
      matterRoot: root,
      summary: summarizeAttentionItems(orderedItems),
      items: orderedItems,
    };
  }

  async function readMatterStatus(root) {
    if (!matterStatusService?.readMatterStatus) return null;
    try {
      return await matterStatusService.readMatterStatus(root);
    } catch (error) {
      return {
        read_error: error?.message || "Unable to read matter status.",
      };
    }
  }

  async function collectIntakeAttention(context) {
    const { root, items } = context;
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
      return;
    }

    for (const folder of intakeFolders) {
      await collectRegisterAttention(context, folder);
      await collectExtractionLogAttention(context, folder);
    }
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

  async function collectSourceIndexAttention(context) {
    const { root, items, status } = context;
    const sourcePath = path.join(root, SOURCE_INDEX_RELATIVE);
    const sourceIndex = await readJsonFile(sourcePath);
    const sourceStage = stageBySlash(status, "/describe_sources");
    const sourceAdvice = sourceStage?.rerunAdvice;

    if (!sourceIndex.exists) {
      if (sourceStage?.state === "not_run" && hasExtractionArtifacts(status)) {
        addItem(items, {
          severity: "warning",
          category: "source_labels",
          code: "source_index_missing",
          title: "Source Index is missing",
          detail: "Extraction artifacts exist, but Source Labels / Document Index has not produced Source Index.json.",
          action: "Run Source Labels before generating or relying on List of Dates.",
          evidence: [evidence(SOURCE_INDEX_RELATIVE)],
        });
      }
      return;
    }

    if (!sourceIndex.valid) {
      addItem(items, {
        severity: "blocker",
        category: "source_labels",
        code: "source_index_unreadable",
        title: "Source Index.json is unreadable",
        detail: sourceIndex.error,
        action: "Regenerate Source Labels or repair Source Index.json.",
        evidence: [evidence(SOURCE_INDEX_RELATIVE)],
      });
      return;
    }

    const sources = Array.isArray(sourceIndex.data?.sources) ? sourceIndex.data.sources : null;
    if (!sources) {
      addItem(items, {
        severity: "blocker",
        category: "source_labels",
        code: "source_index_schema_invalid",
        title: "Source Index.json has no sources[] array",
        detail: "The artifact exists but does not match the expected Source Index shape.",
        action: "Regenerate Source Labels.",
        evidence: [evidence(SOURCE_INDEX_RELATIVE)],
      });
      return;
    }

    const needsReview = sources.filter((source) => (
      source?.needs_review === true || normalizeText(source?.label_status) === "needs_review"
    ));
    if (needsReview.length) {
      addItem(items, {
        severity: "warning",
        category: "source_labels",
        code: "source_labels_need_review",
        title: "Some source labels need review",
        detail: `${needsReview.length} source label(s) are marked needs_review.`,
        action: "Confirm or override labels before relying on lawyer-facing citations.",
        evidence: sampleSourceEvidence(needsReview),
      });
    }

    const leakyLabels = sources.filter((source) => hasDeveloperNameLeak([
      source?.display_label,
      source?.short_label,
      source?.confirmed_label,
      source?.suggested_label,
    ]));
    if (leakyLabels.length) {
      addItem(items, {
        severity: "warning",
        category: "source_labels",
        code: "source_label_developer_name",
        title: "Some source labels contain developer identifiers",
        detail: `${leakyLabels.length} label(s) appear to expose internal file IDs, hashes, or paths.`,
        action: "Rename or confirm lawyer-safe labels before rendering downstream documents.",
        evidence: sampleSourceEvidence(leakyLabels),
      });
    }

    if (Number.isInteger(sourceIndex.data?.source_record_count) && sourceIndex.data.source_record_count !== sources.length) {
      addItem(items, {
        severity: "warning",
        category: "source_labels",
        code: "source_index_count_mismatch",
        title: "Source Index count does not match sources[]",
        detail: `source_record_count is ${sourceIndex.data.source_record_count}, but sources[] has ${sources.length} item(s).`,
        action: "Regenerate Source Labels if this was not an intentional legacy artifact.",
        evidence: [evidence(SOURCE_INDEX_RELATIVE)],
      });
    }

    addRerunAdviceAttention(items, "source_labels", sourceAdvice, {
      staleTitle: "Source Labels may be stale",
      staleAction: "Review rerun advice and regenerate labels if newer extraction records are material.",
    });
  }

  async function collectChronologyAttention(context) {
    const { root, items, status } = context;
    const listJson = await readJsonFile(path.join(root, LIST_OF_DATES_JSON_RELATIVE));
    const markdownExists = await fileExists(path.join(root, LIST_OF_DATES_MARKDOWN_RELATIVE));
    const listStage = stageBySlash(status, "/create_listofdates");
    const listAdvice = listStage?.rerunAdvice;

    if (listJson.exists && !listJson.valid) {
      addItem(items, {
        severity: "blocker",
        category: "chronology",
        code: "listofdates_json_unreadable",
        title: "List of Dates.json is unreadable",
        detail: listJson.error,
        action: "Repair or regenerate List of Dates before using chronology-dependent skills.",
        evidence: [evidence(LIST_OF_DATES_JSON_RELATIVE)],
      });
    }

    if (markdownExists && !listJson.exists) {
      addItem(items, {
        severity: "warning",
        category: "chronology",
        code: "listofdates_json_missing",
        title: "List of Dates markdown exists without JSON metadata",
        detail: "The lawyer-facing markdown exists, but the machine-readable chronology state is missing.",
        action: "Regenerate List of Dates or recover the JSON sidecar before downstream drafting.",
        evidence: [evidence(LIST_OF_DATES_MARKDOWN_RELATIVE), evidence(LIST_OF_DATES_JSON_RELATIVE)],
      });
    }
    if (!markdownExists && listJson.exists) {
      addItem(items, {
        severity: "warning",
        category: "chronology",
        code: "listofdates_markdown_missing",
        title: "List of Dates JSON exists without markdown",
        detail: "The machine-readable chronology exists, but the lawyer-facing markdown is missing.",
        action: "Refresh labels/rendering or regenerate List of Dates.",
        evidence: [evidence(LIST_OF_DATES_JSON_RELATIVE), evidence(LIST_OF_DATES_MARKDOWN_RELATIVE)],
      });
    }
    if (!markdownExists && !listJson.exists && stageBySlash(status, "/describe_sources")?.state === "present") {
      addItem(items, {
        severity: "warning",
        category: "chronology",
        code: "listofdates_missing",
        title: "List of Dates has not been generated",
        detail: "Source Labels exist, but the hero chronology artifact is missing.",
        action: "Run Create List of Dates when the source labels are acceptable.",
        evidence: [evidence(LIST_OF_DATES_MARKDOWN_RELATIVE)],
      });
    }

    addRerunAdviceAttention(items, "chronology", listAdvice, {
      staleTitle: "List of Dates dependency state needs attention",
      staleAction: "Use the dependency state to choose label refresh, review, or regeneration.",
    });
  }

  async function collectCustomSkillRunAttention({ matterName, items }) {
    const customRunItems = await buildCustomSkillRunAttentionItems({
      configurableSkillRunsService,
      matterName,
    });
    for (const item of customRunItems) addItem(items, item);
  }

  async function collectCommandFailureAttention({ matterName, items }) {
    const commandItems = await buildCommandFailureAttentionItems({
      commandInteractionLogService,
      matterName,
    });
    for (const item of commandItems) addItem(items, item);
  }

  return { readMatterAttention };
}

function addRerunAdviceAttention(items, category, advice, { staleTitle, staleAction }) {
  if (!advice) return;
  if (advice.state === "failed") {
    addItem(items, {
      severity: "blocker",
      category,
      code: `${category}_artifact_unreadable`,
      title: `${advice.label || advice.skill} artifact is unreadable`,
      detail: advice.reason || "Rerun advice could not read the current artifact.",
      action: "Repair or regenerate the artifact.",
      evidence: advice.artifactPath ? [evidence(advice.artifactPath)] : [],
    });
  } else if (advice.state === "stale") {
    addItem(items, {
      severity: "warning",
      category,
      code: `${category}_stale`,
      title: staleTitle,
      detail: joinDetailSentences([
        advice.reason,
        advice.dependencyState ? `Dependency state: ${advice.dependencyState}.` : "",
        advice.newestInputPath ? `Newest input: ${advice.newestInputPath}.` : "",
      ]),
      action: staleAction,
      evidence: [advice.artifactPath, advice.newestInputPath].filter(Boolean).map((item) => evidence(item)),
      occurredAt: advice.newestInputAt || "",
    });
  } else if (advice.state === "missing_upstream") {
    addItem(items, {
      severity: "warning",
      category,
      code: `${category}_missing_upstream`,
      title: `${advice.label || advice.skill} has no upstream inputs`,
      detail: "The artifact exists, but rerun advice did not find usable upstream inputs.",
      action: "Check extraction records and Source Index dependencies.",
      evidence: advice.artifactPath ? [evidence(advice.artifactPath)] : [],
    });
  }
}

function addItem(items, item) {
  items.push(normalizeAttentionItem(item));
}

async function readJsonFile(filePath) {
  try {
    const data = JSON.parse(await readFile(filePath, "utf8"));
    return { exists: true, valid: true, data };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, valid: false, data: null, error: "" };
    return { exists: true, valid: false, data: null, error: error?.message || "Invalid JSON" };
  }
}

async function readCsvFile(filePath) {
  try {
    return {
      exists: true,
      valid: true,
      rows: parseCsv(await readFile(filePath, "utf8")),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, valid: false, rows: [], error: "" };
    return { exists: true, valid: false, rows: [], error: error?.message || "Invalid CSV" };
  }
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function evidence(relativePath, extra = {}) {
  return {
    path: normalizeText(relativePath),
    ...extra,
  };
}

function sampleRowEvidence(relativePath, rows, key) {
  return rows.slice(0, 5).map((row) => ({
    path: relativePath,
    row: normalizeText(row[key] || row.file_id || row.status || ""),
    status: normalizeText(row.status),
    notes: normalizeText(row.notes, 240),
  }));
}

function sampleSourceEvidence(sources) {
  return sources.slice(0, 5).map((source) => ({
    path: SOURCE_INDEX_RELATIVE,
    source_id: normalizeText(source?.source_id || source?.file_id),
    label_status: normalizeText(source?.label_status),
  }));
}

function stageBySlash(status, slash) {
  if (!status || !Array.isArray(status.stages)) return null;
  return status.stages.find((stage) => stage.slash === slash) || null;
}

function hasExtractionArtifacts(status) {
  return stageBySlash(status, "/extract")?.state === "present";
}

function hasDeveloperNameLeak(values) {
  return values.some((value) => {
    const text = normalizeText(value);
    return /\bFILE-\d{3,}\b/i.test(text)
      || /[a-f0-9]{32,}/i.test(text)
      || /00_Inbox|10_Library|20_Workshop|30_Drafts|40_Dispatch/.test(text);
  });
}

function joinDetailSentences(parts) {
  return parts
    .map((part) => sentenceWithTerminalPunctuation(part))
    .filter(Boolean)
    .join(" ");
}

function sentenceWithTerminalPunctuation(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return /[.!?:;]$/.test(text) ? text : `${text}.`;
}

function normalizeText(value, maxLength = 800) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
