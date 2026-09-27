import { randomUUID } from 'node:crypto';
import { buildSignedGatewayRequest } from '../gateway/signed-request.mjs';

const baseUrl = (process.env.FLUENCY_STAGING_URL || 'https://fluency-challenge-staging.netlify.app').replace(/\/$/, '');
const secret = required('FLUENCY_RUN_HMAC_SECRET_CURRENT');
const schoolYear = process.env.FLUENCY_TEST_SCHOOL_YEAR || '9999';
const classCode = (process.env.FLUENCY_TEST_CLASS_CODE || 'DEMO').toUpperCase();
const unitId = (process.env.FLUENCY_TEST_UNIT_ID || 'B2U3').toUpperCase();

const request = {
  schemaVersion: '1.0',
  requestId: `staging-${Date.now()}`,
  action: 'createFluencyRun',
  schoolYear,
  classCode,
  unitId,
  assignments: [
    { seatNumber: 1, track: 'S1' },
    { seatNumber: 2, track: 'S2' },
    { seatNumber: 3, track: 'S3' },
    { seatNumber: 4, track: 'S4' },
  ],
};

const envelope = buildSignedGatewayRequest(request, {
  secret,
  sentAt: Math.floor(Date.now() / 1000),
  nonce: randomUUID(),
});

const response = await fetch(`${baseUrl}/api/internal/fluency-runs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(envelope),
});
const body = await response.text();
if (!response.ok) throw new Error(`Could not open the staging run: HTTP ${response.status} ${body.slice(0, 300)}`);
process.stdout.write(`${body}\n`);

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required.`);
  return value;
}
