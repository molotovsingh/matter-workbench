const MATTER_LANES = new Set(["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"]);

export function buildConfigurableSkillImprovementBrief({
  slash = "",
  title = "",
  artifactPath = "",
  changeText = "",
  activeMatter = {},
} = {}) {
  const targetLane = inferLaneFromArtifactPath(artifactPath);
  return {
    intendedUser: "Lawyer improving an active custom skill",
    problem: `Improve ${title || slash} based on real use: ${changeText}`,
    expectedInputs: `Existing active skill ${slash}; selected matter context; current output ${artifactPath || "from the skill"}.`,
    expectedOutputArtifact: artifactPath || "Use the existing skill output artifact unless the reviewer changes it.",
    targetLane,
    paidPosture: "paid",
    riskLevel: "medium",
    notes: [
      "Proposal type: Improve existing skill",
      `Target skill: ${slash}`,
      `What should change: ${changeText}`,
      "What must stay unchanged: Do not change the active skill until a revised sample is generated, approved, validated, and activated as a new version.",
      "What must stay unchanged: Preserve source-backed factual discipline and the current output lane unless the reviewer explicitly changes it.",
      activeMatter.folderName ? `Test matter: ${activeMatter.folderName}` : "Test matter: Not selected",
    ].join("\n"),
  };
}

export function buildConfigurableSkillImprovementInterview({
  slash = "",
  title = "",
  artifactPath = "",
  changeText = "",
  activeMatter = {},
} = {}) {
  return {
    mode: "modify_existing_skill",
    targetSkill: slash,
    originalText: `Improve ${slash}: ${changeText}`,
    understood: `You want to improve ${title || slash} without changing the active version until a revised sample is approved and validated.`,
    designBrief: buildConfigurableSkillImprovementBrief({
      slash,
      title,
      artifactPath,
      changeText,
      activeMatter,
    }),
    defaultAssumptions: [
      `Keep ${slash} stable as the command name for the improved version.`,
      "Keep the current version active until the revised sample validates.",
      "Preserve source-backed factual discipline and the current output lane unless the approved sample changes it.",
    ],
    questions: [],
    planner: {
      source: "deterministic",
      used: false,
    },
  };
}

function inferLaneFromArtifactPath(artifactPath = "") {
  const lane = String(artifactPath || "").split("/")[0] || "";
  if (MATTER_LANES.has(lane)) return lane;
  return "20_Workshop";
}
