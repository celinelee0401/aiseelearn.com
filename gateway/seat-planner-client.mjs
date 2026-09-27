import { randomUUID } from "node:crypto";
import { buildSignedGatewayRequest } from "./signed-request.mjs";

const UPSTREAM_TIMEOUT_MS = 12_000;

export class SeatPlannerClientError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createSeatPlannerClient(options = {}) {
  const {
    getEnvironment,
    fetchImpl = fetch,
    now = () => Date.now(),
    nonce = () => randomUUID()
  } = options;
  if (typeof getEnvironment !== "function") {
    throw new TypeError("getEnvironment must be a function");
  }

  return async function lookupStudentTrack(input) {
    const normalized = normalizeLookup_(input);
    const environment = getEnvironment();
    const endpoint = String(environment.FLUENCY_SEAT_PLANNER_URL || "");
    const secret = String(environment.FLUENCY_SEAT_API_HMAC_SECRET_CURRENT || "");
    if (!isHttpsUrl_(endpoint) || secret.length < 32) {
      throw new SeatPlannerClientError("SERVICE_UNAVAILABLE", "Service unavailable.");
    }

    const request = {
      schemaVersion: "1.0",
      requestId: normalized.requestId,
      action: "getStudentTrack",
      schoolYear: normalized.schoolYear,
      classCode: normalized.classCode,
      seatNumber: normalized.seatNumber
    };
    const sentAt = Math.floor(now() / 1000);
    const wrapper = buildSignedGatewayRequest(request, {
      secret,
      sentAt,
      nonce: nonce()
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(wrapper),
        cache: "no-store",
        signal: controller.signal
      });
    } catch {
      throw new SeatPlannerClientError("SERVICE_UNAVAILABLE", "Service unavailable.");
    } finally {
      clearTimeout(timeoutId);
    }

    let body;
    try {
      body = JSON.parse(await response.text());
    } catch {
      throw new SeatPlannerClientError("SERVICE_UNAVAILABLE", "Service unavailable.");
    }
    if (!response.ok || body?.status !== "ok") {
      const code = ["INVALID_REQUEST", "STUDENT_NOT_FOUND"].includes(body?.error?.code)
        ? body.error.code
        : "SERVICE_UNAVAILABLE";
      const message = code === "STUDENT_NOT_FOUND"
        ? "Student assignment is not available."
        : "Service unavailable.";
      throw new SeatPlannerClientError(code, message);
    }
    if (body.requestId !== request.requestId) {
      throw new SeatPlannerClientError("SERVICE_UNAVAILABLE", "Service unavailable.");
    }
    return normalizeTrackResponse_(body.data, normalized);
  };
}

function normalizeLookup_(input = {}) {
  const schoolYear = String(input.schoolYear || "").trim();
  const classCode = String(input.classCode || "").trim().toUpperCase();
  const seatNumber = Number(input.seatNumber);
  const requestId = input.requestId === undefined
    ? randomUUID()
    : String(input.requestId || "");
  if (!/^\d{2,4}$/.test(schoolYear)
    || !/^[A-Z0-9-]{2,12}$/.test(classCode)
    || !Number.isInteger(seatNumber)
    || seatNumber < 1
    || seatNumber > 60
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) {
    throw new SeatPlannerClientError("INVALID_REQUEST", "Invalid request.");
  }
  return { schoolYear, classCode, seatNumber, requestId };
}

function normalizeTrackResponse_(data, expected) {
  if (!data || typeof data !== "object"
    || data.schoolYear !== expected.schoolYear
    || data.classCode !== expected.classCode
    || data.seatNumber !== expected.seatNumber
    || !["S1", "S2", "S3", "S4"].includes(data.track)) {
    throw new SeatPlannerClientError("SERVICE_UNAVAILABLE", "Service unavailable.");
  }
  return Object.freeze({
    schoolYear: data.schoolYear,
    classCode: data.classCode,
    seatNumber: data.seatNumber,
    track: data.track
  });
}

function isHttpsUrl_(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
