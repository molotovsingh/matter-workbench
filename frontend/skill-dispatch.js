export function createBuiltinSkillDispatch(skills = {}) {
  return {
    "/matter-init": skills.runMatterInit,
    "/prepare_matter": skills.runPrepareMatter,
    "/extract": skills.runExtract,
    "/describe_sources": skills.runDescribeSources,
    "/context_preview": skills.runContextPreview,
    "/context_search": skills.runContextSearch,
    "/create_case_timeline": skills.runCreateListOfDates,
    "/create_listofdates": skills.runCreateListOfDates,
    "/create_mw_listofdates": skills.runMwListOfDates,
    "/doctor": skills.runDoctor,
  };
}
