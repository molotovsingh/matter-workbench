// Live watch dashboard for the isolated V4 runner.
//
// Serves a single self-contained page on 127.0.0.1 that shows an intake being
// processed in real time: ETA counting down, throughput climbing as slow-start
// admission opens lanes, a per-document grid lighting up, and a live feed of
// range completions, failovers, and backpressure events.

import http from "node:http";

export function startWatchDashboard({ port = 4499, service, tenantId, getIntakeId, admissionController, pool, maximumEvents = 200 } = {}) {
  const events = [];
  const startedAtMs = Date.now();
  function pushEvent(type, label) {
    events.push({ at: Date.now(), type, label: String(label).slice(0, 200) });
    if (events.length > maximumEvents) events.shift();
  }

  async function documentRows(intakeId) {
    if (!pool || !intakeId) return [];
    const client = await pool.connect();
    try {
      await client.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      const result = await client.query([
        "select f.relative_path, d.page_count::int,",
        "  count(*) filter (where pc.status = 'accepted')::int as accepted,",
        "  count(*) filter (where pc.status = 'review_required')::int as review,",
        "  count(*) filter (where pc.status = 'running')::int as running",
        "from document_intake_extraction.intake_files f",
        "join document_intake_extraction.documents d on d.tenant_id = f.tenant_id and d.document_id = f.document_id",
        "join document_intake_extraction.document_pages dp on dp.tenant_id = d.tenant_id and dp.document_id = d.document_id",
        "join document_intake_extraction.page_computations pc on pc.tenant_id = dp.tenant_id and pc.computation_id = dp.computation_id",
        "where f.tenant_id = $1 and f.intake_id = $2::uuid",
        "group by f.relative_path, d.page_count",
        "order by f.relative_path",
      ].join("\n"), [tenantId, intakeId]);
      return result.rows;
    } catch {
      return [];
    } finally {
      client.release();
    }
  }

  let previousLimits = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/state.json") {
        const intakeId = getIntakeId();
        for (const lane of admissionController ? admissionController.snapshot() : []) {
          const key = `${lane.capability.provider}/${lane.capability.model}/${lane.capability.adapterVersion}`;
          const label = `${lane.capability.provider} ${lane.capability.adapterVersion.includes("repair") ? "repair" : "primary"}`;
          const previous = previousLimits.get(key);
          if (previous !== undefined && previous !== lane.concurrencyLimit) {
            pushEvent(lane.concurrencyLimit > previous ? "scale" : "throttle",
              lane.concurrencyLimit > previous
                ? `⚡ ${label} engines ${previous} → ${lane.concurrencyLimit}`
                : `⛔ ${label} backed off ${previous} → ${lane.concurrencyLimit}`);
          }
          previousLimits.set(key, lane.concurrencyLimit);
        }
        let progress = null;
        if (intakeId) {
          try {
            progress = await service.getProgress({ tenantId, intakeId });
          } catch {}
        }
        const body = JSON.stringify({
          startedAtMs,
          now: Date.now(),
          progress,
          admission: admissionController ? admissionController.snapshot() : [],
          documents: await documentRows(intakeId),
          events: events.slice(-60),
        });
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(body);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(PAGE);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(String(error?.message || error));
    }
  });
  server.listen(port, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}`,
    pushEvent,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Matter Workbench — Live Extraction</title>
<style>
  :root { --bg:#0b1020; --panel:#121a33; --line:#22305c; --text:#e8edfb; --dim:#8ea0cc; --go:#3ddc84; --warn:#ffb347; --bad:#ff6b6b; --accent:#5aa2ff; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:14px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif; padding:22px; }
  h1 { font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); font-weight:600; }
  .top { display:flex; gap:16px; flex-wrap:wrap; margin:16px 0; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 20px; flex:1; min-width:170px; }
  .card .k { color:var(--dim); font-size:11px; letter-spacing:.12em; text-transform:uppercase; }
  .card .v { font-size:34px; font-weight:700; margin-top:4px; font-variant-numeric:tabular-nums; }
  .card .s { color:var(--dim); font-size:12px; margin-top:2px; }
  .accel { color:var(--go); }
  .lanes { margin:6px 0 2px; }
  .lane-row { display:flex; align-items:center; gap:10px; margin-top:10px; }
  .lane-name { width:150px; color:var(--dim); font-size:12px; }
  .lane-bar { flex:1; height:14px; background:#0e1530; border-radius:7px; overflow:hidden; position:relative; }
  .lane-fill { height:100%; background:linear-gradient(90deg,#2b6cff,#5aa2ff); transition:width .6s ease; }
  .lane-limit { position:absolute; top:-3px; bottom:-3px; width:2px; background:var(--go); transition:left .6s ease; }
  .lane-meta { width:170px; font-size:12px; color:var(--dim); text-align:right; font-variant-numeric:tabular-nums; }
  .pulse { animation:pulse 1s ease infinite alternate; } @keyframes pulse { from{opacity:.75} to{opacity:1} }
  .grid { display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; }
  .doc { width:26px; height:26px; border-radius:6px; background:#182247; border:1px solid var(--line); position:relative; overflow:hidden; }
  .doc .fill { position:absolute; left:0; bottom:0; right:0; background:var(--accent); transition:height .5s ease; }
  .doc.done .fill { background:var(--go); }
  .doc.review .fill { background:var(--warn); }
  .doc.active { border-color:var(--accent); box-shadow:0 0 8px #2b6cffaa; }
  .feed { margin-top:10px; max-height:230px; overflow:auto; font-size:12.5px; }
  .feed div { padding:3px 0; color:var(--dim); border-bottom:1px dashed #1a2447; }
  .feed .range { color:var(--text); } .feed .failover { color:var(--warn); } .feed .throttle { color:var(--bad); } .feed .scale { color:var(--go); }
  .split { display:flex; gap:16px; flex-wrap:wrap; align-items:stretch; }
  .split .card { min-width:320px; }
  .eta-done { color:var(--go); }
  svg { display:block; margin-top:8px; }
</style></head><body>
<h1>Matter Workbench · Live Extraction</h1>
<div class="top">
  <div class="card"><div class="k">Pages read</div><div class="v" id="pages">–</div><div class="s" id="pagesSub"></div></div>
  <div class="card"><div class="k">Speed</div><div class="v accel" id="rate">–</div><div class="s">pages / second<svg id="spark" width="180" height="30"></svg></div></div>
  <div class="card"><div class="k">Estimated wait</div><div class="v" id="eta">–</div><div class="s" id="etaSub"></div></div>
  <div class="card"><div class="k">Elapsed</div><div class="v" id="elapsed">–</div><div class="s" id="status"></div></div>
</div>
<div class="split">
  <div class="card" style="flex:2">
    <div class="k">Reading engines <span id="ssBadge"></span></div>
    <div class="lanes" id="lanes"></div>
    <div class="k" style="margin-top:16px">Documents</div>
    <div class="grid" id="grid"></div>
  </div>
  <div class="card" style="flex:1">
    <div class="k">Live activity</div>
    <div class="feed" id="feed"></div>
  </div>
</div>
<script>
const history = [];
let lastCompleted = null, lastAt = null;
function fmtSeconds(s) { if (s == null || !isFinite(s)) return '–'; s = Math.max(0, Math.round(s)); return s >= 60 ? Math.floor(s/60) + 'm ' + (s%60) + 's' : s + 's'; }
async function tick() {
  try {
    const state = await (await fetch('/state.json')).json();
    const p = state.progress;
    document.getElementById('elapsed').textContent = fmtSeconds((state.now - state.startedAtMs)/1000);
    if (p) {
      const done = p.processing.completedWeightedOperations, total = p.processing.currentWeightedOperations;
      document.getElementById('pages').textContent = Math.round(done) + ' / ' + Math.round(total);
      document.getElementById('pagesSub').textContent = Math.round((p.processing.completionRatio||0)*100) + '% · ' + p.processing.runningWeightedOperations + ' in flight';
      const now = state.now;
      if (lastCompleted != null && now > lastAt) {
        const rate = Math.max(0, (done - lastCompleted) / ((now - lastAt)/1000));
        history.push(rate); if (history.length > 45) history.shift();
        const smooth = history.slice(-5).reduce((a,b)=>a+b,0) / Math.min(5, history.length);
        document.getElementById('rate').textContent = smooth.toFixed(1);
        const svg = document.getElementById('spark'); const max = Math.max(1, ...history);
        svg.innerHTML = '<polyline fill="none" stroke="#3ddc84" stroke-width="2" points="' + history.map((v,i)=> (i*(180/44)) + ',' + (28 - (v/max)*26)).join(' ') + '"/>';
      }
      lastCompleted = done; lastAt = now;
      const terminal = ['ready','ready_with_review'].includes(p.status);
      const eta = document.getElementById('eta');
      if (terminal) { eta.textContent = 'done'; eta.classList.add('eta-done'); document.getElementById('etaSub').textContent = 'status: ' + p.status; }
      else if (p.processing.eta && isFinite(p.processing.eta.lowerSeconds)) {
        eta.textContent = fmtSeconds(p.processing.eta.lowerSeconds) + '–' + fmtSeconds(p.processing.eta.upperSeconds);
        document.getElementById('etaSub').textContent = (p.exception && p.exception.active) ? p.exception.reasons.join(', ') : 'confidence range';
      }
      document.getElementById('status').textContent = 'status: ' + p.status;
    }
    const lanes = document.getElementById('lanes'); lanes.innerHTML = '';
    let slowStart = false;
    for (const lane of state.admission || []) {
      slowStart = slowStart || lane.slowStart;
      const pct = Math.min(100, 100 * lane.inflight / lane.maximumConcurrent);
      const limitPct = Math.min(100, 100 * lane.concurrencyLimit / lane.maximumConcurrent);
      const row = document.createElement('div'); row.className = 'lane-row';
      row.innerHTML = '<div class="lane-name">' + lane.capability.provider + ' · ' + lane.capability.model + '</div>' +
        '<div class="lane-bar"><div class="lane-fill" style="width:' + pct + '%"></div><div class="lane-limit" style="left:' + limitPct + '%"></div></div>' +
        '<div class="lane-meta">' + lane.inflight + ' active · limit ' + lane.concurrencyLimit + ' / ' + lane.maximumConcurrent + '</div>';
      lanes.appendChild(row);
    }
    document.getElementById('ssBadge').innerHTML = slowStart ? '<span class="pulse" style="color:var(--go)">· accelerating</span>' : '';
    const grid = document.getElementById('grid'); grid.innerHTML = '';
    for (const doc of state.documents || []) {
      const total = doc.page_count || 1; const done = doc.accepted + doc.review;
      const cell = document.createElement('div');
      cell.className = 'doc' + (doc.review > 0 && done >= total ? ' review' : done >= total ? ' done' : doc.running > 0 ? ' active' : '');
      cell.title = doc.relative_path + ' — ' + doc.accepted + '/' + total + (doc.review ? ' (' + doc.review + ' review)' : '');
      cell.innerHTML = '<div class="fill" style="height:' + Math.min(100, 100*done/total) + '%"></div>';
      grid.appendChild(cell);
    }
    const feed = document.getElementById('feed');
    feed.innerHTML = (state.events || []).slice().reverse().map((event) =>
      '<div class="' + event.type + '">' + new Date(event.at).toLocaleTimeString() + ' · ' + event.label + '</div>').join('');
  } catch {}
  setTimeout(tick, 1000);
}
tick();
</script></body></html>`;
