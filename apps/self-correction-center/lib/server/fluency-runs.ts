import type { FluencyRunServiceConfig } from './config';
import { SignedServiceError, verifySignedServiceRequest } from './signed-service';
import { supabaseRequest } from './supabase';

type Track = 'S1' | 'S2' | 'S3' | 'S4';

type ClassAssignment = {
  seatNumber: number;
  track: Track;
};

type CreateRunRequest = {
  schoolYear: string;
  classCode: string;
  unitId: string;
  assignments: ClassAssignment[];
};

export type FluencyRunResult = {
  runId: string;
  assignmentCount: number;
  status: 'open' | 'closed' | 'archived';
  created: boolean;
};

export class FluencyRunError extends Error {
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

export async function handleCreateFluencyRun(config: FluencyRunServiceConfig, value: unknown, now = new Date()): Promise<{ requestId: string; run: FluencyRunResult }> {
  let signedRequest;
  try {
    signedRequest = await verifySignedServiceRequest({
      ...config,
      currentSecret: config.fluencyRunHmacSecretCurrent,
      previousSecret: config.fluencyRunHmacSecretPrevious,
    }, value, ['createFluencyRun'], now);
  } catch (error) {
    if (error instanceof SignedServiceError) {
      throw new FluencyRunError(error.code, error.message, error.status, error.requestId);
    }
    throw error;
  }

  const request = validateCreateRunRequest(signedRequest);
  const result = await supabaseRequest<FluencyRunResult>(config, 'rpc/create_fluency_run_snapshot', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      p_request_id: signedRequest.requestId,
      p_school_year: request.schoolYear,
      p_class_code: request.classCode,
      p_unit_id: request.unitId,
      p_assignments: request.assignments,
    }),
  });

  if (!result
    || typeof result.runId !== 'string'
    || !Number.isInteger(result.assignmentCount)
    || !['open', 'closed', 'archived'].includes(result.status)
    || typeof result.created !== 'boolean') {
    throw new FluencyRunError('SERVICE_UNAVAILABLE', 'Service unavailable.', 503, signedRequest.requestId);
  }
  return { requestId: signedRequest.requestId, run: result };
}

function validateCreateRunRequest(value: Record<string, unknown>): CreateRunRequest {
  const schoolYear = typeof value.schoolYear === 'string' ? value.schoolYear.trim() : '';
  const classCode = typeof value.classCode === 'string' ? value.classCode.trim().toUpperCase() : '';
  const unitId = typeof value.unitId === 'string' ? value.unitId.trim().toUpperCase() : '';
  const assignments = value.assignments;
  if (!/^\d{2,4}$/.test(schoolYear)
    || !/^[A-Z0-9-]{2,12}$/.test(classCode)
    || !/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(unitId)
    || !Array.isArray(assignments)
    || assignments.length < 1
    || assignments.length > 60) {
    throw new FluencyRunError('INVALID_REQUEST', 'Invalid request.', 400);
  }

  const seenSeats = new Set<number>();
  const normalizedAssignments = assignments.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new FluencyRunError('INVALID_REQUEST', 'Invalid request.', 400);
    }
    const candidate = value as Partial<ClassAssignment>;
    const seatNumber = Number(candidate.seatNumber);
    const track = String(candidate.track || '').toUpperCase() as Track;
    if (!Number.isInteger(seatNumber)
      || seatNumber < 1
      || seatNumber > 60
      || !['S1', 'S2', 'S3', 'S4'].includes(track)
      || seenSeats.has(seatNumber)) {
      throw new FluencyRunError('INVALID_REQUEST', 'Invalid request.', 400);
    }
    seenSeats.add(seatNumber);
    return { seatNumber, track };
  });

  return { schoolYear, classCode, unitId, assignments: normalizedAssignments };
}
