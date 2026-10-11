import type { AppConfig } from './config';
import { constantTimeEqual, createPinHash, hmac, isValidPin, normalizeActivationCode, randomToken, verifyPin } from './security';
import { queryPath, supabaseRequest } from './supabase';

export type EnrollmentRow = {
  id: string;
  student_id: string;
  school_year: string;
  class_code: string;
  seat_number: number;
  grade_level: number;
  pin_hash: string | null;
  activation_code_hash: string | null;
  activated_at: string | null;
};

type SessionRow = {
  enrollment_id: string;
};

export type StudentSession = {
  schoolYear: string;
  classCode: string;
  seatNumber: number;
  gradeLevel: number;
};

export type IdentityInput = {
  schoolYear: string;
  classCode: string;
  seatNumber: number;
};

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeIdentity(input: IdentityInput): IdentityInput {
  const schoolYear = input.schoolYear.trim();
  const classCode = input.classCode.trim().toUpperCase();
  const seatNumber = Number(input.seatNumber);
  if (!/^\d{2,4}$/.test(schoolYear) || !/^[A-Z0-9-]{2,12}$/.test(classCode) || !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 60) {
    throw new AuthError('請確認學年、班級與座號。');
  }
  return { schoolYear, classCode, seatNumber };
}

function toStudentSession(enrollment: EnrollmentRow): StudentSession {
  return { schoolYear: enrollment.school_year, classCode: enrollment.class_code, seatNumber: enrollment.seat_number, gradeLevel: enrollment.grade_level };
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  const matched = cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return matched ? decodeURIComponent(matched.slice(name.length + 1)) : null;
}

function sessionCookie(token: string, request: Request, maxAge = 45 * 60): string {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `g8_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly;${secure} SameSite=Strict`;
}

export function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `g8_session=; Path=/; Max-Age=0; HttpOnly;${secure} SameSite=Strict`;
}

async function findEnrollment(config: AppConfig, identity: IdentityInput): Promise<EnrollmentRow | null> {
  const rows = await supabaseRequest<EnrollmentRow[]>(config, queryPath('enrollments', {
    select: 'id,student_id,school_year,class_code,seat_number,grade_level,pin_hash,activation_code_hash,activated_at',
    school_year: `eq.${identity.schoolYear}`,
    class_code: `eq.${identity.classCode}`,
    seat_number: `eq.${identity.seatNumber}`,
    active: 'eq.true',
    limit: '1',
  }));
  return rows[0] ?? null;
}

async function recordAttempt(config: AppConfig, identityHash: string, enrollmentId: string | null, success: boolean, reason: string): Promise<void> {
  await supabaseRequest(config, 'auth_attempts', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ identity_hash: identityHash, enrollment_id: enrollmentId, success, reason }),
  });
}

async function assertNotRateLimited(config: AppConfig, identityHash: string): Promise<void> {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rows = await supabaseRequest<{ id: string }[]>(config, queryPath('auth_attempts', {
    select: 'id',
    identity_hash: `eq.${identityHash}`,
    success: 'eq.false',
    attempted_at: `gte.${since}`,
    limit: '5',
  }));
  if (rows.length >= 5) throw new AuthError('嘗試次數過多，請 15 分鐘後再試，或請老師協助。', 429);
}

async function createSession(config: AppConfig, enrollment: EnrollmentRow, request: Request): Promise<{ session: StudentSession; cookie: string }> {
  const token = randomToken();
  const tokenHash = await hmac(token, config.sessionSecret);
  const expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  await supabaseRequest(config, 'student_sessions', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ enrollment_id: enrollment.id, token_hash: tokenHash, expires_at: expiresAt }),
  });
  return { session: toStudentSession(enrollment), cookie: sessionCookie(token, request) };
}

export async function activateStudentCredentials(config: AppConfig, input: IdentityInput & { activationCode: string; pin: string }): Promise<EnrollmentRow> {
  const identity = normalizeIdentity(input);
  if (!isValidPin(input.pin)) throw new AuthError('PIN 必須是六位數字。');
  const identityHash = await hmac(`${identity.schoolYear}:${identity.classCode}:${identity.seatNumber}`, config.sessionSecret);
  await assertNotRateLimited(config, identityHash);
  const enrollment = await findEnrollment(config, identity);
  const activationCode = normalizeActivationCode(input.activationCode);

  if (!enrollment || !enrollment.activation_code_hash || !activationCode) {
    await recordAttempt(config, identityHash, enrollment?.id ?? null, false, 'activation_failed');
    throw new AuthError('啟用資訊不正確，請確認後再試。', 401);
  }

  const activationHash = await hmac(activationCode, config.sessionSecret);
  if (!constantTimeEqual(activationHash, enrollment.activation_code_hash)) {
    await recordAttempt(config, identityHash, enrollment.id, false, 'activation_failed');
    throw new AuthError('啟用資訊不正確，請確認後再試。', 401);
  }

  await supabaseRequest(config, queryPath('enrollments', { id: `eq.${enrollment.id}` }), {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ pin_hash: await createPinHash(input.pin), activation_code_hash: null, activated_at: new Date().toISOString() }),
  });
  await recordAttempt(config, identityHash, enrollment.id, true, 'activated');
  return enrollment;
}

export async function activateStudent(config: AppConfig, input: IdentityInput & { activationCode: string; pin: string }, request: Request): Promise<{ session: StudentSession; cookie: string }> {
  const enrollment = await activateStudentCredentials(config, input);
  return createSession(config, enrollment, request);
}

export async function verifyStudentCredentials(config: AppConfig, input: IdentityInput & { pin: string }, successReason = 'logged_in'): Promise<EnrollmentRow> {
  const identity = normalizeIdentity(input);
  if (!isValidPin(input.pin)) throw new AuthError('PIN 必須是六位數字。');
  const identityHash = await hmac(`${identity.schoolYear}:${identity.classCode}:${identity.seatNumber}`, config.sessionSecret);
  await assertNotRateLimited(config, identityHash);
  const enrollment = await findEnrollment(config, identity);

  if (!enrollment?.pin_hash) {
    await recordAttempt(config, identityHash, enrollment?.id ?? null, false, 'login_failed');
    throw new AuthError('尚未啟用，請改用「第一次啟用」。', 401);
  }
  if (!enrollment.pin_hash.startsWith('v2.')) {
    await recordAttempt(config, identityHash, enrollment.id, false, 'login_failed');
    throw new AuthError('此帳號需要重新啟用，請找老師協助。', 401);
  }
  if (!await verifyPin(input.pin, enrollment.pin_hash)) {
    await recordAttempt(config, identityHash, enrollment.id, false, 'login_failed');
    throw new AuthError('登入資訊不正確，請確認後再試。', 401);
  }

  await recordAttempt(config, identityHash, enrollment.id, true, successReason);
  return enrollment;
}

export async function validateStudentSessionCredential(
  config: AppConfig,
  input: IdentityInput & { enrollmentId: string; credentialVersion: string },
): Promise<EnrollmentRow> {
  const identity = normalizeIdentity(input);
  if (!/^[0-9a-f-]{36}$/i.test(input.enrollmentId) || !Number.isFinite(Date.parse(input.credentialVersion))) {
    throw new AuthError('登入狀態已失效，請重新驗證。', 401);
  }
  const rows = await supabaseRequest<EnrollmentRow[]>(config, queryPath('enrollments', {
    select: 'id,student_id,school_year,class_code,seat_number,grade_level,pin_hash,activation_code_hash,activated_at',
    id: `eq.${input.enrollmentId}`,
    school_year: `eq.${identity.schoolYear}`,
    class_code: `eq.${identity.classCode}`,
    seat_number: `eq.${identity.seatNumber}`,
    activated_at: `eq.${input.credentialVersion}`,
    pin_hash: 'not.is.null',
    active: 'eq.true',
    limit: '1',
  }));
  const enrollment = rows[0];
  if (!enrollment) throw new AuthError('登入狀態已失效，請重新驗證。', 401);
  return enrollment;
}

export async function loginStudent(config: AppConfig, input: IdentityInput & { pin: string }, request: Request): Promise<{ session: StudentSession; cookie: string }> {
  const enrollment = await verifyStudentCredentials(config, input);
  return createSession(config, enrollment, request);
}

export async function getAuthenticatedEnrollment(config: AppConfig, request: Request): Promise<EnrollmentRow | null> {
  const token = readCookie(request, 'g8_session');
  if (!token) return null;
  const tokenHash = await hmac(token, config.sessionSecret);
  const rows = await supabaseRequest<SessionRow[]>(config, queryPath('student_sessions', {
    select: 'enrollment_id', token_hash: `eq.${tokenHash}`, ended_at: 'is.null', expires_at: `gt.${new Date().toISOString()}`, limit: '1',
  }));
  const session = rows[0];
  if (!session) return null;
  const enrollmentRows = await supabaseRequest<EnrollmentRow[]>(config, queryPath('enrollments', {
    select: 'id,student_id,school_year,class_code,seat_number,grade_level,pin_hash,activation_code_hash,activated_at', id: `eq.${session.enrollment_id}`, active: 'eq.true', limit: '1',
  }));
  return enrollmentRows[0] ?? null;
}

export async function logoutStudent(config: AppConfig, request: Request): Promise<void> {
  const token = readCookie(request, 'g8_session');
  if (!token) return;
  const tokenHash = await hmac(token, config.sessionSecret);
  await supabaseRequest(config, queryPath('student_sessions', { token_hash: `eq.${tokenHash}`, ended_at: 'is.null' }), {
    method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
}

export function publicSession(enrollment: EnrollmentRow): StudentSession {
  return toStudentSession(enrollment);
}
