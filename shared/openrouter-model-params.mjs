export function supportsOpenRouterTemperature(model = "") {
  return !/^openai\/gpt-5(?:[.\-/]|$)/i.test(String(model || "").trim());
}

export function openRouterTemperatureParams(model = "", temperature = 0) {
  return supportsOpenRouterTemperature(model) ? { temperature } : {};
}
