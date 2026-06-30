import { CASE_TIMELINE_DEPENDENCY_STATES } from "./case-timeline-dependency-states.mjs";

// Backward-compatible alias for native skill/storage code that still uses the
// old List of Dates name. Prefer CASE_TIMELINE_DEPENDENCY_STATES in product,
// preparation, and read-model code.
export const LIST_OF_DATES_DEPENDENCY_STATES = CASE_TIMELINE_DEPENDENCY_STATES;
