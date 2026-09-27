import { randomUUID } from 'node:crypto';
import { buildSignedGatewayRequest } from '../gateway/signed-request.mjs';

const baseUrl = (process.env.FLUENCY_STAGING_URL || 'https://fluency-challenge-staging.netlify.app').replace(/\/$/, '');
const runSecret = required('FLUENCY_RUN_HMAC_SECRET_CURRENT');
const schoolYear = process.env.FLUENCY_TEST_SCHOOL_YEAR || '9999';
const classCode = (process.env.FLUENCY_TEST_CLASS_CODE || 'DEMO').toUpperCase();
const unitId = (process.env.FLUENCY_TEST_UNIT_ID || 'B2U3').toUpperCase();

const accounts = [
  { seatNumber: 1, track: 'S1', activationCode: 'FLUENCY-S1-01', pin: '410001', rounds: [35, 30, 25] },
  { seatNumber: 2, track: 'S2', activationCode: 'FLUENCY-S2-02', pin: '410002', rounds: [35, 30, 25] },
  { seatNumber: 3, track: 'S3', activationCode: 'FLUENCY-S3-03', pin: '410003', rounds: [30, 25, 20] },
  { seatNumber: 4, track: 'S4', activationCode: 'FLUENCY-S4-04', pin: '410004', rounds: [30, 25, 20] },
];

await openRun();
let progress = await readProgress();

for (const account of accounts) {
  const cookie = await loginOrActivate(account);
  const task = await readTask(cookie);
  assertEqual(task.unitId, unitId, `seat ${account.seatNumber} unit`);
  assertEqual(task.rounds.map((round) => round.timeLimitSeconds), account.rounds, `seat ${account.seatNumber} timing`);

  const existing = progress?.students?.find((student) => student.seatNumber === account.seatNumber);
  for (const round of task.rounds) {
    if (existing?.rounds?.find((item) => item.round === round.round)?.completed) continue;
    await submitRound(cookie, task.assignmentId, round.round);
  }
  progress = await readProgress();
}

const finalProgress = await readProgress();
for (const account of accounts) {
  const student = finalProgress?.students?.find((value) => value.seatNumber === account.seatNumber);
  if (!student || student.rounds.length !== 3 || student.rounds.some((round) => !round.completed)) {
    throw new Error(`Seat ${account.seatNumber} did not complete all three rounds.`);
  }
  for (const round of student.rounds) {
    assertEqual(round.wpm, null, `seat ${account.seatNumber} round ${round.round} WPM`);
    assertEqual(round.pauseFlow, null, `seat ${account.seatNumber} round ${round.round} pause flow`);
    assertEqual(round.pronunciationAccuracy, null, `seat ${account.seatNumber} round ${round.round} pronunciation`);
    assertEqual(round.prosody, null, `seat ${account.seatNumber} round ${round.round} prosody`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  baseUrl,
  schoolYear,
  classCode,
  unitId,
  students: accounts.map(({ seatNumber, track, rounds }) => ({ seatNumber, track, rounds, completedRounds: 3 })),
  assessment: 'staging-flow-check-no-scores',
}, null, 2)}\n`);

async function openRun() {
  const request = {
    schemaVersion: '1.0',
    requestId: `e2e-open-${randomUUID()}`,
    action: 'createFluencyRun',
    schoolYear,
    classCode,
    unitId,
    assignments: accounts.map(({ seatNumber, track }) => ({ seatNumber, track })),
  };
  const body = await signedPost('/api/internal/fluency-runs', request);
  if (body.status !== 'ok' || body.run?.assignmentCount !== accounts.length || body.run?.status !== 'open') {
    throw new Error('The staging class run was not opened correctly.');
  }
}

async function readProgress() {
  const request = {
    schemaVersion: '1.0',
    requestId: `e2e-progress-${randomUUID()}`,
    action: 'getFluencyRunProgress',
    schoolYear,
    classCode,
    unitId,
  };
  const body = await signedPost('/api/internal/fluency-teacher', request);
  if (body.status !== 'ok' || body.action !== request.action || body.data?.status !== 'open') {
    throw new Error('The staging progress response was invalid.');
  }
  return body.data;
}

async function loginOrActivate(account) {
  const credentials = {
    requestId: `e2e-login-${randomUUID()}`,
    schoolYear,
    classCode,
    seatNumber: account.seatNumber,
    pin: account.pin,
  };
  let response = await fetch(`${baseUrl}/api/fluency/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ mode: 'login', ...credentials }),
  });
  if (response.status === 401) {
    response = await fetch(`${baseUrl}/api/fluency/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        mode: 'activate',
        ...credentials,
        requestId: `e2e-activate-${randomUUID()}`,
        activationCode: account.activationCode,
      }),
    });
  }
  const body = await json(response, `seat ${account.seatNumber} login`);
  if (!response.ok || body?.session?.seatNumber !== account.seatNumber) {
    throw new Error(`Seat ${account.seatNumber} could not log in: HTTP ${response.status}.`);
  }
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  if (!cookie.startsWith('fluency_session=')) throw new Error(`Seat ${account.seatNumber} received no session cookie.`);
  return cookie;
}

async function readTask(cookie) {
  const response = await fetch(`${baseUrl}/api/fluency/task?unitId=${encodeURIComponent(unitId)}`, {
    headers: { cookie },
  });
  const body = await json(response, 'task');
  if (!response.ok || !body?.task) throw new Error(`Could not load a staging task: HTTP ${response.status}.`);
  return body.task;
}

async function submitRound(cookie, assignmentId, round) {
  const form = new FormData();
  form.set('attemptId', randomUUID());
  form.set('assignmentId', assignmentId);
  form.set('unitId', unitId);
  form.set('round', String(round));
  form.set('audio', new Blob([makePcm16Wav(1_600, 0.1)], { type: 'audio/wav' }), `round-${round}.wav`);
  const response = await fetch(`${baseUrl}/api/fluency/assess`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  const body = await json(response, `round ${round}`);
  if (!response.ok || body?.assessment?.provider?.name !== 'staging-flow-check') {
    throw new Error(`Staging round ${round} failed or returned a real assessment: HTTP ${response.status}.`);
  }
  const metrics = body.assessment.metrics;
  if (metrics?.pace?.wpm !== null
    || metrics?.pauseFlow?.score !== null
    || metrics?.pronunciationAccuracy?.score !== null
    || metrics?.prosody?.score !== null) {
    throw new Error(`Staging round ${round} unexpectedly returned a speech score.`);
  }
}

async function signedPost(pathname, request) {
  const envelope = buildSignedGatewayRequest(request, {
    secret: runSecret,
    sentAt: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
  });
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await json(response, pathname);
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}.`);
  return body;
}

async function json(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

function makePcm16Wav(durationMs, amplitude) {
  const sampleRate = 16_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1000);
  const dataLength = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(44 + index * 2, Math.round(Math.sin(index / 10) * amplitude * 32767), true);
  }
  return buffer;
}

function ascii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch.`);
  }
}

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required.`);
  return value;
}
