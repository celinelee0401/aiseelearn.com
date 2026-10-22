import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFluencySession } from './student-identity-netlify-adapter.mjs';
import { inspectPcm16Wav } from '../apps/fluency-challenge/lib/audio-quality.mjs';

const MAX_REQUEST_BYTES = 2_100_000;
const JOB_TTL_MS = 15 * 60_000;
const RESULT_TTL_MS = 60 * 60_000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('hex');
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createFluencyAssessmentJobs({ getEnvironment, getStore, assess, fetchImpl = fetch, now = Date.now, reportError = () => {} }) {
  function config() {
    const env = getEnvironment();
    return { sessionSecret: String(env.FLUENCY_SESSION_SECRET || ''), proofSecret: String(env.IDENTITY_GATEWAY_HMAC_SECRET_CURRENT || env.STUDENT_IDENTITY_HMAC_SECRET_CURRENT || '') };
  }
  function keyFor(session, attemptId, secret) { return sign(`${session.enrollmentId}:${attemptId}`, secret); }
  const pending = () => json({ status: 'processing', retryAfterMs: 2000 }, 202);
  function resultResponse(record) {
    if (record.state === 'complete' || record.state === 'failed') return json(record.result.body, record.result.status);
    return pending();
  }
  async function dispatch(request, key, runId, secret) {
    const sentAt = Math.floor(now() / 1000);
    const body = { key, runId, sentAt, proof: sign(`${key}:${runId}:${sentAt}`, secret) };
    const response = await fetchImpl(new URL('/api/internal/fluency-assess-job', request.url), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw Error('background dispatch failed');
  }
  async function submit(request) {
    if (!['POST', 'GET'].includes(request.method)) return json({error:'Method not allowed.'}, 405);
    const { sessionSecret, proofSecret } = config();
    if (sessionSecret.length < 32 || proofSecret.length < 32) return json({error:'Service unavailable.'}, 503);
    const session = readFluencySession(request, sessionSecret, now());
    if (!session) return json({error:'尚未登入或連線已過期。'}, 401);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({error:'Request not allowed.'}, 403);
    const store = getStore();
    if (request.method === 'GET') {
      const attemptId = new URL(request.url).searchParams.get('attemptId');
      if (!uuid(attemptId)) return json({error:'評測資料不完整。'}, 400);
      const key = keyFor(session, attemptId, proofSecret);
      const record = await store.get(`state/${key}`, {type:'json'});
      if (!record) return json({error:'找不到這次評測，錄音仍可重新送出。'}, 404);
      if (record.expiresAt < now()) {
        await removeJob(store, key, record);
        return json({error:'這次評測已過期，請重新送出原錄音。'}, 410);
      }
      if (['queued','processing'].includes(record.state) && now() - record.createdAt > JOB_TTL_MS) {
        await store.delete(`input/${key}/${record.runId}`);
        return json({error:'語音服務未完成評測，請保留錄音再試。'}, 503);
      }
      return resultResponse(record);
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES) return json({error:'錄音檔太大，請重新錄製。'},413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_REQUEST_BYTES) return json({error:'錄音檔太大，請重新錄製。'},413);
    let form;
    try { form = await new Response(bytes, {headers:{'content-type':request.headers.get('content-type') || ''}}).formData(); }
    catch { return json({error:'錄音資料格式不正確。'},400); }
    const attemptId = form.get('attemptId');
    const audio = form.get('audio');
    if (!uuid(attemptId) || !uuid(form.get('assignmentId')) || !/^[A-Z0-9][A-Z0-9._-]{1,63}$/i.test(String(form.get('unitId') || '')) || ![1,2,3].includes(Number(form.get('round'))) || !(audio instanceof File) || audio.size > 2_000_000) return json({error:'錄音或任務資料不完整。'},400);
    const quality = inspectPcm16Wav(await audio.arrayBuffer());
    if (quality.status !== 'pass') return json({code:'audio_quality',error:'錄音品質不足，請靠近麥克風再錄一次。',quality},422);
    const key = keyFor(session, attemptId, proofSecret);
    let previous = await store.getWithMetadata(`state/${key}`, {type:'json'});
    if (previous && previous.data.expiresAt < now()) { await removeJob(store,key,previous.data); previous = null; }
    if (previous?.data.state === 'complete') return resultResponse(previous.data);
    if (previous && ['queued','processing'].includes(previous.data.state) && now()-previous.data.createdAt <= JOB_TTL_MS) return pending();
    const runId = randomUUID();
    const inputKey = `input/${key}/${runId}`;
    // The private upload exists only until this background run finishes.
    await store.setJSON(inputKey, { body:Buffer.from(bytes).toString('base64'), contentType:request.headers.get('content-type'), cookie:request.headers.get('cookie'), url:request.url });
    const record = {state:'queued',runId,createdAt:now(),expiresAt:now()+RESULT_TTL_MS};
    const created = await store.setJSON(`state/${key}`, record, previous ? {onlyIfMatch:previous.etag} : {onlyIfNew:true});
    if (!created.modified) { await store.delete(inputKey); return pending(); }
    try { await dispatch(request,key,runId,proofSecret); }
    catch {
      // A lost dispatch response can still mean the worker started. Its lock
      // prevents the same run from doing paid assessment twice.
      try { await dispatch(request,key,runId,proofSecret); }
      catch { reportError('ASSESSMENT_DISPATCH_UNCONFIRMED'); }
    }
    // Best-effort bounded cleanup also removes abandoned uploads after a crash.
    return pending();
  }
  async function worker(request) {
    const { proofSecret } = config();
    if (proofSecret.length < 32 || request.method !== 'POST') return json({error:'Unauthorized.'},401);
    let body;
    try { body = await request.json(); } catch { return json({error:'Invalid request.'},400); }
    const {key,runId,sentAt,proof} = body || {};
    if (!/^[a-f0-9]{64}$/.test(key || '') || !uuid(runId) || !Number.isInteger(sentAt) || Math.abs(Math.floor(now()/1000)-sentAt)>90 || !same(sign(`${key}:${runId}:${sentAt}`,proofSecret),proof)) return json({error:'Unauthorized.'},401);
    const store = getStore();
    const record = await store.get(`state/${key}`,{type:'json'});
    if (!record || record.runId!==runId || record.expiresAt<now() || ['complete','failed'].includes(record.state)) return new Response(null,{status:204});
    const locked = await store.setJSON(`lock/${key}/${runId}`,{createdAt:now()},{onlyIfNew:true});
    if (!locked.modified) return new Response(null,{status:204});
    const inputKey = `input/${key}/${runId}`;
    try {
      const input = await store.get(inputKey,{type:'json'});
      if (!input) throw Error('missing upload');
      await store.setJSON(`state/${key}`,{...record,state:'processing'});
      const response = await assess(new Request(input.url,{method:'POST',headers:{'content-type':input.contentType,cookie:input.cookie},body:Buffer.from(input.body,'base64')}));
      const result = {status:response.status,body:await response.json()};
      await store.setJSON(`state/${key}`,{...record,state:response.ok?'complete':'failed',result,finishedAt:now()});
    } catch {
      reportError('ASSESSMENT_JOB_FAILED');
      await store.setJSON(`state/${key}`,{...record,state:'failed',result:{status:503,body:{error:'語音評測暫時未完成，錄音仍可重新送出。'}}});
    } finally {
      await store.delete(inputKey);
      await cleanupExpired(store).catch(() => reportError('ASSESSMENT_CLEANUP_FAILED'));
    }
    return new Response(null,{status:204});
  }
  async function removeJob(store,key,record) {
    for (const prefix of [`input/${key}/`, `lock/${key}/`]) {
      const {blobs} = await store.list({prefix});
      await Promise.all(blobs.map(blob => store.delete(blob.key)));
    }
    await store.delete(`state/${key}`);
  }
  async function cleanupExpired(store) {
    const {blobs} = await store.list({prefix:'state/'});
    for (const blob of blobs.slice(0,20)) {
      const record = await store.get(blob.key,{type:'json'});
      if (record?.expiresAt < now()) await removeJob(store,blob.key.slice(6),record);
    }
  }
  return {submit,worker};
}
