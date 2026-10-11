import assert from "node:assert/strict";
import test from "node:test";

import {
  biggestGain,
  compareRounds,
  formatDelta,
  previousResult,
  progressHeadline
} from "../apps/fluency-challenge/lib/round-comparison.mjs";

function result(round, wpm, pauseFlow, pronunciationAccuracy, prosody) {
  return {
    round,
    assessment: {
      metrics: {
        pace: { wpm },
        pauseFlow: { score: pauseFlow },
        pronunciationAccuracy: { score: pronunciationAccuracy },
        prosody: { score: prosody }
      }
    }
  };
}

test("round comparison reports deltas against the previous round", () => {
  const comparisons = compareRounds(result(2, 90, 75.2, 80, null), result(1, 80, 70, 80.4, 60));
  const byKey = Object.fromEntries(comparisons.map((item) => [item.key, item]));
  assert.equal(byKey.pauseFlow.delta, 5.2);
  assert.equal(byKey.pauseFlow.direction, "up");
  assert.equal(byKey.pronunciationAccuracy.direction, "same");
  assert.equal(byKey.prosody.delta, null);
  assert.equal(byKey.wpm.neutral, true);
  assert.equal(byKey.wpm.delta, 10);
});

test("the first round has no comparison and gets a starting-point message", () => {
  const comparisons = compareRounds(result(1, 80, 70, 80, 60), null);
  assert.ok(comparisons.every((item) => item.delta === null));
  assert.match(progressHeadline(comparisons), /起點/);
});

test("headlines name only score gains and never treat pace as good or bad", () => {
  const comparisons = compareRounds(result(2, 60, 75, 79, 60), result(1, 90, 70, 80, 60));
  assert.equal(progressHeadline(comparisons), "停頓流暢比上一輪進步了！");
  const allDown = compareRounds(result(2, 120, 60, 70, 50), result(1, 90, 70, 80, 60));
  assert.doesNotMatch(progressHeadline(allDown), /進步/);
});

test("previous result and biggest gain use round order, not array order", () => {
  const results = [result(3, 110, 90, 95, 80), result(1, 95, 80, 92, 73), result(2, 80, 70, 82, 66)];
  assert.equal(previousResult(results, 3).round, 2);
  assert.equal(previousResult(results, 1), null);
  const gain = biggestGain(results);
  assert.equal(gain.key, "pauseFlow");
  assert.equal(gain.delta, 10);
  assert.equal(biggestGain([result(1, 80, 70, 80, 60)]), null);
});

test("delta labels are short and readable", () => {
  assert.equal(formatDelta(5.2), "▲ +5.2");
  assert.equal(formatDelta(-3), "▼ -3");
  assert.equal(formatDelta(0.4), "持平");
  assert.equal(formatDelta(null), "");
});
