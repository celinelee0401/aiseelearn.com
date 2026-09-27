import { getFluencyRunServiceConfig } from '@/lib/server/config';
import { FluencyRunError, handleCreateFluencyRun } from '@/lib/server/fluency-runs';
import { configurationRequired, json } from '@/lib/server/http';

const MAX_BODY_BYTES = 24 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = getFluencyRunServiceConfig();
  if (!config) return configurationRequired();

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', run: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', run: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }

  try {
    const result = await handleCreateFluencyRun(config, JSON.parse(rawBody));
    return json({ status: 'ok', requestId: result.requestId, run: result.run, error: null });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ status: 'error', requestId: '', run: null, error: { code: 'INVALID_JSON', message: 'Request must be valid JSON.' } }, 400);
    }
    if (error instanceof FluencyRunError) {
      return json({ status: 'error', requestId: error.requestId, run: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', run: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}
