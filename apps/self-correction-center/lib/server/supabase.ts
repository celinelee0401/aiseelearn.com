import type { AppConfig } from './config.ts';

export class SupabaseRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function supabaseRequest<T>(config: AppConfig, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.secretKey);
  // Supabase's newer sb_secret_ keys are API keys, not JWTs. Sending one as a
  // Bearer token makes the Data API reject an otherwise valid key with 401.
  if (config.secretKey.startsWith('sb_')) {
    headers.delete('authorization');
  } else {
    headers.set('authorization', `Bearer ${config.secretKey}`);
  }
  headers.set('content-type', 'application/json');

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  const body = await response.text();

  if (!response.ok) {
    throw new SupabaseRequestError(body || '資料庫請求失敗。', response.status);
  }

  return (body ? JSON.parse(body) : null) as T;
}

export function queryPath(table: string, parameters: Record<string, string>): string {
  return `${table}?${new URLSearchParams(parameters).toString()}`;
}
