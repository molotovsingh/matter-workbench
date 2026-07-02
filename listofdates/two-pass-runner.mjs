import { AI_TASKS } from "../shared/model-policy.mjs";
import { clusterChronologyEntries } from "./clustering.mjs";
import {
  CANDIDATE_SCHEMA,
  OUTPUT_SCHEMA,
} from "./contracts.mjs";
import {
  buildListOfDatesArtifactFiles,
  createListOfDatesOutputPaths,
  writeCandidateLedger,
  writeListOfDatesArtifacts,
} from "./artifacts.mjs";
import {
  compareEntries,
  matterSummary,
  validateAndHydrateCandidates,
  validateAndHydrateEntries,
} from "./entries.mjs";
import {
  LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT,
  LIST_OF_DATES_EDITOR_SYSTEM_PROMPT,
  listOfDatesCandidatePromptPayload,
  listOfDatesEditorPromptPayload,
} from "./providers.mjs";
import {
  TWO_PASS_ENGINE_VERSION,
  createCandidateLedger,
  mergeAiRunMetadata,
  twoPassAiRunMetadata,
} from "./run-metadata.mjs";
import { createConfiguredListOfDatesProvider } from "./run-config.mjs";
import { prepareCreateListOfDatesInputsFromRecords } from "./one-pass-runner.mjs";
import { runListOfDatesStage, skipListOfDatesStage } from "./stage-recording.mjs";

export async function buildCreateListOfDatesTwoPassFromRecords(options = {}) {
  const prepared = prepareCreateListOfDatesInputsFromRecords(options);
  const { matterRoot, dryRun, env, matterJson, records } = prepared;
  return runCreateListOfDatesTwoPass({
    options,
    env,
    matterRoot,
    dryRun,
    matterJson,
    records,
    sourceIndex: prepared.sourceIndex,
    chronologyBlocks: prepared.chronologyBlocks,
    chunks: prepared.chunks,
    filteredBlockCount: prepared.filteredBlockCount,
    outputLines: prepared.outputLines,
    persistArtifacts: false,
    candidateLedgerWriter: options.candidateLedgerWriter,
    artifactWriter: options.artifactWriter,
    stageRecorder: options.stageRecorder,
  });
}

export async function runCreateListOfDatesTwoPass({
  options,
  env,
  matterRoot,
  dryRun,
  matterJson,
  records,
  sourceIndex,
  chronologyBlocks,
  chunks,
  filteredBlockCount,
  outputLines,
  persistArtifacts = !dryRun,
  candidateLedgerWriter,
  artifactWriter,
  stageRecorder,
}) {
  const pass1 = createConfiguredListOfDatesProvider({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS1,
    options,
    env,
    prompt: {
      systemPrompt: LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT,
      payloadBuilder: listOfDatesCandidatePromptPayload,
      schemaName: "list_of_dates_candidate_chunk",
      schemaDescription: "Verbose source-backed chronology candidate ledger.",
    },
    injectedProvider: options.pass1Provider,
  });
  const pass2 = createConfiguredListOfDatesProvider({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS2,
    options,
    env,
    prompt: {
      systemPrompt: LIST_OF_DATES_EDITOR_SYSTEM_PROMPT,
      payloadBuilder: listOfDatesEditorPromptPayload,
      schemaName: "list_of_dates_editor",
      schemaDescription: "Final record-neutral Case Timeline entries edited from a candidate ledger.",
    },
    injectedProvider: options.pass2Provider,
  });
  outputLines.push("[listofdates] two-pass mode enabled");

  const rawCandidates = [];
  const pass1ResponseAiRuns = [];
  let candidateLedger = null;
  const candidatePass = await runListOfDatesStage(
    stageRecorder,
    {
      id: "candidate_pass",
      label: "Generate candidate date ledger",
      provider: pass1.baseAiRun.provider,
      model: pass1.baseAiRun.model,
    },
    async () => {
      for (const [index, chunk] of chunks.entries()) {
        const response = await pass1.provider({
          matter: matterSummary(matterJson),
          chunk,
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          schema: CANDIDATE_SCHEMA,
        });
        if (!response || !Array.isArray(response.candidates)) {
          const error = new Error(`AI provider returned an invalid candidate-ledger payload for chunk ${index + 1}`);
          error.statusCode = 502;
          throw error;
        }
        rawCandidates.push(...response.candidates);
        if (response.ai_run) pass1ResponseAiRuns.push(response.ai_run);
        outputLines.push(`[listofdates] pass 1 chunk ${index + 1}/${chunks.length}: ${response.candidates.length} candidate(s)`);
      }

      const pass1AiRun = mergeAiRunMetadata(pass1.baseAiRun, pass1ResponseAiRuns);
      const candidates = validateAndHydrateCandidates(rawCandidates, chronologyBlocks, sourceIndex);
      const outputPaths = createListOfDatesOutputPaths(matterRoot, { includeCandidates: true });
      candidateLedger = createCandidateLedger({
        matterJson,
        candidates,
        records,
        chronologyBlocks,
        filteredBlockCount,
        pass1AiRun,
        status: "pass1_complete",
      });

      if (!dryRun) {
        await persistCandidateLedger({
          matterRoot,
          outputPaths,
          candidateLedger,
          persistArtifacts,
          candidateLedgerWriter,
        });
      }
      return { pass1AiRun, candidates, outputPaths };
    },
    ({ candidates = [], outputPaths = {} } = {}) => ({
      summary: `Accepted ${candidates.length} candidate(s) into ${outputPaths.candidates || "candidate ledger"}`,
      salvageable: true,
    }),
  );
  const { pass1AiRun, candidates, outputPaths } = candidatePass;

  try {
    const editorPass = await runListOfDatesStage(
      stageRecorder,
      {
        id: "editor_pass",
        label: "Edit final Case Timeline entries",
        provider: pass2.baseAiRun.provider,
        model: pass2.baseAiRun.model,
      },
      async () => {
        const pass2Response = await pass2.provider({
          matter: matterSummary(matterJson),
          candidates,
          schema: OUTPUT_SCHEMA,
        });
        if (!pass2Response || !Array.isArray(pass2Response.entries)) {
          const error = new Error("AI provider returned an invalid two-pass list-of-dates editor payload");
          error.statusCode = 502;
          throw error;
        }

        const pass2AiRun = mergeAiRunMetadata(pass2.baseAiRun, pass2Response.ai_run ? [pass2Response.ai_run] : []);
        const candidateCitations = new Set(candidates.map((candidate) => candidate.citation));
        const editorEntries = pass2Response.entries.filter((entry) => candidateCitations.has(entry?.citation));
        const validEntries = validateAndHydrateEntries(editorEntries, chronologyBlocks, sourceIndex);
        const acceptedEntries = validEntries.sort(compareEntries);
        const entries = clusterChronologyEntries(acceptedEntries, { compareEntries }).sort(compareEntries);
        const aiRun = twoPassAiRunMetadata(pass1AiRun, pass2AiRun);
        candidateLedger = {
          ...candidateLedger,
          status: "succeeded",
          finished_at: new Date().toISOString(),
          pass2_ai_run: pass2AiRun,
          final_entry_count: entries.length,
        };

        const validation = {
          candidate_count: candidates.length,
          accepted_entries: acceptedEntries.length,
          final_entries: entries.length,
          clustered_entries: acceptedEntries.length - entries.length,
        };
        const artifactFiles = buildListOfDatesArtifactFiles({
          matterJson,
          engineVersion: TWO_PASS_ENGINE_VERSION,
          markdownEngineVersion: TWO_PASS_ENGINE_VERSION,
          generatedAt: options.generatedAt,
          generationMode: "two_pass",
          candidateLedgerPath: outputPaths.candidates,
          aiRun,
          pass1AiRun,
          pass2AiRun,
          records,
          sourceIndex,
          validation,
          entries,
        });
        const candidateLedgerFile = candidateLedgerArtifactFile(outputPaths.candidates, candidateLedger);
        return { pass2Response, pass2AiRun, acceptedEntries, entries, aiRun, validation, artifactFiles, candidateLedgerFile };
      },
      ({ acceptedEntries = [], entries = [] } = {}) => ({
        summary: `Accepted ${acceptedEntries.length} cited event(s), rendering ${entries.length} row(s)`,
        salvageable: true,
      }),
    );
    const { pass2Response, pass2AiRun, acceptedEntries, entries, aiRun, validation, artifactFiles, candidateLedgerFile } = editorPass;

    if (!dryRun) {
      await runListOfDatesStage(
        stageRecorder,
        { id: "persist", label: "Persist Case Timeline artifacts" },
        async () => {
          if (typeof artifactWriter === "function") {
            await artifactWriter({ files: [...artifactFiles.files, candidateLedgerFile] });
          } else if (persistArtifacts) {
            await writeListOfDatesArtifacts({
              matterRoot,
              matterJson,
              engineVersion: TWO_PASS_ENGINE_VERSION,
              markdownEngineVersion: TWO_PASS_ENGINE_VERSION,
              generatedAt: options.generatedAt,
              generationMode: "two_pass",
              candidateLedgerPath: outputPaths.candidates,
              aiRun,
              pass1AiRun,
              pass2AiRun,
              records,
              sourceIndex,
              validation,
              entries,
            });
            await writeCandidateLedger(matterRoot, candidateLedger);
          }
        },
        () => ({ summary: `Wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}` }),
      );
    } else {
      await skipListOfDatesStage(stageRecorder, { id: "persist", label: "Persist Case Timeline artifacts" }, { summary: "Dry run; artifacts were not written." });
    }

    outputLines.push(`[listofdates] pass 1 accepted ${candidates.length} candidate(s) into ${outputPaths.candidates}`);
    outputLines.push(`[listofdates] pass 2 accepted ${acceptedEntries.length} cited date event(s)`);
    if (acceptedEntries.length !== entries.length) {
      outputLines.push(`[listofdates] rendered ${entries.length} chronology row(s) after cluster classification`);
    }
    outputLines.push(`[listofdates] provider ${aiRun.provider}: ${aiRun.model}`);
    outputLines.push(dryRun
      ? "[listofdates] dry run only. Re-run with apply to write the Case Timeline."
      : `[listofdates] wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}`);

    return {
      dryRun,
      matterRoot,
      engineVersion: TWO_PASS_ENGINE_VERSION,
      generationMode: "two_pass",
      counts: {
        recordsRead: records.length,
        blocksSent: chronologyBlocks.length,
        blocksFiltered: filteredBlockCount,
        aiRequests: chunks.length + 1,
        candidateEntries: rawCandidates.length,
        acceptedCandidates: candidates.length,
        acceptedEntries: acceptedEntries.length,
        clusteredEntries: acceptedEntries.length - entries.length,
        entries: entries.length,
        rejectedCandidates: rawCandidates.length - candidates.length,
        rejectedEntries: pass2Response.entries.length - acceptedEntries.length,
      },
      outputPaths,
      candidateLedger,
      pass1AiRun,
      pass2AiRun,
      aiRun,
      entries,
      artifact: artifactFiles.jsonArtifact,
      artifactFiles: [...artifactFiles.files, candidateLedgerFile],
      outputLines,
    };
  } catch (error) {
    if (!dryRun && candidateLedger?.candidates?.length) {
      await persistCandidateLedger({
        matterRoot,
        outputPaths,
        candidateLedger: {
          ...candidateLedger,
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: error.message,
        },
        persistArtifacts,
        candidateLedgerWriter,
      });
    }
    throw error;
  }
}

async function persistCandidateLedger({
  matterRoot,
  outputPaths,
  candidateLedger,
  persistArtifacts,
  candidateLedgerWriter,
}) {
  if (typeof candidateLedgerWriter === "function") {
    await candidateLedgerWriter(candidateLedgerArtifactFile(outputPaths.candidates, candidateLedger));
    return;
  }
  if (persistArtifacts) await writeCandidateLedger(matterRoot, candidateLedger);
}

function candidateLedgerArtifactFile(relativePath, candidateLedger) {
  return {
    relativePath,
    text: `${JSON.stringify(candidateLedger, null, 2)}\n`,
  };
}
