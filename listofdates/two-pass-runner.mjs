import { AI_TASKS } from "../shared/model-policy.mjs";
import { clusterChronologyEntries } from "./clustering.mjs";
import {
  CANDIDATE_SCHEMA,
  OUTPUT_SCHEMA,
} from "./contracts.mjs";
import {
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
      schemaDescription: "Final lawyer-facing List of Dates entries edited from a candidate ledger.",
    },
    injectedProvider: options.pass2Provider,
  });
  outputLines.push("[listofdates] two-pass mode enabled");

  const rawCandidates = [];
  const pass1ResponseAiRuns = [];
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
  let candidateLedger = createCandidateLedger({
    matterJson,
    candidates,
    records,
    chronologyBlocks,
    filteredBlockCount,
    pass1AiRun,
    status: "pass1_complete",
  });

  if (!dryRun) {
    await writeCandidateLedger(matterRoot, candidateLedger);
  }

  try {
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

    if (!dryRun) {
      await writeListOfDatesArtifacts({
        matterRoot,
        matterJson,
        engineVersion: TWO_PASS_ENGINE_VERSION,
        markdownEngineVersion: TWO_PASS_ENGINE_VERSION,
        generationMode: "two_pass",
        candidateLedgerPath: outputPaths.candidates,
        aiRun,
        pass1AiRun,
        pass2AiRun,
        records,
        sourceIndex,
        validation: {
          candidate_count: candidates.length,
          accepted_entries: acceptedEntries.length,
          final_entries: entries.length,
          clustered_entries: acceptedEntries.length - entries.length,
        },
        entries,
      });
      await writeCandidateLedger(matterRoot, candidateLedger);
    }

    outputLines.push(`[listofdates] pass 1 accepted ${candidates.length} candidate(s) into ${outputPaths.candidates}`);
    outputLines.push(`[listofdates] pass 2 accepted ${acceptedEntries.length} cited date event(s)`);
    if (acceptedEntries.length !== entries.length) {
      outputLines.push(`[listofdates] rendered ${entries.length} chronology row(s) after cluster classification`);
    }
    outputLines.push(`[listofdates] provider ${aiRun.provider}: ${aiRun.model}`);
    outputLines.push(dryRun
      ? "[listofdates] dry run only. Re-run with apply to write list of dates."
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
      outputLines,
    };
  } catch (error) {
    if (!dryRun && candidateLedger?.candidates?.length) {
      await writeCandidateLedger(matterRoot, {
        ...candidateLedger,
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error.message,
      });
    }
    throw error;
  }
}
