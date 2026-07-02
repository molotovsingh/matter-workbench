export async function runListOfDatesStage(stageRecorder, stage, operation, successPatch = null) {
  if (typeof operation !== "function") throw new Error("stage operation is required");
  if (!stageRecorder?.startStage || !stageRecorder?.succeedStage || !stageRecorder?.failStage) {
    return operation();
  }
  await stageRecorder.startStage(stage);
  try {
    const value = await operation();
    const patch = typeof successPatch === "function" ? successPatch(value) : (successPatch || {});
    await stageRecorder.succeedStage({ ...stage, ...patch });
    return value;
  } catch (error) {
    await stageRecorder.failStage(stage, error);
    throw error;
  }
}

export async function skipListOfDatesStage(stageRecorder, stage, patch = {}) {
  if (!stageRecorder?.skipStage) return;
  await stageRecorder.skipStage({ ...stage, ...patch });
}
