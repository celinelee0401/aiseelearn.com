export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function configurationRequired(): Response {
  return json({ error: '尚未完成資料庫設定，請稍後再試。', code: 'CONFIGURATION_REQUIRED' }, 503);
}
