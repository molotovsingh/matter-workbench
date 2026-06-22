export function readRuntimeDbPayloadText({
  matter,
  relativePath = "",
  readPayloadRow,
  warnings = [],
} = {}) {
  try {
    const payload = readPayloadRow({ matter, relativePath });
    return payload.bytes.toString("utf8");
  } catch (error) {
    if (error?.statusCode === 404) return null;
    if (error?.statusCode === 409) {
      pushWarning(warnings, `Skipped DB payload ${relativePath}: payload is not available in DB custody`);
      return null;
    }
    pushWarning(warnings, `Skipped DB payload ${relativePath}: ${error.message || error}`);
    return null;
  }
}

function pushWarning(warnings, message) {
  if (Array.isArray(warnings)) warnings.push(message);
}
