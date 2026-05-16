export function wireSkillIdeaSessionActions({
  aiCommandSession,
  cancelSkillIdeaInterview,
  configurableSkillRuns,
  copySavedSkillIdeaReviewPacket,
  creationActions,
  getSession = () => null,
  handleSkillIdeaInterviewInput,
  markSavedSkillIdeaReady,
  openSavedSkillIdeaInSkills,
  sampleActions,
  saveSkillIdeaInterviewSession,
  startAnotherSkillIdea,
} = {}) {
  aiCommandSession?.querySelectorAll?.("[data-skill-interview-action]")?.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.skillInterviewAction;
      if (action === "save") {
        await saveSkillIdeaInterviewSession();
        return;
      }
      if (action === "edit") {
        await handleSkillIdeaInterviewInput("edit answers");
        return;
      }
      if (action === "copy-packet") {
        await copySavedSkillIdeaReviewPacket();
        return;
      }
      if (action === "generate-sample") {
        await sampleActions.generateSavedSkillIdeaSample();
        return;
      }
      if (action === "regenerate-sample") {
        await sampleActions.generateSavedSkillIdeaSample({ feedback: "Regenerate the sample with the current design brief." });
        return;
      }
      if (action === "approve-sample") {
        await sampleActions.approveSavedSkillIdeaSampleAndCreateSkill();
        return;
      }
      if (action === "create-skill") {
        await creationActions.createConfigurableSkillFromApprovedSample();
        return;
      }
      if (action === "run-created-skill") {
        const session = getSession();
        const slash = session?.createdSkill?.slash || session?.sampleReview?.createdSkill?.slash || "";
        if (slash) await configurableSkillRuns.runConfigurableSkillCommand({ slash, title: session?.createdSkill?.title || slash }, slash);
        return;
      }
      if (action === "copy-sample") {
        await sampleActions.copySavedSkillIdeaSample();
        return;
      }
      if (action === "copy-ledger-sample") {
        const sampleId = button.dataset.sampleId || "";
        await sampleActions.copyLedgerSampleById(sampleId);
        return;
      }
      if (action === "mark-ready") {
        await markSavedSkillIdeaReady();
        return;
      }
      if (action === "open-skills") {
        await openSavedSkillIdeaInSkills();
        return;
      }
      if (action === "start-another") {
        startAnotherSkillIdea();
        return;
      }
      if (action === "cancel") {
        cancelSkillIdeaInterview();
      }
    });
  });
}
