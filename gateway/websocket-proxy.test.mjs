import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { attachCollaborationProxy } from './websocket-proxy.mjs';
const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require('../frontends/ohif/node_modules/ws');
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };

test('upgrade preserves cookies and Origin, strips spoofed forwarding headers, and transfers frames', async () => {
  const upstream = http.createServer(), gateway = http.createServer(), wss = new WebSocketServer({ noServer: true });
  let received;
  upstream.on('upgrade', (request, socket, head) => {
    received = request;
    wss.handleUpgrade(request, socket, head, ws => ws.on('message', data => ws.send(data.toString())));
  });
  const upstreamPort = await listen(upstream);
  attachCollaborationProxy(gateway, upstreamPort, 8080);
  const port = await listen(gateway);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/medcollab?datasetId=synthetic&seriesId=ct`, {
    headers: { Cookie: 'MEDICAL_DEMO_SESSION=synthetic', Origin: 'http://127.0.0.1:8080', 'X-Forwarded-User': 'forged' },
  });
  try {
    await once(ws, 'open');
    const message = once(ws, 'message'); ws.send('mask-change');
    assert.equal((await message)[0].toString(), 'mask-change');
    assert.equal(received.headers.cookie, 'MEDICAL_DEMO_SESSION=synthetic');
    assert.equal(received.headers.origin, 'http://127.0.0.1:8080');
    assert.equal(received.headers.host, '127.0.0.1:8080');
    assert.equal(received.headers['x-forwarded-user'], undefined);
    assert.equal(received.url, '/ws/medcollab?datasetId=synthetic&seriesId=ct');
  } finally {
    ws.terminate(); wss.clients.forEach(client => client.terminate());
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => gateway.close(resolve))]); wss.close();
  }
});

test('upstream authorization failures remain rejected handshakes', async () => {
  const upstream = http.createServer(), gateway = http.createServer();
  upstream.on('upgrade', (_, socket) => socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'));
  const upstreamPort = await listen(upstream); attachCollaborationProxy(gateway, upstreamPort, 8080);
  const port = await listen(gateway);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/medcollab`);
  try {
    const [, response] = await once(ws, 'unexpected-response'); assert.equal(response.statusCode, 401); response.resume();
  } finally {
    ws.on('error', () => {}); ws.terminate();
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => gateway.close(resolve))]);
  }
});
