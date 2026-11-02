import http from 'node:http';

/** Java remains the only identity and room authority. */
export function attachCollaborationProxy(server, javaPort, publicPort) {
  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1'); }
    catch { socket.destroy(); return; }
    if (url.pathname !== '/ws/medcollab' || request.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
    }
    const headers = { ...request.headers, host: `127.0.0.1:${publicPort}` };
    delete headers.forwarded;
    for (const name of Object.keys(headers)) if (name.startsWith('x-forwarded-')) delete headers[name];
    const upstream = http.request({ hostname: '127.0.0.1', port: javaPort, path: url.pathname + url.search, method: 'GET', headers });
    upstream.setTimeout(30_000, () => upstream.destroy());
    let peer;
    const stop = () => { upstream.destroy(); peer?.destroy(); socket.destroy(); };
    socket.on('error', stop);socket.on('close', () => { upstream.destroy(); peer?.destroy(); });
    upstream.on('error', () => { if (!socket.destroyed) socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); });
    upstream.on('response', response => {
      const status = [401,403,404,429].includes(response.statusCode) ? response.statusCode : 502;
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);response.resume();
    });
    upstream.on('upgrade', (response, incoming, incomingHead) => {
      peer=incoming;upstream.setTimeout(0);incoming.setTimeout(0);socket.setTimeout(0);
      incoming.on('error',stop);incoming.on('close',()=>socket.destroy());
      const responseHeaders=[];
      for(let i=0;i<response.rawHeaders.length;i+=2) responseHeaders.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i+1]}`);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders.join('\r\n')}\r\n\r\n`);
      if(incomingHead.length) socket.write(incomingHead);
      if(head.length) incoming.write(head);
      incoming.pipe(socket);socket.pipe(incoming);
    });
    upstream.end();
  });
}
