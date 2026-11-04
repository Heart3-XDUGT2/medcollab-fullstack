import type { APIRequestContext } from '@playwright/test';

const paths = [
  /^\/api\/(?:health|session|datasets|teams)$/,
  /^\/api\/teams\/[^/]+(?:\/(?:datasets|members))?$/,
  /^\/api\/datasets\/[^/]+\/(?:annotation-stats|workspace)$/,
];
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export function liveOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      'Live target must be an explicit HTTP(S) origin without credentials or parameters.'
    );
  }
}

/** Browser-context cookies stay in Playwright; the probe cannot invoke a write or follow an API redirect. */
export function readOnlyFetch(
  origin: string,
  request: Pick<APIRequestContext, 'get'>
): typeof fetch {
  const trusted = liveOrigin(origin);
  return async (input, init) => {
    if (input instanceof Request) throw new Error('Live probe accepts only explicit API paths.');
    const url = new URL(String(input), trusted);
    if (
      url.origin !== trusted ||
      url.search ||
      url.hash ||
      !paths.some((pattern) => pattern.test(url.pathname)) ||
      (init?.method || 'GET').toUpperCase() !== 'GET' ||
      init?.body != null
    ) {
      throw new Error('Live probe refused a request outside its read-only allowlist.');
    }
    if (init?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    let response;
    try {
      response = await request.get(url.href, {
        maxRedirects: 0,
        timeout: url.pathname.endsWith('/annotation-stats') ? 150000 : 15000,
        headers: { ...Object.fromEntries(new Headers(init?.headers)), 'Cache-Control': 'no-store' },
      });
    } catch {
      throw new Error(
        'Live API transport did not complete; no response body or credentials were recorded.'
      );
    }
    if (init?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    try {
      const body = await response.body();
      if (body.byteLength > MAX_JSON_BYTES) throw new Error();
      return new Response(new Uint8Array(body), {
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
      });
    } catch {
      throw new Error('Live JSON response could not be read within the probe limit.');
    } finally {
      await response.dispose();
    }
  };
}
