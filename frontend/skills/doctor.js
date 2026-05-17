import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { lawyerActionCompleteLabel, lawyerActionLabel, lawyerActionRunningLabel } from "../lawyer-labels.js";

export function createDoctorSkill(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;

  async function runDoctor(command) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>No matter loaded</strong><br />Pick a matter from Home before running ${lawyerActionLabel("/doctor")}.`,
        bar: "No Matter",
        terminal: "[doctor] no active matter",
      });
      return;
    }
    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > ${lawyerActionLabel("/doctor")}`;
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${lawyerActionRunningLabel("/doctor")}</strong><br />Scanning matter setup and saved artifacts for issues...`,
      bar: "Matter Check Running",
      terminal: `[doctor] scanning ${activeMatter.folderName}`,
    });
    editorContent.innerHTML = `<h1>${lawyerActionLabel("/doctor")} — ${escapeHtml(activeMatter.folderName)}</h1><p>Checking matter...</p>`;
    try {
      const payload = await postJson("/api/doctor/scan");
      renderDoctorScan(payload.issues || []);
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Matter check failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Matter Check Failed",
        terminal: `[doctor] scan failed: ${error.message}`,
      });
      editorContent.innerHTML = `<h1>${lawyerActionLabel("/doctor")} — ${escapeHtml(activeMatter.folderName)}</h1><p class="form-error">Check failed: ${escapeHtml(error.message)}</p>`;
    }
  }

  function renderDoctorScan(issues) {
    const activeMatter = ctx.getActiveMatter();
    if (!issues.length) {
      ctx.setStatus({
        mood: "success",
        card: "<strong>All clear</strong><br />No issues detected.",
        bar: "Matter Check Clear",
        terminal: "[doctor] no issues found",
      });
      editorContent.innerHTML = `
        <h1>${lawyerActionLabel("/doctor")} — ${escapeHtml(activeMatter.folderName)}</h1>
        <p>No issues detected. The matter's structure matches the current schema.</p>
      `;
      return;
    }
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${issues.length} issue${issues.length === 1 ? "" : "s"} found</strong><br />Review and choose which to fix.`,
      bar: "Matter Check Issues",
      terminal: [`[doctor] ${issues.length} issue(s) found`, ...issues.map((i) => `[doctor] - ${i.id} (${i.severity}): ${i.title}`)],
    });
    const cards = issues.map((issue) => `
      <div class="doctor-issue" data-issue-id="${escapeHtml(issue.id)}">
        <label class="doctor-issue-toggle">
          <input type="checkbox" class="doctor-issue-checkbox" data-issue-id="${escapeHtml(issue.id)}" ${issue.autoFixable ? "checked" : "disabled"} />
          <span class="doctor-issue-title">
            <span class="doctor-issue-badge doctor-severity-${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span>
            ${escapeHtml(issue.title)}
          </span>
        </label>
        <div class="doctor-issue-body">
          <p>${escapeHtml(issue.description)}</p>
          ${issue.autoFixable
            ? `<p class="doctor-fix-description"><strong>Suggested fix:</strong> ${escapeHtml(issue.fixDescription || "")}</p>`
            : `<p class="doctor-fix-description"><em>No automatic fix; manual cleanup required.</em></p>`}
        </div>
      </div>
    `).join("");
    editorContent.innerHTML = `
      <h1>${lawyerActionLabel("/doctor")} — ${escapeHtml(activeMatter.folderName)}</h1>
      <p>${issues.length} issue${issues.length === 1 ? "" : "s"} found. Backups go to <code>.doctor-backups/&lt;timestamp&gt;/</code> before any fix runs.</p>
      <div class="doctor-issues">${cards}</div>
      <div class="form-actions">
        <button type="button" id="doctorFixSelected">Fix selected</button>
        <button type="button" class="secondary" id="doctorFixAll">Fix all automatically fixable</button>
        <button type="button" class="secondary" id="doctorCancel">Cancel</button>
      </div>
      <div id="doctorError" class="form-error" hidden></div>
    `;
    document.getElementById("doctorCancel").addEventListener("click", ctx.goToExplorer);
    document.getElementById("doctorFixSelected").addEventListener("click", () => {
      const selected = Array.from(document.querySelectorAll(".doctor-issue-checkbox"))
        .filter((cb) => cb.checked && !cb.disabled)
        .map((cb) => cb.dataset.issueId);
      applyDoctorFixes(selected);
    });
    document.getElementById("doctorFixAll").addEventListener("click", () => {
      const all = issues.filter((i) => i.autoFixable).map((i) => i.id);
      applyDoctorFixes(all);
    });
  }

  async function applyDoctorFixes(fixIds) {
    const errorBox = document.getElementById("doctorError");
    if (errorBox) errorBox.hidden = true;
    if (!fixIds.length) {
      if (errorBox) {
        errorBox.textContent = "Select at least one issue to fix.";
        errorBox.hidden = false;
      }
      return;
    }
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Applying ${fixIds.length} fix${fixIds.length === 1 ? "" : "es"}</strong><br />Creating a backup first...`,
      bar: "Matter Check Fixing",
      terminal: `[doctor] applying ${fixIds.length} fix(es): ${fixIds.join(", ")}`,
    });
    try {
      const payload = await postJson("/api/doctor/fix", { fixIds });
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
      renderDoctorResult(payload);
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Matter check fix failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Matter Check Failed",
        terminal: `[doctor] fix failed: ${error.message}`,
      });
    }
  }

  function renderDoctorResult(payload) {
    const activeMatter = ctx.getActiveMatter();
    const applied = payload.applied || [];
    const failed = payload.failed || [];
    const remaining = payload.remaining || [];
    const appliedCount = applied.length;
    const allLogs = applied.flatMap((a) => a.log || []);
    ctx.setStatus({
      mood: failed.length ? "idle" : "success",
      card: failed.length
        ? `<strong>Partial fix</strong><br />${appliedCount} applied, ${failed.length} failed.`
        : `<strong>${lawyerActionCompleteLabel("/doctor")}</strong><br />${appliedCount} fix${appliedCount === 1 ? "" : "es"} applied.`,
      bar: failed.length ? "Matter Check Partial" : "Matter Check Complete",
      terminal: [
        `[doctor] applied ${appliedCount} fix(es)`,
        ...allLogs.map((l) => `[doctor]   ${l}`),
        ...failed.map((f) => `[doctor] FAILED ${f.id}: ${f.error}`),
        `[doctor] remaining issues: ${remaining.length}`,
      ],
    });
    const appliedHtml = applied.map((a) => `
      <div class="doctor-issue">
        <strong>${escapeHtml(a.id)}</strong>
        <ul>${(a.log || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        ${a.backupDir ? `<p class="doctor-fix-description">Backup: <code>${escapeHtml(a.backupDir)}</code></p>` : ""}
      </div>
    `).join("");
    const failedHtml = failed.map((f) => `
      <div class="doctor-issue">
        <span class="doctor-issue-badge doctor-severity-error">failed</span>
        <strong>${escapeHtml(f.id)}</strong>: ${escapeHtml(f.error)}
      </div>
    `).join("");
    const remainingHtml = remaining.length
      ? `<h2>Remaining issues</h2><div class="doctor-issues">${remaining.map((i) => `<div class="doctor-issue"><span class="doctor-issue-badge doctor-severity-${escapeHtml(i.severity)}">${escapeHtml(i.severity)}</span> <strong>${escapeHtml(i.title)}</strong><p>${escapeHtml(i.description)}</p></div>`).join("")}</div>`
      : "";
    editorContent.innerHTML = `
      <h1>${lawyerActionCompleteLabel("/doctor")} — ${escapeHtml(activeMatter.folderName)}</h1>
      ${appliedCount ? `<h2>Applied</h2><div class="doctor-issues">${appliedHtml}</div>` : ""}
      ${failed.length ? `<h2>Failed</h2><div class="doctor-issues">${failedHtml}</div>` : ""}
      ${remainingHtml}
      <div class="form-actions">
        <button type="button" id="doctorReturn">Back to matter</button>
        ${remaining.length ? `<button type="button" class="secondary" id="doctorRescan">Re-scan</button>` : ""}
      </div>
    `;
    document.getElementById("doctorReturn").addEventListener("click", ctx.goToExplorer);
    const rescan = document.getElementById("doctorRescan");
    if (rescan) rescan.addEventListener("click", () => runDoctor("/doctor"));
  }

  return {
    applyDoctorFixes,
    renderDoctorResult,
    renderDoctorScan,
    runDoctor,
  };
}
