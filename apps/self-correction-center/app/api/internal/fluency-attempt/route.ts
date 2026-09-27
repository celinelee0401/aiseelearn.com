import { getIdentityServiceConfig } from '@/lib/server/config';
import { FluencyAttemptError, handleRecordFluencyAttempt } from '@/lib/server/fluency-attempt';
import { configurationRequired, json } from '@/lib/server/http';

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = getIdentityServiceConfig();
  if (!config) return configurationRequired();
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', attempt: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }
  try {
    const result = await handleRecordFluencyAttempt(config, JSON.parse(rawBody));
    return json({ status: 'ok', requestId: result.requestId, attempt: result.attempt, error: null });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ status: 'error', requestId: '', attempt: null, error: { code: 'INVALID_JSON', message: 'Request must be valid JSON.' } }, 400);
    }
    if (error instanceof FluencyAttemptError) {
      return json({ status: 'error', requestId: error.requestId, attempt: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', attempt: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}
