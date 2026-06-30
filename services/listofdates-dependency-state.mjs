import {
  CASE_TIMELINE_DEPENDENCY_STATES,
  classifyCaseTimelineDependencyState,
} from "./case-timeline-dependency-state.mjs";

// Backward-compatible aliases for the native /create_listofdates skill. Product
// read models and preparation code should import the Case Timeline names.
export const LIST_OF_DATES_DEPENDENCY_STATES = CASE_TIMELINE_DEPENDENCY_STATES;
export const classifyListOfDatesDependencyState = classifyCaseTimelineDependencyState;
