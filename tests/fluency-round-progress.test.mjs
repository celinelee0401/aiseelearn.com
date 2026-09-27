import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  firstIncompleteRoundIndex,
  mergeRoundResults,
  normalizeCompletedRounds
} from "../apps/fluency-challenge/lib/round-progress.mjs";

test("completed rounds are normalized without allowing invalid progress", () => {
  assert.deepEqual(normalizeCompletedRounds([3, "1", 1, 0, 4, "bad"]), [1, 3]);
  assert.deepEqual(normalizeCompletedRounds(null), []);
});

test("the browser resumes at the first incomplete round", () => {
  const rounds = [{ round: 1 }, { round: 2 }, { round: 3 }];
  assert.equal(firstIncompleteRoundIndex(rounds, []), 0);
  assert.equal(firstIncompleteRoundIndex(rounds, [1]), 1);
  assert.equal(firstIncompleteRoundIndex(rounds, [1, 2]), 2);
  assert.equal(firstIncompleteRoundIndex(rounds, [1, 2, 3]), -1);
});

test("saved assessment evidence is restored while current-page audio remains preferred", () => {
  const saved = [
    { round: 1, assessment: { metrics: { pace: { wpm: 80 } } }, audioUrl: "" },
    { round: 2, assessment: { metrics: { pace: { wpm: 90 } } }, audioUrl: "" }
  ];
  const local = [
    { round: 2, assessment: { metrics: { pace: { wpm: 95 } } }, audioUrl: "blob:local" }
  ];
  const merged = mergeRoundResults(saved, local);
  assert.deepEqual(merged.map((result) => result.round), [1, 2]);
  assert.equal(merged[0].assessment.metrics.pace.wpm, 80);
  assert.equal(merged[1].assessment.metrics.pace.wpm, 95);
  assert.equal(merged[1].audioUrl, "blob:local");
});

test("the staging migration returns only completed round numbers with the task", async () => {
  const sql = await readFile(new URL(
    "../apps/self-correction-center/supabase/migrations/202609080002_fluency_resume_progress.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /'completedRounds'/);
  assert.match(sql, /jsonb_agg\(attempt\.round_number order by attempt\.round_number\)/i);
  assert.match(sql, /where attempt\.assignment_id = assignment\.id/i);
  assert.doesNotMatch(sql, /recognized_text|metrics|audio_object_key/i);
});

test("the evidence migration restores assessment details without exposing identity or audio storage", async () => {
  const sql = await readFile(new URL(
    "../apps/self-correction-center/supabase/migrations/202609080003_fluency_resume_evidence.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /'completedAttempts'/);
  assert.match(sql, /'transcript', coalesce\(attempt\.recognized_text/i);
  assert.match(sql, /'metrics', coalesce\(attempt\.metrics -> 'metrics'/i);
  assert.match(sql, /'provider', jsonb_build_object/i);
  assert.doesNotMatch(sql, /'studentId'|'enrollmentId'|'audioObjectKey'/i);
  assert.doesNotMatch(sql, /audio_object_key/i);
});
