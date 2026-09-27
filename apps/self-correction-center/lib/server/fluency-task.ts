import type { IdentityServiceConfig } from './config';
import { SignedServiceError, verifySignedServiceRequest } from './signed-service';
import { supabaseRequest } from './supabase';

export type PublicFluencyTask = {
  assignmentId: string;
  runId: string;
  unitId: string;
  title: string;
  promptText: string | null;
  configVersion: string;
  rounds: Array<{ round: number; timeLimitSeconds: number }>;
  completedRounds: number[];
  completedAttempts: Array<{
    attemptId: string;
    round: number;
    timeLimitSeconds: number;
    assessment: {
      schemaVersion: string;
      rubricVersion: string;
      provider: { name: string; version: string; mode: 'unscripted' };
      transcript: string;
      durationMs: number;
      recognizedWordCount: number | null;
      metrics: Record<string, unknown>;
      observations: unknown[];
      warnings: unknown[];
    };
  }>;
};

export class FluencyTaskError extends Error {
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

export async function handleGetFluencyTask(config: IdentityServiceConfig, value: unknown, now = new Date()): Promise<{ requestId: string; task: PublicFluencyTask }> {
  let request;
  try {
    request = await verifySignedServiceRequest({
      ...config,
      currentSecret: config.identityGatewayHmacSecretCurrent,
      previousSecret: config.identityGatewayHmacSecretPrevious,
    }, value, ['getFluencyTask'], now);
  } catch (error) {
    if (error instanceof SignedServiceError) {
      throw new FluencyTaskError(error.code, error.message, error.status, error.requestId);
    }
    throw error;
  }

  const studentId = uuidField(request.studentId);
  const enrollmentId = uuidField(request.enrollmentId);
  const schoolYear = textField(request.schoolYear, /^\d{2,4}$/);
  const classCode = textField(request.classCode, /^[A-Z0-9-]{2,12}$/);
  const unitId = textField(request.unitId, /^[A-Z0-9][A-Z0-9._-]{1,63}$/);
  if (!studentId || !enrollmentId || !schoolYear || !classCode || !unitId) {
    throw new FluencyTaskError('INVALID_REQUEST', 'Invalid request.', 400, request.requestId);
  }

  const task = await supabaseRequest<PublicFluencyTask | null>(config, 'rpc/get_fluency_student_task', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      p_student_id: studentId,
      p_enrollment_id: enrollmentId,
      p_school_year: schoolYear,
      p_class_code: classCode,
      p_unit_id: unitId,
    }),
  });
  if (!task) {
    throw new FluencyTaskError('ASSIGNMENT_NOT_FOUND', '目前沒有可開始的口說任務。', 404, request.requestId);
  }
  validatePublicTask(task, unitId, request.requestId);
  return { requestId: request.requestId, task };
}

function uuidField(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function textField(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return pattern.test(normalized) ? normalized : null;
}

function validatePublicTask(task: PublicFluencyTask, expectedUnitId: string, requestId: string): void {
  const validRounds = Array.isArray(task.rounds)
    && task.rounds.length === 3
    && task.rounds.every((round, index) => (
      round
      && round.round === index + 1
      && Number.isInteger(round.timeLimitSeconds)
      && round.timeLimitSeconds >= 5
      && round.timeLimitSeconds <= 180
    ));
  const validCompletedRounds = Array.isArray(task.completedRounds)
    && task.completedRounds.every((round) => Number.isInteger(round) && round >= 1 && round <= 3)
    && new Set(task.completedRounds).size === task.completedRounds.length;
  const validCompletedAttempts = Array.isArray(task.completedAttempts)
    && task.completedAttempts.every((attempt) => {
      const assessment = attempt?.assessment;
      return uuidField(attempt?.attemptId)
        && Number.isInteger(attempt?.round)
        && attempt.round >= 1
        && attempt.round <= 3
        && Number.isInteger(attempt?.timeLimitSeconds)
        && attempt.timeLimitSeconds >= 5
        && attempt.timeLimitSeconds <= 180
        && assessment
        && typeof assessment.schemaVersion === 'string'
        && typeof assessment.rubricVersion === 'string'
        && typeof assessment.provider?.name === 'string'
        && typeof assessment.provider?.version === 'string'
        && assessment.provider?.mode === 'unscripted'
        && typeof assessment.transcript === 'string'
        && Number.isInteger(assessment.durationMs)
        && assessment.durationMs > 0
        && assessment.metrics
        && typeof assessment.metrics === 'object'
        && !Array.isArray(assessment.metrics)
        && Array.isArray(assessment.observations)
        && Array.isArray(assessment.warnings);
    })
    && new Set(task.completedAttempts.map((attempt) => attempt.round)).size === task.completedAttempts.length
    && JSON.stringify(task.completedAttempts.map((attempt) => attempt.round).sort())
      === JSON.stringify([...task.completedRounds].sort());
  if (!uuidField(task.assignmentId)
    || !uuidField(task.runId)
    || task.unitId !== expectedUnitId
    || typeof task.title !== 'string'
    || (task.promptText !== null && typeof task.promptText !== 'string')
    || typeof task.configVersion !== 'string'
    || !validRounds
    || !validCompletedRounds
    || !validCompletedAttempts) {
    throw new FluencyTaskError('SERVICE_UNAVAILABLE', 'Service unavailable.', 503, requestId);
  }
}
