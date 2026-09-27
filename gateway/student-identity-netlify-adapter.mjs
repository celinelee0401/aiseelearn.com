import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import { signGatewayRequest } from "./signed-request.mjs";

export const STUDENT_IDENTITY_ROUTE = Object.freeze({
  path: "/api/fluency/auth/login",
  rateLimit: Object.freeze({
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: Object.freeze(["ip", "domain"])
  })
});

export const FLUENCY_SESSION_ROUTES = Object.freeze({
  session: "/api/fluency/session",
  logout: "/api/fluency/auth/logout"
});

const PUBLIC_BODY_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const SESSION_SECONDS = 45 * 60;

export function createStudentIdentityNetlifyAdapter(options = {}) {
  const {
    getEnvironment,
    fetchImpl = fetch,
    now = () => Date.now(),
    nonce = () => randomUUID()
  } = options;
  if (typeof getEnvironment !== "function") {
    throw new TypeError("getEnvironment must be a function");
  }

  return async function studentIdentityNetlifyAdapter(request) {
    if (request.method !== "POST") {
      return jsonResponse_(405, { error: "Method not allowed." });
    }

    const environment = getEnvironment();
    const identityServiceUrl = String(environment.STUDENT_IDENTITY_SERVICE_URL || "");
    const selfCorrectionLoginUrl = String(environment.SELF_CORRECTION_LOGIN_URL || "");
    const proofSecret = String(environment.STUDENT_IDENTITY_HMAC_SECRET_CURRENT || "");
    const sessionSecret = String(environment.FLUENCY_SESSION_SECRET || "");
    if (!identityServiceUrl || proofSecret.length < 32 || sessionSecret.length < 32) {
      return jsonResponse_(503, { error: "Service unavailable." });
    }
    if (selfCorrectionLoginUrl && !isHttpsUrl_(selfCorrectionLoginUrl)) {
      return jsonResponse_(503, { error: "Service unavailable." });
    }

    const origin = request.headers.get("origin") || "";
    const requestOrigin = new URL(request.url).origin;
    if (origin && origin !== requestOrigin) {
      return jsonResponse_(403, { error: "Service unavailable." });
    }

    const readResult = await readRequestBodyWithLimit_(request, PUBLIC_BODY_BYTES);
    if (readResult.tooLarge) {
      return jsonResponse_(413, { error: "Request is too large." });
    }

    let publicRequest;
    try {
      publicRequest = JSON.parse(readResult.body);
    } catch {
      return jsonResponse_(400, { error: "Request must be valid JSON." });
    }
    const validation = validatePublicRequest_(publicRequest);
    if (!validation.ok) {
      return jsonResponse_(400, { error: validation.message });
    }

    const sentAt = Math.floor(now() / 1000);
    const requestId = typeof publicRequest.requestId === "string"
      ? publicRequest.requestId
      : randomUUID();
    const action = publicRequest.mode === "activate"
      ? "activateStudentIdentity"
      : "verifyStudentCredentials";
    const internalRequest = {
      schemaVersion: "1.0",
      requestId,
      action,
      credentials: {
        schoolYear: publicRequest.schoolYear.trim(),
        classCode: publicRequest.classCode.trim().toUpperCase(),
        seatNumber: Number(publicRequest.seatNumber),
        pin: publicRequest.pin,
        ...(action === "activateStudentIdentity"
          ? { activationCode: publicRequest.activationCode }
          : {})
      }
    };
    let verified;
    if (selfCorrectionLoginUrl && action === "verifyStudentCredentials") {
      // The self-correction centre is the current PIN authority for live
      // classes.  It authenticates the PIN; the signed internal service only
      // resolves the matching stable IDs needed for Fluency records.
      const externalAuth = await verifySelfCorrectionPin_(fetchImpl, selfCorrectionLoginUrl, internalRequest.credentials);
      if (!externalAuth.ok) return jsonResponse_(externalAuth.status, { error: externalAuth.message });

      verified = await callIdentityService_(fetchImpl, identityServiceUrl, proofSecret, sentAt, nonce(), {
        schemaVersion: "1.0",
        requestId,
        action: "resolveStudentIdentity",
        credentials: {
          schoolYear: internalRequest.credentials.schoolYear,
          classCode: internalRequest.credentials.classCode,
          seatNumber: internalRequest.credentials.seatNumber
        }
      });
    } else {
      verified = await callIdentityService_(fetchImpl, identityServiceUrl, proofSecret, sentAt, nonce(), internalRequest);
    }
    if (!verified.ok) return jsonResponse_(verified.status, { error: verified.message });

    const identity = normalizeVerifiedIdentity_(verified.body.identity);
    if (!identity) {
      return jsonResponse_(503, { error: "Service unavailable." });
    }

    const expiresAt = Math.floor(now() / 1000) + SESSION_SECONDS;
    const token = encryptFluencySession({
      version: 1,
      studentId: identity.studentId,
      enrollmentId: identity.enrollmentId,
      schoolYear: identity.schoolYear,
      classCode: identity.classCode,
      seatNumber: identity.seatNumber,
      gradeLevel: identity.gradeLevel,
      expiresAt
    }, sessionSecret);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    const cookie = `fluency_session=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure}`;

    return jsonResponse_(200, {
      session: {
        schoolYear: identity.schoolYear,
        classCode: identity.classCode,
        seatNumber: identity.seatNumber,
        gradeLevel: identity.gradeLevel
      }
    }, { "Set-Cookie": cookie });
  };
}

export function signIdentityRequest(request, options) {
  return signGatewayRequest(request, options);
}

export function encryptFluencySession(claims, secret) {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(claims), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptFluencySession(token, secret, now = Date.now()) {
  try {
    const [version, ivValue, ciphertextValue, tagValue] = String(token || "").split(".");
    if (version !== "v1" || !ivValue || !ciphertextValue || !tagValue) return null;
    const key = createHash("sha256").update(secret, "utf8").digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
    const claims = JSON.parse(plaintext);
    if (!normalizeVerifiedIdentity_(claims)) return null;
    if (claims.version !== 1 || !Number.isInteger(claims.expiresAt)) return null;
    if (claims.expiresAt <= Math.floor(now / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function readFluencySession(request, secret, now = Date.now()) {
  const cookie = request.headers.get("cookie") || "";
  const pair = cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("fluency_session="));
  if (!pair) return null;
  const token = decodeURIComponent(pair.slice("fluency_session=".length));
  return decryptFluencySession(token, secret, now);
}

export function createFluencySessionReader(options = {}) {
  const { getEnvironment, now = () => Date.now() } = options;
  if (typeof getEnvironment !== "function") {
    throw new TypeError("getEnvironment must be a function");
  }
  return async function fluencySessionReader(request) {
    if (request.method !== "GET") {
      return jsonResponse_(405, { error: "Method not allowed." });
    }
    const secret = String(getEnvironment().FLUENCY_SESSION_SECRET || "");
    if (secret.length < 32) {
      return jsonResponse_(503, { error: "Service unavailable." });
    }
    const claims = readFluencySession(request, secret, now());
    if (!claims) {
      return jsonResponse_(401, { error: "尚未登入或連線已過期。" });
    }
    return jsonResponse_(200, {
      session: {
        schoolYear: claims.schoolYear,
        classCode: claims.classCode,
        seatNumber: claims.seatNumber,
        gradeLevel: claims.gradeLevel
      }
    });
  };
}

export function createFluencyLogoutAdapter() {
  return async function fluencyLogoutAdapter(request) {
    if (request.method !== "POST") {
      return jsonResponse_(405, { error: "Method not allowed." });
    }
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return jsonResponse_(200, { ok: true }, {
      "Set-Cookie": `fluency_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`
    });
  };
}

function validatePublicRequest_(value) {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "請確認學年、班級、座號與 PIN。" };
  }
  const mode = value.mode || "login";
  const seatNumber = Number(value.seatNumber);
  const requestIdValid = value.requestId === undefined
    || (typeof value.requestId === "string"
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.requestId));
  const identityValid = typeof value.schoolYear === "string"
    && /^\d{2,4}$/.test(value.schoolYear.trim())
    && typeof value.classCode === "string"
    && /^[A-Za-z0-9-]{2,12}$/.test(value.classCode.trim())
    && Number.isInteger(seatNumber)
    && seatNumber >= 1
    && seatNumber <= 60
    && typeof value.pin === "string"
    && /^\d{6}$/.test(value.pin);
  const activationValid = mode !== "activate"
    || (typeof value.activationCode === "string"
      && /^[A-Za-z0-9 -]{4,64}$/.test(value.activationCode));
  if ((mode !== "login" && mode !== "activate") || !requestIdValid || !identityValid || !activationValid) {
    return { ok: false, message: "請確認學年、班級、座號與 PIN。" };
  }
  return { ok: true };
}

function normalizeVerifiedIdentity_(value) {
  if (!value || typeof value !== "object") return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(value.studentId || ""))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(value.enrollmentId || ""))) return null;
  if (!/^\d{2,4}$/.test(String(value.schoolYear || ""))) return null;
  if (!/^[A-Z0-9-]{2,12}$/.test(String(value.classCode || ""))) return null;
  if (!Number.isInteger(value.seatNumber) || value.seatNumber < 1 || value.seatNumber > 60) return null;
  if (!Number.isInteger(value.gradeLevel) || value.gradeLevel < 1 || value.gradeLevel > 12) return null;
  return value;
}

function isHttpsUrl_(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function verifySelfCorrectionPin_(fetchImpl, url, credentials) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolYear: credentials.schoolYear,
        classCode: credentials.classCode,
        seatNumber: credentials.seatNumber,
        pin: credentials.pin
      }),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    return { ok: false, status: 503, message: "Service unavailable." };
  } finally {
    clearTimeout(timeoutId);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 503, message: "Service unavailable." };
  }
  if (!response.ok || !body?.session) {
    const status = [400, 401, 429].includes(response.status) ? response.status : 503;
    return {
      ok: false,
      status,
      message: status === 503 ? "Service unavailable." : String(body?.error || "登入資訊不正確，請確認後再試。")
    };
  }
  const session = body.session;
  if (session.schoolYear !== credentials.schoolYear
    || session.classCode !== credentials.classCode
    || Number(session.seatNumber) !== credentials.seatNumber) {
    return { ok: false, status: 503, message: "Service unavailable." };
  }
  return { ok: true };
}

async function callIdentityService_(fetchImpl, url, secret, sentAt, nonceValue, internalRequest) {
  const proof = signIdentityRequest(internalRequest, { secret, sentAt, nonce: nonceValue });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gateway: { version: "1", sentAt, nonce: nonceValue, signature: proof },
        request: internalRequest
      }),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    return { ok: false, status: 503, message: "Service unavailable." };
  } finally {
    clearTimeout(timeoutId);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 503, message: "Service unavailable." };
  }
  if (!response.ok || body?.status !== "ok") {
    const status = [400, 401, 429].includes(response.status) ? response.status : 503;
    return {
      ok: false,
      status,
      message: status === 503 ? "Service unavailable." : String(body?.error?.message || "登入資訊不正確，請確認後再試。")
    };
  }
  return { ok: true, body };
}

async function readRequestBodyWithLimit_(request, maximumBytes) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return { body: "", tooLarge: true };
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maximumBytes) {
    return { body: "", tooLarge: true };
  }
  return { body, tooLarge: false };
}

function jsonResponse_(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}
