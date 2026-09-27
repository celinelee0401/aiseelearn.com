export function normalizeCompletedRounds(value, roundCount = 3) {
  if (!Array.isArray(value) || !Number.isInteger(roundCount) || roundCount < 1) return [];
  return [...new Set(value
    .map((round) => Number(round))
    .filter((round) => Number.isInteger(round) && round >= 1 && round <= roundCount))]
    .sort((left, right) => left - right);
}

export function firstIncompleteRoundIndex(rounds, completedRounds) {
  if (!Array.isArray(rounds)) return -1;
  const completed = new Set(normalizeCompletedRounds(completedRounds, rounds.length));
  return rounds.findIndex((round) => !completed.has(Number(round?.round)));
}

export function mergeRoundResults(savedResults, localResults) {
  const saved = Array.isArray(savedResults) ? savedResults : [];
  const local = Array.isArray(localResults) ? localResults : [];
  const byRound = new Map(saved
    .filter((result) => Number.isInteger(Number(result?.round)))
    .map((result) => [Number(result.round), result]));
  for (const result of local) {
    if (Number.isInteger(Number(result?.round))) byRound.set(Number(result.round), result);
  }
  return [...byRound.values()].sort((left, right) => Number(left.round) - Number(right.round));
}
