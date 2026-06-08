import { modelPolicyMetadata, resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { resolveModelPolicy } from "../shared/model-policy.mjs";
import { createListOfDatesProvider } from "./providers.mjs";

export const TWO_PASS_ENV_FLAG = "CREATE_LISTOFDATES_TWO_PASS_ENABLED";

export function isTwoPassListOfDatesEnabled({ env, options }) {
  if (typeof options.twoPass === "boolean") return options.twoPass;
  return ["1", "true", "yes", "on"].includes(String(env[TWO_PASS_ENV_FLAG] || "").trim().toLowerCase());
}

export function createConfiguredListOfDatesProvider({
  task,
  options,
  env,
  prompt,
  injectedProvider,
  providerFactory = createListOfDatesProvider,
}) {
  const modelPolicy = resolveModelPolicy(task, { env });
  const providerConfig = resolveProviderConfig(modelPolicy, {
    endpoint: options.endpoint,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
  });
  const baseAiRun = modelPolicyMetadata(modelPolicy, providerConfig);
  const provider = injectedProvider || providerFactory({
    providerConfig,
    apiKey: options.apiKey,
    env,
    fetchImpl: options.fetchImpl || fetch,
    prompt,
  });
  return { provider, baseAiRun };
}
