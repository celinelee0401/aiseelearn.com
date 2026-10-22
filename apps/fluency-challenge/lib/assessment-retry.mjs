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


// A received recording is evaluated by a background worker. Keep the same
// attempt ID and poll; never re-upload while the job is still processing.
export async function waitForAssessment(response, { attemptId, fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onProgress = () => {}, maxPolls = 150 } = {}) {
  if (response?.status !== 202) return response;
  const deadline = Date.now() + 5 * 60_000;
  for (let poll = 0; poll < maxPolls && Date.now() < deadline; poll++) {
    onProgress(poll * 2);
    await wait(2000);
    let result;
    try { result = await fetchImpl(`/api/fluency/assess?attemptId=${encodeURIComponent(attemptId)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }); }
    catch { continue; }
    if (result.status === 202) continue;
    if ([502,504].includes(result.status)) continue;
    return result;
  }
  return null;
}
