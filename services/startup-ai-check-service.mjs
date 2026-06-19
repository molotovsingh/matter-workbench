import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export async function runStartupAiChecks({ aiSettingsService, log = console.log } = {}) {
  const check = typeof aiSettingsService?.checkCopilotModel === "function"
    ? await aiSettingsService.checkCopilotModel()
    : null;
  if (!check) return null;

  const route = [check.provider, check.model].filter(Boolean).join(" / ") || "unknown route";
  if (check.ok) {
    log(redactSensitiveText(`Matter Copilot startup check: ok (${route})`));
  } else {
    log(redactSensitiveText(`Matter Copilot startup check: failed (${route}) - ${check.error || "unknown error"}`));
  }
  return check;
}
