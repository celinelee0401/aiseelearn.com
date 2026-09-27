import assert from "node:assert/strict";
import test from "node:test";

import {
  createFluencyAssessmentAdapter,
  FLUENCY_ASSESSMENT_ROUTE,
  MAX_RECORDING_OVERAGE_MS
} from "../gateway/fluency-assessment-adapter.mjs";
import { createAssessmentResult } from "../apps/fluency-challenge/lib/assessment-contract.mjs";
import { TranscriptionProviderError } from "../gateway/azure-fast-transcriber.mjs";
import { encryptFluencySession } from "../gateway/student-identity-netlify-adapter.mjs";

const NOW = Date.parse("2026-09-03T10:00:00.000Z");
const SESSION_SECRET = "FIC-FLUENCY-SESSION-SECRET-1234567890";
const PROOF_SECRET = "FIC-STUDENT-IDENTITY-PROOF-SECRET-12345";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const ENROLLMENT_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const RECORDED_ATTEMPT_ID = "77777777-7777-4777-8777-777777777777";

function environment() {
  return {
    FLUENCY_SESSION_SECRET: SESSION_SECRET,
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: PROOF_SECRET,
    FLUENCY_TASK_SERVICE_URL: "https://identity.fictional.invalid/api/internal/fluency-task",
    FLUENCY_ATTEMPT_SERVICE_URL: "https://identity.fictional.invalid/api/internal/fluency-attempt",
    AZURE_SPEECH_RECOGNITION_URL: "https://speech.fictional.invalid/speech/recognition/conversation/cognitiveservices/v1",
    AZURE_SPEECH_KEY: "FIC-SPEECH-KEY-000000"
  };
}

function stagingFlowEnvironment() {
  const value = environment();
  delete value.AZURE_SPEECH_RECOGNITION_URL;
  delete value.AZURE_SPEECH_KEY;
  return {
    ...value,
    FLUENCY_ASSESSMENT_MODE: "staging-flow-check",
    SITE_NAME: "fluency-challenge-staging"
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

function assessmentRequest({
  cookie = sessionCookie(),
  assignmentId = ASSIGNMENT_ID,
  unitId = "B2U3",
  round = 1,
  durationMs = 30_000,
  amplitude = 0.1
} = {}) {
  const form = new FormData();
  form.set("assignmentId", assignmentId);
  form.set("attemptId", ATTEMPT_REQUEST_ID);
  form.set("unitId", unitId);
  form.set("round", String(round));
  form.set("audio", new File([makePcm16Wav_(durationMs, amplitude)], "round.wav", { type: "audio/wav" }));
  return new Request(`https://fluency.fictional.local${FLUENCY_ASSESSMENT_ROUTE}`, {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
    body: form
  });
}

function taskResponse(requestId, assignmentId = ASSIGNMENT_ID, completedRounds = []) {
  return new Response(JSON.stringify({
    status: "ok",
    requestId,
    task: {
      assignmentId,
      runId: "44444444-4444-4444-8444-444444444444",
      unitId: "B2U3",
      title: "B2 U3 Fluency Challenge",
      promptText: "Talk about a memorable day.",
      configVersion: "1",
      track: "S3",
      rounds: [
        { round: 1, timeLimitSeconds: 30 },
        { round: 2, timeLimitSeconds: 25 },
        { round: 3, timeLimitSeconds: 20 }
      ],
      completedRounds
    }
  }), { status: 200 });
}

test("assessment requires a session, verifies the frozen round, and returns evidence without track", async () => {
  let forwarded;
  let assessorInput;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-0001",
    requestId: () => "FIC-ASSESS-TASK-0001",
    fetchImpl: async (url, options) => {
      forwarded = JSON.parse(options.body);
      if (String(url).endsWith("/fluency-task")) return taskResponse(forwarded.request.requestId);
      assert.equal(String(url).endsWith("/fluency-attempt"), true);
      assert.equal(forwarded.request.action, "recordFluencyAttempt");
      assert.equal(forwarded.request.requestId, ATTEMPT_REQUEST_ID);
      assert.equal(forwarded.request.assignmentId, ASSIGNMENT_ID);
      return new Response(JSON.stringify({
        status: "ok",
        requestId: ATTEMPT_REQUEST_ID,
        attempt: { attemptId: RECORDED_ATTEMPT_ID, round: 1, status: "recorded" }
      }), { status: 200 });
    },
    createAssessor: () => async (input) => {
      assessorInput = input;
      return {
        schemaVersion: "1.0",
        provider: { name: "fictional", version: "v1", mode: "unscripted" },
        transcript: "I had a memorable day.",
        metrics: {
          pace: { wpm: 50, score: null, status: "measured" },
          pauseFlow: { score: 78, status: "measured" },
          pronunciationAccuracy: { score: 84, status: "measured" },
          prosody: { score: 70, status: "measured" },
          contentCoverage: { score: null, status: "not-applicable" }
        }
      };
    }
  });

  const response = await adapter(assessmentRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(forwarded.request.studentId, STUDENT_ID);
  assert.equal(forwarded.request.enrollmentId, ENROLLMENT_ID);
  assert.equal(assessorInput.mode, "unscripted");
  assert.equal(assessorInput.referenceText, undefined);
  assert.equal(body.attemptId, RECORDED_ATTEMPT_ID);
  assert.equal(body.round, 1);
  assert.equal(body.timeLimitSeconds, 30);
  assert.equal(body.assessment.metrics.contentCoverage.score, null);
  assert.equal(JSON.stringify(body).includes("S3"), false);
  assert.equal(JSON.stringify(body).includes(STUDENT_ID), false);
});

test("enhanced transcription replaces displayed text and WPM while preserving audio scores", async () => {
  let savedRequest;
  let phraseHints;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-ENHANCED",
    requestId: () => "FIC-ASSESS-TASK-ENHANCED",
    fetchImpl: async (url, options) => {
      const forwarded = JSON.parse(options.body);
      if (String(url).endsWith("/fluency-task")) return taskResponse(forwarded.request.requestId);
      savedRequest = forwarded.request;
      return new Response(JSON.stringify({
        status: "ok",
        requestId: ATTEMPT_REQUEST_ID,
        attempt: { attemptId: RECORDED_ATTEMPT_ID, round: 1, status: "recorded" }
      }), { status: 200 });
    },
    createAssessor: () => async () => createAssessmentResult({
      providerName: "azure-speech-pronunciation",
      providerVersion: "rest-short-audio-v1",
      mode: "unscripted",
      durationMs: 30_000,
      transcript: "Incorrect base text",
      transcriptConfidence: 0.55,
      accuracy: 84,
      fluency: 78,
      prosody: 70
    }),
    createTranscriber: () => async (input) => {
      phraseHints = input.phrases;
      return {
        provider: "azure-fast-transcription",
        version: "2025-10-15",
        transcript: "I had a memorable summer vacation in Australia.",
        wordCount: 8,
        confidence: 0.88
      };
    }
  });

  const response = await adapter(assessmentRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.assessment.transcript, "I had a memorable summer vacation in Australia.");
  assert.equal(body.assessment.metrics.pace.wpm, 16);
  assert.equal(body.assessment.metrics.pronunciationAccuracy.score, 84);
  assert.equal(body.assessment.metrics.evidenceReliability.transcript.source, "azure-fast-transcription");
  assert.equal(body.assessment.metrics.evidenceReliability.transcript.status, "measured");
  assert.equal(phraseHints.includes("memorable"), true);
  assert.equal(savedRequest.recognizedText, body.assessment.transcript);
  assert.equal(savedRequest.metrics.metrics.pace.wpm, 16);
});

test("enhanced transcription failure falls back without discarding pronunciation evidence", async () => {
  const diagnostics = [];
  let savedRequest;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-TRANSCRIPT-FALLBACK",
    requestId: () => "FIC-ASSESS-TASK-TRANSCRIPT-FALLBACK",
    reportProviderError: (value) => diagnostics.push(value),
    fetchImpl: async (url, options) => {
      const forwarded = JSON.parse(options.body);
      if (String(url).endsWith("/fluency-task")) return taskResponse(forwarded.request.requestId);
      savedRequest = forwarded.request;
      return new Response(JSON.stringify({
        status: "ok",
        requestId: ATTEMPT_REQUEST_ID,
        attempt: { attemptId: RECORDED_ATTEMPT_ID, round: 1, status: "recorded" }
      }), { status: 200 });
    },
    createAssessor: () => async () => createAssessmentResult({
      providerName: "azure-speech-pronunciation",
      providerVersion: "rest-short-audio-v1",
      mode: "unscripted",
      durationMs: 30_000,
      transcript: "Base assessment transcript",
      transcriptConfidence: 0.74,
      accuracy: 84,
      fluency: 78,
      prosody: 70
    }),
    createTranscriber: () => async () => {
      throw new TranscriptionProviderError("TRANSCRIPTION_RATE_LIMITED", "private upstream detail", 503);
    }
  });

  const response = await adapter(assessmentRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.assessment.transcript, "Base assessment transcript");
  assert.equal(body.assessment.warnings.includes("enhanced_transcript_unavailable"), true);
  assert.equal(savedRequest.metrics.warnings.includes("enhanced_transcript_unavailable"), true);
  assert.deepEqual(diagnostics, [{ code: "TRANSCRIPTION_RATE_LIMITED", status: 503 }]);
});

test("a stale assignment is rejected before paid assessment", async () => {
  let assessorCalls = 0;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-STALE",
    requestId: () => "FIC-ASSESS-TASK-STALE",
    fetchImpl: async (_url, options) => taskResponse(JSON.parse(options.body).request.requestId),
    createAssessor: () => async () => { assessorCalls += 1; }
  });
  const response = await adapter(assessmentRequest({ assignmentId: "55555555-5555-4555-8555-555555555555" }));
  assert.equal(response.status, 409);
  assert.equal(assessorCalls, 0);
});

test("an already-completed round is rejected before paid assessment", async () => {
  let assessorCalls = 0;
  let attemptServiceCalls = 0;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-COMPLETED",
    requestId: () => "FIC-ASSESS-TASK-COMPLETED",
    fetchImpl: async (url, options) => {
      const forwarded = JSON.parse(options.body);
      if (String(url).endsWith("/fluency-task")) {
        return taskResponse(forwarded.request.requestId, ASSIGNMENT_ID, [1]);
      }
      attemptServiceCalls += 1;
      throw new Error("must not save a duplicate");
    },
    createAssessor: () => async () => { assessorCalls += 1; }
  });
  const response = await adapter(assessmentRequest({ round: 1 }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "round_already_completed");
  assert.equal(assessorCalls, 0);
  assert.equal(attemptServiceCalls, 0);
});

test("a later round is rejected until the preceding round is complete", async () => {
  let assessorCalls = 0;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-SEQUENCE",
    requestId: () => "FIC-ASSESS-TASK-SEQUENCE",
    fetchImpl: async (_url, options) => taskResponse(JSON.parse(options.body).request.requestId),
    createAssessor: () => async () => { assessorCalls += 1; }
  });
  const response = await adapter(assessmentRequest({ round: 2, durationMs: 25_000 }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "round_out_of_sequence");
  assert.equal(assessorCalls, 0);
});

test("the isolated staging site can save a flow-check result without inventing speech scores", async () => {
  let savedRequest;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => stagingFlowEnvironment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-STAGING",
    requestId: () => "FIC-ASSESS-TASK-STAGING",
    fetchImpl: async (url, options) => {
      const forwarded = JSON.parse(options.body);
      if (String(url).endsWith("/fluency-task")) return taskResponse(forwarded.request.requestId);
      savedRequest = forwarded.request;
      return new Response(JSON.stringify({
        status: "ok",
        requestId: ATTEMPT_REQUEST_ID,
        attempt: { attemptId: RECORDED_ATTEMPT_ID, round: 1, status: "recorded" }
      }), { status: 200 });
    }
  });

  const response = await adapter(assessmentRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.assessment.provider.name, "staging-flow-check");
  assert.equal(body.assessment.transcript, "");
  assert.equal(body.assessment.metrics.pace.wpm, null);
  assert.equal(body.assessment.metrics.pauseFlow.score, null);
  assert.equal(body.assessment.metrics.pronunciationAccuracy.score, null);
  assert.equal(body.assessment.metrics.prosody.score, null);
  assert.equal(body.assessment.warnings.includes("staging_flow_only"), true);
  assert.equal(savedRequest.assessmentProvider, "staging-flow-check");
  assert.equal(savedRequest.metrics.metrics.pace.status, "unavailable");
});

test("flow-check mode cannot activate on a different Netlify site", async () => {
  const unsafeEnvironment = {
    ...stagingFlowEnvironment(),
    SITE_NAME: "fluency-challenge"
  };
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => unsafeEnvironment,
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-PROD-GUARD",
    requestId: () => "FIC-ASSESS-TASK-PROD-GUARD",
    fetchImpl: async (_url, options) => taskResponse(JSON.parse(options.body).request.requestId)
  });

  const response = await adapter(assessmentRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "語音評測服務尚未設定完成。");
});

test("bad audio and an exceeded frozen time limit are rejected before paid assessment", async () => {
  let assessorCalls = 0;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-QUALITY",
    requestId: () => "FIC-ASSESS-TASK-QUALITY",
    fetchImpl: async (_url, options) => taskResponse(JSON.parse(options.body).request.requestId),
    createAssessor: () => async () => { assessorCalls += 1; }
  });
  const quietResponse = await adapter(assessmentRequest({ amplitude: 0.001 }));
  const longResponse = await adapter(assessmentRequest({ durationMs: 34_001 }));
  assert.equal(quietResponse.status, 422);
  assert.equal((await quietResponse.json()).code, "audio_quality");
  assert.equal(longResponse.status, 422);
  assert.equal((await longResponse.json()).code, "time_limit_exceeded");
  assert.equal(MAX_RECORDING_OVERAGE_MS, 4_000);
  assert.equal(assessorCalls, 0);
});

test("missing session stops before task lookup and assessment", async () => {
  let calls = 0;
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
    createAssessor: () => { calls += 1; throw new Error("must not create"); }
  });
  const response = await adapter(assessmentRequest({ cookie: "" }));
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("provider failures return a safe code and emit only bounded diagnostics", async () => {
  const diagnostics = [];
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-ASSESS-NONCE-PROVIDER",
    requestId: () => "FIC-ASSESS-TASK-PROVIDER",
    fetchImpl: async (_url, options) => taskResponse(JSON.parse(options.body).request.requestId),
    reportProviderError: (value) => diagnostics.push(value),
    createAssessor: () => async () => {
      throw new Error("FIC-SENSITIVE-UNEXPECTED-DETAIL");
    }
  });
  const response = await adapter(assessmentRequest());
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "speech_provider_unavailable");
  assert.equal(JSON.stringify(body).includes("FIC-SENSITIVE"), false);
  assert.deepEqual(diagnostics, [{ code: "PROVIDER_UNEXPECTED_ERROR", status: 503 }]);
});

test("a centrally recorded round cannot be overwritten by a second submission", async () => {
  const adapter = createFluencyAssessmentAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: (() => { let value = 0; return () => `FIC-ASSESS-NONCE-${++value}`; })(),
    requestId: () => "FIC-ASSESS-TASK-CONFLICT",
    fetchImpl: async (url, options) => {
      const forwarded = JSON.parse(options.body);
      if (String(url).endsWith("/fluency-task")) return taskResponse(forwarded.request.requestId);
      return new Response(JSON.stringify({
        status: "error",
        requestId: ATTEMPT_REQUEST_ID,
        attempt: null,
        error: { code: "ROUND_ALREADY_RECORDED", message: "FIC-INTERNAL-DETAIL" }
      }), { status: 409 });
    },
    createAssessor: () => async () => ({
      schemaVersion: "1.0",
      rubricVersion: "fluency-evidence-v0.1",
      provider: { name: "fictional", version: "v1", mode: "unscripted" },
      transcript: "Already recorded",
      metrics: {},
      observations: [],
      warnings: []
    })
  });
  const response = await adapter(assessmentRequest());
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(JSON.stringify(body).includes("FIC-INTERNAL-DETAIL"), false);
  assert.equal(JSON.stringify(body).includes(STUDENT_ID), false);
});

function makePcm16Wav_(durationMs, amplitude) {
  const sampleRate = 16_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1000);
  const dataLength = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  ascii_(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii_(view, 8, "WAVE");
  ascii_(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii_(view, 36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(44 + index * 2, Math.round(Math.sin(index / 10) * amplitude * 32767), true);
  }
  return buffer;
}

function ascii_(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
