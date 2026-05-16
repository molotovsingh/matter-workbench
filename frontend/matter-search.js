export function filterMatters(matters = [], query = "") {
  const normalizedQuery = normalizeMatterSearchText(query);
  if (!normalizedQuery) return matters;
  return matters.filter((matter) => normalizeMatterSearchText([
    matter.name,
    matter.folderName,
    matter.inputLabel,
    matter.clientName,
    matter.oppositeParty,
    matter.matterName,
  ].filter(Boolean).join(" ")).includes(normalizedQuery));
}

export function normalizeMatterSearchText(value = "") {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}
