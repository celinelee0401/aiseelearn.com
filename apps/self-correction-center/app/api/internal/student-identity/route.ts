import { getIdentityServiceConfig } from '@/lib/server/config';
import { handleIdentityGatewayRequest, IdentityGatewayError } from '@/lib/server/identity-service';
import { configurationRequired, json } from '@/lib/server/http';

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = getIdentityServiceConfig();
  if (!config) return configurationRequired();

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', identity: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ status: 'error', requestId: '', identity: null, error: { code: 'REQUEST_TOO_LARGE', message: 'Request is too large.' } }, 413);
  }

  try {
    const result = await handleIdentityGatewayRequest(config, JSON.parse(rawBody));
    return json({ status: 'ok', requestId: result.requestId, identity: result.identity, error: null });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ status: 'error', requestId: '', identity: null, error: { code: 'INVALID_JSON', message: 'Request must be valid JSON.' } }, 400);
    }
    if (error instanceof IdentityGatewayError) {
      return json({ status: 'error', requestId: error.requestId, identity: null, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ status: 'error', requestId: '', identity: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } }, 503);
  }
}
