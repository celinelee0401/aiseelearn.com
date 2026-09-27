export function canRetryAssessment(status) {
  return status === null || status === 408 || status === 429 || status >= 500;
}

export function createAssessmentForm({ attemptId, assignmentId, unitId, round, audio }) {
  const form = new FormData();
  form.set("attemptId", attemptId);
  form.set("assignmentId", assignmentId);
  form.set("unitId", unitId);
  form.set("round", String(round));
  form.set("audio", audio, `round-${round}.wav`);
  return form;
}
