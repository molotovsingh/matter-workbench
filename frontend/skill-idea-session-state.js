export function createInitialSkillIdeaSession(interview = {}) {
  return {
    interview,
    answers: {},
    questionIndex: 0,
    ready: !Array.isArray(interview?.questions) || interview.questions.length === 0,
  };
}

export function buildSkillIdeaPlannerTerminal({
  plannerInfo = {},
  plannerFallbackMessage = "",
  userRequest = "",
} = {}) {
  if (plannerInfo.source === "model") {
    return `[skill-ideas] model-planned interview opened: ${userRequest}`;
  }
  if (plannerInfo.source === "deterministic fallback") {
    return [
      `[skill-ideas] planner fallback: ${plannerInfo.fallbackReason || plannerFallbackMessage || "deterministic fallback"}`,
      `[skill-ideas] interview opened: ${userRequest}`,
    ];
  }
  return `[skill-ideas] interview opened: ${userRequest}`;
}

export function answerCurrentSkillIdeaQuestion(session, answer = "") {
  const question = session?.interview?.questions?.[session.questionIndex];
  if (!question) {
    if (session) session.ready = true;
    return {
      question: null,
      ready: true,
      nextQuestionNumber: 0,
    };
  }

  session.answers = session.answers || {};
  session.answers[question.id] = String(answer || "").trim();
  session.questionIndex += 1;
  session.ready = session.questionIndex >= session.interview.questions.length;

  return {
    question,
    ready: session.ready,
    nextQuestionNumber: session.questionIndex + 1,
  };
}
