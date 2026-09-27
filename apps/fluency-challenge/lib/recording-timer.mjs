export const FINISH_SENTENCE_GRACE_MS = 3_000;

export function getRecordingTimerState({
  targetDeadlineMs,
  nowMs,
  graceMs = FINISH_SENTENCE_GRACE_MS
}) {
  if (!Number.isFinite(targetDeadlineMs) || !Number.isFinite(nowMs)) {
    throw new TypeError("Timer values must be finite numbers.");
  }
  if (!Number.isInteger(graceMs) || graceMs < 0) {
    throw new TypeError("graceMs must be a non-negative integer.");
  }

  const targetRemainingMs = targetDeadlineMs - nowMs;
  if (targetRemainingMs > 0) {
    return Object.freeze({
      phase: "speaking",
      displaySeconds: Math.ceil(targetRemainingMs / 1_000),
      shouldStop: false
    });
  }

  const graceRemainingMs = Math.max(0, graceMs + targetRemainingMs);
  if (graceRemainingMs > 0) {
    return Object.freeze({
      phase: "finish-sentence",
      displaySeconds: Math.ceil(graceRemainingMs / 1_000),
      shouldStop: false
    });
  }

  return Object.freeze({
    phase: "ended",
    displaySeconds: 0,
    shouldStop: true
  });
}
