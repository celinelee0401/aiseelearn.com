import { getIdentityServiceConfig } from '@/lib/server/config';
import { FluencyTaskError, handleGetFluencyTask } from '@/lib/server/fluency-task';
import { configurationRequired, json } from '@/lib/server/http';

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = getIdentityServiceConfig();
  if (!config) return configurationRequired();
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', task: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }
  try {
    const result = await handleGetFluencyTask(config, JSON.parse(rawBody));
    return json({ status: 'ok', requestId: result.requestId, task: result.task, error: null });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ status: 'error', requestId: '', task: null, error: { code: 'INVALID_JSON', message: 'Request must be valid JSON.' } }, 400);
    }
    if (error instanceof FluencyTaskError) {
      return json({ status: 'error', requestId: error.requestId, task: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', task: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}
