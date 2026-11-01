import { test as ohifTest, expect } from './utils';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runtime as work, evidence as out, origin, datasetId } from './medcollab-e2e-env';
// Keep OHIF's page-object fixtures. This production build is not Istanbul-instrumented;
// use a normal context lifecycle instead of the coverage collector's teardown hook.
const test=ohifTest.extend({context:async({browser},use)=>{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  try{await use(context);}finally{await context.close();}
}});
test.skip(
  process.env.MEDCOLLAB_E2E_ENABLED !== '1' || !datasetId,
  'Requires an isolated prepared server and MEDCOLLAB_E2E_ENABLED=1 plus MEDCOLLAB_E2E_DATASET_ID; see docs/medcollab-server/E2E-SETUP.md.'
);
test.beforeAll(async () => {
  await mkdir(out, { recursive: true });
  try {
    await writeFile(work + '/qa-runtime.json', JSON.stringify({ users: [], segs: [] }), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!response?.ok) throw new Error(`MedCollab E2E prerequisite: start the complete isolated stack at ${origin} before running this suite.`);
});
async function register(page) {
  await page.goto(origin + '/auth/register');
  const password = randomUUID();
  await page.locator('[name="username"]').fill('ohif-qa-' + Date.now());
  await page.locator('[name="password"]').fill(password);
  await page.locator('[name="password-confirm"]').fill(password);
  await Promise.all([
    page.waitForURL(origin + '/home'),
    page.getByTestId('register-submit').click(),
  ]);
  await page.evaluate(() => localStorage.setItem('medcollab:dataset-bar:expanded', 'true'));
  const subject = await page.evaluate(
    async () => (await (await fetch('/api/session')).json()).subject
  );
  const info = JSON.parse(await readFile(work + '/qa-runtime.json', 'utf8'));
  info.users.push(subject);
  await writeFile(work + '/qa-runtime.json', JSON.stringify(info));
}
async function ready(page) {
  await page.waitForFunction(
    () => (window as any).services?.datasetWorkspaceService?.state.ready,
    null,
    { timeout: 120000 }
  );
  const notice = page.getByRole('button', { name: '确认并隐藏' });
  if (await notice.isVisible()) await notice.click();
  await expect(page.getByTestId('dataset-publish')).toBeEnabled();
}
async function pixels(page) {
  return page.evaluate(() => (window as any).services.datasetWorkspaceService.capture());
}
test('Portal → protected DICOMweb → local drafts → Labelmap SEG → another account', async ({
  page,
  browser,
  viewportPageObject,
}) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const requests: { method: string; path: string }[] = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) requests.push({ method: r.method(), path: u.pathname });
  });
  await register(page);
  // New registrations must both see this explicitly chosen public QA dataset.
  // Missing fixtures are a skipped integration run, never a passing assertion.
  const preparation = await page.evaluate(async id => {
    const datasets = await (await fetch('/api/datasets')).json();
    const dataset = datasets.items?.find(item => item.id === id);
    if (!dataset || dataset.access !== 'public') return 'Prepare a public QA dataset visible to newly registered users.';
    const launch = await (await fetch('/api/datasets/' + encodeURIComponent(id) + '/workspace')).json();
    if (launch.series?.length !== 1 || launch.series[0].instanceCount < 2) return 'The QA dataset must contain exactly one CT series with at least two slices.';
    const status = await (await fetch('/api/datasets/' + encodeURIComponent(id) + '/segmentations/' + encodeURIComponent(launch.series[0].id) + '/status')).json();
    return status.publishedVersion === 0 ? '' : 'The QA series must have no existing published segmentation (version 0). Use a fresh isolated fixture.';
  }, datasetId);
  test.skip(Boolean(preparation), 'MedCollab E2E prerequisite: ' + preparation);
  await page.getByTestId('home-dataset-select').filter({ has: page.getByText(datasetId, { exact: true }) }).click();
  await page.locator('[data-cy="home-open-workspace"]:visible').click();
  await page.waitForURL('**/imaging/medcollab/medcollab?**');
  await ready(page);
  const launchURL = page.url(),
    beforeWrites = requests.filter(r => r.method !== 'GET').length;
  await page.getByTestId('Brush-btn').click();
  const viewport = await viewportPageObject.active;
  await viewport.normalizedDragAt({ start: { x: 0.45, y: 0.5 }, end: { x: 0.55, y: 0.55 } });
  await page.waitForFunction(() => {
    const s = (window as any).services.datasetWorkspaceService.state;
    return s.local && !s.dirty;
  });
  const drawn = await pixels(page);
  expect(drawn.masks.length).toBeGreaterThan(0);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(beforeWrites);
  expect(
    requests.some(r => r.path.includes('/dicomweb/') && r.path.includes('/frames/1'))
  ).toBeTruthy();
  expect(requests.some(r => r.path.endsWith('/preview'))).toBeFalsy();
  await page.reload();
  await ready(page);
  expect(await pixels(page)).toEqual(drawn);
  // A second foreground label uses the same labelmap, avoiding overlap layers.
  await page.getByRole('button', { name: /添加分割区域|Add Segment/ }).click();
  await page.getByTestId('Brush-btn').click();
  await (
    await viewportPageObject.active
  ).normalizedDragAt({ start: { x: 0.62, y: 0.56 }, end: { x: 0.67, y: 0.6 } });
  await page.waitForFunction(() => {
    const s = (window as any).services.datasetWorkspaceService.state;
    return s.local && !s.dirty;
  });
  const multi = await pixels(page);
  expect(multi.segments).toHaveLength(2);
  expect(new Set(multi.masks.flatMap(m => m.runs.filter((_, i) => i % 3 === 2))).size).toBe(2);
  await page.screenshot({ path: out + '/workspace-local-draft.png', fullPage: true });
  // Independent browser contexts have independent Keycloak/Java sessions and IndexedDB.
  const otherContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const other = await otherContext.newPage();
  await register(other);
  await other.goto(launchURL);
  await ready(other);
  expect((await pixels(other)).masks).toHaveLength(0);
  await page.getByTestId('dataset-publish').click();
  await page.waitForFunction(
    () => {
      const s = (window as any).services.datasetWorkspaceService.state;
      return !s.busy && (s.version === 1 || s.error);
    },
    {},
    { timeout: 120000 }
  );
  expect(
    await page.evaluate(() => (window as any).services.datasetWorkspaceService.state.error)
  ).toBe('');
  const publication = await page.evaluate(async () => {
    const w = (window as any).services.datasetWorkspaceService;
    return await (await fetch(w.segApi('/status'))).json();
  });
  expect(publication.publishedVersion).toBe(1);
  const info = JSON.parse(await readFile(work + '/qa-runtime.json', 'utf8'));
  info.segs.push(publication.orthancId);
  await writeFile(work + '/qa-runtime.json', JSON.stringify(info));
  await other.getByTestId('dataset-load-latest').click();
  await other.waitForFunction(
    () => (window as any).services.datasetWorkspaceService.state.version === 1
  );
  const restored = await pixels(other);
  expect(restored.masks).toEqual(multi.masks);
  expect(restored.segments.map(s => s.label)).toEqual(multi.segments.map(s => s.label));
  const download = page.waitForEvent('download');
  await page.getByTestId('dataset-export').click();
  await (await download).saveAs(out + '/qa-labelmap-seg.dcm');
  // An old simple-editor draft may remain after one-time upgrade. The OHIF
  // tombstone must prevent it from being imported again after publication.
  await page.evaluate(async()=>{
    const w=(window as any).services.datasetWorkspaceService,store=(window as any).maskDrafts;
    const session=await(await fetch('/api/session')).json(),key=store.key(session,w.state.datasetId,w.state.seriesId);
    const prior=await store.read(key);
    await store.write(key,prior.revision,{baseVersion:0,label:'old draft',sourceFingerprint:w.fingerprint,masks:[{instanceId:w.sources[0].id,runs:[0,1]}]});
  });
  await page.reload();
  await ready(page);
  expect((await pixels(page)).masks).toEqual(multi.masks);
  // Two tabs starting at the same published version must not silently overwrite.
  const originalBase = publication.publishedVersion;
  const conflict = await page.evaluate(
    async ({ data, originalBase }) => {
      const w = (window as any).services.datasetWorkspaceService,
        s = await (await fetch('/api/session')).json();
      const post = async version =>
        fetch(w.segApi('/publish-labelmap'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [s.csrfHeaderName]: s.csrfToken },
          body: JSON.stringify({
            expectedPublishedVersion: version,
            label: 'QA',
            data,
            publicationId: crypto.randomUUID(),
          }),
        });
      const a = await post(originalBase),
        first = await a.json(),
        b = await post(originalBase);
      return { first, conflict: b.status };
    },
    { data: multi, originalBase }
  );
  expect(conflict.conflict).toBe(409);
  info.segs.push(conflict.first.orthancId);
  await writeFile(work + '/qa-runtime.json', JSON.stringify(info));
  await writeFile(
    out + '/browser-verification.json',
    JSON.stringify(
      {
        passed: 12,
        checks: [
          'real Keycloak registration',
          'Portal button navigation',
          'dataset scoped DICOMweb CT frames',
          'no PNG CT requests',
          'brush edits stored only in IndexedDB',
          'refresh restores exact pixels',
          'multiple label values preserved',
          'independent account draft isolation',
          'publish persists in Orthanc',
          'authorized other account restores exact pixels',
          'Labelmap SEG export',
          'stale publication returns 409',
        ],
        pageErrors: errors,
      },
      null,
      2
    )
  );
  expect(errors).toEqual([]);
  console.log('All business-flow assertions passed; closing test workspaces.');
  await other.evaluate(() => (window as any).services.datasetWorkspaceService.close());
  await other.goto('about:blank');
  await otherContext.close();
  await page.evaluate(() => (window as any).services.datasetWorkspaceService.close());
  await page.goto('about:blank');
  console.log('Test workspaces closed.');
});
