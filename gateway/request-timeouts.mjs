export const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_BODY_TIMEOUT_MS = 5 * 60 * 1000;
export const SERVER_TIMEOUTS = Object.freeze({
  requestTimeout: IMPORT_TIMEOUT_MS,
  headersTimeout: 60 * 1000,
});

export function upstreamTimeoutMs(pathname) {
  if (pathname === '/api/import') return IMPORT_TIMEOUT_MS;
  return pathname.startsWith('/api/datasets/') || pathname.startsWith('/api/import')
    ? 240000
    : 30000;
}

export function enforceRequestBodyTimeout(request, response, {
  importTimeoutMs = IMPORT_TIMEOUT_MS,
  defaultTimeoutMs = DEFAULT_BODY_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let pathname;
  try { pathname = new URL(request.url, 'http://gateway.invalid').pathname; } catch { /* Malformed requests keep the shorter limit. */ }
  const timeout = request.method === 'POST' && pathname === '/api/import'
    ? importTimeoutMs
    : defaultTimeoutMs;
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    clearTimer(timer);
    for (const event of ['end', 'aborted', 'close']) request.removeListener(event, cleanup);
  };
  const timer = setTimer(() => {
    if (!active) return;
    cleanup();
    if (request.complete || request.destroyed) return;
    if (!response.headersSent && !response.destroyed && !response.writableEnded) {
      response.writeHead(408, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      response.end(JSON.stringify({ error: '请求体接收超时，请核对操作结果，不会自动重试。' }), () => request.destroy());
    } else {
      request.destroy();
      if (!response.destroyed) response.destroy();
    }
  }, timeout);
  timer.unref?.();
  for (const event of ['end', 'aborted', 'close']) request.once(event, cleanup);
  return cleanup;
}
