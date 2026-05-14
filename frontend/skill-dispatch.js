export function createBuiltinSkillDispatch(skills = {}) {
  return {
    "/matter-init": skills.runMatterInit,
    "/prepare_matter": skills.runPrepareMatter,
    "/extract": skills.runExtract,
    "/describe_sources": skills.runDescribeSources,
    "/context_preview": skills.runContextPreview,
    "/context_search": skills.runContextSearch,
    "/create_listofdates": skills.runCreateListOfDates,
    "/doctor": skills.runDoctor,
  };
}
