import { postJson } from "../api-client.js";
import {
  buildMatterJson,
  buildPreviewResultLines,
  escapeHtml,
  validateMetadata,
} from "../dom-utils.js";

export function createMatterInitSkill(ctx) {
  const { editorContent } = ctx.elements;

  function renderMatterInitResult(result, modeLabel) {
    const activeMatter = ctx.getActiveMatter();
    const matterJson = result.matterJson || buildMatterJson(activeMatter);
    const counts = result.counts || {
      scannedFiles: activeMatter.fileCount,
      uniqueFiles: activeMatter.fileCount,
      duplicateFiles: 0,
    };
    const paths = result.paths || {
      sourceDir: "00_Inbox/Intake 01 - Initial/Source Files",
      originalsDir: "00_Inbox/Intake 01 - Initial/Originals",
      byTypeDir: "00_Inbox/Intake 01 - Initial/By Type",
      intakeLogPath: "00_Inbox/Intake 01 - Initial/Intake Log.csv",
      fileRegisterPath: "00_Inbox/Intake 01 - Initial/File Register.csv",
    };

    ctx.setStatus({
      mood: "success",
      card: `<strong>matter-init ${escapeHtml(modeLabel)} complete</strong><br />${counts.scannedFiles} files scanned, ${counts.duplicateFiles} exact duplicates identified.`,
      bar: "Skill Complete",
      terminal: result.outputLines || buildPreviewResultLines(activeMatter, "/matter-init"),
    });
    editorContent.innerHTML = `
      <h1>/matter-init result</h1>
      <p>
        The intake slash skill completed the deterministic copy-only pass for
        ${escapeHtml(activeMatter.metadata.matterName)} while keeping source material untouched.
      </p>
      <dl class="skill-contract">
        <div>
          <dt>Matter</dt>
          <dd>${escapeHtml(activeMatter.metadata.clientName)} v. ${escapeHtml(activeMatter.metadata.oppositeParty)}</dd>
        </div>
        <div>
          <dt>Scanned</dt>
          <dd>${counts.scannedFiles} files, ${counts.uniqueFiles} unique, ${counts.duplicateFiles} exact duplicates</dd>
        </div>
        <div>
          <dt>Staged</dt>
          <dd>${counts.looseRootFilesStaged || 0} loose root files copied into <code>${escapeHtml(paths.sourceDir)}</code></dd>
        </div>
        <div>
          <dt>Preserved</dt>
          <dd>Originals copied under <code>${escapeHtml(paths.originalsDir)}</code></dd>
        </div>
        <div>
          <dt>Arranged</dt>
          <dd>Working copies grouped under <code>${escapeHtml(paths.byTypeDir)}</code> by file type</dd>
        </div>
        <div>
          <dt>Reported</dt>
          <dd><code>${escapeHtml(paths.intakeLogPath)}</code> and <code>${escapeHtml(paths.fileRegisterPath)}</code></dd>
        </div>
      </dl>
      <h2>matter.json</h2>
      <pre class="json-preview">${escapeHtml(JSON.stringify(matterJson, null, 2))}</pre>
    `;
  }

  async function runMatterInit(command) {
    const activeMatter = ctx.getActiveMatter();
    const missingMetadata = validateMetadata(activeMatter.metadata);

    if (missingMetadata.length) {
      ctx.setStatus({
        bar: "Metadata Missing",
        terminal: [
          `> workbench.run ${command}`,
          "[matter-init] blocked: required matter metadata is incomplete",
          `[matter-init] missing: ${missingMetadata.join(", ")}`,
        ],
      });
      editorContent.innerHTML = `
        <h1>${escapeHtml(activeMatter.metadata.matterName || activeMatter.folderName || "Matter")}</h1>
        <div class="run-failure-card">
          <strong>matter-init can't run yet</strong>
          Missing required metadata: ${escapeHtml(missingMetadata.join(", "))}.<br />
          Edit <code>matter.json</code> on disk and click Refresh, or recreate this matter via <code>+ New Matter</code>.
        </div>
      `;
      return;
    }

    ctx.setStatus({
      bar: "Running Skill",
      terminal: [
        `> workbench.run ${command}`,
        "[matter-init] running deterministic local intake...",
      ],
    });

    try {
      const result = await postJson("/api/matter-init", { metadata: activeMatter.metadata });
      ctx.mergeActiveMatterState({ fileCount: result.counts.scannedFiles });
      renderMatterInitResult(result, "write");
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
    } catch (error) {
      ctx.setStatus({
        bar: "Run Failed",
        terminal: [
          `[matter-init] aborted: ${error.message}`,
          "[matter-init] no files were written",
        ],
      });
      editorContent.innerHTML = `
        <h1>${escapeHtml(activeMatter.metadata.matterName || activeMatter.folderName || "Matter")}</h1>
        <div class="run-failure-card">
          <strong>matter-init failed</strong>
          ${escapeHtml(error.message)}<br />
          No files were written. Check that the local server is running, then try again.
        </div>
        <div class="form-actions">
          <button type="button" class="run-skill-button" id="runMatterInitRetry">Try again</button>
          <button type="button" class="run-skill-button secondary" id="runMatterInitBack">Back to overview</button>
        </div>
      `;
      const retry = document.getElementById("runMatterInitRetry");
      if (retry) retry.addEventListener("click", () => runMatterInit(command));
      const back = document.getElementById("runMatterInitBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
    }
  }

  return { renderMatterInitResult, runMatterInit };
}
