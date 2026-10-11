import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  createSeatPlannerClient,
  SeatPlannerClientError
} from "../gateway/seat-planner-client.mjs";
import { buildSignedGatewayRequest } from "../gateway/signed-request.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gasSource = fs.readFileSync(
  path.join(projectRoot, "gas/seat-planner-api/SeatPlannerApi.gs"),
  "utf8"
);
const SECRET = "FIC-SEAT-PLANNER-PROOF-SECRET-123456789";
const NOW_MS = Date.parse("2026-09-03T08:00:00.000Z");

function createGasRuntime() {
  const properties = new Map([
    ["FLUENCY_SEAT_API_HMAC_SECRET_CURRENT", SECRET],
    ["FLUENCY_RUN_SERVICE_URL", "https://fluency-service.fictional.invalid/api/internal/fluency-runs"],
    ["FLUENCY_TEACHER_SERVICE_URL", "https://fluency-service.fictional.invalid/api/internal/fluency-teacher"],
    ["FLUENCY_RUN_API_HMAC_SECRET_CURRENT", SECRET]
  ]);
  const cache = new Map();
  const context = {
    __sheetReads: 0,
    __role: "teacher",
    __outbound: null,
    console: { error() {}, log() {} },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return properties.get(key) ?? null;
          }
        };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get(key) {
            return cache.get(key) ?? null;
          },
          put(key, value) {
            cache.set(key, value);
          }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { return true; },
          releaseLock() {}
        };
      }
    },
    Utilities: {
      Charset: { UTF_8: "UTF_8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest(_algorithm, value) {
        return [...crypto.createHash("sha256").update(value).digest()];
      },
      computeHmacSha256Signature(value, key) {
        return [...crypto.createHmac("sha256", key).update(value).digest()];
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(Uint8Array.from(bytes, byte => (byte + 256) % 256))
          .toString("base64url");
      },
      getUuid() { return "FIC-UUID-0000-0000"; }
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(content) {
        return {
          content,
          setMimeType() { return this; },
          getContent() { return this.content; }
        };
      }
    },
    UrlFetchApp: {
      fetch(url, options) {
        context.__outbound = { url, options, body: JSON.parse(options.payload) };
        const requestId = context.__outbound.body.request.requestId;
        const action = context.__outbound.body.request.action;
        const settings = {
          unitId: "B2U3",
          title: "B2 U3 Fluency Challenge",
          promptText: "Tell us about your weekend.",
          configVersion: "v-test",
          active: true,
          tracks: [
            { track: "S1", useDefault: true, source: "globalDefault", rounds: [35, 30, 25] },
            { track: "S2", useDefault: false, source: "unitOverride", rounds: [40, 35, 30] },
            { track: "S3", useDefault: true, source: "globalDefault", rounds: [30, 25, 20] },
            { track: "S4", useDefault: true, source: "globalDefault", rounds: [30, 25, 20] }
          ]
        };
        return {
          getResponseCode() { return 200; },
          getContentText() {
            if (action === "getFluencyUnitSettings" || action === "saveFluencyUnitSettings") {
              return JSON.stringify({ status: "ok", requestId, action, data: settings, error: null });
            }
            if (action === "getFluencyRunProgress") {
              return JSON.stringify({
                status: "ok",
                requestId,
                action,
                data: {
                  unitId: "B2U3",
                  status: "open",
                  openedAt: "2026-09-03T08:00:00.000Z",
                  students: [{
                    seatNumber: 7,
                    rounds: [
                      { round: 1, completed: true, wpm: 82, pauseFlow: 78, pronunciationAccuracy: 84, prosody: 70 },
                      { round: 2, completed: false, wpm: null, pauseFlow: null, pronunciationAccuracy: null, prosody: null },
                      { round: 3, completed: false, wpm: null, pauseFlow: null, pronunciationAccuracy: null, prosody: null }
                    ]
                  }]
                },
                error: null
              });
            }
            if (action === "closeFluencyRun") {
              return JSON.stringify({
                status: "ok",
                requestId,
                action,
                data: { unitId: "B2U3", status: "closed", closedAt: "2026-09-03T08:30:00.000Z" },
                error: null
              });
            }
            return JSON.stringify({
              status: "ok",
              requestId,
              run: { runId: "33333333-3333-4333-8333-333333333333", assignmentCount: 1, status: "open", created: true },
              error: null
            });
          }
        };
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(`
    var SEAT_PLANNER_SOURCE = {
      '801': { sheet: '801_名單' },
      '816': { sheet: '816_名單' }
    };
    function readPlannerSeed_(className) {
      globalThis.__sheetReads += 1;
      return {
        students: className === '801'
          ? [{ id: '7', number: 7, name: 'Fictional Student', track: 'S3' }]
          : []
      };
    }
    function assertPlannerSession_() { return { role: globalThis.__role }; }
    function assertPlannerClass_(className) {
      if (!SEAT_PLANNER_SOURCE[className]) throw new Error('invalid class');
    }
    ${gasSource}
    Date.now = function () { return ${NOW_MS}; };
    globalThis.__api = {
      doPost: doPost,
      startRun: startFluencyRunSnapshot,
      getSettings: getFluencyUnitSettings,
      saveSettings: saveFluencyUnitSettings,
      getProgress: getFluencyRunProgress,
      closeRun: closeFluencyRun,
      setRole: function (role) { globalThis.__role = role; }
    };
  `, context);
  return context;
}

function environment(secret = SECRET) {
  return {
    FLUENCY_SEAT_PLANNER_URL: "https://seat-planner.fictional.invalid/exec",
    FLUENCY_SEAT_API_HMAC_SECRET_CURRENT: secret
  };
}

function gasFetch(context) {
  return async (_url, options) => {
    const output = context.__api.doPost({
      postData: { contents: options.body }
    });
    return new Response(output.getContent(), { status: 200 });
  };
}

test("signed single-student lookup returns only the current track", async () => {
  const context = createGasRuntime();
  const lookupTrack = createSeatPlannerClient({
    getEnvironment: () => environment(),
    fetchImpl: gasFetch(context),
    now: () => NOW_MS,
    nonce: () => "FIC-SEAT-NONCE-0001"
  });

  const result = await lookupTrack({
    requestId: "FIC-SEAT-LOOKUP-01",
    schoolYear: "115",
    classCode: "801",
    seatNumber: 7
  });

  assert.deepEqual(result, {
    schoolYear: "115",
    classCode: "801",
    seatNumber: 7,
    track: "S3"
  });
  assert.equal(context.__sheetReads, 1);
  assert.equal(JSON.stringify(result).includes("Fictional Student"), false);
  assert.equal("name" in result, false);
  assert.equal("score" in result, false);
});

test("a replayed nonce and an invalid proof stop before another Sheet read", async () => {
  const context = createGasRuntime();
  const lookupTrack = createSeatPlannerClient({
    getEnvironment: () => environment(),
    fetchImpl: gasFetch(context),
    now: () => NOW_MS,
    nonce: () => "FIC-SEAT-NONCE-REPLAY"
  });
  const input = {
    requestId: "FIC-SEAT-REPLAY-01",
    schoolYear: "115",
    classCode: "801",
    seatNumber: 7
  };

  await lookupTrack(input);
  await assert.rejects(() => lookupTrack(input), error => (
    error instanceof SeatPlannerClientError
      && error.code === "SERVICE_UNAVAILABLE"
  ));
  assert.equal(context.__sheetReads, 1);

  const wrongProofContext = createGasRuntime();
  const wrongProofLookup = createSeatPlannerClient({
    getEnvironment: () => environment("FIC-WRONG-PROOF-SECRET-1234567890123"),
    fetchImpl: gasFetch(wrongProofContext),
    now: () => NOW_MS,
    nonce: () => "FIC-SEAT-NONCE-WRONG-PROOF"
  });
  await assert.rejects(() => wrongProofLookup(input), error => (
    error instanceof SeatPlannerClientError
      && error.code === "SERVICE_UNAVAILABLE"
  ));
  assert.equal(wrongProofContext.__sheetReads, 0);
});

test("unsupported classes and missing assignments do not disclose a roster", async () => {
  const context = createGasRuntime();
  const lookupTrack = createSeatPlannerClient({
    getEnvironment: () => environment(),
    fetchImpl: gasFetch(context),
    now: () => NOW_MS,
    nonce: (() => {
      let index = 0;
      return () => `FIC-SEAT-NONCE-MISSING-${++index}`;
    })()
  });

  await assert.rejects(() => lookupTrack({
    requestId: "FIC-SEAT-UNKNOWN-CLASS",
    schoolYear: "115",
    classCode: "999",
    seatNumber: 7
  }), error => error instanceof SeatPlannerClientError && error.code === "INVALID_REQUEST");
  assert.equal(context.__sheetReads, 0);

  await assert.rejects(() => lookupTrack({
    requestId: "FIC-SEAT-MISSING-STUDENT",
    schoolYear: "115",
    classCode: "801",
    seatNumber: 8
  }), error => error instanceof SeatPlannerClientError && error.code === "STUDENT_NOT_FOUND");
  assert.equal(context.__sheetReads, 1);
});

test("the Node signer produces the exact proof expected by Apps Script", () => {
  const context = createGasRuntime();
  const request = {
    schemaVersion: "1.0",
    requestId: "FIC-SEAT-CONTRACT-01",
    action: "getStudentTrack",
    schoolYear: "115",
    classCode: "801",
    seatNumber: 7
  };
  const wrapper = buildSignedGatewayRequest(request, {
    secret: SECRET,
    sentAt: Math.floor(NOW_MS / 1000),
    nonce: "FIC-SEAT-NONCE-CONTRACT"
  });
  const output = context.__api.doPost({
    postData: { contents: JSON.stringify(wrapper) }
  });
  assert.equal(JSON.parse(output.getContent()).status, "ok");
});

test("an authenticated teacher can freeze the class without sending names to the run service", () => {
  const context = createGasRuntime();
  const result = context.__api.startRun(
    "801",
    "B2U3",
    "FIC-TEACHER-SESSION",
    "FIC-CREATE-RUN-01"
  );

  assert.equal(result.assignmentCount, 1);
  assert.equal(result.status, "open");
  assert.equal(result.created, true);
  assert.equal(context.__outbound.body.request.action, "createFluencyRun");
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.__outbound.body.request.assignments)),
    [{ seatNumber: 7, track: "S3" }]
  );
  assert.equal(JSON.stringify(context.__outbound.body).includes("Fictional Student"), false);
  assert.equal(context.__outbound.body.gateway.signature.length, 43);
});

test("the seat-planner assistant role cannot open a Fluency run", () => {
  const context = createGasRuntime();
  context.__api.setRole("assistant");
  assert.throws(() => context.__api.startRun(
    "801",
    "B2U3",
    "FIC-ASSISTANT-SESSION",
    "FIC-CREATE-RUN-ASSISTANT"
  ), /只有教師/);
  assert.equal(context.__outbound, null);
});

test("every non-teacher planner role is denied teacher controls", () => {
  const context = createGasRuntime();
  for (const role of ["assistant", "projector", "student", null]) {
    context.__api.setRole(role);
    assert.throws(() => context.__api.getSettings("801", "B2U3", "FIC-NON-TEACHER-SESSION"), /只有教師/);
  }
  assert.equal(context.__outbound, null);
});

test("an authenticated teacher can read and save per-unit timing overrides", () => {
  const context = createGasRuntime();
  const settings = context.__api.getSettings("801", "b2u3", "FIC-TEACHER-SESSION");
  assert.equal(settings.unitId, "B2U3");
  assert.deepEqual(JSON.parse(JSON.stringify(settings.tracks[1].rounds)), [40, 35, 30]);
  assert.equal(context.__outbound.body.request.action, "getFluencyUnitSettings");
  assert.equal("classCode" in context.__outbound.body.request, false);

  const saved = context.__api.saveSettings(
    "801",
    "B2U3",
    settings,
    "FIC-TEACHER-SESSION",
    "FIC-SAVE-SETTINGS-01"
  );
  assert.equal(saved.unitId, "B2U3");
  assert.equal(context.__outbound.body.request.action, "saveFluencyUnitSettings");
  assert.equal(context.__outbound.body.request.rules.length, 4);
  assert.equal(JSON.stringify(context.__outbound.body).includes("Fictional Student"), false);
});

test("teacher progress contains seat and evidence only, while assistants are blocked", () => {
  const context = createGasRuntime();
  const progress = context.__api.getProgress("801", "B2U3", "FIC-TEACHER-SESSION");
  assert.equal(progress.students[0].seatNumber, 7);
  assert.equal(progress.students[0].rounds[0].pronunciationAccuracy, 84);
  assert.equal(JSON.stringify(progress).includes("studentId"), false);
  assert.equal(JSON.stringify(progress).includes("track"), false);
  assert.equal(JSON.stringify(progress).includes("transcript"), false);

  context.__api.setRole("assistant");
  assert.throws(() => context.__api.getProgress("801", "B2U3", "FIC-ASSISTANT-SESSION"), /只有教師/);
});

test("a teacher can close the current run without exposing its database id", () => {
  const context = createGasRuntime();
  const result = context.__api.closeRun(
    "801",
    "B2U3",
    "FIC-TEACHER-SESSION",
    "FIC-CLOSE-RUN-01"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    unitId: "B2U3",
    status: "closed",
    closedAt: "2026-09-03T08:30:00.000Z"
  });
  assert.equal(context.__outbound.body.request.action, "closeFluencyRun");
  assert.equal("runId" in result, false);
  assert.equal("studentId" in result, false);
});

test("database keep-alive sends one signed read-only lookup and throttles repeats", () => {
  const context = createGasRuntime();
  assert.equal(context.fluencyDatabaseKeepAlive(), undefined);
  assert.equal(context.__outbound.body.request.action, "getFluencyUnitSettings");
  assert.equal(context.__outbound.url, "https://fluency-service.fictional.invalid/api/internal/fluency-teacher");
  assert.equal(context.__outbound.body.gateway.signature.length, 43);
  context.__outbound = null;
  context.fluencyDatabaseKeepAlive();
  assert.equal(context.__outbound, null);
});
