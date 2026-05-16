import { escapeHtml } from "../dom-utils.js";
import { latestActivityLines } from "../activity-log-store.js";
import { filterMatters } from "../matter-search.js";
import { setShellMatterMode } from "../shell-presentation.js";
import { renderNewMatterForm } from "./new-matter.js";

export function createHomeLandingController({
  ctx,
  setActivityActive,
  resetMatterSearch,
} = {}) {
  function renderBlankLanding() {
    setActivityActive?.("explorer");
    ctx.clearActiveMatter?.();
    setShellMatterMode(ctx.elements, false);
    if (ctx.elements.titleText) ctx.elements.titleText.textContent = "No matter selected";
    if (ctx.elements.bottomMeta) ctx.elements.bottomMeta.textContent = "No matter selected";
    resetMatterSearch?.();
    ctx.elements.workspaceTree.innerHTML = "";
    ctx.elements.breadcrumbs.textContent = "Home";

    const mattersState = ctx.getMattersState();
    const recentActivityLines = latestActivityLines(ctx.getActivityLogLines?.({ limit: 4 }) || []);
    ctx.elements.editorContent.innerHTML = renderHomeLandingHtml({
      mattersState,
      recentActivityLines,
      greeting: timeAwareGreeting(),
    });
    scrollHomeToTop(ctx.elements.editorContent);
    wireHomeLanding({
      ctx,
      mattersState,
    });
    ctx.setStatus({
      mood: "idle",
      card: mattersState.matters.length
        ? "<strong>Pick a matter</strong><br />Search existing matters or add a new one from Home."
        : "<strong>Ready</strong><br />Create your first matter to begin.",
      bar: "Pick a matter to begin",
      terminal: [
        "[landing] no active matter",
        `[landing] ${mattersState.matters.length} matter(s) available`,
      ],
    });
  }

  return { renderBlankLanding };
}

export function renderHomeLandingHtml({ mattersState = {}, recentActivityLines = [], greeting = timeAwareGreeting() } = {}) {
  const matters = Array.isArray(mattersState.matters) ? mattersState.matters : [];
  const hasMatters = matters.length > 0;
  const resumeMatterName = mattersState.resumeMatterName || "";
  const canResume = Boolean(
    resumeMatterName && matters.some((matter) => matter.name === resumeMatterName),
  );
  const availableMatters = matters.slice(0, 3);
  return `
    <section class="landing-home">
      <div class="landing-kicker">Home</div>
      <h1>${escapeHtml(greeting)}</h1>
      <p class="landing-lede">
        ${hasMatters
          ? "Choose a matter to begin, or use the assistant to prepare documents, search cases, or run an action."
          : "Create your first matter to begin."}
      </p>
      ${canResume ? `
        <button id="continueLastMatterButton" class="home-continue-card" type="button">
          <span class="home-card-kicker">Continue where you left off</span>
          <strong>${escapeHtml(resumeMatterName)}</strong>
          <span>Open this matter</span>
          <span class="home-continue-arrow" aria-hidden="true">→</span>
        </button>
      ` : ""}
      <div class="home-dashboard-grid">
        <section class="home-card">
          <div class="home-card-header">
            <h2>Available matters</h2>
            <span>${matters.length} total</span>
          </div>
          ${availableMatters.length ? `
            <ul class="home-matter-list">
              ${availableMatters.map((matter) => `
                <li>
                  <button type="button" data-home-matter-name="${escapeHtml(matter.name)}">
                    <span class="home-matter-dot" aria-hidden="true"></span>
                    <strong>${escapeHtml(matter.name)}</strong>
                  </button>
                </li>
              `).join("")}
            </ul>
          ` : '<p class="muted">No matters yet.</p>'}
          <button id="homeViewAllMattersButton" class="home-card-link" type="button">View all matters →</button>
        </section>
        <section class="home-card">
          <div class="home-card-header">
            <h2>Quick actions</h2>
          </div>
          <div class="home-quick-actions">
            <button id="homeFindMatterAction" type="button">
              <strong>Find a matter</strong>
              <span>Search by client, party, or matter name</span>
            </button>
            <button id="homeAddMatterAction" type="button">
              <strong>Add new matter</strong>
              <span>Create a new case folder</span>
            </button>
            <button id="homeNewSkillAction" type="button">
              <strong>New skill</strong>
              <span>Design a reusable matter action</span>
            </button>
            <button id="homePrepareMatterAction" type="button">
              <strong>Prepare matter</strong>
              <span>Check setup and run missing preparation</span>
            </button>
          </div>
        </section>
      </div>
      <section id="homeMatterSearchPanel" class="home-matter-search-panel" hidden>
        <label for="homeMatterSearchInput">Search existing matters</label>
        <input
          id="homeMatterSearchInput"
          type="search"
          placeholder="Type a client, party, or matter name"
          autocomplete="off"
          spellcheck="false"
        />
        <div id="homeMatterSearchMeta" class="matter-search-meta">${hasMatters ? `Type to search ${matters.length} matter${matters.length === 1 ? "" : "s"}.` : "No matters are available yet."}</div>
        <ul id="homeMattersList" class="home-matters-list matters-list"></ul>
      </section>
      <section class="home-card home-activity-card">
        <div class="home-card-header">
          <h2>Recent activity</h2>
        </div>
        ${recentActivityLines.length ? `
          <ul class="home-activity-list">
            ${recentActivityLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
        ` : '<p class="muted">No activity yet. Pick a matter to begin.</p>'}
      </section>
    </section>
    ${mattersState.mattersHome ? `
      <details class="local-folder-details">
        <summary>Show local folder</summary>
        <p><code>${escapeHtml(mattersState.mattersHome)}</code></p>
      </details>
    ` : ""}
  `;
}

export function renderHomeMatterResults({
  matters = [],
  query = "",
  list,
  meta,
} = {}) {
  if (!list || !meta) return;
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    list.innerHTML = "";
    meta.textContent = matters.length
      ? `Type to search ${matters.length} matter${matters.length === 1 ? "" : "s"}.`
      : "No matters are available yet.";
    return;
  }
  const filteredMatters = filterMatters(matters, trimmedQuery);
  meta.textContent = `${filteredMatters.length} of ${matters.length} matters`;
  if (!filteredMatters.length) {
    list.innerHTML = `<li class="matters-empty">No matters match "${escapeHtml(trimmedQuery)}".</li>`;
    return;
  }
  list.innerHTML = filteredMatters.map((matter) => (
    `<li><button type="button" class="matters-entry" data-home-matter-name="${escapeHtml(matter.name)}">${escapeHtml(matter.name)}</button></li>`
  )).join("");
}

export function timeAwareGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

function wireHomeLanding({ ctx, mattersState }) {
  const homeSearchPanel = document.getElementById("homeMatterSearchPanel");
  const homeSearchInput = document.getElementById("homeMatterSearchInput");
  const homeSearchMeta = document.getElementById("homeMatterSearchMeta");
  const homeMattersList = document.getElementById("homeMattersList");
  const revealHomeSearch = () => {
    if (!homeSearchPanel || !homeSearchInput) return;
    homeSearchPanel.hidden = false;
    homeSearchInput.focus();
    renderHomeMatterResults({
      matters: mattersState.matters,
      query: homeSearchInput.value,
      list: homeMattersList,
      meta: homeSearchMeta,
    });
  };
  const runHomeCommand = (command) => {
    if (ctx.elements.aiCommandInput) ctx.elements.aiCommandInput.value = command;
    ctx.runCommand?.(command);
  };

  document.getElementById("continueLastMatterButton")?.addEventListener("click", () => {
    ctx.switchToMatter?.(mattersState.resumeMatterName || "");
  });
  document.getElementById("homeAddMatterButton")?.addEventListener("click", () => {
    renderNewMatterForm(ctx);
  });
  document.getElementById("homeAddMatterAction")?.addEventListener("click", () => {
    renderNewMatterForm(ctx);
  });
  document.getElementById("homeSearchMatterButton")?.addEventListener("click", revealHomeSearch);
  document.getElementById("homeViewAllMattersButton")?.addEventListener("click", revealHomeSearch);
  document.getElementById("homeFindMatterAction")?.addEventListener("click", revealHomeSearch);
  document.getElementById("homeNewSkillAction")?.addEventListener("click", () => runHomeCommand("new skill"));
  document.getElementById("homePrepareMatterAction")?.addEventListener("click", () => runHomeCommand("prepare matter"));
  ctx.elements.editorContent.querySelectorAll?.("[data-home-matter-name]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.homeMatterName || "";
      if (name) ctx.switchToMatter?.(name);
    });
  });
  homeSearchInput?.addEventListener("input", (event) => {
    renderHomeMatterResults({
      matters: mattersState.matters,
      query: event.target.value,
      list: homeMattersList,
      meta: homeSearchMeta,
    });
  });
  homeMattersList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-home-matter-name]");
    const name = button?.dataset?.homeMatterName || "";
    if (!name) return;
    if (homeSearchInput) homeSearchInput.value = "";
    homeMattersList.innerHTML = "";
    ctx.switchToMatter?.(name);
  });
}

function scrollHomeToTop(editorContent) {
  editorContent.scrollTop = 0;
  globalThis.requestAnimationFrame?.(() => {
    editorContent.scrollTop = 0;
  });
  globalThis.setTimeout?.(() => {
    editorContent.scrollTop = 0;
  }, 0);
}
