import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';

test('the unified gateway serves the React teams route without swallowing protected routes', async () => {
  const repository = path.resolve(import.meta.dirname, '../../..');
  await fs.access(path.join(repository, 'frontends/portal/dist/index.html'));
  const stub = http.createServer((request, response) => {
    if (request.url.startsWith('/mask-drafts.js')) {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end('/* isolated draft-route fixture */');
      return;
    }
    if (request.url.startsWith('/auth/login')) {
      response.writeHead(302, { Location: '/isolated-auth-fixture' });
      response.end();
      return;
    }
    response.writeHead(418, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'isolated upstream fixture' }));
  });
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const javaPort = stub.address().port;
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(repository, 'gateway/unified-server.mjs')], {
    cwd: repository,
    env: { ...process.env, PORTAL_PORT: String(port), PORTAL_JAVA_PORT: String(javaPort) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(() => {
        throw new Error('Gateway fixture exited before listening');
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gateway fixture startup timed out')), 5000).unref()
      ),
    ]);
    const base = `http://127.0.0.1:${port}`;
    for (const route of ['/home', '/teams', '/teams/']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/html/);
      assert.match(await response.text(), /id="root"/);
    }
    const api = await fetch(base + '/api/nonexistent-ui-fixture');
    assert.equal(api.status, 418);
    assert.match(api.headers.get('content-type'), /application\/json/);
    const auth = await fetch(base + '/auth/login', { redirect: 'manual' });
    assert.equal(auth.status, 302);
    assert.equal(auth.headers.get('location'), '/isolated-auth-fixture');
    const signIn = await fetch(base + '/sign-in', { redirect: 'manual' });
    assert.equal(signIn.status, 302);
    assert.equal(signIn.headers.get('location'), '/auth/login');
    const drafts = await fetch(base + '/mask-drafts.js');
    assert.equal(drafts.status, 200);
    assert.match(await drafts.text(), /isolated draft-route fixture/);
    const imaging = await fetch(base + '/imaging/nonexistent-portal-ui-fixture.js');
    assert.equal(imaging.status, 404);
    assert.match(imaging.headers.get('content-type'), /application\/json/);
    const unknown = await fetch(base + '/not-a-portal-ui-route');
    assert.equal(unknown.status, 404);
    const write = await fetch(base + '/teams', { method: 'POST' });
    assert.equal(write.status, 405);
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await new Promise((resolve) => stub.close(resolve));
  }
});
