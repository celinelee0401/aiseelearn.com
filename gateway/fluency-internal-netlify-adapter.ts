import { getFluencyRunServiceConfig, getIdentityServiceConfig } from '../apps/self-correction-center/lib/server/config.js';
import { FluencyAttemptError, handleRecordFluencyAttempt } from '../apps/self-correction-center/lib/server/fluency-attempt.js';
import { FluencyRunError, handleCreateFluencyRun } from '../apps/self-correction-center/lib/server/fluency-runs.js';
import { FluencyTaskError, handleGetFluencyTask } from '../apps/self-correction-center/lib/server/fluency-task.js';
import { FluencyTeacherError, handleFluencyTeacherRequest } from '../apps/self-correction-center/lib/server/fluency-teacher.js';
import { configurationRequired, json } from '../apps/self-correction-center/lib/server/http.js';
import { handleIdentityGatewayRequest, IdentityGatewayError } from '../apps/self-correction-center/lib/server/identity-service.js';
import { SupabaseRequestError } from '../apps/self-correction-center/lib/server/supabase.js';

type ErrorEnvelopeKey = 'identity' | 'task' | 'attempt' | 'run' | 'data';

function requestTooLarge(key: ErrorEnvelopeKey): Response {
  const body: Record<string, unknown> = {
    status: 'error',
    requestId: '',
    error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' },
  };
  body[key] = null;
  if (key === 'data') body.action = '';
  return json(body, 413);
}

async function readJsonBody(request: Request, maxBodyBytes: number, key: ErrorEnvelopeKey): Promise<unknown | Response> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return requestTooLarge(key);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) {
    return requestTooLarge(key);
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    const body: Record<string, unknown> = {
      status: 'error',
      requestId: '',
      error: { code: 'INVALID_JSON', message: 'Request must be valid JSON.' },
    };
    body[key] = null;
    if (key === 'data') body.action = '';
    return json(body, 400);
  }
}

export async function handleInternalStudentIdentity(request: Request): Promise<Response> {
  const config = getIdentityServiceConfig();
  if (!config) {
    console.error('fluency identity configuration unavailable');
    return configurationRequired();
  }

  const body = await readJsonBody(request, 8 * 1024, 'identity');
  if (body instanceof Response) return body;

  try {
    const result = await handleIdentityGatewayRequest(config, body);
    return json({ status: 'ok', requestId: result.requestId, identity: result.identity, error: null });
  } catch (error) {
    if (error instanceof IdentityGatewayError) {
      return json({ status: 'error', requestId: error.requestId, identity: null, error: { code: error.code, message: error.message } }, error.status);
    }
    // Do not log the database response body, credentials, or student identifiers.
    console.error('fluency identity service failed', {
      kind: error instanceof SupabaseRequestError ? 'supabase' : 'unexpected',
      status: error instanceof SupabaseRequestError ? error.status : undefined,
      name: error instanceof Error ? error.name : undefined,
      keyKind: config.secretKey.startsWith('sb_secret_') ? 'modern-secret'
        : config.secretKey.startsWith('sb_') ? 'modern-other' : 'legacy-or-invalid',
    });
    return json({ status: 'error', requestId: '', identity: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}

export async function handleInternalFluencyTask(request: Request): Promise<Response> {
  const config = getIdentityServiceConfig();
  if (!config) return configurationRequired();

  const body = await readJsonBody(request, 8 * 1024, 'task');
  if (body instanceof Response) return body;

  try {
    const result = await handleGetFluencyTask(config, body);
    return json({ status: 'ok', requestId: result.requestId, task: result.task, error: null });
  } catch (error) {
    if (error instanceof FluencyTaskError) {
      return json({ status: 'error', requestId: error.requestId, task: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', task: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}

export async function handleInternalFluencyAttempt(request: Request): Promise<Response> {
  const config = getIdentityServiceConfig();
  if (!config) return configurationRequired();

  const body = await readJsonBody(request, 32 * 1024, 'attempt');
  if (body instanceof Response) return body;

  try {
    const result = await handleRecordFluencyAttempt(config, body);
    return json({ status: 'ok', requestId: result.requestId, attempt: result.attempt, error: null });
  } catch (error) {
    if (error instanceof FluencyAttemptError) {
      return json({ status: 'error', requestId: error.requestId, attempt: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', attempt: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}

export async function handleInternalFluencyRuns(request: Request): Promise<Response> {
  const config = getFluencyRunServiceConfig();
  if (!config) return configurationRequired();

  const body = await readJsonBody(request, 24 * 1024, 'run');
  if (body instanceof Response) return body;

  try {
    const result = await handleCreateFluencyRun(config, body);
    return json({ status: 'ok', requestId: result.requestId, run: result.run, error: null });
  } catch (error) {
    if (error instanceof FluencyRunError) {
      return json({ status: 'error', requestId: error.requestId, run: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', run: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}

export async function handleInternalFluencyTeacher(request: Request): Promise<Response> {
  const config = getFluencyRunServiceConfig();
  if (!config) return configurationRequired();

  const body = await readJsonBody(request, 32 * 1024, 'data');
  if (body instanceof Response) return body;

  try {
    const result = await handleFluencyTeacherRequest(config, body);
    return json({ status: 'ok', requestId: result.requestId, action: result.action, data: result.data, error: null });
  } catch (error) {
    if (error instanceof FluencyTeacherError) {
      return json({ status: 'error', requestId: error.requestId, action: '', data: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', action: '', data: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}
