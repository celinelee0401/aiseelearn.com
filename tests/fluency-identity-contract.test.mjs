import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createStudentIdentityNetlifyAdapter } from '../gateway/student-identity-netlify-adapter.mjs';
import { buildSignedGatewayRequest } from '../gateway/signed-request.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'fluency-contract-'));
const output = path.join(dir, 'identity.mjs');
await build({ entryPoints: [new URL('../apps/self-correction-center/lib/server/identity-service.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', outfile: output });
const { handleIdentityGatewayRequest } = await import(pathToFileURL(output));
process.on('exit', () => { void rm(dir, { recursive: true, force: true }); });
const secret = 'fictional-proof-secret-at-least-32-characters';
const config = { supabaseUrl: 'https://database.invalid', secretKey: 'sb_secret_fictional', sessionSecret: secret, identityGatewayHmacSecretCurrent: secret, identityGatewayHmacSecretPrevious: null };
const credentials = { schoolYear: '115', classCode: 'FIC-A', seatNumber: 7 };
const row = { id: '22222222-2222-4222-8222-222222222222', student_id: '11111111-1111-4111-8111-111111111111', school_year: '115', class_code: 'FIC-A', seat_number: 7, grade_level: 8, activated_at: '2026-09-01T00:00:00Z', pin_hash: 'fictional-hash' };
function envelope() { return buildSignedGatewayRequest({ schemaVersion: '1.0', requestId: crypto.randomUUID(), action: 'resolveStudentIdentity', credentials }, { secret, sentAt: Math.floor(Date.now()/1000), nonce: crypto.randomUUID() }); }
function dbFetch(enrollments, calls) {
  return async (url, init = {}) => {
    const u = new URL(url); calls.push({url: u, method: init.method || 'GET'});
    if (u.pathname.endsWith('/service_gateway_nonces')) return new Response(null, { status: 204 });
    assert.equal(u.pathname, '/rest/v1/enrollments');
    assert.equal(u.searchParams.get('active'), 'eq.true');
    assert.equal(u.searchParams.get('class_code'), 'eq.FIC-A');
    return Response.json(enrollments);
  };
}
test('PIN authority -> signed identity handler -> encrypted browser session', async () => {
  const saved = globalThis.fetch; const calls = []; globalThis.fetch = dbFetch([row], calls);
  try {
    const adapter = createStudentIdentityNetlifyAdapter({ getEnvironment: () => ({ STUDENT_IDENTITY_SERVICE_URL: 'https://identity.invalid', SELF_CORRECTION_LOGIN_URL: 'https://authority.invalid', STUDENT_IDENTITY_HMAC_SECRET_CURRENT: secret, FLUENCY_SESSION_SECRET: secret }), fetchImpl: async (url, init) => {
      if (url === 'https://authority.invalid') return Response.json({session: {...credentials, gradeLevel: 8}});
      const body = JSON.parse(init.body);
      assert.equal(body.request.action, 'resolveStudentIdentity');
      assert.equal(body.request.credentials.pin, undefined);
      const result = await handleIdentityGatewayRequest(config, body);
      return Response.json({status: 'ok', identity: result.identity});
    }});
    const response = await adapter(new Request('https://fluency.invalid/api/fluency/auth/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...credentials, pin: '123456'})}));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /fluency_session=.*HttpOnly/);
    const body = await response.json(); assert.equal(body.session.classCode, 'FIC-A'); assert.equal(body.session.studentId, undefined);
    assert.equal(calls.filter(c => c.url.pathname.endsWith('/enrollments')).length, 1);
  } finally { globalThis.fetch = saved; }
});
test('resolver rejects invalid proof before any database request', async () => {
  const saved = globalThis.fetch; globalThis.fetch = () => { throw Error('database must not be called'); };
  try { const body = envelope(); body.gateway.signature = 'A'.repeat(43); await assert.rejects(handleIdentityGatewayRequest(config, body), e => e.code === 'INVALID_PROOF' && e.status === 401); }
  finally { globalThis.fetch = saved; }
});
for (const [label, rows] of [['missing or inactive', []], ['not activated', [{...row, activated_at: null}]], ['without PIN', [{...row, pin_hash: null}]]]) {
  test(`resolver rejects ${label} enrollment`, async () => {
    const saved = globalThis.fetch; globalThis.fetch = dbFetch(rows, []);
    try { await assert.rejects(handleIdentityGatewayRequest(config, envelope()), e => e.code === 'AUTH_FAILED' && e.status === 401); }
    finally { globalThis.fetch = saved; }
  });
}
