export const FLUENCY_TRACKS = Object.freeze(["S1", "S2", "S3", "S4"]);

export const DEFAULT_TRACK_SCHEDULES = deepFreeze_({
  S1: [35, 30, 25],
  S2: [35, 30, 25],
  S3: [30, 25, 20],
  S4: [30, 25, 20]
});

export function resolveTrackSchedule({ unitId, track, unitOverrides = {} }) {
  const normalizedUnitId = normalizeUnitId_(unitId);
  const normalizedTrack = normalizeTrack_(track);
  const override = unitOverrides?.[normalizedUnitId]?.[normalizedTrack];
  const schedule = override === undefined
    ? DEFAULT_TRACK_SCHEDULES[normalizedTrack]
    : validateSchedule_(override);

  return Object.freeze({
    unitId: normalizedUnitId,
    track: normalizedTrack,
    roundSeconds: Object.freeze([...schedule]),
    source: override === undefined ? "globalDefault" : "unitOverride"
  });
}

export function createAssignmentSnapshot({
  runId,
  studentId,
  enrollmentId,
  unitId,
  track,
  unitOverrides = {},
  assignedAt = new Date().toISOString(),
  configVersion = "1"
}) {
  const schedule = resolveTrackSchedule({ unitId, track, unitOverrides });
  const snapshot = {
    schemaVersion: "1.0",
    configVersion: String(configVersion),
    runId: requiredIdentifier_(runId, "runId"),
    studentId: requiredIdentifier_(studentId, "studentId"),
    enrollmentId: requiredIdentifier_(enrollmentId, "enrollmentId"),
    unitId: schedule.unitId,
    track: schedule.track,
    scheduleSource: schedule.source,
    rounds: schedule.roundSeconds.map((timeLimitSeconds, index) => ({
      round: index + 1,
      timeLimitSeconds
    })),
    assignedAt: validIsoDate_(assignedAt)
  };
  return deepFreeze_(snapshot);
}

function validateSchedule_(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError("A track schedule must contain exactly three rounds.");
  }
  const normalized = value.map(Number);
  if (normalized.some((seconds) => !Number.isInteger(seconds) || seconds < 5 || seconds > 180)) {
    throw new TypeError("Round times must be whole seconds between 5 and 180.");
  }
  if (!(normalized[0] > normalized[1] && normalized[1] > normalized[2])) {
    throw new TypeError("Round times must decrease from Round 1 to Round 3.");
  }
  return normalized;
}

function normalizeTrack_(track) {
  const normalized = String(track || "").trim().toUpperCase();
  if (!FLUENCY_TRACKS.includes(normalized)) {
    throw new TypeError("Track must be S1, S2, S3, or S4.");
  }
  return normalized;
}

function normalizeUnitId_(unitId) {
  const normalized = String(unitId || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(normalized)) {
    throw new TypeError("unitId is invalid.");
  }
  return normalized;
}

function requiredIdentifier_(value, name) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new TypeError(`${name} is invalid.`);
  }
  return normalized;
}

function validIsoDate_(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("assignedAt is invalid.");
  return date.toISOString();
}

function deepFreeze_(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze_);
  return value;
}
