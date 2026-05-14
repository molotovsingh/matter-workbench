export async function writeClipboardText(text) {
  const value = String(text ?? "");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Embedded browser contexts may expose Clipboard API but reject writes.
    }
  }

  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new Error("clipboard is unavailable");
  }

  const scratch = document.createElement("textarea");
  scratch.value = value;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.top = "-9999px";
  document.body.appendChild(scratch);
  scratch.select();
  try {
    if (!document.execCommand?.("copy")) throw new Error("clipboard copy was rejected");
  } finally {
    scratch.remove();
  }
}
