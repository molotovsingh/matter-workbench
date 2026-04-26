const TERMINAL_LINE_CAP = 500;

export function createStatusController({ terminalOutput, statusBarRight }) {
  function appendTerminal(lines) {
    const incoming = Array.isArray(lines) ? lines : [lines];
    if (!incoming.length) return;
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    const stamped = incoming.map((line) => `${stamp} ${line}`);
    const existing = terminalOutput.textContent ? terminalOutput.textContent.split("\n") : [];
    const combined = existing.concat(stamped);
    const trimmed = combined.length > TERMINAL_LINE_CAP
      ? combined.slice(combined.length - TERMINAL_LINE_CAP)
      : combined;
    terminalOutput.textContent = trimmed.join("\n");
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function setStatus({ bar, terminal } = {}) {
    if (bar !== undefined) statusBarRight.innerHTML = `<span>${bar}</span>`;
    if (terminal !== undefined) appendTerminal(terminal);
  }

  return { appendTerminal, setStatus };
}
