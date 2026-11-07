import { RealtimeClient } from './realtimeClient';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
const datasetId = 'dataset /中文?&';
const seriesId = 'series+#=/';
let browser: any;
let socketConstructor: jest.Mock;
let clients: RealtimeClient[];

beforeEach(() => {
  browser = {
    location: { href: 'https://viewer.example/imaging/medcollab?datasetId=page-only' },
    config: {},
    localStorage: { getItem: jest.fn(() => 'true') },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  socketConstructor = jest.fn(() => ({ close: jest.fn() }));
  clients = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: socketConstructor });
});

afterEach(() => {
  clients.forEach(client => client.destroy(false));
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as any).window;
  if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket);
  else delete (globalThis as any).WebSocket;
});

function connect() {
  const onState = jest.fn();
  const client = new RealtimeClient({ datasetId, seriesId, clientId: 'url-test-client', onState });
  clients.push(client);
  client.connect();
  return onState;
}

function openedUrl(): URL {
  expect(socketConstructor).toHaveBeenCalledTimes(1);
  return socketConstructor.mock.calls[0][0];
}

function expectScope(url: URL) {
  expect(url.searchParams.getAll('datasetId')).toEqual([datasetId]);
  expect(url.searchParams.getAll('seriesId')).toEqual([seriesId]);
}

test.each([
  ['http:', 'ws:'],
  ['https:', 'wss:'],
  ['ws:', 'ws:'],
  ['wss:', 'wss:'],
])('configured %s connects with %s without changing the endpoint', (input, expected) => {
  browser.config.medcollabRealtime = {
    url: `${input}//socket.example:8443/custom/socket?keep=one&keep=two&datasetId=old&datasetId=duplicate&seriesId=old`,
  };
  connect();
  const url = openedUrl();
  expect(url.protocol).toBe(expected);
  expect(url.host).toBe('socket.example:8443');
  expect(url.pathname).toBe('/custom/socket');
  expect(url.searchParams.getAll('keep')).toEqual(['one', 'two']);
  expectScope(url);
});

test.each([
  ['http://viewer.example:8080/imaging/medcollab?unrelated=page', 'ws:'],
  ['https://viewer.example:8443/imaging/medcollab?unrelated=page', 'wss:'],
])('default endpoint stays same-origin for %s', (href, expected) => {
  browser.location.href = href;
  connect();
  const url = openedUrl();
  expect(url.protocol).toBe(expected);
  expect(url.host).toBe(new URL(href).host);
  expect(url.pathname).toBe('/ws/medcollab');
  expect(url.searchParams.has('unrelated')).toBe(false);
  expectScope(url);
});

test('configured relative endpoint preserves its path and query on the current HTTPS origin', () => {
  browser.config.medcollabRealtime = { url: '/custom/realtime?keep=value&seriesId=old' };
  connect();
  const url = openedUrl();
  expect(url.protocol).toBe('wss:');
  expect(url.host).toBe('viewer.example');
  expect(url.pathname).toBe('/custom/realtime');
  expect(url.searchParams.get('keep')).toBe('value');
  expectScope(url);
});

test.each(['ftp://socket.example/ws', 'file:///tmp/socket', 'javascript:alert(1)', 'data:text/plain,socket'])(
  'rejects unsupported configured URL %s before constructing a socket',
  configured => {
    browser.config.medcollabRealtime = { url: configured };
    const onState = connect();
    expect(socketConstructor).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith({
      status: 'error', members: [], activities: [], error: '实时协作地址无效',
    });
  }
);
