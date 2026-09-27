import assert from "node:assert/strict";
import test from "node:test";

import {
  createFluencyTaskAdapter,
  FLUENCY_TASK_ROUTE
} from "../gateway/fluency-task-adapter.mjs";
import { encryptFluencySession } from "../gateway/student-identity-netlify-adapter.mjs";

const NOW = Date.parse("2026-09-03T10:00:00.000Z");
const SESSION_SECRET = "FIC-FLUENCY-SESSION-SECRET-1234567890";
const PROOF_SECRET = "FIC-STUDENT-IDENTITY-PROOF-SECRET-12345";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const ENROLLMENT_ID = "22222222-2222-4222-8222-222222222222";

function environment() {
  return {
    FLUENCY_SESSION_SECRET: SESSION_SECRET,
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: PROOF_SECRET,
    FLUENCY_TASK_SERVICE_URL: "https://identity.fictional.invalid/api/internal/fluency-task"
  };
}

function sessionCookie() {
  const token = encryptFluencySession({
    version: 1,
    studentId: STUDENT_ID,
    enrollmentId: ENROLLMENT_ID,
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    gradeLevel: 8,
    expiresAt: Math.floor(NOW / 1000) + 45 * 60
  }, SESSION_SECRET);
  return `fluency_session=${encodeURIComponent(token)}`;
}

function taskRequest(cookie = sessionCookie(), unitId = "B2U3") {
  return new Request(`https://fluency.fictional.local${FLUENCY_TASK_ROUTE}?unitId=${unitId}`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
}

test("an authenticated student receives only the frozen public task", async () => {
  let forwarded;
  const adapter = createFluencyTaskAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-TASK-NONCE-0001",
    requestId: () => "FIC-GET-TASK-0001",
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({
        status: "ok",
        requestId: forwarded.request.requestId,
        task: {
          assignmentId: "33333333-3333-4333-8333-333333333333",
          runId: "44444444-4444-4444-8444-444444444444",
          unitId: "B2U3",
          title: "B2 U3 Fluency Challenge",
          promptText: null,
          configVersion: "1",
          track: "S3",
          rounds: [
            { round: 1, timeLimitSeconds: 30 },
            { round: 2, timeLimitSeconds: 25 },
            { round: 3, timeLimitSeconds: 20 }
          ],
          completedRounds: [1],
          completedAttempts: [{
            attemptId: "55555555-5555-4555-8555-555555555555",
            round: 1,
            timeLimitSeconds: 30,
            assessment: {
              schemaVersion: "1.0",
              rubricVersion: "fluency-evidence-v0.1",
              provider: {
                name: "azure-speech-pronunciation-assessment",
                version: "v1",
                mode: "unscripted"
              },
              transcript: "I had a memorable summer.",
              durationMs: 28_000,
              recognizedWordCount: null,
              metrics: {
                pace: { wpm: 90, status: "measured" },
                pauseFlow: { score: 82, status: "measured" },
                pronunciationAccuracy: { score: 91, status: "measured" },
                prosody: { score: 80, status: "measured" },
                contentCoverage: { score: null, status: "not-applicable" }
              },
              observations: [],
              warnings: []
            }
          }]
        },
        error: null
      }), { status: 200 });
    }
  });

  const response = await adapter(taskRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(forwarded.request.studentId, STUDENT_ID);
  assert.equal(forwarded.request.enrollmentId, ENROLLMENT_ID);
  assert.equal(forwarded.request.unitId, "B2U3");
  assert.equal(forwarded.request.action, "getFluencyTask");
  assert.deepEqual(body.task.rounds.map(round => round.timeLimitSeconds), [30, 25, 20]);
  assert.deepEqual(body.task.completedRounds, [1]);
  assert.equal(body.task.completedAttempts.length, 1);
  assert.equal(body.task.completedAttempts[0].round, 1);
  assert.equal(body.task.completedAttempts[0].assessment.metrics.pauseFlow.score, 82);
  assert.equal(body.task.completedAttempts[0].assessment.recognizedWordCount, null);
  assert.equal("studentId" in body.task, false);
  assert.equal("enrollmentId" in body.task, false);
  assert.equal("runId" in body.task, false);
  assert.equal("track" in body.task, false);
});

test("completed evidence must match the completed round list", async () => {
  const adapter = createFluencyTaskAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-TASK-NONCE-MISMATCH",
    requestId: () => "FIC-GET-TASK-MISMATCH",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "ok",
      requestId: "FIC-GET-TASK-MISMATCH",
      task: {
        assignmentId: "33333333-3333-4333-8333-333333333333",
        runId: "44444444-4444-4444-8444-444444444444",
        unitId: "B2U3",
        title: "B2 U3 Fluency Challenge",
        promptText: null,
        configVersion: "1",
        track: "S3",
        rounds: [
          { round: 1, timeLimitSeconds: 30 },
          { round: 2, timeLimitSeconds: 25 },
          { round: 3, timeLimitSeconds: 20 }
        ],
        completedRounds: [1],
        completedAttempts: []
      },
      error: null
    }), { status: 200 })
  });

  const response = await adapter(taskRequest());
  assert.equal(response.status, 503);
});

test("missing or expired session stops before the task service", async () => {
  let upstreamCalls = 0;
  const adapter = createFluencyTaskAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("must not fetch");
    }
  });
  const response = await adapter(taskRequest(""));
  assert.equal(response.status, 401);
  assert.equal(upstreamCalls, 0);
});

test("missing assignment is a bounded 404 without internal identifiers", async () => {
  const adapter = createFluencyTaskAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-TASK-NONCE-MISSING",
    requestId: () => "FIC-GET-TASK-MISSING",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "error",
      requestId: "FIC-GET-TASK-MISSING",
      task: null,
      error: { code: "ASSIGNMENT_NOT_FOUND", message: "internal detail" }
    }), { status: 404 })
  });
  const response = await adapter(taskRequest());
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(JSON.stringify(body).includes(STUDENT_ID), false);
  assert.equal(JSON.stringify(body).includes("internal detail"), false);
});
