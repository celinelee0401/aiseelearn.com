import { randomUUID } from "node:crypto";
import { readFluencySession } from "./student-identity-netlify-adapter.mjs";
import { buildSignedGatewayRequest } from "./signed-request.mjs";

export const FLUENCY_TASK_ROUTE = "/api/fluency/task";
const UPSTREAM_TIMEOUT_MS = 12_000;

export function createFluencyTaskAdapter(options = {}) {
  const {
    getEnvironment,
    fetchImpl = fetch,
    now = () => Date.now(),
    nonce = () => randomUUID(),
    requestId = () => randomUUID()
  } = options;
  if (typeof getEnvironment !== "function") {
    throw new TypeError("getEnvironment must be a function");
  }

  return async function fluencyTaskAdapter(request) {
    if (request.method !== "GET") return jsonResponse_(405, { error: "Method not allowed." });
    const environment = getEnvironment();
    const sessionSecret = String(environment.FLUENCY_SESSION_SECRET || "");
    const proofSecret = String(environment.STUDENT_IDENTITY_HMAC_SECRET_CURRENT || "");
    const taskServiceUrl = String(environment.FLUENCY_TASK_SERVICE_URL || "");
    if (sessionSecret.length < 32 || proofSecret.length < 32 || !isHttpsUrl_(taskServiceUrl)) {
      return jsonResponse_(503, { error: "Service unavailable." });
    }

    const session = readFluencySession(request, sessionSecret, now());
    if (!session) return jsonResponse_(401, { error: "尚未登入或連線已過期。" });
    const unitId = new URL(request.url).searchParams.get("unitId")?.trim().toUpperCase() || "";
    if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(unitId)) {
      return jsonResponse_(400, { error: "單元代碼不正確。" });
    }

    const internalRequest = {
      schemaVersion: "1.0",
      requestId: requestId(),
      action: "getFluencyTask",
      studentId: session.studentId,
      enrollmentId: session.enrollmentId,
      schoolYear: session.schoolYear,
      classCode: session.classCode,
      unitId
    };
    const wrapper = buildSignedGatewayRequest(internalRequest, {
      secret: proofSecret,
      sentAt: Math.floor(now() / 1000),
      nonce: nonce()
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(taskServiceUrl, {
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
    try {
      body = await response.json();
    } catch {
      return jsonResponse_(503, { error: "Service unavailable." });
    }
    if (!response.ok || body?.status !== "ok" || body.requestId !== internalRequest.requestId) {
      const status = response.status === 404 ? 404 : 503;
      const message = status === 404 ? "目前沒有可開始的口說任務。" : "Service unavailable.";
      return jsonResponse_(status, { error: message });
    }
    const task = publicTask_(body.task, unitId);
    if (!task) return jsonResponse_(503, { error: "Service unavailable." });
    return jsonResponse_(200, { task });
  };
}

function publicTask_(value, expectedUnitId) {
  if (!value || typeof value !== "object"
    || !/^[0-9a-f-]{36}$/i.test(String(value.assignmentId || ""))
    || value.unitId !== expectedUnitId
    || typeof value.title !== "string"
    || (value.promptText !== null && typeof value.promptText !== "string")
    || typeof value.configVersion !== "string"
    || !Array.isArray(value.rounds)
    || value.rounds.length !== 3) return null;
  const rounds = value.rounds.map((round, index) => ({
    round: Number(round?.round),
    timeLimitSeconds: Number(round?.timeLimitSeconds)
  }));
  if (rounds.some((round, index) => round.round !== index + 1
    || !Number.isInteger(round.timeLimitSeconds)
    || round.timeLimitSeconds < 5
    || round.timeLimitSeconds > 180)) return null;
  const completedRounds = Array.isArray(value.completedRounds)
    ? value.completedRounds.map(Number)
    : [];
  if (completedRounds.some((round) => !Number.isInteger(round) || round < 1 || round > 3)
    || new Set(completedRounds).size !== completedRounds.length) return null;
  const completedAttempts = Array.isArray(value.completedAttempts)
    ? value.completedAttempts.map((attempt) => publicAttempt_(attempt))
    : [];
  if (completedAttempts.some((attempt) => !attempt)
    || new Set(completedAttempts.map((attempt) => attempt.round)).size !== completedAttempts.length
    || JSON.stringify(completedAttempts.map((attempt) => attempt.round).sort())
      !== JSON.stringify([...completedRounds].sort())) return null;
  return Object.freeze({
    assignmentId: value.assignmentId,
    unitId: value.unitId,
    title: value.title,
    promptText: value.promptText,
    configVersion: value.configVersion,
    rounds: Object.freeze(rounds),
    completedRounds: Object.freeze([...completedRounds].sort((left, right) => left - right)),
    completedAttempts: Object.freeze(completedAttempts.sort((left, right) => left.round - right.round))
  });
}

function publicAttempt_(value) {
  const assessment = value?.assessment;
  const provider = assessment?.provider;
  if (!value || typeof value !== "object"
    || !/^[0-9a-f-]{36}$/i.test(String(value.attemptId || ""))
    || !Number.isInteger(Number(value.round))
    || Number(value.round) < 1
    || Number(value.round) > 3
    || !Number.isInteger(Number(value.timeLimitSeconds))
    || Number(value.timeLimitSeconds) < 5
    || Number(value.timeLimitSeconds) > 180
    || !assessment || typeof assessment !== "object"
    || typeof assessment.schemaVersion !== "string"
    || typeof assessment.rubricVersion !== "string"
    || !provider || typeof provider !== "object"
    || typeof provider.name !== "string"
    || typeof provider.version !== "string"
    || provider.mode !== "unscripted"
    || typeof assessment.transcript !== "string"
    || !Number.isInteger(Number(assessment.durationMs))
    || Number(assessment.durationMs) < 1
    || !assessment.metrics || typeof assessment.metrics !== "object" || Array.isArray(assessment.metrics)
    || !Array.isArray(assessment.observations)
    || !Array.isArray(assessment.warnings)) return null;
  return Object.freeze({
    attemptId: value.attemptId,
    round: Number(value.round),
    timeLimitSeconds: Number(value.timeLimitSeconds),
    assessment: Object.freeze({
      schemaVersion: assessment.schemaVersion,
      rubricVersion: assessment.rubricVersion,
      provider: Object.freeze({
        name: provider.name,
        version: provider.version,
        mode: "unscripted"
      }),
      transcript: assessment.transcript,
      durationMs: Number(assessment.durationMs),
      recognizedWordCount: assessment.recognizedWordCount !== null
        && assessment.recognizedWordCount !== undefined
        && Number.isInteger(Number(assessment.recognizedWordCount))
        ? Number(assessment.recognizedWordCount)
        : null,
      metrics: Object.freeze(JSON.parse(JSON.stringify(assessment.metrics))),
      observations: Object.freeze(JSON.parse(JSON.stringify(assessment.observations))),
      warnings: Object.freeze(JSON.parse(JSON.stringify(assessment.warnings)))
    })
  });
}

function isHttpsUrl_(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
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
