import { getFluencyRunServiceConfig } from '@/lib/server/config';
import { FluencyTeacherError, handleFluencyTeacherRequest } from '@/lib/server/fluency-teacher';
import { configurationRequired, json } from '@/lib/server/http';

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = getFluencyRunServiceConfig();
  if (!config) return configurationRequired();

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', action: '', data: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', action: '', data: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }

  try {
    const result = await handleFluencyTeacherRequest(config, JSON.parse(rawBody));
    return json({ status: 'ok', requestId: result.requestId, action: result.action, data: result.data, error: null });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ status: 'error', requestId: '', action: '', data: null, error: { code: 'INVALID_JSON', message: 'Request must be valid JSON.' } }, 400);
    }
    if (error instanceof FluencyTeacherError) {
      return json({ status: 'error', requestId: error.requestId, action: '', data: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', action: '', data: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}
