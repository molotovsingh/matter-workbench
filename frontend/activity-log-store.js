const DEFAULT_ACTIVITY_LINE_CAP = 500;

export function createActivityLogStore({
  lineCap = DEFAULT_ACTIVITY_LINE_CAP,
  timestamp = () => new Date().toLocaleTimeString([], { hour12: false }),
} = {}) {
  let lines = [];

  function append(input) {
    const incoming = normalizeActivityInput(input);
    if (!incoming.length) return getLines();
    const stamp = timestamp();
    const stamped = incoming.map((line) => `${stamp} ${line}`);
    lines = trimActivityLines(lines.concat(stamped), lineCap);
    return getLines();
  }

  function clear() {
    lines = [];
  }

  function getLines({ limit, newestFirst = false } = {}) {
    let selected = lines.slice();
    if (Number.isFinite(limit) && limit >= 0) {
      selected = selected.slice(Math.max(0, selected.length - limit));
    }
    return newestFirst ? selected.reverse() : selected;
  }

  function getText() {
    return lines.join("\n");
  }

  function setLines(nextLines = []) {
    lines = trimActivityLines(normalizeActivityInput(nextLines), lineCap);
    return getLines();
  }

  return {
    append,
    clear,
    getLines,
    getText,
    setLines,
  };
}

export function latestActivityLines(lines = [], { limit = 4, newestFirst = true } = {}) {
  const normalized = normalizeActivityInput(lines);
  const selected = Number.isFinite(limit) && limit >= 0
    ? normalized.slice(Math.max(0, normalized.length - limit))
    : normalized;
  return newestFirst ? selected.reverse() : selected;
}

export function normalizeActivityInput(input = []) {
  const values = Array.isArray(input) ? input : String(input || "").split("\n");
  return values
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function trimActivityLines(lines = [], lineCap = DEFAULT_ACTIVITY_LINE_CAP) {
  if (!Number.isFinite(lineCap) || lineCap < 1 || lines.length <= lineCap) return lines.slice();
  return lines.slice(lines.length - lineCap);
}
