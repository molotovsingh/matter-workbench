export const PRIVATE_BETA_SIGNAL_STATUSES = Object.freeze([
  "active",
  "resolved",
  "superseded",
  "suppressed",
]);

export const CLOSED_PRIVATE_BETA_SIGNAL_STATUSES = new Set(
  PRIVATE_BETA_SIGNAL_STATUSES.filter((status) => status !== "active"),
);

export function normalizePrivateBetaSignalStatus(value, fallback = "active") {
  const status = String(value || "").trim().toLowerCase();
  return PRIVATE_BETA_SIGNAL_STATUSES.includes(status) ? status : fallback;
}

export function isClosedPrivateBetaSignalStatus(value) {
  return CLOSED_PRIVATE_BETA_SIGNAL_STATUSES.has(normalizePrivateBetaSignalStatus(value, ""));
}

export function shouldReopenPrivateBetaSignalOnRecurrence({ status, source } = {}) {
  const normalizedStatus = normalizePrivateBetaSignalStatus(status, "");
  const normalizedSource = String(source || "").trim().toLowerCase();
  return ["resolved", "superseded"].includes(normalizedStatus) && normalizedSource !== "job_status";
}
