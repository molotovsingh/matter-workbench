const RESEND_API_URL = "https://api.resend.com/emails";

export function createConsoleEmailSender({ env = process.env, fetchImpl = fetch } = {}) {
  const provider = String(env.MOTHERSHIP_CONSOLE_EMAIL_PROVIDER || (env.MOTHERSHIP_CONSOLE_EMAIL_API_KEY || env.RESEND_API_KEY ? "resend" : "")).trim().toLowerCase();
  if (!provider) throw new Error("MOTHERSHIP_CONSOLE_EMAIL_PROVIDER=resend is required for email-code console auth.");
  if (provider !== "resend") throw new Error(`Unsupported MOTHERSHIP_CONSOLE_EMAIL_PROVIDER: ${provider}`);

  const apiKey = String(env.MOTHERSHIP_CONSOLE_EMAIL_API_KEY || env.RESEND_API_KEY || "").trim();
  const from = String(env.MOTHERSHIP_CONSOLE_FROM_EMAIL || "").trim();
  if (!apiKey) throw new Error("MOTHERSHIP_CONSOLE_EMAIL_API_KEY or RESEND_API_KEY is required for Resend console auth.");
  if (!from) throw new Error("MOTHERSHIP_CONSOLE_FROM_EMAIL is required for Resend console auth.");

  return {
    provider,
    async sendConsoleCode({ email, code, expiresInMinutes = 10 }) {
      const to = String(email || "").trim();
      const cleanCode = String(code || "").trim();
      if (!to || !cleanCode) throw new Error("Console code email requires recipient and code.");
      const response = await fetchImpl(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "Your Matter Workbench console code",
          text: renderConsoleCodeEmail({ code: cleanCode, expiresInMinutes }),
        }),
      });
      if (!response.ok) {
        const detail = await safeResponseText(response);
        throw new Error(`Resend email failed (${response.status}): ${detail}`);
      }
      return true;
    },
  };
}

export function renderConsoleCodeEmail({ code, expiresInMinutes = 10 }) {
  return [
    "Your Matter Workbench mothership console code is:",
    "",
    String(code || "").trim(),
    "",
    `This code expires in ${expiresInMinutes} minutes.`,
  ].join("\n");
}

async function safeResponseText(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500) || response.statusText || "upstream error";
  } catch {
    return response.statusText || "upstream error";
  }
}
