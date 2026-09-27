import { createAssignmentSnapshot } from "./task-config.mjs";

export function createClassRunSnapshot({
  runId,
  schoolYear,
  classCode,
  unitId,
  studentAssignments,
  unitOverrides = {},
  openedAt = new Date().toISOString(),
  configVersion = "1"
}) {
  const normalizedYear = String(schoolYear || "").trim();
  const normalizedClass = String(classCode || "").trim().toUpperCase();
  if (!/^\d{2,4}$/.test(normalizedYear) || !/^[A-Z0-9-]{2,12}$/.test(normalizedClass)) {
    throw new TypeError("schoolYear or classCode is invalid.");
  }
  if (!Array.isArray(studentAssignments) || studentAssignments.length < 1 || studentAssignments.length > 60) {
    throw new TypeError("studentAssignments must contain 1 to 60 students.");
  }

  const seenEnrollments = new Set();
  const seenSeats = new Set();
  const assignments = studentAssignments.map((assignment) => {
    const seatNumber = Number(assignment.seatNumber);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 60) {
      throw new TypeError("seatNumber is invalid.");
    }
    const enrollmentId = String(assignment.enrollmentId || "").trim();
    if (seenSeats.has(seatNumber) || seenEnrollments.has(enrollmentId)) {
      throw new TypeError("Duplicate student assignment.");
    }
    seenSeats.add(seatNumber);
    seenEnrollments.add(enrollmentId);

    return Object.freeze({
      schoolYear: normalizedYear,
      classCode: normalizedClass,
      seatNumber,
      ...createAssignmentSnapshot({
        runId,
        studentId: assignment.studentId,
        enrollmentId,
        unitId,
        track: assignment.track,
        unitOverrides,
        assignedAt: openedAt,
        configVersion
      })
    });
  });

  return deepFreeze_({
    schemaVersion: "1.0",
    runId: String(runId),
    schoolYear: normalizedYear,
    classCode: normalizedClass,
    unitId: String(unitId).trim().toUpperCase(),
    configVersion: String(configVersion),
    openedAt: new Date(openedAt).toISOString(),
    assignmentCount: assignments.length,
    assignments
  });
}

function deepFreeze_(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze_);
  return value;
}
