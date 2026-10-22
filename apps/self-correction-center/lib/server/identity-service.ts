import {
  activateStudentCredentials,
  AuthError,
  type EnrollmentRow,
  resolveStudentIdentity,
  validateStudentSessionCredential,
  verifyStudentCredentials,
} from './auth';
import type { IdentityServiceConfig } from './config';
import { SignedServiceError, verifySignedServiceRequest } from './signed-service';

type IdentityAction = 'resolveStudentIdentity' | 'verifyStudentCredentials' | 'activateStudentIdentity' | 'validateStudentSession';

type IdentityCredentials = {
  schoolYear: string;
  classCode: string;
  seatNumber: number;
  pin: string;
  activationCode?: string;
  enrollmentId?: string;
  credentialVersion?: string;
};

export type VerifiedStudentIdentity = {
  studentId: string;
  enrollmentId: string;
  schoolYear: string;
  classCode: string;
  seatNumber: number;
  gradeLevel: number;
  credentialVersion: string;
};

export class IdentityGatewayError extends Error {
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

function toVerifiedIdentity(enrollment: EnrollmentRow): VerifiedStudentIdentity {
  if (!enrollment.activated_at) {
    throw new IdentityGatewayError('AUTH_FAILED', 'Authentication failed.', 401);
  }
  return {
    studentId: enrollment.student_id,
    enrollmentId: enrollment.id,
    schoolYear: enrollment.school_year,
    classCode: enrollment.class_code,
    seatNumber: enrollment.seat_number,
    gradeLevel: enrollment.grade_level,
    credentialVersion: enrollment.activated_at,
  };
}

function identityCredentials(value: unknown, action: IdentityAction): IdentityCredentials {
  if (!value || typeof value !== 'object') {
    throw new IdentityGatewayError('INVALID_REQUEST', 'Request could not be verified.', 400);
  }
  const credentials = value as Partial<IdentityCredentials>;
  const sharedInvalid = typeof credentials.schoolYear !== 'string'
    || typeof credentials.classCode !== 'string'
    || !Number.isInteger(Number(credentials.seatNumber));
  const actionValid = action === 'resolveStudentIdentity'
    ? true
    : action === 'validateStudentSession'
    ? typeof credentials.enrollmentId === 'string' && typeof credentials.credentialVersion === 'string'
    : typeof credentials.pin === 'string'
      && (action !== 'activateStudentIdentity' || typeof credentials.activationCode === 'string');
  if (sharedInvalid || !actionValid) {
    throw new IdentityGatewayError('INVALID_REQUEST', 'Request could not be verified.', 400);
  }
  return credentials as IdentityCredentials;
}

export async function handleIdentityGatewayRequest(config: IdentityServiceConfig, value: unknown, now = new Date()): Promise<{ requestId: string; identity: VerifiedStudentIdentity }> {
  let request;
  try {
    request = await verifySignedServiceRequest({
      ...config,
      currentSecret: config.identityGatewayHmacSecretCurrent,
      previousSecret: config.identityGatewayHmacSecretPrevious,
    }, value, ['resolveStudentIdentity', 'verifyStudentCredentials', 'activateStudentIdentity', 'validateStudentSession'], now);
  } catch (error) {
    if (error instanceof SignedServiceError) {
      throw new IdentityGatewayError(error.code, error.message, error.status, error.requestId);
    }
    throw error;
  }
  const action = request.action as IdentityAction;
  const credentials = identityCredentials(request.credentials, action);

  try {
    const enrollment = action === 'resolveStudentIdentity'
      ? await resolveStudentIdentity(config, credentials)
      : action === 'validateStudentSession'
      ? await validateStudentSessionCredential(config, {
          ...credentials,
          enrollmentId: credentials.enrollmentId ?? '',
          credentialVersion: credentials.credentialVersion ?? '',
        })
      : action === 'activateStudentIdentity'
        ? await activateStudentCredentials(config, {
          ...credentials,
          activationCode: credentials.activationCode ?? '',
        })
        : await verifyStudentCredentials(config, credentials, 'verified_for_module');
    return { requestId: request.requestId, identity: toVerifiedIdentity(enrollment) };
  } catch (error) {
    if (error instanceof AuthError) {
      throw new IdentityGatewayError('AUTH_FAILED', error.message, error.status, request.requestId);
    }
    throw error;
  }
}
