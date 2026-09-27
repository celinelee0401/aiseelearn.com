import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import {
  createFluencyLogoutAdapter,
  createFluencySessionReader,
  createStudentIdentityNetlifyAdapter,
  decryptFluencySession,
  STUDENT_IDENTITY_ROUTE
} from "../gateway/student-identity-netlify-adapter.mjs";

const PROOF_SECRET = "FIC-PROOF-SECRET-AT-LEAST-32-BYTES";
const SESSION_SECRET = "FIC-SESSION-SECRET-AT-LEAST-32-BYTES";
const NOW = Date.parse("2026-09-03T08:00:00.000Z");
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const ENROLLMENT_ID = "22222222-2222-4222-8222-222222222222";

function environment(overrides = {}) {
  return {
    STUDENT_IDENTITY_SERVICE_URL: "https://identity.fictional.invalid/api/internal/student-identity",
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: PROOF_SECRET,
    FLUENCY_SESSION_SECRET: SESSION_SECRET,
    ...overrides
  };
}

function browserRequest(body) {
  return new Request("https://fluency.fictional.local/api/fluency/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://fluency.fictional.local"
    },
    body: JSON.stringify(body)
  });
}

function expectedProof(wrapper) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(wrapper.request), "utf8")
    .digest("hex");
  return createHmac("sha256", PROOF_SECRET)
    .update(`v1\n${wrapper.gateway.sentAt}\n${wrapper.gateway.nonce}\n${requestHash}`, "utf8")
    .digest("base64url");
}

test("Fluency login verifies the shared PIN server-to-server and hides stable IDs from the browser", async () => {
  let forwarded;
  const adapter = createStudentIdentityNetlifyAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-NONCE-1234567890",
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({
        status: "ok",
        requestId: forwarded.request.requestId,
        identity: {
          studentId: STUDENT_ID,
          enrollmentId: ENROLLMENT_ID,
          schoolYear: "115",
          classCode: "FIC-A",
          seatNumber: 7,
          gradeLevel: 8
        },
        error: null
      }), { status: 200 });
    }
  });

  const response = await adapter(browserRequest({
    mode: "login",
    requestId: "FIC-FLUENCY-LOGIN-01",
    schoolYear: "115",
    classCode: "fic-a",
    seatNumber: 7,
    pin: "123456"
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(forwarded.request.action, "verifyStudentCredentials");
  assert.equal(forwarded.gateway.signature, expectedProof(forwarded));
  assert.deepEqual(body.session, {
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    gradeLevel: 8
  });
  assert.equal(JSON.stringify(body).includes(STUDENT_ID), false);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^fluency_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(cookie.includes(STUDENT_ID), false);
  assert.equal(cookie.includes("123456"), false);
  const token = decodeURIComponent(cookie.match(/^fluency_session=([^;]+)/)[1]);
  const claims = decryptFluencySession(token, SESSION_SECRET, NOW);
  assert.equal(claims.studentId, STUDENT_ID);
  assert.equal(claims.enrollmentId, ENROLLMENT_ID);
  assert.equal(claims.expiresAt, Math.floor(NOW / 1000) + 45 * 60);
  assert.equal(decryptFluencySession(`${token}tampered`, SESSION_SECRET, NOW), null);
  assert.equal(decryptFluencySession(token, SESSION_SECRET, NOW + 46 * 60 * 1000), null);
});

test("first activation can happen through Fluency and still uses the shared identity source", async () => {
  let forwarded;
  const adapter = createStudentIdentityNetlifyAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-NONCE-ABCDEFGHIJ",
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({
        status: "ok",
        requestId: forwarded.request.requestId,
        identity: {
          studentId: STUDENT_ID,
          enrollmentId: ENROLLMENT_ID,
          schoolYear: "115",
          classCode: "FIC-A",
          seatNumber: 7,
          gradeLevel: 8
        },
        error: null
      }), { status: 200 });
    }
  });

  const response = await adapter(browserRequest({
    mode: "activate",
    requestId: "FIC-FLUENCY-ACTIVATE-01",
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    activationCode: "FIC-ACT-7788",
    pin: "654321"
  }));

  assert.equal(response.status, 200);
  assert.equal(forwarded.request.action, "activateStudentIdentity");
  assert.equal(forwarded.request.credentials.activationCode, "FIC-ACT-7788");
});

test("uses the live self-correction PIN authority before resolving Fluency record IDs", async () => {
  const calls = [];
  const adapter = createStudentIdentityNetlifyAdapter({
    getEnvironment: () => environment({
      SELF_CORRECTION_LOGIN_URL: "https://self-correction.fictional.invalid/api/auth/login"
    }),
    now: () => NOW,
    nonce: () => "FIC-NONCE-FALLBACK-01",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.includes("self-correction")) {
        return new Response(JSON.stringify({
          session: { schoolYear: "115", classCode: "FIC-A", seatNumber: 7, gradeLevel: 8 }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        status: "ok",
        requestId: calls.at(-1).body.request.requestId,
        identity: {
          studentId: STUDENT_ID,
          enrollmentId: ENROLLMENT_ID,
          schoolYear: "115",
          classCode: "FIC-A",
          seatNumber: 7,
          gradeLevel: 8
        }
      }), { status: 200 });
    }
  });

  const response = await adapter(browserRequest({
    mode: "login", schoolYear: "115", classCode: "fic-a", seatNumber: 7, pin: "123456"
  }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.pin, "123456");
  assert.equal(calls[1].body.request.action, "resolveStudentIdentity");
  assert.equal("pin" in calls[1].body.request.credentials, false);
});

test("invalid input and missing server configuration fail before contacting identity service", async () => {
  let upstreamCalls = 0;
  const adapter = createStudentIdentityNetlifyAdapter({
    getEnvironment: () => environment(),
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("must not fetch");
    }
  });
  const invalid = await adapter(browserRequest({
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    pin: "12"
  }));
  assert.equal(invalid.status, 400);
  assert.equal(upstreamCalls, 0);

  const disabled = createStudentIdentityNetlifyAdapter({
    getEnvironment: () => environment({ STUDENT_IDENTITY_HMAC_SECRET_CURRENT: "" }),
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("must not fetch");
    }
  });
  const unavailable = await disabled(browserRequest({
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    pin: "123456"
  }));
  assert.equal(unavailable.status, 503);
  assert.equal(upstreamCalls, 0);
});

test("route keeps Netlify managed protection at the public login boundary", () => {
  assert.equal(STUDENT_IDENTITY_ROUTE.path, "/api/fluency/auth/login");
  assert.equal(STUDENT_IDENTITY_ROUTE.rateLimit.windowLimit, 120);
  assert.deepEqual(STUDENT_IDENTITY_ROUTE.rateLimit.aggregateBy, ["ip", "domain"]);
});

test("the encrypted Fluency session can be resumed and explicitly cleared on a shared iPad", async () => {
  const login = createStudentIdentityNetlifyAdapter({
    getEnvironment: () => environment(),
    now: () => NOW,
    nonce: () => "FIC-NONCE-SESSION-01",
    fetchImpl: async (_url, options) => {
      const forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({
        status: "ok",
        requestId: forwarded.request.requestId,
        identity: {
          studentId: STUDENT_ID,
          enrollmentId: ENROLLMENT_ID,
          schoolYear: "115",
          classCode: "FIC-A",
          seatNumber: 7,
          gradeLevel: 8
        },
        error: null
      }), { status: 200 });
    }
  });
  const loginResponse = await login(browserRequest({
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    pin: "123456"
  }));
  const sessionCookie = loginResponse.headers.get("set-cookie").split(";")[0];
  const readSession = createFluencySessionReader({
    getEnvironment: () => environment(),
    now: () => NOW
  });
  const sessionResponse = await readSession(new Request(
    "https://fluency.fictional.local/api/fluency/session",
    { headers: { Cookie: sessionCookie } }
  ));
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual((await sessionResponse.json()).session, {
    schoolYear: "115",
    classCode: "FIC-A",
    seatNumber: 7,
    gradeLevel: 8
  });

  const logout = createFluencyLogoutAdapter();
  const logoutResponse = await logout(new Request(
    "https://fluency.fictional.local/api/fluency/auth/logout",
    { method: "POST", headers: { Cookie: sessionCookie } }
  ));
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("set-cookie"), /Max-Age=0/);
});
