import type { AppConfig } from './config.ts';
import { constantTimeEqual, hmac, sha256Hex } from './security.ts';
import {
  SupabaseRequestError,
  queryPath,
  supabaseRequest,
} from './supabase.ts';

const MAX_CLOCK_SKEW_SECONDS = 90;
// A sender may be 90 seconds ahead. Keep its nonce until the whole accepted
// timestamp window has elapsed, including the final accepted second.
const NONCE_TTL_SECONDS = 2 * MAX_CLOCK_SKEW_SECONDS + 1;

export type SignedServiceConfig = AppConfig & {
  currentSecret: string;
  previousSecret: string | null;
};

type SignedEnvelope = {
  gateway: {
    version: '1';
    sentAt: number;
    nonce: string;
    signature: string;
  };
  request: Record<string, unknown> & {
    schemaVersion: '1.0';
    requestId: string;
    action: string;
  };
};

export class SignedServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;

  constructor(code: string, message: string, status: number, requestId = '') {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export async function verifySignedServiceRequest(config: SignedServiceConfig, value: unknown, allowedActions: readonly string[], now = new Date()): Promise<SignedEnvelope['request']> {
  if (!isSignedEnvelope(value) || !allowedActions.includes(value.request.action)) {
    throw new SignedServiceError('INVALID_REQUEST', 'Request could not be verified.', 400);
  }

  const { gateway, request } = value;
  if (Math.abs(Math.floor(now.getTime() / 1000) - gateway.sentAt) > MAX_CLOCK_SKEW_SECONDS) {
    throw new SignedServiceError('EXPIRED_REQUEST', 'Request could not be verified.', 401, request.requestId);
  }
  if (!await signatureMatches(config, value)) {
    throw new SignedServiceError('INVALID_PROOF', 'Request could not be verified.', 401, request.requestId);
  }

  await claimNonce(config, gateway.nonce, now);
  return request;
}

function isSignedEnvelope(value: unknown): value is SignedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SignedEnvelope>;
  const gateway = candidate.gateway;
  const request = candidate.request;
  return Boolean(gateway)
    && Boolean(request)
    && typeof gateway === 'object'
    && typeof request === 'object'
    && gateway?.version === '1'
    && Number.isInteger(gateway.sentAt)
    && typeof gateway.nonce === 'string'
    && /^[A-Za-z0-9_-]{16,128}$/.test(gateway.nonce)
    && typeof gateway.signature === 'string'
    && /^[A-Za-z0-9_-]{32,128}$/.test(gateway.signature)
    && request?.schemaVersion === '1.0'
    && typeof request.requestId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.requestId)
    && typeof request.action === 'string';
}

async function signatureMatches(config: SignedServiceConfig, body: SignedEnvelope): Promise<boolean> {
  const requestHash = await sha256Hex(JSON.stringify(body.request));
  const signingInput = `v1\n${body.gateway.sentAt}\n${body.gateway.nonce}\n${requestHash}`;
  const secrets = [config.currentSecret, config.previousSecret].filter((value): value is string => Boolean(value));
  for (const secret of secrets) {
    if (constantTimeEqual(await hmac(signingInput, secret), body.gateway.signature)) return true;
  }
  return false;
}

async function claimNonce(config: SignedServiceConfig, nonce: string, now: Date): Promise<void> {
  const nonceHash = await hmac(nonce, config.sessionSecret);
  const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000).toISOString();
  await supabaseRequest(config, queryPath('service_gateway_nonces', { expires_at: `lt.${now.toISOString()}` }), {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  }).catch(() => undefined);

  try {
    await supabaseRequest(config, 'service_gateway_nonces', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ nonce_hash: nonceHash, expires_at: expiresAt }),
    });
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status === 409) {
      throw new SignedServiceError('REPLAYED_REQUEST', 'Request could not be verified.', 401);
    }
    throw error;
  }
}
