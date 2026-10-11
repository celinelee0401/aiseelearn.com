// Pace is shown as a trend only: classroom WPM thresholds are not validated yet.
export const COMPARISON_METRICS = Object.freeze([
  Object.freeze({ key: "pauseFlow", label: "停頓流暢", read: (metrics) => metrics?.pauseFlow?.score }),
  Object.freeze({ key: "pronunciationAccuracy", label: "發音清晰", read: (metrics) => metrics?.pronunciationAccuracy?.score }),
  Object.freeze({ key: "prosody", label: "語調節奏", read: (metrics) => metrics?.prosody?.score }),
  Object.freeze({ key: "wpm", label: "語速", unit: "WPM", neutral: true, read: (metrics) => metrics?.pace?.wpm })
]);

const SAME_THRESHOLD = 1;

export function metricValue(assessment, metric) {
  const value = metric.read(assessment?.metrics);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function compareRounds(current, previous) {
  return COMPARISON_METRICS.map((metric) => {
    const value = metricValue(current?.assessment, metric);
    const before = previous ? metricValue(previous.assessment, metric) : null;
    const delta = value === null || before === null ? null : roundOne(value - before);
    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit || "",
      neutral: Boolean(metric.neutral),
      value,
      delta,
      direction: directionOf(delta)
    };
  });
}

export function previousResult(results, round) {
  if (!Array.isArray(results)) return null;
  return results
    .filter((result) => Number(result?.round) < Number(round))
    .sort((left, right) => Number(right.round) - Number(left.round))[0] || null;
}

export function progressHeadline(comparisons) {
  const scored = comparisons.filter((item) => !item.neutral && item.direction);
  if (!scored.length) return "這是你的起點。下一輪試著說得更順、更少停頓。";
  const gains = scored.filter((item) => item.direction === "up");
  if (gains.length === scored.length) return "每一項都比上一輪更好，太棒了！";
  if (gains.length) return `${gains.map((item) => item.label).join("、")}比上一輪進步了！`;
  if (scored.every((item) => item.direction === "same")) return "表現很穩定。下一輪試著再多說一點。";
  return "分數本來就會起伏。下一輪放慢一點，把每個字說清楚。";
}

export function biggestGain(results) {
  const completed = Array.isArray(results)
    ? [...results].sort((left, right) => Number(left.round) - Number(right.round))
    : [];
  if (completed.length < 2) return null;
  const first = completed[0];
  const last = completed[completed.length - 1];
  return compareRounds(last, first)
    .filter((item) => !item.neutral && item.delta !== null && item.delta >= SAME_THRESHOLD)
    .sort((left, right) => right.delta - left.delta)[0] || null;
}

export function formatDelta(delta) {
  if (delta === null) return "";
  if (Math.abs(delta) < SAME_THRESHOLD) return "持平";
  return `${delta > 0 ? "▲ +" : "▼ "}${delta}`;
}

function directionOf(delta) {
  if (delta === null) return null;
  if (Math.abs(delta) < SAME_THRESHOLD) return "same";
  return delta > 0 ? "up" : "down";
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}
