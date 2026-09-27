import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssignmentSnapshot,
  DEFAULT_TRACK_SCHEDULES,
  resolveTrackSchedule
} from "../apps/fluency-challenge/lib/task-config.mjs";
import { createClassRunSnapshot } from "../apps/fluency-challenge/lib/run-snapshot.mjs";

test("four-track defaults match the teacher rules", () => {
  assert.deepEqual(DEFAULT_TRACK_SCHEDULES.S1, [35, 30, 25]);
  assert.deepEqual(DEFAULT_TRACK_SCHEDULES.S2, [35, 30, 25]);
  assert.deepEqual(DEFAULT_TRACK_SCHEDULES.S3, [30, 25, 20]);
  assert.deepEqual(DEFAULT_TRACK_SCHEDULES.S4, [30, 25, 20]);
});

test("a teacher can override one track for one unit without changing global defaults", () => {
  const unitOverrides = { B2U5: { S2: [40, 35, 30] } };
  const overridden = resolveTrackSchedule({ unitId: "b2u5", track: "s2", unitOverrides });
  const untouched = resolveTrackSchedule({ unitId: "B2U5", track: "S1", unitOverrides });

  assert.deepEqual(overridden.roundSeconds, [40, 35, 30]);
  assert.equal(overridden.source, "unitOverride");
  assert.deepEqual(untouched.roundSeconds, [35, 30, 25]);
  assert.equal(untouched.source, "globalDefault");
  assert.deepEqual(DEFAULT_TRACK_SCHEDULES.S2, [35, 30, 25]);
});

test("assignment snapshot freezes the assigned track and exact round limits", () => {
  const snapshot = createAssignmentSnapshot({
    runId: "FIC-RUN-01",
    studentId: "FIC-STUDENT-01",
    enrollmentId: "FIC-ENROLLMENT-01",
    unitId: "B2U5",
    track: "S2",
    unitOverrides: { B2U5: { S2: [40, 35, 30] } },
    assignedAt: "2026-09-03T08:00:00.000Z",
    configVersion: "B2U5-v3"
  });

  assert.equal(snapshot.track, "S2");
  assert.equal(snapshot.scheduleSource, "unitOverride");
  assert.deepEqual(snapshot.rounds, [
    { round: 1, timeLimitSeconds: 40 },
    { round: 2, timeLimitSeconds: 35 },
    { round: 3, timeLimitSeconds: 30 }
  ]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.rounds), true);
});

test("invalid or non-decreasing schedules are rejected", () => {
  assert.throws(
    () => resolveTrackSchedule({ unitId: "B2U5", track: "S2", unitOverrides: { B2U5: { S2: [30, 30, 20] } } }),
    /must decrease/
  );
  assert.throws(
    () => resolveTrackSchedule({ unitId: "B2U5", track: "S5" }),
    /Track must be/
  );
});

test("opening one class run freezes every teacher-assigned track at the same instant", () => {
  const run = createClassRunSnapshot({
    runId: "FIC-RUN-CLASS-01",
    schoolYear: "115",
    classCode: "FIC-A",
    unitId: "B2U5",
    openedAt: "2026-09-03T09:00:00.000Z",
    configVersion: "B2U5-v3",
    unitOverrides: { B2U5: { S2: [40, 35, 30] } },
    studentAssignments: [
      {
        seatNumber: 1,
        studentId: "FIC-STUDENT-01",
        enrollmentId: "FIC-ENROLLMENT-01",
        track: "S2"
      },
      {
        seatNumber: 2,
        studentId: "FIC-STUDENT-02",
        enrollmentId: "FIC-ENROLLMENT-02",
        track: "S4"
      }
    ]
  });

  assert.equal(run.assignmentCount, 2);
  assert.equal(run.assignments[0].track, "S2");
  assert.deepEqual(run.assignments[0].rounds.map(round => round.timeLimitSeconds), [40, 35, 30]);
  assert.equal(run.assignments[1].track, "S4");
  assert.deepEqual(run.assignments[1].rounds.map(round => round.timeLimitSeconds), [30, 25, 20]);
  assert.equal(run.assignments[0].assignedAt, run.assignments[1].assignedAt);
  assert.equal(Object.isFrozen(run), true);
});

test("a class run rejects duplicate seats or enrollments", () => {
  assert.throws(() => createClassRunSnapshot({
    runId: "FIC-RUN-DUPLICATE",
    schoolYear: "115",
    classCode: "FIC-A",
    unitId: "B2U3",
    studentAssignments: [
      { seatNumber: 1, studentId: "FIC-STUDENT-01", enrollmentId: "FIC-ENROLLMENT-01", track: "S1" },
      { seatNumber: 1, studentId: "FIC-STUDENT-02", enrollmentId: "FIC-ENROLLMENT-02", track: "S2" }
    ]
  }), /Duplicate student assignment/);
});
