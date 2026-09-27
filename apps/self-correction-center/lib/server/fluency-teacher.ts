import type { FluencyRunServiceConfig } from './config';
import { SignedServiceError, verifySignedServiceRequest } from './signed-service';
import { supabaseRequest } from './supabase';

const TRACKS = ['S1', 'S2', 'S3', 'S4'] as const;
type Track = typeof TRACKS[number];

export type FluencyTrackRule = {
  track: Track;
  useDefault: boolean;
  source: 'globalDefault' | 'unitOverride';
  rounds: [number, number, number];
};

export type FluencyUnitSettings = {
  unitId: string;
  title: string;
  promptText: string | null;
  configVersion: string;
  active: boolean;
  isNew: boolean;
  tracks: FluencyTrackRule[];
};

export type FluencyRoundProgress = {
  round: number;
  completed: boolean;
  wpm: number | null;
  pauseFlow: number | null;
  pronunciationAccuracy: number | null;
  prosody: number | null;
};

export type FluencyRunProgress = {
  unitId: string;
  status: 'open';
  openedAt: string;
  students: Array<{ seatNumber: number; rounds: FluencyRoundProgress[] }>;
};

export type FluencyCloseResult = {
  unitId: string;
  status: 'closed' | 'no-open-run';
  closedAt: string | null;
};

export class FluencyTeacherError extends Error {
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

export async function handleFluencyTeacherRequest(
  config: FluencyRunServiceConfig,
  value: unknown,
  now = new Date(),
): Promise<{ requestId: string; action: string; data: FluencyUnitSettings | FluencyRunProgress | FluencyCloseResult | null }> {
  let request;
  try {
    request = await verifySignedServiceRequest({
      ...config,
      currentSecret: config.fluencyRunHmacSecretCurrent,
      previousSecret: config.fluencyRunHmacSecretPrevious,
    }, value, ['getFluencyUnitSettings', 'saveFluencyUnitSettings', 'getFluencyRunProgress', 'closeFluencyRun'], now);
  } catch (error) {
    if (error instanceof SignedServiceError) {
      throw new FluencyTeacherError(error.code, error.message, error.status, error.requestId);
    }
    throw error;
  }

  const unitId = unitIdField(request.unitId);
  if (!unitId) throw invalid(request.requestId);

  if (request.action === 'getFluencyUnitSettings') {
    const result = await rpc<unknown>(config, 'get_fluency_unit_settings', { p_unit_id: unitId });
    if (result === null) throw invalid(request.requestId);
    return { requestId: request.requestId, action: request.action, data: validateSettings(result, request.requestId) };
  }

  if (request.action === 'saveFluencyUnitSettings') {
    const title = typeof request.title === 'string' ? request.title.trim() : '';
    const promptText = typeof request.promptText === 'string' ? request.promptText.trim() : '';
    const rules = validateSubmittedRules(request.rules, request.requestId);
    if (!title || title.length > 200 || promptText.length > 5_000) throw invalid(request.requestId);

    const result = await rpc<Record<string, unknown>>(config, 'save_fluency_unit_settings', {
      p_request_id: request.requestId,
      p_unit_id: unitId,
      p_title: title,
      p_prompt_text: promptText,
      p_rules: rules,
    });
    if (result?.outcome === 'conflict') throw new FluencyTeacherError('REQUEST_CONFLICT', 'Request conflicts with an earlier request.', 409, request.requestId);
    if (result?.outcome !== 'saved') throw invalid(request.requestId);
    return {
      requestId: request.requestId,
      action: request.action,
      data: validateSettings(result.settings, request.requestId),
    };
  }

  const schoolYear = textField(request.schoolYear, /^\d{2,4}$/);
  const classCode = textField(request.classCode, /^[A-Z0-9-]{2,12}$/, true);
  if (!schoolYear || !classCode) throw invalid(request.requestId);

  if (request.action === 'closeFluencyRun') {
    const result = await rpc<Record<string, unknown>>(config, 'close_fluency_run', {
      p_request_id: request.requestId,
      p_school_year: schoolYear,
      p_class_code: classCode,
      p_unit_id: unitId,
    });
    if (result?.outcome === 'conflict') throw new FluencyTeacherError('REQUEST_CONFLICT', 'Request conflicts with an earlier request.', 409, request.requestId);
    if (result?.outcome === 'invalid') throw invalid(request.requestId);
    return { requestId: request.requestId, action: request.action, data: validateCloseResult(result, request.requestId) };
  }

  if (request.action !== 'getFluencyRunProgress') throw invalid(request.requestId);
  const result = await rpc<unknown>(config, 'get_fluency_run_progress', {
    p_school_year: schoolYear,
    p_class_code: classCode,
    p_unit_id: unitId,
  });
  return {
    requestId: request.requestId,
    action: request.action,
    data: result === null ? null : validateProgress(result, request.requestId),
  };
}

function validateCloseResult(value: unknown, requestId: string): FluencyCloseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable(requestId);
  const candidate = value as Record<string, unknown>;
  const unitId = unitIdField(candidate.unitId);
  const status = typeof candidate.status === 'string' ? candidate.status : '';
  if (!unitId || !['closed', 'no-open-run'].includes(status)) throw unavailable(requestId);
  if (status === 'closed' && typeof candidate.closedAt !== 'string') throw unavailable(requestId);
  if (status === 'no-open-run' && candidate.closedAt !== null) throw unavailable(requestId);
  return {
    unitId,
    status: status as FluencyCloseResult['status'],
    closedAt: candidate.closedAt as string | null,
  };
}

async function rpc<T>(config: FluencyRunServiceConfig, name: string, body: Record<string, unknown>): Promise<T> {
  return supabaseRequest<T>(config, `rpc/${name}`, {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
}

function validateSubmittedRules(value: unknown, requestId: string): Array<{ track: Track; useDefault: boolean; rounds: [number, number, number] }> {
  if (!Array.isArray(value) || value.length !== TRACKS.length) throw invalid(requestId);
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid(requestId);
    const candidate = item as Record<string, unknown>;
    const track = (typeof candidate.track === 'string' ? candidate.track.toUpperCase() : '') as Track;
    const rounds = candidate.rounds;
    if (!TRACKS.includes(track) || seen.has(track) || typeof candidate.useDefault !== 'boolean'
      || !Array.isArray(rounds) || rounds.length !== 3) throw invalid(requestId);
    const normalized = rounds.map(Number) as [number, number, number];
    if (!normalized.every((seconds) => Number.isInteger(seconds) && seconds >= 5 && seconds <= 180)
      || normalized[0] <= normalized[1] || normalized[1] <= normalized[2]) throw invalid(requestId);
    seen.add(track);
    return { track, useDefault: candidate.useDefault, rounds: normalized };
  });
}

function validateSettings(value: unknown, requestId: string): FluencyUnitSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable(requestId);
  const candidate = value as Record<string, unknown>;
  const unitId = unitIdField(candidate.unitId);
  const title = typeof candidate.title === 'string' ? candidate.title : '';
  const promptText = candidate.promptText === null || typeof candidate.promptText === 'string' ? candidate.promptText : undefined;
  const configVersion = typeof candidate.configVersion === 'string' ? candidate.configVersion : '';
  const tracks = candidate.tracks;
  if (!unitId || !title || promptText === undefined || !configVersion || typeof candidate.active !== 'boolean'
    || typeof candidate.isNew !== 'boolean'
    || !Array.isArray(tracks) || tracks.length !== 4) throw unavailable(requestId);

  const validated = tracks.map((rule) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw unavailable(requestId);
    const item = rule as Record<string, unknown>;
    const submitted = validateSubmittedRules([{
      track: item.track,
      useDefault: item.useDefault,
      rounds: item.rounds,
    }, ...TRACKS.filter((track) => track !== item.track).map((track) => ({
      track,
      useDefault: true,
      rounds: track === 'S1' || track === 'S2' ? [35, 30, 25] : [30, 25, 20],
    }))], requestId)[0];
    if (!['globalDefault', 'unitOverride'].includes(String(item.source))) throw unavailable(requestId);
    return { ...submitted, source: String(item.source) as FluencyTrackRule['source'] };
  });
  if (new Set(validated.map((rule) => rule.track)).size !== 4) throw unavailable(requestId);
  return { unitId, title, promptText, configVersion, active: candidate.active, isNew: candidate.isNew, tracks: validated };
}

function validateProgress(value: unknown, requestId: string): FluencyRunProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable(requestId);
  const candidate = value as Record<string, unknown>;
  const unitId = unitIdField(candidate.unitId);
  if (!unitId || candidate.status !== 'open' || typeof candidate.openedAt !== 'string' || !Array.isArray(candidate.students)) {
    throw unavailable(requestId);
  }
  const seenSeats = new Set<number>();
  const students = candidate.students.map((student) => {
    if (!student || typeof student !== 'object' || Array.isArray(student)) throw unavailable(requestId);
    const item = student as Record<string, unknown>;
    const seatNumber = Number(item.seatNumber);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 60 || seenSeats.has(seatNumber) || !Array.isArray(item.rounds) || item.rounds.length !== 3) {
      throw unavailable(requestId);
    }
    seenSeats.add(seatNumber);
    const rounds = item.rounds.map((round, index) => validateRoundProgress(round, index + 1, requestId));
    return { seatNumber, rounds };
  });
  return { unitId, status: 'open', openedAt: candidate.openedAt, students };
}

function validateRoundProgress(value: unknown, expectedRound: number, requestId: string): FluencyRoundProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable(requestId);
  const item = value as Record<string, unknown>;
  if (item.round !== expectedRound || typeof item.completed !== 'boolean') throw unavailable(requestId);
  return {
    round: expectedRound,
    completed: item.completed,
    wpm: nullableMetric(item.wpm, requestId),
    pauseFlow: nullableMetric(item.pauseFlow, requestId),
    pronunciationAccuracy: nullableMetric(item.pronunciationAccuracy, requestId),
    prosody: nullableMetric(item.prosody, requestId),
  };
}

function nullableMetric(value: unknown, requestId: string): number | null {
  if (value === null) return null;
  const metric = Number(value);
  if (!Number.isFinite(metric) || metric < 0 || metric > 1_000) throw unavailable(requestId);
  return metric;
}

function unitIdField(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(normalized) ? normalized : null;
}

function textField(value: unknown, pattern: RegExp, uppercase = false): string | null {
  if (typeof value !== 'string') return null;
  const normalized = uppercase ? value.trim().toUpperCase() : value.trim();
  return pattern.test(normalized) ? normalized : null;
}

function invalid(requestId: string): FluencyTeacherError {
  return new FluencyTeacherError('INVALID_REQUEST', 'Invalid request.', 400, requestId);
}

function unavailable(requestId: string): FluencyTeacherError {
  return new FluencyTeacherError('SERVICE_UNAVAILABLE', 'Service unavailable.', 503, requestId);
}
