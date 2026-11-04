import { expect, test } from '@playwright/test';
import { liveOrigin, readOnlyFetch } from './read-only-transport';

const target = process.env.PORTAL_LIVE_BASE_URL;
test.skip(!target, 'Explicit live target is required; this suite never starts a service.');
const origin = target ? liveOrigin(target) : '';
async function safely<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(`${label} failed; sensitive responses are not included in this report.`);
  }
}

test('runtime and public capability agree with the Portal contract', async ({ page, context }) => {
  try {
    await safely('Portal entry', () => page.goto(origin + '/home'));
    const raw = await page.evaluate(() => (window as any).config?.medcollab);
    expect(
      raw?.apiEnabled === true,
      'A preview with API disabled is not a real integration target.'
    ).toBe(true);
    expect(
      raw?.authOrigin === origin,
      'Authentication must use the coordinated public origin.'
    ).toBe(true);
    expect(
      raw?.workspacePath === '/workspace',
      'Workspace launch must use the controlled launch route.'
    ).toBe(true);
    const health = await safely('Public capability', async () => {
      const response = await readOnlyFetch(origin, context.request)('/api/health');
      if (response.status !== 200) throw new Error();
      return response.json();
    });
    expect(
      health.annotationStatsApi === 'v1',
      'The running backend does not advertise statistics v1.'
    ).toBe(true);
    expect(
      health.teamApi === 'team-library-v1',
      'The running team API is not the expected contract.'
    ).toBe(true);
  } catch {
    await context.close().catch(() => {});
    throw new Error(
      'Live public capability check failed; the page was closed without retaining private DOM.'
    );
  }
});
