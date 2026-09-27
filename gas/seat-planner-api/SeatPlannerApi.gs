/**
 * Private server-to-server API for Fluency Challenge.
 *
 * Add this file to the "115-1 課堂紀錄" Apps Script project. It reuses
 * SEAT_PLANNER_SOURCE and readPlannerSeed_() from SeatPlanner.gs. Do not expose
 * this endpoint directly to a browser and do not return names or a class roster.
 */
var FLUENCY_SEAT_API = Object.freeze({
  schemaVersion: '1.0',
  proofVersion: '1',
  maximumSkewSeconds: 90,
  replayWindowSeconds: 120,
  replayCachePrefix: 'FLUENCY_SEAT_API_NONCE_',
  lockWaitMs: 3000,
  minimumSecretLength: 32,
  currentSecretProperty: 'FLUENCY_SEAT_API_HMAC_SECRET_CURRENT',
  previousSecretProperty: 'FLUENCY_SEAT_API_HMAC_SECRET_PREVIOUS'
});

var FLUENCY_RUN_API = Object.freeze({
  endpointProperty: 'FLUENCY_RUN_SERVICE_URL',
  currentSecretProperty: 'FLUENCY_RUN_API_HMAC_SECRET_CURRENT',
  minimumSecretLength: 32
});

var FLUENCY_TEACHER_API = Object.freeze({
  endpointProperty: 'FLUENCY_TEACHER_SERVICE_URL',
  currentSecretProperty: 'FLUENCY_RUN_API_HMAC_SECRET_CURRENT',
  minimumSecretLength: 32
});

/**
 * Called from the authenticated teacher planner UI when a unit is opened.
 * The assistant role may update classroom metrics but may not freeze a new run.
 */
function startFluencyRunSnapshot(className, unitId, token, requestId) {
  assertFluencyTeacher_(token);
  assertPlannerClass_(className);
  var normalizedUnitId = normalizeFluencyUnitId_(unitId);
  var normalizedRequestId = normalizeFluencyRequestId_(requestId, 'FLUENCY-RUN-');

  var seed = readPlannerSeed_(className);
  var request = {
    schemaVersion: '1.0',
    requestId: normalizedRequestId,
    action: 'createFluencyRun',
    schoolYear: '115',
    classCode: String(className),
    unitId: normalizedUnitId,
    assignments: (seed.students || []).map(function(student) {
      return { seatNumber: Number(student.number), track: student.track };
    })
  };
  if (!request.assignments.length) throw new Error('目前沒有可指派的學生。');

  var body = fluencyPostService_(FLUENCY_RUN_API, request, '開課');
  return {
    runId: body.run.runId,
    assignmentCount: body.run.assignmentCount,
    status: body.run.status,
    created: Boolean(body.run.created),
    unitId: normalizedUnitId
  };
}

/** Read the editable unit prompt and effective S1-S4 timing rules. */
function getFluencyUnitSettings(className, unitId, token) {
  assertFluencyTeacher_(token);
  assertPlannerClass_(className);
  var normalizedUnitId = normalizeFluencyUnitId_(unitId);
  var request = {
    schemaVersion: '1.0',
    requestId: normalizeFluencyRequestId_('', 'FLUENCY-SETTINGS-'),
    action: 'getFluencyUnitSettings',
    unitId: normalizedUnitId
  };
  var body = fluencyPostService_(FLUENCY_TEACHER_API, request, '讀取單元設定');
  return body.data;
}

/** Save unit-specific overrides. Existing run snapshots remain immutable. */
function saveFluencyUnitSettings(className, unitId, settings, token, requestId) {
  assertFluencyTeacher_(token);
  assertPlannerClass_(className);
  var normalizedUnitId = normalizeFluencyUnitId_(unitId);
  var value = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  var request = {
    schemaVersion: '1.0',
    requestId: normalizeFluencyRequestId_(requestId, 'FLUENCY-SAVE-'),
    action: 'saveFluencyUnitSettings',
    unitId: normalizedUnitId,
    title: String(value.title || '').trim(),
    promptText: String(value.promptText || '').trim(),
    rules: Array.isArray(value.tracks) ? value.tracks.map(function(rule) {
      return {
        track: String(rule && rule.track || '').toUpperCase(),
        useDefault: Boolean(rule && rule.useDefault),
        rounds: Array.isArray(rule && rule.rounds) ? rule.rounds.map(Number) : []
      };
    }) : []
  };
  var body = fluencyPostService_(FLUENCY_TEACHER_API, request, '儲存單元設定');
  return body.data;
}

/** Return seat-only R1-R3 progress for the latest open run. */
function getFluencyRunProgress(className, unitId, token) {
  assertFluencyTeacher_(token);
  assertPlannerClass_(className);
  var normalizedUnitId = normalizeFluencyUnitId_(unitId);
  var request = {
    schemaVersion: '1.0',
    requestId: normalizeFluencyRequestId_('', 'FLUENCY-PROGRESS-'),
    action: 'getFluencyRunProgress',
    schoolYear: '115',
    classCode: String(className),
    unitId: normalizedUnitId
  };
  var body = fluencyPostService_(FLUENCY_TEACHER_API, request, '讀取活動進度');
  return body.data;
}

/** Close the latest open run so student task and assessment access stop immediately. */
function closeFluencyRun(className, unitId, token, requestId) {
  assertFluencyTeacher_(token);
  assertPlannerClass_(className);
  var normalizedUnitId = normalizeFluencyUnitId_(unitId);
  var request = {
    schemaVersion: '1.0',
    requestId: normalizeFluencyRequestId_(requestId, 'FLUENCY-CLOSE-'),
    action: 'closeFluencyRun',
    schoolYear: '115',
    classCode: String(className),
    unitId: normalizedUnitId
  };
  var body = fluencyPostService_(FLUENCY_TEACHER_API, request, '結束活動');
  return body.data;
}

function assertFluencyTeacher_(token) {
  var session = assertPlannerSession_(token);
  if (!session || session.role !== 'teacher') {
    throw new Error('只有教師可以管理 Fluency Challenge。');
  }
  return session;
}

function normalizeFluencyUnitId_(unitId) {
  var normalized = String(unitId || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(normalized)) {
    throw new Error('單元代碼不正確。');
  }
  return normalized;
}

function normalizeFluencyRequestId_(requestId, prefix) {
  var normalized = String(requestId || (prefix + Utilities.getUuid()));
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error('請求代碼不正確。');
  }
  return normalized;
}

function fluencyPostService_(api, request, operationName) {
  var properties = PropertiesService.getScriptProperties();
  var endpoint = String(properties.getProperty(api.endpointProperty) || '').trim();
  var secret = String(properties.getProperty(api.currentSecretProperty) || '').trim();
  if (!/^https:\/\//.test(endpoint) || secret.length < api.minimumSecretLength) {
    throw new Error('Fluency Challenge ' + operationName + '服務尚未完成設定。');
  }
  var sentAt = Math.floor(Date.now() / 1000);
  var nonce = Utilities.getUuid();
  var wrapper = {
    gateway: {
      version: '1',
      sentAt: sentAt,
      nonce: nonce,
      signature: fluencySeatSignature_(request, sentAt, nonce, secret)
    },
    request: request
  };
  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(wrapper),
    muteHttpExceptions: true
  });
  var body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('Fluency Challenge ' + operationName + '服務暫時無法使用。');
  }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300
    || body.status !== 'ok' || body.requestId !== request.requestId) {
    throw new Error('Fluency Challenge ' + operationName + '失敗，請稍後再試。');
  }
  return body;
}

function doPost(event) {
  var requestId = fluencySeatRequestIdFromEvent_(event);
  try {
    var request = verifyFluencySeatRequest_(event);
    requestId = request.requestId;
    return fluencySeatJsonOutput_({
      status: 'ok',
      requestId: requestId,
      serverTime: new Date().toISOString(),
      data: getFluencyStudentTrack_(request),
      error: null
    });
  } catch (error) {
    console.error(error && error.internalReason ? error.internalReason : 'FLUENCY_SEAT_API_FAILED');
    return fluencySeatJsonOutput_({
      status: 'error',
      requestId: requestId,
      serverTime: new Date().toISOString(),
      data: null,
      error: {
        code: error && error.publicCode ? error.publicCode : 'SERVICE_UNAVAILABLE',
        message: error && error.publicMessage ? error.publicMessage : 'Service unavailable.',
        details: null
      }
    });
  }
}

function verifyFluencySeatRequest_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'PROOF_MISSING');
  }

  var wrapper;
  try {
    wrapper = JSON.parse(String(event.postData.contents));
  } catch (error) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'INVALID_JSON');
  }

  var gateway = wrapper && typeof wrapper === 'object' ? wrapper.gateway : null;
  var request = wrapper && typeof wrapper === 'object' ? wrapper.request : null;
  if (!gateway || !request || Array.isArray(gateway) || Array.isArray(request) || gateway.version !== FLUENCY_SEAT_API.proofVersion) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'INVALID_WRAPPER');
  }

  var nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(gateway.sentAt) || Math.abs(nowSeconds - gateway.sentAt) > FLUENCY_SEAT_API.maximumSkewSeconds) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'PROOF_EXPIRED');
  }

  var nonce = String(gateway.nonce || '');
  var signature = String(gateway.signature || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'PROOF_FIELDS_INVALID');
  }

  var secrets = fluencySeatSecrets_();
  var currentSignature = fluencySeatSignature_(request, gateway.sentAt, nonce, secrets.current);
  var signatureMatches = fluencySeatConstantTimeEqual_(signature, currentSignature);
  if (!signatureMatches && secrets.previous) {
    signatureMatches = fluencySeatConstantTimeEqual_(
      signature,
      fluencySeatSignature_(request, gateway.sentAt, nonce, secrets.previous)
    );
  }
  if (!signatureMatches) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'PROOF_INVALID');
  }

  rememberFluencySeatNonce_(nonce);
  validateFluencySeatRequest_(request);
  return request;
}

function validateFluencySeatRequest_(request) {
  if (request.schemaVersion !== FLUENCY_SEAT_API.schemaVersion || request.action !== 'getStudentTrack') {
    throw fluencySeatError_('INVALID_REQUEST', 'Invalid request.', 'REQUEST_ACTION_INVALID');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(request.requestId || ''))) {
    throw fluencySeatError_('INVALID_REQUEST', 'Invalid request.', 'REQUEST_ID_INVALID');
  }
  if (String(request.schoolYear || '') !== '115') {
    throw fluencySeatError_('INVALID_REQUEST', 'Invalid request.', 'SCHOOL_YEAR_INVALID');
  }
  var classCode = String(request.classCode || '').trim();
  var seatNumber = Number(request.seatNumber);
  if (!SEAT_PLANNER_SOURCE[classCode] || !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 60) {
    throw fluencySeatError_('INVALID_REQUEST', 'Invalid request.', 'STUDENT_KEY_INVALID');
  }
}

function getFluencyStudentTrack_(request) {
  var classCode = String(request.classCode).trim();
  var seatNumber = Number(request.seatNumber);
  var seed = readPlannerSeed_(classCode);
  var student = (seed.students || []).find(function(item) {
    return Number(item.number) === seatNumber;
  });
  if (!student || ['S1', 'S2', 'S3', 'S4'].indexOf(student.track) === -1) {
    throw fluencySeatError_('STUDENT_NOT_FOUND', 'Student assignment is not available.', 'STUDENT_OR_TRACK_MISSING');
  }
  return {
    schoolYear: '115',
    classCode: classCode,
    seatNumber: seatNumber,
    track: student.track
  };
}

function fluencySeatSecrets_() {
  var properties = PropertiesService.getScriptProperties();
  var current = String(properties.getProperty(FLUENCY_SEAT_API.currentSecretProperty) || '').trim();
  var previous = String(properties.getProperty(FLUENCY_SEAT_API.previousSecretProperty) || '').trim();
  if (current.length < FLUENCY_SEAT_API.minimumSecretLength || (previous && previous.length < FLUENCY_SEAT_API.minimumSecretLength)) {
    throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'PROOF_CONFIG_INVALID');
  }
  return { current: current, previous: previous };
}

function fluencySeatSignature_(request, sentAt, nonce, secret) {
  var requestDigest = fluencySeatHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(request),
    Utilities.Charset.UTF_8
  ));
  var signingInput = ['v1', String(sentAt), nonce, requestDigest].join('\n');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    signingInput,
    secret,
    Utilities.Charset.UTF_8
  )).replace(/=+$/g, '');
}

function rememberFluencySeatNonce_(nonce) {
  var nonceHash = fluencySeatHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    nonce,
    Utilities.Charset.UTF_8
  ));
  var cacheKey = FLUENCY_SEAT_API.replayCachePrefix + nonceHash;
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(FLUENCY_SEAT_API.lockWaitMs);
    if (!hasLock) throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'REPLAY_LOCKED');
    var cache = CacheService.getScriptCache();
    if (cache.get(cacheKey)) throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'REPLAYED');
    cache.put(cacheKey, '1', FLUENCY_SEAT_API.replayWindowSeconds);
    if (cache.get(cacheKey) !== '1') throw fluencySeatError_('SERVICE_UNAVAILABLE', 'Service unavailable.', 'REPLAY_CACHE_FAILED');
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function fluencySeatConstantTimeEqual_(leftValue, rightValue) {
  var left = String(leftValue || '');
  var right = String(rightValue || '');
  var maximumLength = Math.max(left.length, right.length, 43);
  var mismatch = left.length ^ right.length;
  for (var index = 0; index < maximumLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function fluencySeatHex_(bytes) {
  return (bytes || []).map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function fluencySeatRequestIdFromEvent_(event) {
  try {
    var wrapper = JSON.parse(String(event.postData.contents || ''));
    var requestId = String(wrapper && wrapper.request ? wrapper.request.requestId || '' : '');
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId) ? requestId : '';
  } catch (error) {
    return '';
  }
}

function fluencySeatError_(code, message, internalReason) {
  var error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  error.internalReason = internalReason;
  return error;
}

function fluencySeatJsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
