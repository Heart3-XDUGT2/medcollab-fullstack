import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { once } from 'node:events';
import { DEFAULT_BODY_TIMEOUT_MS, IMPORT_TIMEOUT_MS, SERVER_TIMEOUTS, upstreamTimeoutMs, enforceRequestBodyTimeout } from './request-timeouts.mjs';

function fixture(url = '/api/import', method = 'POST') {
  const request = Object.assign(new EventEmitter(), {
    url, method, complete: false, destroyed: false,
    destroy() { this.destroyed = true; this.emit('aborted'); this.emit('close'); },
  });
  const response = {
    headersSent: false, destroyed: false, writableEnded: false, status: null, headers: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body, callback) { this.body = body; this.writableEnded = true; callback?.(); },
    destroy() { this.destroyed = true; },
  };
  let expire, delay, clears = 0;
  const handle = { unref() {} };
  const cleanup = enforceRequestBodyTimeout(request, response, {
    setTimer: (callback, ms) => { expire = callback; delay = ms; return handle; },
    clearTimer: timer => { assert.equal(timer, handle); clears++; },
  });
  return { request, response, cleanup, expire: () => expire(), get delay() { return delay; }, get clears() { return clears; } };
}

test('server reception is bounded at 30 minutes with the existing 60-second header protection', () => {
  assert.equal(IMPORT_TIMEOUT_MS, 1800000);
  assert.equal(DEFAULT_BODY_TIMEOUT_MS, 300000);
  assert.deepEqual(SERVER_TIMEOUTS, { requestTimeout: 1800000, headersTimeout: 60000 });
});

for (const [pathname, expected] of [
  ['/api/import', 1800000], ['/api/import/', 240000], ['/api/import-extra', 240000],
  ['/api/datasets/data/instances', 240000], ['/api/datasets', 30000], ['/api/session', 30000], ['/auth/login', 30000],
]) {
  test(`upstream timeout classification preserves ${pathname}`, () => {
    assert.equal(upstreamTimeoutMs(pathname), expected);
  });
}

for (const [url, method, expected] of [
  ['/api/import', 'POST', 1800000], ['/api/import?datasetId=test', 'POST', 1800000],
  ['/api/import', 'GET', 300000], ['/api/import/', 'POST', 300000],
  ['/api/datasets', 'POST', 300000], ['http://[', 'POST', 300000],
]) {
  test(`body reception timeout classification: ${method} ${url}`, () => {
    const value = fixture(url, method);
    assert.equal(value.delay, expected);
    value.cleanup();
  });
}

for (const event of ['end', 'aborted', 'close']) {
  test(`clears its receive timer and listeners after ${event}`, () => {
    const value = fixture();
    value.request.emit(event);
    assert.equal(value.clears, 1);
    for (const name of ['end', 'aborted', 'close']) assert.equal(value.request.listenerCount(name), 0);
    value.expire();
    assert.equal(value.response.status, null);
    assert.equal(value.request.destroyed, false);
  });
}

test('an incomplete body gets 408 and connection closure, propagating cancellation to an upstream listener', () => {
  const value = fixture();
  let aborted = 0;
  value.request.on('aborted', () => aborted++);
  value.expire();
  assert.equal(value.response.status, 408);
  assert.equal(value.response.headers.Connection, 'close');
  assert.equal(value.response.headers['Cache-Control'], 'no-store');
  assert.equal(value.request.destroyed, true);
  assert.equal(aborted, 1);
  assert.equal(value.clears, 1);
});

test('does not replace a response that has already started and still closes the unfinished upload', () => {
  const value = fixture();
  value.response.headersSent = true;
  value.expire();
  assert.equal(value.response.status, null);
  assert.equal(value.request.destroyed, true);
  assert.equal(value.response.destroyed, true);
});

test('an early response does not remove the body reception bound', () => {
  const value = fixture('/api/datasets');
  value.response.writableEnded = true;
  value.expire();
  assert.equal(value.request.destroyed, true);
  assert.equal(value.response.status, null);
});

test('does not abort a fully received request that completed before its end event was consumed', () => {
  const value = fixture();
  value.request.complete = true;
  value.expire();
  assert.equal(value.request.destroyed, false);
  assert.equal(value.response.status, null);
  assert.equal(value.clears, 1);
});

test('the guard accepts smaller test-only timeouts without waiting for production durations', () => {
  const request = Object.assign(new EventEmitter(), { url: '/api/import', method: 'POST' });
  let delay;
  const cleanup = enforceRequestBodyTimeout(request, {}, { importTimeoutMs: 25, defaultTimeoutMs: 5, setTimer: (_callback, ms) => { delay = ms; return { unref() {} }; }, clearTimer() {} });
  assert.equal(delay, 25);
  cleanup();
});

test('a real unfinished request body gets a bounded 408 and the connection is cleaned up', async () => {
  let aborted = 0;
  const server = http.createServer(SERVER_TIMEOUTS, (request, response) => {
    enforceRequestBodyTimeout(request, response, { importTimeoutMs: 30, defaultTimeoutMs: 10 });
    request.on('aborted', () => aborted++);
    request.resume();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    assert.equal(server.requestTimeout, 1800000);
    assert.equal(server.headersTimeout, 60000);
    for (const pathname of ['/api/import', '/api/other']) {
      const status = await new Promise((resolve, reject) => {
        let settled = false;
        const request = http.request({
          hostname: '127.0.0.1', port: server.address().port, path: pathname,
          method: 'POST', headers: { 'Content-Length': '100' },
        }, response => {
          response.resume();
          response.on('end', () => { settled = true; request.destroy(); resolve(response.statusCode); });
        });
        request.on('error', error => { if (!settled) reject(error); });
        request.setTimeout(2000, () => request.destroy(new Error('Isolated body-timeout test stalled')));
        request.write('x');
      });
      assert.equal(status, 408);
    }
    assert.equal(aborted, 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
