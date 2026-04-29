#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_CASES_DIR = path.join(os.homedir(), "Downloads");
const DEFAULT_MATTERS_DIR = path.join(os.homedir(), "matters-matter-workbench");
const GOLDEN_FILENAME = "GOLDEN_LIST_OF_DATES.md";
const GENERATED_RELATIVE_PATH = path.join("10_Library", "List of Dates.md");
const GENERATED_JSON_FILENAME = "List of Dates.json";
const CITATION_RE = /\b(FILE-\d{4,})\s+p(\d+)\.b(\d+|\?)(?=\s|$|[`).,;:])/;
const RAW_CITATION_RE = /\bFILE-\d{4,}\s+p\d+\.b\d+(?=\s|$|[`).,;:])/;
const BANNED_UNSUPPORTED_CONCLUSIONS = [
  /\bfraud\b/i,
  /\bbad faith\b/i,
  /\bbreach proved\b/i,
  /\bliability admitted\b/i,
  /\bproved\b/i,
];

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "under",
  "with",
]);

function parseArgs(argv) {
  const options = {
    casesDir: DEFAULT_CASES_DIR,
    mattersDir: DEFAULT_MATTERS_DIR,
    json: false,
    allowExtra: false,
    requireLawyerFacing: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases-dir") {
      options.casesDir = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--matters-dir") {
      options.mattersDir = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--allow-extra") {
      options.allowExtra = true;
    } else if (arg === "--require-lawyer-facing") {
      options.requireLawyerFacing = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node evals/listofdates/check-golden-listofdates.mjs [options]

Compare dummy-case GOLDEN_LIST_OF_DATES.md files against generated
10_Library/List of Dates.md artifacts.

Options:
  --cases-dir DIR    Folder containing case_* dummy folders (default: ~/Downloads)
  --matters-dir DIR  Folder containing generated matter folders (default: ~/matters-matter-workbench)
  --allow-extra      Do not fail the process for extra generated events
  --require-lawyer-facing
                     Require proposed lawyer-facing fields in generated JSON/Markdown
  --json             Emit JSON report instead of text
  -h, --help         Show this help
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const goldenCases = await discoverGoldenCases(options.casesDir);
  if (!goldenCases.length) {
    throw new Error(`No ${GOLDEN_FILENAME} files found under ${options.casesDir}`);
  }
  const generatedMatters = await discoverGeneratedMatters(options.mattersDir);
  const results = [];

  for (const goldenCase of goldenCases) {
    const generatedMatter = findGeneratedMatter(goldenCase, generatedMatters);
    if (!generatedMatter) {
      results.push({
        ...goldenCaseSummary(goldenCase),
        status: "missing-generated-artifact",
        generatedPath: "",
        expectedEvents: goldenCase.events.length,
        generatedEvents: 0,
        missing: goldenCase.events,
        extra: [],
        citationIssues: [],
        sourceLabelIssues: [],
        lawyerFacingIssues: [],
      });
      continue;
    }

    const generatedJsonEntries = await readGeneratedJsonEntries(generatedMatter.jsonPath);
    const generated = parseGeneratedListOfDates(
      await readFile(generatedMatter.path, "utf8"),
      generatedJsonEntries,
    );
    results.push(compareCase(goldenCase, generatedMatter, generated, options));
  }

  const summary = summarize(results, options);
  if (options.json) {
    console.log(`${JSON.stringify({ summary, results }, null, 2)}\n`);
  } else {
    printReport(summary, results, options);
  }

  if (!summary.ok) process.exitCode = 1;
}

async function discoverGoldenCases(casesDir) {
  const entries = await readdir(casesDir, { withFileTypes: true });
  const cases = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("case_")) continue;
    const goldenPath = path.join(casesDir, entry.name, GOLDEN_FILENAME);
    if (!(await pathExists(goldenPath))) continue;
    const markdown = await readFile(goldenPath, "utf8");
    const matterName = extractMatterName(markdown);
    cases.push({
      caseName: entry.name,
      goldenPath,
      matterName,
      events: parseGoldenEvents(markdown),
    });
  }

  return cases.sort((a, b) => a.caseName.localeCompare(b.caseName));
}

async function discoverGeneratedMatters(mattersDir) {
  const entries = await readdir(mattersDir, { withFileTypes: true });
  const matters = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const listPath = path.join(mattersDir, entry.name, GENERATED_RELATIVE_PATH);
    if (!(await pathExists(listPath))) continue;
    const markdown = await readFile(listPath, "utf8");
    const jsonPath = path.join(path.dirname(listPath), GENERATED_JSON_FILENAME);
    matters.push({
      matterDirName: entry.name,
      path: listPath,
      jsonPath: await pathExists(jsonPath) ? jsonPath : "",
      matterName: extractMatterName(markdown),
      mtimeMs: (await stat(listPath)).mtimeMs,
    });
  }

  return matters.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function findGeneratedMatter(goldenCase, generatedMatters) {
  return generatedMatters.find((matter) => matter.matterName === goldenCase.matterName);
}

function extractMatterName(markdown) {
  const match = /^Matter:\s*(.+)$/m.exec(markdown);
  return match ? match[1].trim() : "";
}

function parseGoldenEvents(markdown) {
  const section = markdown.split(/^## Expected events/m)[1] || "";
  return parseMarkdownTable(section)
    .filter((row) => /^\d+$/.test(row[0] || "") && /^\d{4}-\d{2}-\d{2}$/.test(row[1] || ""))
    .map((row) => {
      const citation = stripMarkdown(row[3] || "");
      const parsedCitation = parseCitation(citation);
      return {
        number: Number(row[0]),
        date_iso: row[1],
        event: stripMarkdown(row[2] || ""),
        citation,
        file_id: parsedCitation?.file_id || "",
        page: parsedCitation?.page || "",
        block_id: parsedCitation?.block_id || "",
        eventKey: normalizeEvent(row[2] || ""),
      };
    });
}

async function readGeneratedJsonEntries(jsonPath) {
  if (!jsonPath) return [];
  try {
    const parsed = JSON.parse(await readFile(jsonPath, "utf8"));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function parseGeneratedListOfDates(markdown, jsonEntries = []) {
  const table = parseMarkdownTableWithHeader(markdown);
  const dateIndex = table.headers.findIndex((header) => header === "date");
  const eventIndex = table.headers.findIndex((header) => header === "event");
  const citationIndex = table.headers.findIndex((header) => header === "citation");
  const relevanceIndex = table.headers.findIndex((header) => header === "legal relevance");
  const sourceIndex = table.headers.findIndex((header) => header === "source");

  return table.rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row[dateIndex] || ""))
    .map((row, index) => {
      const jsonEntry = jsonEntries[index] && typeof jsonEntries[index] === "object" ? jsonEntries[index] : {};
      const source = stripMarkdown(sourceIndex >= 0 ? row[sourceIndex] : "");
      const citation = stripMarkdown(citationIndex >= 0 ? row[citationIndex] : (source.match(RAW_CITATION_RE)?.[0] || ""));
      const parsedCitation = parseCitation(citation);
      return {
        index: index + 1,
        date_iso: row[dateIndex],
        event: stripMarkdown(row[eventIndex] || ""),
        citation,
        source,
        file_id: parsedCitation?.file_id || "",
        page: parsedCitation?.page || "",
        block_id: parsedCitation?.block_id || "",
        eventKey: normalizeEvent(row[eventIndex] || ""),
        event_type: stringField(jsonEntry.event_type),
        legal_relevance: stringField(jsonEntry.legal_relevance || (relevanceIndex >= 0 ? row[relevanceIndex] : "")),
        issue_tags: Array.isArray(jsonEntry.issue_tags) ? jsonEntry.issue_tags.map(String).filter(Boolean) : [],
        perspective: stringField(jsonEntry.perspective),
        hasLawyerFacingFields: Boolean(jsonEntry.event_type
          || jsonEntry.legal_relevance
          || (Array.isArray(jsonEntry.issue_tags) && jsonEntry.issue_tags.length)
          || jsonEntry.perspective
          || (relevanceIndex >= 0 && row[relevanceIndex])),
      };
    });
}

function parseMarkdownTableWithHeader(markdown) {
  const rows = parseMarkdownTable(markdown);
  const headerIndex = rows.findIndex((row) => row.some((cell) => stripMarkdown(cell).toLowerCase() === "date"));
  if (headerIndex < 0) return { headers: [], rows: [] };
  return {
    headers: rows[headerIndex].map((cell) => stripMarkdown(cell).toLowerCase()),
    rows: rows.slice(headerIndex + 1),
  };
}

function parseMarkdownTable(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    if (/^\|\s*:?-{3,}/.test(trimmed)) continue;
    rows.push(splitMarkdownRow(trimmed));
  }
  return rows;
}

function splitMarkdownRow(row) {
  const inner = row.slice(1, -1);
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const char of inner) {
    if (escaped) {
      cell += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function compareCase(goldenCase, generatedMatter, generatedEvents, options) {
  const matchedGenerated = new Set();
  const matched = [];
  const missing = [];

  for (const expected of goldenCase.events) {
    const candidates = generatedEvents
      .map((actual, index) => ({
        actual,
        index,
        score: eventMatchScore(expected, actual),
      }))
      .filter((candidate) => candidate.score >= 0.38 && !matchedGenerated.has(candidate.index))
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      missing.push(expected);
      continue;
    }

    const best = candidates[0];
    matchedGenerated.add(best.index);
    matched.push({
      expected,
      actual: best.actual,
      score: round(best.score),
    });
  }

  const extra = generatedEvents.filter((_, index) => !matchedGenerated.has(index));
  const citationIssues = citationChecks(matched);
  const sourceLabelIssues = sourceLabelChecks(generatedEvents);
  const lawyerFacingIssues = lawyerFacingChecks(generatedEvents, options.requireLawyerFacing);

  return {
    ...goldenCaseSummary(goldenCase),
    status: issuesForResult({ missing, extra, citationIssues, sourceLabelIssues, lawyerFacingIssues }).length ? "diff" : "ok",
    generatedPath: generatedMatter.path,
    expectedEvents: goldenCase.events.length,
    generatedEvents: generatedEvents.length,
    matched,
    missing,
    extra,
    citationIssues,
    sourceLabelIssues,
    lawyerFacingIssues,
  };
}

function goldenCaseSummary(goldenCase) {
  return {
    caseName: goldenCase.caseName,
    matterName: goldenCase.matterName,
    goldenPath: goldenCase.goldenPath,
  };
}

function eventMatchScore(expected, actual) {
  if (expected.date_iso !== actual.date_iso) return 0;
  const eventSimilarity = tokenSimilarity(expected.eventKey, actual.eventKey);
  const citationBonus = expected.file_id && expected.file_id === actual.file_id ? 0.15 : 0;
  const pageBonus = expected.page && expected.page === actual.page ? 0.05 : 0;
  return Math.min(1, eventSimilarity + citationBonus + pageBonus);
}

function citationChecks(matches) {
  const issues = [];
  for (const match of matches) {
    const { expected, actual } = match;
    if (!RAW_CITATION_RE.test(actual.citation)) {
      issues.push(issue("missing_raw_citation", expected, actual, "Generated citation column lacks FILE-NNNN pX.bY."));
      continue;
    }
    if (expected.file_id && actual.file_id !== expected.file_id) {
      issues.push(issue("file_id_mismatch", expected, actual, `Expected ${expected.file_id}, got ${actual.file_id || "(none)"}.`));
    }
    if (expected.page && actual.page !== expected.page) {
      issues.push(issue("page_mismatch", expected, actual, `Expected p${expected.page}, got p${actual.page || "?"}.`));
    }
  }
  return issues;
}

function sourceLabelChecks(generatedEvents) {
  return generatedEvents
    .filter((event) => {
      const citationInSource = event.source.match(RAW_CITATION_RE)?.[0] || "";
      const label = citationInSource ? event.source.replace(citationInSource, "").replace(/[()]/g, "").trim() : "";
      return !citationInSource || !label;
    })
    .map((event) => ({
      type: "missing_source_label_or_raw_citation",
      date_iso: event.date_iso,
      event: event.event,
      citation: event.citation,
      source: event.source,
      detail: "Source column should include readable label plus raw FILE-NNNN pX.bY citation.",
    }));
}

function lawyerFacingChecks(generatedEvents, requireLawyerFacing) {
  const issues = [];
  for (const event of generatedEvents) {
    if (!requireLawyerFacing && !event.hasLawyerFacingFields) continue;

    if (!event.event_type) {
      issues.push(lawyerFacingIssue("missing_event_type", event, "Generated entry is missing event_type."));
    }
    if (!event.legal_relevance) {
      issues.push(lawyerFacingIssue("missing_legal_relevance", event, "Generated entry is missing legal_relevance."));
    }
    if (!Array.isArray(event.issue_tags) || !event.issue_tags.length) {
      issues.push(lawyerFacingIssue("missing_issue_tags", event, "Generated entry is missing issue_tags."));
    }
    if (event.perspective !== "client_favourable") {
      issues.push(lawyerFacingIssue("invalid_perspective", event, `Expected perspective client_favourable, got ${event.perspective || "(missing)"}.`));
    }
    for (const banned of BANNED_UNSUPPORTED_CONCLUSIONS) {
      if (banned.test(event.legal_relevance)) {
        issues.push(lawyerFacingIssue("unsupported_conclusion_language", event, `legal_relevance contains high-risk conclusion language: ${banned}.`));
      }
    }
  }
  return issues;
}

function lawyerFacingIssue(type, event, detail) {
  return {
    type,
    date_iso: event.date_iso,
    event: event.event,
    citation: event.citation,
    detail,
  };
}

function issue(type, expected, actual, detail) {
  return {
    type,
    expected: compactEvent(expected),
    actual: compactEvent(actual),
    detail,
  };
}

function compactEvent(event) {
  return {
    date_iso: event.date_iso,
    event: event.event,
    citation: event.citation,
  };
}

function issuesForResult(result) {
  const issues = [];
  if (result.missing?.length) issues.push("missing");
  if (result.extra?.length) issues.push("extra");
  if (result.citationIssues?.length) issues.push("citation");
  if (result.sourceLabelIssues?.length) issues.push("source_label");
  if (result.lawyerFacingIssues?.length) issues.push("lawyer_facing");
  return issues;
}

function normalizeEvent(value) {
  return tokenize(value).join(" ");
}

function tokenize(value) {
  return stripMarkdown(value)
    .toLowerCase()
    .replace(/rs\.?/g, "rs")
    .replace(/₹/g, "rs ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(stemToken)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function stemToken(token) {
  const replacements = new Map([
    ["paid", "pay"],
    ["payment", "pay"],
    ["payments", "pay"],
    ["billed", "bill"],
    ["billing", "bill"],
    ["fees", "fee"],
    ["executed", "execute"],
    ["issued", "issue"],
    ["received", "receive"],
    ["filed", "file"],
    ["scheduled", "schedule"],
    ["denying", "deny"],
    ["claimed", "claim"],
    ["claims", "claim"],
  ]);
  if (replacements.has(token)) return replacements.get(token);
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenSimilarity(expectedKey, actualKey) {
  const expected = new Set(expectedKey.split(" ").filter(Boolean));
  const actual = new Set(actualKey.split(" ").filter(Boolean));
  if (!expected.size || !actual.size) return 0;
  let intersection = 0;
  for (const token of expected) {
    if (actual.has(token)) intersection += 1;
  }
  const containment = intersection / expected.size;
  const reverseContainment = intersection / actual.size;
  const jaccard = intersection / new Set([...expected, ...actual]).size;
  const blendedContainment = (containment * 0.45) + (reverseContainment * 0.55);
  const conciseActualMatch = reverseContainment >= 0.75 ? Math.max(containment, 0.5) : 0;
  return Math.max(jaccard, blendedContainment, conciseActualMatch);
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/`/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCitation(value) {
  const match = CITATION_RE.exec(value);
  if (!match) return null;
  return {
    file_id: match[1],
    page: match[2],
    block_id: match[3] === "?" ? "" : match[3],
  };
}

function summarize(results, options) {
  const summary = {
    cases: results.length,
    okCases: results.filter((result) => result.status === "ok").length,
    diffCases: results.filter((result) => result.status === "diff").length,
    missingArtifactCases: results.filter((result) => result.status === "missing-generated-artifact").length,
    expectedEvents: sum(results, "expectedEvents"),
    generatedEvents: sum(results, "generatedEvents"),
    missingEvents: sum(results, (result) => result.missing.length),
    extraEvents: sum(results, (result) => result.extra.length),
    citationIssues: sum(results, (result) => result.citationIssues.length),
    sourceLabelIssues: sum(results, (result) => result.sourceLabelIssues.length),
    lawyerFacingIssues: sum(results, (result) => result.lawyerFacingIssues.length),
    allowExtra: options.allowExtra,
    requireLawyerFacing: options.requireLawyerFacing,
  };
  summary.ok = summary.missingArtifactCases === 0
    && summary.missingEvents === 0
    && (summary.allowExtra || summary.extraEvents === 0)
    && summary.citationIssues === 0
    && summary.sourceLabelIssues === 0
    && summary.lawyerFacingIssues === 0;
  return summary;
}

function sum(items, keyOrGetter) {
  const getter = typeof keyOrGetter === "function" ? keyOrGetter : (item) => item[keyOrGetter] || 0;
  return items.reduce((total, item) => total + getter(item), 0);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function printReport(summary, results, options) {
  console.log("# Golden List of Dates Check\n");
  console.log(`Cases: ${summary.cases}; ok: ${summary.okCases}; diff: ${summary.diffCases}; missing artifacts: ${summary.missingArtifactCases}`);
  console.log(`Events: expected ${summary.expectedEvents}, generated ${summary.generatedEvents}, missing ${summary.missingEvents}, extra ${summary.extraEvents}`);
  console.log(`Citation issues: ${summary.citationIssues}; source-label issues: ${summary.sourceLabelIssues}; lawyer-facing issues: ${summary.lawyerFacingIssues}`);
  if (options.allowExtra) console.log("Extra generated events are reported but not treated as failure.");
  if (options.requireLawyerFacing) console.log("Lawyer-facing contract checks are required for this run.");

  for (const result of results) {
    console.log(`\n## ${result.caseName}`);
    console.log(`Matter: ${result.matterName}`);
    console.log(`Status: ${result.status}`);
    if (result.generatedPath) console.log(`Generated: ${result.generatedPath}`);
    console.log(`Events: expected ${result.expectedEvents}, generated ${result.generatedEvents}, missing ${result.missing.length}, extra ${result.extra.length}`);

    printEvents("Missing expected events", result.missing);
    printEvents("Extra generated events", result.extra);
    printIssues("Citation issues", result.citationIssues);
    printIssues("Source label issues", result.sourceLabelIssues);
    printIssues("Lawyer-facing issues", result.lawyerFacingIssues);
  }
}

function printEvents(title, events) {
  if (!events.length) return;
  console.log(`\n${title}:`);
  for (const event of events) {
    console.log(`- ${event.date_iso} | ${event.event} | ${event.citation}`);
  }
}

function printIssues(title, issues) {
  if (!issues.length) return;
  console.log(`\n${title}:`);
  for (const issueItem of issues) {
    if (issueItem.expected && issueItem.actual) {
      console.log(`- ${issueItem.type}: ${issueItem.detail}`);
      console.log(`  expected: ${issueItem.expected.date_iso} | ${issueItem.expected.event} | ${issueItem.expected.citation}`);
      console.log(`  actual:   ${issueItem.actual.date_iso} | ${issueItem.actual.event} | ${issueItem.actual.citation}`);
    } else {
      console.log(`- ${issueItem.type}: ${issueItem.date_iso} | ${issueItem.event} | ${issueItem.detail}`);
    }
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
