import { randomUUID } from "node:crypto";
import { inspectPcm16Wav } from "../apps/fluency-challenge/lib/audio-quality.mjs";
import {
  addAssessmentWarning,
  applyEnhancedTranscript
} from "../apps/fluency-challenge/lib/assessment-contract.mjs";
import {
  createAzureFastTranscriber,
  TranscriptionProviderError
} from "./azure-fast-transcriber.mjs";
import { createAzurePronunciationAssessor, AssessmentProviderError } from "./azure-pronunciation-assessor.mjs";
import { createAzureContinuousPronunciationAssessor } from "./azure-continuous-pronunciation-assessor.mjs";
import { readFluencySession } from "./student-identity-netlify-adapter.mjs";
import { buildSignedGatewayRequest } from "./signed-request.mjs";

export const FLUENCY_ASSESSMENT_ROUTE = "/api/fluency/assess";
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_AUDIO_BYTES = 2_000_000;
// The student sees a three-second finish-the-sentence window. The extra second
// is capture/clock tolerance only and is never presented as speaking time.
export const MAX_RECORDING_OVERAGE_MS = 4_000;
const STAGING_FLOW_MODE = "staging-flow-check";
const STAGING_FLOW_SITE = "fluency-challenge-staging";

export function createFluencyAssessmentAdapter(options = {}) {
  const {
    getEnvironment,
    fetchImpl = fetch,
    now = () => Date.now(),
    nonce = () => randomUUID(),
    requestId = () => randomUUID(),
    reportProviderError = () => {},
    createAssessor = (environment) => createConfiguredAssessor_(environment, fetchImpl),
    createTranscriber = (environment) => createConfiguredTranscriber_(environment, fetchImpl)
  } = options;
  if (typeof getEnvironment !== "function") throw new TypeError("getEnvironment must be a function");
  if (typeof reportProviderError !== "function") throw new TypeError("reportProviderError must be a function");

  return async function fluencyAssessmentAdapter(request) {
    if (request.method !== "POST") return jsonResponse_(405, { error: "Method not allowed." });
    const environment = getEnvironment();
    const sessionSecret = String(environment.FLUENCY_SESSION_SECRET || "");
    const proofSecret = String(environment.STUDENT_IDENTITY_HMAC_SECRET_CURRENT || "");
    const taskServiceUrl = String(environment.FLUENCY_TASK_SERVICE_URL || "");
    const attemptServiceUrl = String(environment.FLUENCY_ATTEMPT_SERVICE_URL || "");
    if (sessionSecret.length < 32 || proofSecret.length < 32
      || !isHttpsUrl_(taskServiceUrl) || !isHttpsUrl_(attemptServiceUrl)) {
      return jsonResponse_(503, { error: "Service unavailable." });
    }

    const session = readFluencySession(request, sessionSecret, now());
    if (!session) return jsonResponse_(401, { error: "尚未登入或連線已過期。" });

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_AUDIO_BYTES + 100_000) {
      return jsonResponse_(413, { error: "錄音檔太大，請重新錄製。" });
    }
    let form;
    try {
      form = await request.formData();
    } catch {
      return jsonResponse_(400, { error: "錄音資料格式不正確。" });
    }
    const audio = form.get("audio");
    const attemptRequestId = textField_(form, "attemptId");
    const assignmentId = textField_(form, "assignmentId");
    const unitId = textField_(form, "unitId").toUpperCase();
    const roundNumber = Number(textField_(form, "round"));
    if (!(audio instanceof File)
      || audio.size < 44
      || audio.size > MAX_AUDIO_BYTES
      || !uuid_(attemptRequestId)
      || !uuid_(assignmentId)
      || !/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(unitId)
      || !Number.isInteger(roundNumber)
      || roundNumber < 1
      || roundNumber > 3) {
      return jsonResponse_(400, { error: "錄音或任務資料不完整。" });
    }

    const task = await loadFrozenTask_({
      environment,
      session,
      unitId,
      proofSecret,
      taskServiceUrl,
      fetchImpl,
      now,
      nonce,
      requestId
    });
    if (task instanceof Response) return task;
    if (task.assignmentId !== assignmentId) {
      return jsonResponse_(409, { error: "任務已更新，請重新整理後再錄音。" });
    }
    const round = task.rounds.find((value) => value.round === roundNumber);
    if (!round) return jsonResponse_(400, { error: "輪次不正確。" });
    if (task.completedRounds.includes(roundNumber)) {
      return jsonResponse_(409, {
        code: "round_already_completed",
        error: "這一輪已經完成，正在更新下一輪。"
      });
    }
    const nextRound = task.rounds.find((value) => !task.completedRounds.includes(value.round));
    if (!nextRound || nextRound.round !== roundNumber) {
      return jsonResponse_(409, {
        code: "round_out_of_sequence",
        error: "請依照順序完成三輪練習。"
      });
    }

    const audioBuffer = await audio.arrayBuffer();
    const quality = inspectPcm16Wav(audioBuffer);
    if (quality.status !== "pass") {
      return jsonResponse_(422, {
        code: "audio_quality",
        error: qualityMessage_(quality.status),
        quality
      });
    }
    if (quality.durationMs > round.timeLimitSeconds * 1000 + MAX_RECORDING_OVERAGE_MS) {
      return jsonResponse_(422, {
        code: "time_limit_exceeded",
        error: "這次錄音超過本輪時間，請重新錄製。",
        quality
      });
    }

    let assessor;
    let transcriber = null;
    try {
      assessor = createAssessor(environment);
      transcriber = createTranscriber(environment);
    } catch {
      return jsonResponse_(503, { error: "語音評測服務尚未設定完成。" });
    }
    try {
      const transcriptionPromise = transcriber
        ? Promise.resolve(transcriber({
          audio: audioBuffer,
          phrases: transcriptPhrases_(task)
        })).then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error })
        )
        : Promise.resolve({ value: null, error: null });
      let assessment = await assessor({
        audio: audioBuffer,
        durationMs: quality.durationMs,
        mode: "unscripted"
      });
      const transcription = await transcriptionPromise;
      if (transcription.value) {
        assessment = applyEnhancedTranscript(assessment, {
          transcript: transcription.value.transcript,
          wordCount: transcription.value.wordCount,
          confidence: transcription.value.confidence,
          source: transcription.value.provider
        });
      } else if (transcription.error) {
        assessment = addAssessmentWarning(assessment, "enhanced_transcript_unavailable");
        reportProviderError(Object.freeze({
          code: transcription.error instanceof TranscriptionProviderError
            ? transcription.error.code
            : "TRANSCRIPTION_UNEXPECTED_ERROR",
          status: transcription.error instanceof TranscriptionProviderError
            ? transcription.error.status
            : 503
        }));
      }
      const saved = await saveAttempt_({
        attemptServiceUrl,
        attemptRequestId,
        assignmentId,
        roundNumber,
        quality,
        assessment,
        session,
        proofSecret,
        fetchImpl,
        now,
        nonce
      });
      if (saved instanceof Response) return saved;
      return jsonResponse_(200, {
        attemptId: saved.attemptId,
        round: roundNumber,
        timeLimitSeconds: round.timeLimitSeconds,
        quality,
        assessment
      });
    } catch (error) {
      if (error instanceof AssessmentProviderError && error.code === "SPEECH_NOT_RECOGNIZED") {
        return jsonResponse_(422, { code: "speech_not_recognized", error: "這次沒有辨識到足夠的英文語音，請靠近麥克風再試一次。" });
      }
      const providerCode = error instanceof AssessmentProviderError
        ? error.code
        : "PROVIDER_UNEXPECTED_ERROR";
      reportProviderError(Object.freeze({
        code: providerCode,
        status: error instanceof AssessmentProviderError ? error.status : 503
      }));
      return jsonResponse_(503, {
        code: "speech_provider_unavailable",
        providerCode,
        error: "語音評測暫時無法使用，請稍後再試。"
      });
    }
  };
}

function createConfiguredTranscriber_(environment, fetchImpl) {
  if (String(environment.FLUENCY_ENHANCED_TRANSCRIPT_ENABLED || "").toLowerCase() !== "true") {
    return null;
  }
  return createAzureFastTranscriber({
    endpoint: environment.AZURE_SPEECH_RESOURCE_ENDPOINT,
    key: environment.AZURE_SPEECH_KEY,
    fetchImpl
  });
}

function createConfiguredAssessor_(environment, fetchImpl) {
  const mode = String(environment.FLUENCY_ASSESSMENT_MODE || "");
  const siteName = String(environment.SITE_NAME || "");
  if (mode === STAGING_FLOW_MODE && siteName === STAGING_FLOW_SITE) {
    return createStagingFlowAssessor_();
  }
  if (String(environment.FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED || "").toLowerCase() === "true") {
    return createAzureContinuousPronunciationAssessor({
      key: environment.AZURE_SPEECH_KEY,
      region: speechRegion_(environment.AZURE_SPEECH_RECOGNITION_URL)
    });
  }
  return createAzurePronunciationAssessor({
    endpoint: environment.AZURE_SPEECH_RECOGNITION_URL,
    key: environment.AZURE_SPEECH_KEY,
    fetchImpl
  });
}

function speechRegion_(recognitionUrl) {
  const host = new URL(String(recognitionUrl || "")).hostname;
  const match = /^([a-z0-9-]+)\.stt\.speech\.microsoft\.com$/i.exec(host);
  if (!match) throw new TypeError("Azure Speech region is invalid");
  return match[1];
}

function createStagingFlowAssessor_() {
  return async ({ durationMs, mode }) => Object.freeze({
    schemaVersion: "1.0",
    rubricVersion: "fluency-evidence-v0.1",
    provider: Object.freeze({
      name: STAGING_FLOW_MODE,
      version: "v1",
      mode
    }),
    transcript: "",
    durationMs,
    recognizedWordCount: null,
    metrics: Object.freeze({
      pace: Object.freeze({ wpm: null, score: null, status: "unavailable" }),
      pauseFlow: Object.freeze({ score: null, status: "unavailable" }),
      pronunciationAccuracy: Object.freeze({ score: null, status: "unavailable" }),
      prosody: Object.freeze({ score: null, status: "unavailable" }),
      contentCoverage: Object.freeze({ score: null, status: "not-applicable" })
    }),
    observations: Object.freeze([]),
    warnings: Object.freeze([
      "staging_flow_only",
      "speech_recognition_not_configured"
    ])
  });
}

function transcriptPhrases_(task) {
  const source = `${task?.title || ""} ${task?.promptText || ""}`;
  const stopWords = new Set([
    "about", "after", "again", "also", "and", "because", "describe", "did", "during",
    "felt", "from", "have", "how", "into", "one", "say", "share", "that", "the", "their",
    "thing", "this", "was", "what", "when", "where", "which", "with", "you", "your"
  ]);
  return [...new Set(source.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [])]
    .filter((word) => word.length >= 3 && !stopWords.has(word.toLowerCase()))
    .slice(0, 50);
}

async function saveAttempt_(args) {
  const internalRequest = {
    schemaVersion: "1.0",
    requestId: args.attemptRequestId,
    action: "recordFluencyAttempt",
    studentId: args.session.studentId,
    enrollmentId: args.session.enrollmentId,
    assignmentId: args.assignmentId,
    round: args.roundNumber,
    durationMs: args.quality.durationMs,
    recognizedText: args.assessment.transcript,
    assessmentProvider: args.assessment.provider?.name,
    assessmentVersion: args.assessment.provider?.version,
    metrics: {
      schemaVersion: args.assessment.schemaVersion,
      rubricVersion: args.assessment.rubricVersion,
      metrics: args.assessment.metrics,
      observations: args.assessment.observations,
      warnings: args.assessment.warnings,
      audioQuality: args.quality
    }
  };
  const wrapper = buildSignedGatewayRequest(internalRequest, {
    secret: args.proofSecret,
    sentAt: Math.floor(args.now() / 1000),
    nonce: args.nonce()
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response;
  try {
    response = await args.fetchImpl(args.attemptServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wrapper),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    return jsonResponse_(503, { error: "評測已完成，但結果暫時無法儲存，請保留本頁並再試一次。" });
  } finally {
    clearTimeout(timeoutId);
  }
  let body;
  try { body = await response.json(); } catch { return jsonResponse_(503, { error: "評測結果暫時無法儲存。" }); }
  if (response.status === 409) return jsonResponse_(409, { error: "這一輪已經完成，請進入下一輪。" });
  if (!response.ok || body?.status !== "ok" || body.requestId !== args.attemptRequestId
    || !uuid_(body.attempt?.attemptId) || body.attempt?.round !== args.roundNumber) {
    return jsonResponse_(503, { error: "評測結果暫時無法儲存。" });
  }
  return body.attempt;
}

async function loadFrozenTask_(args) {
  const internalRequest = {
    schemaVersion: "1.0",
    requestId: args.requestId(),
    action: "getFluencyTask",
    studentId: args.session.studentId,
    enrollmentId: args.session.enrollmentId,
    schoolYear: args.session.schoolYear,
    classCode: args.session.classCode,
    unitId: args.unitId
  };
  const wrapper = buildSignedGatewayRequest(internalRequest, {
    secret: args.proofSecret,
    sentAt: Math.floor(args.now() / 1000),
    nonce: args.nonce()
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response;
  try {
    response = await args.fetchImpl(args.taskServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wrapper),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    return jsonResponse_(503, { error: "Service unavailable." });
  } finally {
    clearTimeout(timeoutId);
  }
  let body;
  try { body = await response.json(); } catch { return jsonResponse_(503, { error: "Service unavailable." }); }
  if (!response.ok || body?.status !== "ok" || body.requestId !== internalRequest.requestId) {
    return jsonResponse_(response.status === 404 ? 404 : 503, {
      error: response.status === 404 ? "目前沒有可開始的口說任務。" : "Service unavailable."
    });
  }
  if (!validTask_(body.task, args.unitId)) return jsonResponse_(503, { error: "Service unavailable." });
  return body.task;
}

function validTask_(task, expectedUnitId) {
  return task
    && uuid_(task.assignmentId)
    && task.unitId === expectedUnitId
    && Array.isArray(task.rounds)
    && task.rounds.length === 3
    && task.rounds.every((round, index) => round?.round === index + 1
      && Number.isInteger(round.timeLimitSeconds)
      && round.timeLimitSeconds >= 5
      && round.timeLimitSeconds <= 180)
    && Array.isArray(task.completedRounds)
    && task.completedRounds.every((round) => Number.isInteger(round) && round >= 1 && round <= 3)
    && new Set(task.completedRounds).size === task.completedRounds.length;
}

function textField_(form, key) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function uuid_(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHttpsUrl_(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function qualityMessage_(status) {
  return ({
    "too-short": "錄音太短，請說完整一點再停止。",
    "too-quiet": "麥克風收到的聲音太小，請靠近一些再錄一次。",
    clipping: "聲音有爆音，請離麥克風稍遠一點再試。",
    "invalid-format": "錄音格式不完整，請重新錄製。"
  })[status] || "錄音品質未通過，請再試一次。";
}

function jsonResponse_(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
