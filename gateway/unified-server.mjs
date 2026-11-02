import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORTAL_PORT || 8080);
const javaPort = Number(process.env.PORTAL_JAVA_PORT || 8082);
if (![port, javaPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) || port === javaPort) throw new Error('Invalid Portal/Java ports');
const root = await fs.realpath(path.resolve(folder, '../frontends/portal/dist'));
const imagingRoot = path.resolve(folder, '../frontends/ohif/platform/app/dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm':'application/wasm', '.woff':'font/woff', '.ttf':'font/ttf' };
const proxyRoutes = /^\/(api|auth|oauth2|login\/oauth2)(\/|$)/;
// Keep the existing simple editor on the public origin so its IndexedDB stays with the unified site.
const editorRoutes = new Map([['/teams.js', '/teams.js'], ['/annotation-demo', '/index.html'], ['/mask-drafts.js', '/mask-drafts.js'], ['/segmentation.js', '/segmentation.js']]);
const spaRoutes = new Set(['/home', '/teams', '/teams/']);
const hopHeaders = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function safeHeaders(headers) {
  const result = { ...headers };
  for (const name of [...hopHeaders, ...(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]) delete result[name];
  return result;
}
const server = http.createServer(async (request, response) => {
  const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__medcollab_portal_health') return json(200, { service: 'medcollab-portal-gateway-v1', port, javaPort, pid: process.pid, workspace: 'dicomweb-labelmap-v1' });
    if (proxyRoutes.test(url.pathname) || editorRoutes.has(url.pathname)) {
      const headers = safeHeaders(request.headers);
      delete headers.forwarded;
      for (const name of Object.keys(headers)) if (name.startsWith('x-forwarded-')) delete headers[name];
      headers.host = `127.0.0.1:${port}`;
      const upstream = http.request({ hostname: '127.0.0.1', port: javaPort, path: (editorRoutes.get(url.pathname) || url.pathname) + url.search, method: request.method, headers }, incoming => {
        response.writeHead(incoming.statusCode, safeHeaders(incoming.headers));
        incoming.on('error', () => response.destroy());
        incoming.pipe(response);
      });
      const imagingRequest = url.pathname.startsWith('/api/datasets/') || url.pathname.startsWith('/api/import');
      upstream.setTimeout(imagingRequest ? 240000 : 30000, () => upstream.destroy(new Error('Upstream timeout')));
      upstream.on('error', () => {
        if (!response.headersSent && !response.destroyed) json(503, { error: 'Java 服务暂不可用，请通过一键启动入口启动服务器。' });
        else response.destroy();
      });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
      request.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'Method not allowed' });
    if (url.pathname === '/') { response.writeHead(302, { Location: '/home' + url.search, 'Cache-Control': 'no-store' }); response.end(); return; }
    if (['/sign-in', '/account/sign-in'].includes(url.pathname)) { response.writeHead(302, { Location: '/auth/login', 'Cache-Control': 'no-store' }); response.end(); return; }
    if (url.pathname === '/config.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('window.config = ' + JSON.stringify({ medcollab: { apiEnabled: true, authOrigin: `http://127.0.0.1:${port}`, logoutOrigins: ['http://127.0.0.1:8081'], workspacePath: '/workspace', publicSamplePath: null } }) + ';'); return;
    }
    if (url.pathname === '/workspace') {
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>打开医学标注工作台</title><body><p id="status">正在检查账户和影像…</p><div id="series"></div><p><a href="/home">返回首页</a></p><script src="/workspace-launch.js"></script></body></html>');return;
    }
    if (url.pathname === '/workspace-launch.js') {
      response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      response.end(await fs.readFile(path.join(folder,'workspace-launch.js')));return;
    }
    if (url.pathname === '/imaging') {response.writeHead(302,{Location:'/imaging/'+url.search});response.end();return;}
    if (url.pathname.startsWith('/imaging/')) {
      const relative=decodeURIComponent(url.pathname.slice('/imaging/'.length));
      if(relative.includes('\\')||relative.includes('\0'))return json(400,{error:'Invalid path'});
      const spa=relative===''||/^medcollab(?:\/[^/]+)?\/?$/.test(relative);
      const candidate=path.resolve(imagingRoot,spa?'index.html':relative);
      if(!candidate.startsWith(imagingRoot+path.sep))return json(403,{error:'Forbidden'});
      const filename=await fs.realpath(candidate).catch(()=>null);
      if(!filename||!filename.startsWith(imagingRoot+path.sep))return json(404,{error:'Imaging build missing'});
      const info=await fs.stat(filename);if(!info.isFile())return json(404,{error:'Not found'});
      if(spa) {
        const html=(await fs.readFile(filename,'utf8')).replace('<head>','<head><script src="/mask-drafts.js"></script>');
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(html);return;
      }
      response.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      if(request.method==='HEAD')response.end();else createReadStream(filename).on('error',()=>response.destroy()).pipe(response);return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return json(400, { error: 'Invalid path' });
    const candidate = spaRoutes.has(pathname) ? path.join(root, 'index.html') : path.resolve(root, `.${pathname}`);
    const inside = p => p.startsWith(root + path.sep);
    if (!inside(candidate)) return json(403, { error: 'Forbidden' });
    const filename = await fs.realpath(candidate).catch(() => null);
    if (!filename || !inside(filename)) return json(404, { error: 'Not found' });
    const info = await fs.stat(filename);
    if (!info.isFile()) return json(404, { error: 'Not found' });
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
  } catch { if (!response.headersSent) json(500, { error: 'Portal 入口处理失败' }); else response.destroy(); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is occupied. Run the Portal deployment launcher to move Java to ${javaPort}.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Portal: http://127.0.0.1:${port}/home; Java: 127.0.0.1:${javaPort}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
