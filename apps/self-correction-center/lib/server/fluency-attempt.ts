import type { IdentityServiceConfig } from './config';
import { SignedServiceError, verifySignedServiceRequest } from './signed-service';
import { supabaseRequest } from './supabase';

type AttemptResult = {
  outcome: 'recorded' | 'existing' | 'conflict' | 'already-recorded' | 'unauthorized' | 'time-limit' | 'invalid';
  attemptId?: string;
  round?: number;
};

export class FluencyAttemptError extends Error {
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

export async function handleRecordFluencyAttempt(
  config: IdentityServiceConfig,
  value: unknown,
  now = new Date(),
): Promise<{ requestId: string; attempt: { attemptId: string; round: number; status: 'recorded' | 'existing' } }> {
  let request;
  try {
    request = await verifySignedServiceRequest({
      ...config,
      currentSecret: config.identityGatewayHmacSecretCurrent,
      previousSecret: config.identityGatewayHmacSecretPrevious,
    }, value, ['recordFluencyAttempt'], now);
  } catch (error) {
    if (error instanceof SignedServiceError) {
      throw new FluencyAttemptError(error.code, error.message, error.status, error.requestId);
    }
    throw error;
  }

  const studentId = uuidField(request.studentId);
  const enrollmentId = uuidField(request.enrollmentId);
  const assignmentId = uuidField(request.assignmentId);
  const roundNumber = Number(request.round);
  const durationMs = Number(request.durationMs);
  const recognizedText = typeof request.recognizedText === 'string' ? request.recognizedText.trim() : '';
  const provider = textField(request.assessmentProvider, /^[a-z0-9][a-z0-9._-]{1,63}$/);
  const version = textField(request.assessmentVersion, /^[A-Z0-9][A-Z0-9._-]{0,63}$/i, false);
  const metrics = request.metrics;
  if (!studentId || !enrollmentId || !assignmentId
    || !Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 3
    || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 180_000
    || recognizedText.length > 10_000
    || !provider || !version
    || !metrics || typeof metrics !== 'object' || Array.isArray(metrics)
    || (metrics as Record<string, unknown>).schemaVersion !== '1.0') {
    throw new FluencyAttemptError('INVALID_REQUEST', 'Invalid request.', 400, request.requestId);
  }

  const result = await supabaseRequest<AttemptResult>(config, 'rpc/record_fluency_attempt', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      p_request_id: request.requestId,
      p_student_id: studentId,
      p_enrollment_id: enrollmentId,
      p_assignment_id: assignmentId,
      p_round_number: roundNumber,
      p_duration_ms: durationMs,
      p_recognized_text: recognizedText,
      p_assessment_provider: provider,
      p_assessment_version: version,
      p_metrics: metrics,
    }),
  });

  if (result?.outcome === 'conflict' || result?.outcome === 'already-recorded') {
    throw new FluencyAttemptError('ROUND_ALREADY_RECORDED', 'This round is already recorded.', 409, request.requestId);
  }
  if (result?.outcome === 'unauthorized') {
    throw new FluencyAttemptError('ASSIGNMENT_NOT_OPEN', 'This assignment is not open.', 403, request.requestId);
  }
  if (result?.outcome === 'time-limit' || result?.outcome === 'invalid') {
    throw new FluencyAttemptError('INVALID_REQUEST', 'Invalid request.', 400, request.requestId);
  }
  if (!result || !['recorded', 'existing'].includes(result.outcome)
    || !uuidField(result.attemptId) || result.round !== roundNumber) {
    throw new FluencyAttemptError('SERVICE_UNAVAILABLE', 'Service unavailable.', 503, request.requestId);
  }
  return {
    requestId: request.requestId,
    attempt: { attemptId: result.attemptId!, round: result.round!, status: result.outcome },
  };
}

function uuidField(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function textField(value: unknown, pattern: RegExp, uppercase = true): string | null {
  if (typeof value !== 'string') return null;
  const normalized = uppercase ? value.trim().toLowerCase() : value.trim();
  return pattern.test(normalized) ? normalized : null;
}
