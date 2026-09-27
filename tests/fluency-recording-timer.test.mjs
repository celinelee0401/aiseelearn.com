import assert from "node:assert/strict";
import test from "node:test";

import {
  FINISH_SENTENCE_GRACE_MS,
  getRecordingTimerState
} from "../apps/fluency-challenge/lib/recording-timer.mjs";

const TARGET_DEADLINE = 35_000;

test("the target countdown shows the full configured speaking time", () => {
  assert.deepEqual(getRecordingTimerState({ targetDeadlineMs: TARGET_DEADLINE, nowMs: 0 }), {
    phase: "speaking",
    displaySeconds: 35,
    shouldStop: false
  });
  assert.equal(getRecordingTimerState({ targetDeadlineMs: TARGET_DEADLINE, nowMs: 999 }).displaySeconds, 35);
  assert.equal(getRecordingTimerState({ targetDeadlineMs: TARGET_DEADLINE, nowMs: 1_000 }).displaySeconds, 34);
});

test("reaching the target opens a bounded three-second finish-sentence window", () => {
  assert.equal(FINISH_SENTENCE_GRACE_MS, 3_000);
  assert.deepEqual(getRecordingTimerState({ targetDeadlineMs: TARGET_DEADLINE, nowMs: 35_000 }), {
    phase: "finish-sentence",
    displaySeconds: 3,
    shouldStop: false
  });
  assert.equal(getRecordingTimerState({ targetDeadlineMs: TARGET_DEADLINE, nowMs: 37_999 }).displaySeconds, 1);
});

test("recording hard-stops at the end of the finish-sentence window", () => {
  assert.deepEqual(getRecordingTimerState({ targetDeadlineMs: TARGET_DEADLINE, nowMs: 38_000 }), {
    phase: "ended",
    displaySeconds: 0,
    shouldStop: true
  });
});
