import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);
const reactRunReportPath = new URL("../react-ui/src/lib/configurableSkillRunReport.ts", import.meta.url);

let reactRunReportModulePromise = null;

async function importReactRunReportModule() {
  if (reactRunReportModulePromise) return reactRunReportModulePromise;

  reactRunReportModulePromise = (async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mwb-react-run-report-"));
    const secretFile = path.join(tempDir, "secretRedaction.mjs");
    const runReportFile = path.join(tempDir, "configurableSkillRunReport.mjs");

    await writeFile(secretFile, transpile(await readFile(reactSecretRedactionPath, "utf8")));
    const source = (await readFile(reactRunReportPath, "utf8"))
      .replace("'./secretRedaction'", "'./secretRedaction.mjs'");
    await writeFile(runReportFile, transpile(source));

    return import(pathToFileURL(runReportFile).href);
  })();

  return reactRunReportModulePromise;
}

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

test("React custom skill run report mirrors metadata-only redaction boundary", async () => {
  const { formatConfigurableSkillRunReport } = await importReactRunReportModule();
  const report = formatConfigurableSkillRunReport({
    id: "run_123",
    title: "Party Map sk-title-secret",
    slash: "/party_map",
    status: "failed",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    startedAt: "2026-05-15T10:00:00.000Z",
    finishedAt: "2026-05-15T10:01:00.000Z",
    overwrite: "approved",
    outputPaths: {
      markdown: "20_Workshop/sk-path-secret.md",
      json: "20_Workshop/Party Map.json",
    },
    aiRun: {
      provider: "openai-direct",
      model: "gpt-5.4",
    },
    warnings: ["OPENAI_API_KEY=sk-warning-secret"],
    errorMessage: "provider rejected Bearer sk-error-secret",
    markdown: "# Generated work product",
  });

  assert.match(report, /^# Custom Skill Run Report/);
  assert.match(report, /Run id: run_123/);
  assert.match(report, /Provider\/model: openai-direct \/ gpt-5\.4/);
  assert.match(report, /Output document: Replaced existing output document/);
  assert.match(report, /metadata only/i);
  assert.doesNotMatch(report, /Generated work product/);
  assert.doesNotMatch(report, /sk-title-secret|sk-path-secret|sk-warning-secret|sk-error-secret/);
  assert.match(report, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(report, /Bearer \[redacted-secret\]/);
});

test("React Activity output opening is limited to the run matter", async () => {
  const { canOpenSkillRunOutputForMatter, skillRunOutputExistsInWorkspace } = await importReactRunReportModule();
  const run = {
    id: "run_1",
    status: "succeeded",
    matterFolder: "Ayesha Vs Japan Airlines",
    outputPaths: {
      markdown: "20_Workshop/Party Map.md",
    },
  };

  assert.equal(
    canOpenSkillRunOutputForMatter(run, { name: "Ayesha Vs Japan Airlines", folderName: "Ayesha Vs Japan Airlines" }),
    true,
  );
  assert.equal(
    canOpenSkillRunOutputForMatter(run, { name: "Atlas", folderName: "Atlas Constuction vs Diptishree" }),
    false,
  );
  assert.equal(canOpenSkillRunOutputForMatter({ ...run, status: "failed" }, {
    name: "Ayesha Vs Japan Airlines",
    folderName: "Ayesha Vs Japan Airlines",
  }), false);

  const activeMatter = {
    name: "Ayesha Vs Japan Airlines",
    folderName: "Ayesha Vs Japan Airlines",
    workspace: {
      name: "Ayesha Vs Japan Airlines",
      path: "",
      children: [
        {
          name: "Case Analysis",
          path: "20_Workshop",
          type: "folder",
          children: [
            {
              name: "Party Map.md",
              path: "20_Workshop/Party Map.md",
              type: "file",
            },
          ],
        },
      ],
    },
  };

  assert.equal(skillRunOutputExistsInWorkspace(run, activeMatter), true);
  assert.equal(skillRunOutputExistsInWorkspace({
    ...run,
    outputPaths: { markdown: "20_Workshop/Missing.md" },
  }, activeMatter), false);
});
