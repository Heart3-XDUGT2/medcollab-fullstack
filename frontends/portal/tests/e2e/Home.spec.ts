import type { Page } from '@playwright/test';
import { addPortalConfiguration, expect, test } from './fixtures';

type MockSession = {
  loggedIn: boolean;
  username: string | null;
  issuer: string | null;
  subject: string | null;
  csrfToken: string;
  csrfHeaderName: string;
};

type MockDataset = {
  id: string;
  name: string;
  access: 'owner' | 'shared' | 'public';
  ownerUsername: string;
  instanceCount: number;
  createdAt: string;
};

type ApiRequest = {
  method: string;
  pathname: string;
  search: string;
  headers: Record<string, string>;
  body: string | null;
};

const sessionA: MockSession = {
  loggedIn: true,
  username: 'fixture-account-a',
  issuer: 'https://identity.example.test',
  subject: 'fixture-subject-a',
  csrfToken: 'fixture-initial-token',
  csrfHeaderName: 'X-Home-CSRF',
};

const sessionB: MockSession = {
  ...sessionA,
  username: 'fixture-account-b',
  subject: 'fixture-subject-b',
  csrfToken: 'fixture-account-b-token',
};

const signedOutSession: MockSession = {
  ...sessionA,
  loggedIn: false,
  username: null,
  issuer: null,
  subject: null,
};

const datasets: MockDataset[] = [
  {
    id: 'fixture-owner-01',
    name: 'Alpha fixture',
    access: 'owner',
    ownerUsername: 'fixture-account-a',
    instanceCount: 12,
    createdAt: '2026-10-30T00:00:00Z',
  },
  {
    id: 'fixture-shared-02',
    name: 'Bravo fixture',
    access: 'shared',
    ownerUsername: 'fixture-collaborator',
    instanceCount: 7,
    createdAt: '2026-10-29T00:00:00Z',
  },
  {
    id: 'fixture-public-03',
    name: 'Charlie fixture',
    access: 'public',
    ownerUsername: 'fixture-public',
    instanceCount: 139,
    createdAt: '2026-10-28T00:00:00Z',
  },
];

async function configureRealHome(page: Page, config: Record<string, unknown> = {}) {
  await addPortalConfiguration(page, {
    medcollab: {
      apiEnabled: true,
      authOrigin: 'https://identity.example.test',
      logoutOrigins: [],
      workspacePath: null,
      ...config,
    },
  });
}

async function mockHomeApi(
  page: Page,
  options: {
    session?: (read: number) => MockSession;
    createStatus?: number | ((write: number) => number);
    datasetList?: (read: number) => MockDataset[];
    beforeSession?: (read: number) => Promise<void>;
    beforeDatasets?: (read: number) => Promise<void>;
  } = {}
) {
  const requests: ApiRequest[] = [];
  let sessionReads = 0;
  let datasetReads = 0;
  let createWrites = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry: ApiRequest = {
      method: request.method(),
      pathname: url.pathname,
      search: url.search,
      headers: request.headers(),
      body: request.postData(),
    };
    requests.push(entry);
    let status = 200;
    let json: unknown;
    if (entry.pathname === '/api/session' && entry.method === 'GET') {
      const read = ++sessionReads;
      await options.beforeSession?.(read);
      json = options.session?.(read) || sessionA;
    } else if (entry.pathname === '/api/datasets' && entry.method === 'GET') {
      const read = ++datasetReads;
      await options.beforeDatasets?.(read);
      const items = options.datasetList?.(read) || datasets;
      json = { items, total: items.length };
    } else if (entry.pathname === '/api/health' && entry.method === 'GET') {
      json = { status: 'UP' };
    } else if (entry.method === 'GET' &&
      ['/api/me/favorite-datasets', '/api/me/favorite-datasets/state', '/api/me/recent-datasets'].includes(entry.pathname)) {
      // Keep activity unavailable in this mutation-safety fixture; real activity has its own tests.
      status = 503;
      json = { error: 'Activity intentionally unavailable in this fixture' };
    } else if (entry.pathname === '/api/datasets' && entry.method === 'POST') {
      createWrites++;
      status =
        typeof options.createStatus === 'function'
          ? options.createStatus(createWrites)
          : options.createStatus || 200;
      json = {
        ...datasets[0],
        id: 'fixture-created-04',
        name: JSON.parse(entry.body || '{}').name,
        instanceCount: 0,
        createdAt: '2026-11-01T00:00:00Z',
      };
    } else {
      status = 500;
      json = { message: 'Unexpected request in Home response fixture' };
    }
    await route.fulfill({ status, json });
  });
  return requests;
}

async function mockDocumentNavigation(page: Page, pathname: string, marker: string) {
  const documents: {
    url: string;
    method: string;
    navigation: boolean;
    resourceType: string;
  }[] = [];
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const request = route.request();
      documents.push({
        url: request.url(),
        method: request.method(),
        navigation: request.isNavigationRequest(),
        resourceType: request.resourceType(),
      });
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><h1 data-cy="portal-navigation-fixture">${marker}</h1></body></html>`,
      });
    }
  );
  return documents;
}

async function observeUncancelledRead(page: Page, pathname: string, occurrence: number | 'armed') {
  // Let a targeted response finish after cancellation to exercise the caller's stale-result guard.
  await page.addInitScript(
    ({ pathname, occurrence }) => {
      const fetch = window.fetch.bind(window);
      let reads = 0;
      (window as any).__homeFixtureReadParsed = false;
      (window as any).__homeFixtureReadArmed = false;
      window.fetch = async (input, options) => {
        const observed = input === pathname && (occurrence === 'armed'
          ? (window as any).__homeFixtureReadArmed === true : ++reads === occurrence);
        if (observed) (window as any).__homeFixtureReadArmed = false;
        const response = await fetch(input, observed ? { ...options, signal: undefined } : options);
        if (observed) {
          const json = response.json.bind(response);
          response.json = async () => {
            const value = await json();
            (window as any).__homeFixtureReadParsed = true;
            return value;
          };
        }
        return response;
      };
    },
    { pathname, occurrence }
  );
}

async function observeDemoFileAccess(page: Page, fileName: string) {
  await page.addInitScript((name) => {
    const observations = {
      active: false,
      fetches: [] as string[],
      reads: [] as string[],
    };
    (window as any).__homeUploadObservations = observations;
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (observations.active) observations.fetches.push(String(input));
      return fetch(input, options);
    };
    for (const method of ['arrayBuffer', 'text', 'stream']) {
      const original = (Blob.prototype as any)[method];
      if (typeof original !== 'function') continue;
      (Blob.prototype as any)[method] = function (this: Blob, ...args: unknown[]) {
        if (this instanceof File && this.name === name) observations.reads.push(method);
        return original.apply(this, args);
      };
    }
    for (const method of [
      'readAsArrayBuffer',
      'readAsBinaryString',
      'readAsDataURL',
      'readAsText',
    ]) {
      const original = (FileReader.prototype as any)[method];
      if (typeof original !== 'function') continue;
      (FileReader.prototype as any)[method] = function (
        this: FileReader,
        file: Blob,
        ...args: unknown[]
      ) {
        if (file instanceof File && file.name === name) observations.reads.push(method);
        return original.call(this, file, ...args);
      };
    }
  }, fileName);
}

test.describe('MedCollab home response fixtures', () => {
  test('starts unconfigured without a fabricated account, demo data, or API requests', async ({
    page,
    homePageObject: home,
  }) => {
    const requests = await mockHomeApi(page);
    await home.visit();
    await expect(home.heading).toHaveText('我的数据集');
    await expect(home.connectionState).toContainText('尚未连接影像服务');
    await expect(home.account).toHaveText('未登录');
    await expect(home.rows).toHaveCount(0);
    await expect(home.demoBanner).toBeHidden();
    await expect(home.create).toBeDisabled();
    await expect(home.upload).toBeDisabled();
    await expect(home.enterDemo).toBeVisible();
    await expect(home.images).toHaveCount(0);
    await page.getByRole('button', { name: '账号菜单', exact: true }).click();
    await expect(home.sampleUnconfigured).toBeVisible();
    await expect(home.sampleLink).toHaveCount(0);
    expect(
      (await home.navigationTargets()).some((target) => /\/(?:viewer|ohif)(?:\/|$)/.test(target))
    ).toBe(false);
    expect(requests).toEqual([]);
  });

  test('uses a configured same-origin sample anchor as an independent document entry', async ({
    page,
    homePageObject: home,
  }) => {
    await addPortalConfiguration(page, {
      medcollab: { apiEnabled: false, publicSamplePath: '/imaging/public-example' },
    });
    const requests = await mockHomeApi(page);
    const documents = await mockDocumentNavigation(
      page,
      '/imaging/public-example',
      'public-sample-navigation-fixture'
    );
    await home.visit();
    const portalOrigin = new URL(page.url()).origin;
    await page.getByRole('button', { name: '账号菜单', exact: true }).click();
    await expect(home.sampleUnconfigured).toHaveCount(0);
    await expect(home.sampleLink).toHaveJSProperty('tagName', 'A');
    await expect(home.sampleLink).toHaveAttribute('href', '/imaging/public-example');
    await home.sampleLink.click();
    await expect(home.navigationFixture).toHaveText('public-sample-navigation-fixture');
    await expect(home.root).toBeHidden();
    expect(documents).toHaveLength(1);
    expect(new URL(documents[0].url).origin).toBe(portalOrigin);
    expect(new URL(documents[0].url).pathname).toBe('/imaging/public-example');
    expect(documents[0]).toMatchObject({
      method: 'GET',
      navigation: true,
      resourceType: 'document',
    });
    expect(requests).toEqual([]);
  });

  test('opens the configured workspace as a document with an opaque business dataset ID', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page, { workspacePath: '/imaging/launch' });
    const launchDataset: MockDataset = {
      ...datasets[0],
      id: 'fixture business/id?x=1&task=annotation',
      name: 'Business launch fixture',
    };
    const requests = await mockHomeApi(page, { datasetList: () => [launchDataset] });
    const documents = await mockDocumentNavigation(
      page,
      '/imaging/launch',
      'workspace-document-navigation-fixture'
    );
    await home.visit();
    const portalOrigin = new URL(page.url()).origin;
    await expect(home.row(launchDataset.name)).toBeVisible();
    await home.selectDataset(launchDataset.name).click();
    await home.openWorkspace.click();
    await expect(home.navigationFixture).toHaveText('workspace-document-navigation-fixture');
    await expect(home.root).toBeHidden();
    expect(documents).toHaveLength(1);
    const destination = new URL(documents[0].url);
    expect(destination.origin).toBe(portalOrigin);
    expect(destination.pathname).toBe('/imaging/launch');
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      datasetId: launchDataset.id,
      access: launchDataset.access,
      intent: 'view',
      returnPath: '/home',
    });
    expect(destination.search).not.toContain(sessionA.csrfToken);
    expect(documents[0]).toMatchObject({
      method: 'GET',
      navigation: true,
      resourceType: 'document',
    });
    expect(requests.every(request => request.method === 'GET' &&
      ['/api/session', '/api/datasets', '/api/health'].includes(request.pathname))).toBe(true);
    expect(requests.filter(request => request.pathname === '/api/datasets')).toHaveLength(1);
  });

  test('enters demo explicitly and filters, searches, sorts, and selects the in-memory list', async ({
    page,
    homePageObject: home,
  }) => {
    const requests = await mockHomeApi(page);
    await home.visit();
    await home.enterDemo.click();
    await expect(home.demoBanner).toContainText('本机演示');
    await expect(home.rows).toHaveCount(12);
    await home.filterBy('owner');
    await expect(home.rows).toHaveCount(6);
    await expect(home.row('待导入的影像集')).toBeVisible();
    await home.filterBy('shared');
    await expect(home.rows).toHaveCount(4);
    await expect(home.row('协作资料（空集）')).toBeVisible();
    await home.filterBy('public');
    await expect(home.rows).toHaveCount(2);
    await home.filterBy('all');
    await home.search.fill('公共影像');
    await expect(home.rows).toHaveCount(2);
    await home.sort.selectOption('name');
    await expect(home.datasetNames).toHaveText(['CTChest 胸部 CT', 'CTPelvis 骨盆 CT']);
    await home.search.fill('not-a-fixture-match');
    await expect(home.rows).toHaveCount(0);
    await expect(home.empty).toContainText('没有匹配');
    await home.search.fill('');
    await home.sort.selectOption('newest');
    await expect(home.datasetNames.first()).toHaveText('待导入的影像集');
    await home.selectDataset('待导入的影像集').click();
    await expect(home.detail).toContainText('demo-own-empty');
    await home.openWorkspace.click();
    await expect(home.notice).toContainText('未接入工作界面');
    await expect(page).toHaveURL(/\/home(?:\?|$)/);
    expect(requests).toEqual([]);
  });

  test('returns row focus after closing rename opened directly from an unselected row menu', async ({
    page,
    homePageObject: home,
  }) => {
    const requests = await mockHomeApi(page);
    const datasetName = '待导入的影像集';
    await home.visit();
    await home.enterDemo.click();
    await expect(home.datasetNames.first()).toHaveText(datasetName);

    for (const closeMethod of ['Escape', 'cancel'] as const) {
      await expect(home.selectDataset(datasetName)).toHaveAttribute('aria-pressed', 'false');
      await expect(home.detail).toBeHidden();
      await home.moreForDataset(datasetName).click();
      await home.renameMenuItem.click();
      await home.waitForDialogSettled();
      await expect(home.nameInput).toBeFocused();
      await expect(home.nameInput).toHaveValue(datasetName);
      await home.nameInput.fill(`${datasetName} unsaved ${closeMethod}`);
      if (closeMethod === 'Escape') {
        await home.nameInput.press('Escape');
      } else {
        await home.actionCancel.click();
      }
      await expect(home.actionDialog).toBeHidden();
      await expect
        .poll(() => home.focusedDatasetControl(datasetName))
        .toMatch(/^home-dataset-(select|more)$/);
      await expect(home.selectDataset(datasetName)).toHaveAttribute('aria-pressed', 'false');
      await expect(home.detail).toBeHidden();
      await expect(home.datasetNames.first()).toHaveText(datasetName);
    }
    await expect(home.rows).toHaveCount(12);
    expect(requests).toEqual([]);
  });

  test('keeps search and selection when changing list organization or hiding details', async ({
    page,
    homePageObject: home,
  }) => {
    const requests = await mockHomeApi(page);
    await home.visit();
    await home.enterDemo.click();
    await home.search.fill('腹部');
    const selected = home.selectDataset('腹部 CT · 多器官标注集');
    await selected.click();
    await expect(home.detail).toBeVisible();
    await page.getByRole('button', { name: '显示设置', exact: true }).click();
    await page.getByLabel('资料分组', { exact: true }).selectOption('source');
    await page.keyboard.press('Escape');
    await expect(home.search).toHaveValue('腹部');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(home.detail).toBeVisible();
    await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
    await expect(home.detail).toBeHidden();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '资料清单', exact: true }).click();
    await expect(home.search).toHaveValue('腹部');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(requests).toEqual([]);
  });

  test('creates and renames only in demo memory and clears the example on logout', async ({
    page,
    homePageObject: home,
  }) => {
    const requests = await mockHomeApi(page);
    const createdName = 'fixture-memory-created';
    const renamedName = 'fixture-memory-renamed';
    await home.visit();
    await home.enterDemo.click();
    await home.create.click();
    await home.nameInput.fill(createdName);
    await home.nameSave.click();
    await expect(home.actionDialog).toBeHidden();
    await expect(home.row(createdName)).toBeVisible();
    await expect(home.rows).toHaveCount(13);
    await home.moreForDataset(createdName).click();
    await home.renameMenuItem.click();
    await expect(home.nameInput).toHaveValue(createdName);
    await home.nameInput.fill(renamedName);
    await home.nameSave.click();
    await expect(home.actionDialog).toBeHidden();
    await expect(home.row(createdName)).toHaveCount(0);
    await expect(home.row(renamedName)).toBeVisible();
    await expect(home.rows).toHaveCount(13);
    const persisted = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })
    );
    expect(persisted).not.toContain(createdName);
    expect(persisted).not.toContain(renamedName);
    await page.getByRole('button', { name: '账号菜单', exact: true }).click();
    await home.logout.click();
    await expect(home.connectionState).toContainText('尚未连接影像服务');
    await expect(home.demoBanner).toBeHidden();
    await expect(home.account).toHaveText('未登录');
    await expect(home.rows).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('renders only the dataset contract and keeps search and sort local', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    const requests = await mockHomeApi(page);
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await expect(home.account).toHaveText(sessionA.username!);
    await page.getByRole('button', { name: '对比表格', exact: true }).click();
    await expect(home.tableHeadings).toHaveText(['数据集', '创建者', '实例数', '创建时间', 'CT 共享画布', '操作']);
    await expect(home.row('Alpha fixture')).not.toContainText('fixture-owner-01');
    await expect(home.row('Alpha fixture')).toContainText('我创建的');
    await expect(home.row('Alpha fixture')).toContainText('fixture-account-a');
    await expect(home.row('Alpha fixture')).toContainText('12');
    await expect(home.datasetCreationTime('Alpha fixture')).toHaveAttribute(
      'datetime',
      datasets[0].createdAt
    );
    await expect(home.root).not.toContainText('仅自己');
    await expect(home.root).not.toContainText('修改时间');
    await home.search.fill('fixture-collaborator');
    await expect(home.datasetNames).toHaveText(['Bravo fixture']);
    await home.search.fill('');
    await home.sort.selectOption('oldest');
    await expect(home.datasetNames).toHaveText([
      'Charlie fixture',
      'Bravo fixture',
      'Alpha fixture',
    ]);
    await home.selectDataset('Alpha fixture').click();
    await expect(home.detail).toContainText('fixture-owner-01');
    await expect(home.detail).toContainText('继续共享');
    await home.openWorkspace.click();
    await expect(home.notice).toContainText('工作界面入口尚未接入');
    await expect(page).toHaveURL(/\/home(?:\?|$)/);
    expect(requests.every(request => request.method === 'GET' && request.search === '' &&
      ['/api/session', '/api/datasets', '/api/health'].includes(request.pathname))).toBe(true);
    expect(requests.filter(request => request.pathname === '/api/datasets')).toHaveLength(1);
  });

  test('refreshes the session and uses its current CSRF token for one create request', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    const freshToken = 'fixture-fresh-write-token';
    let currentToken = sessionA.csrfToken;
    const requests = await mockHomeApi(page, {
      session: () => ({ ...sessionA, csrfToken: currentToken }),
    });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('  Created by response fixture  ');
    currentToken = freshToken;
    const beforeSave = requests.length;
    await home.nameSave.click();
    await expect(home.actionDialog).toBeHidden();
    await expect(home.row('Created by response fixture')).toBeVisible();
    await expect(home.rows).toHaveCount(4);
    expect(requests.slice(beforeSave).some(request => request.pathname === '/api/session')).toBe(true);
    const writes = requests.filter((request) => request.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].pathname).toBe('/api/datasets');
    expect(writes[0].headers['x-home-csrf']).toBe(freshToken);
    expect(JSON.parse(writes[0].body!)).toEqual({ name: 'Created by response fixture' });
  });

  test('clears the old account and pending create without a write when the identity changes', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    let currentSession = sessionA;
    const requests = await mockHomeApi(page, {
      session: () => currentSession,
    });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('Old account pending name');
    currentSession = sessionB;
    const beforeSave = requests.length;
    await home.nameSave.click();
    await expect(home.notice).toContainText('登录账号已变化');
    await expect(home.actionDialog).toBeHidden();
    await expect(home.nameInput).toHaveCount(0);
    await expect(home.rows).toHaveCount(0);
    await expect(home.detail).toBeHidden();
    await expect(home.account).toHaveText('未登录');
    await expect(home.root).not.toContainText('Old account pending name');
    await expect(home.create).toBeDisabled();
    expect(requests.slice(beforeSave).some(request => request.pathname === '/api/session')).toBe(true);
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  test('does not replay a forbidden write and keeps its dialog context', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    const requests = await mockHomeApi(page, { createStatus: 403 });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('Forbidden create fixture');
    const beforeSave = requests.length;
    await home.nameSave.click();
    await expect(home.actionError).toContainText('操作未获授权');
    await expect(home.actionDialog).toBeVisible();
    await expect(home.nameInput).toHaveValue('Forbidden create fixture');
    await expect(home.create).toBeDisabled();
    await expect(home.nameSave).toBeDisabled();
    await expect(home.sessionRefresh).toBeVisible();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    expect(requests.slice(beforeSave).some(request => request.pathname === '/api/session')).toBe(true);
  });

  test('restores a forbidden dialog for the same account without automatically replaying it', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    const requests = await mockHomeApi(page, {
      createStatus: (write) => (write === 1 ? 403 : 200),
    });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('Explicitly retried fixture');
    await home.nameSave.click();
    await expect(home.actionError).toContainText('操作未获授权');
    await expect(home.nameSave).toBeDisabled();
    await home.sessionRefresh.click();
    await expect(home.rows).toHaveCount(3);
    await expect(home.actionDialog).toBeVisible();
    await expect(home.nameInput).toHaveValue('Explicitly retried fixture');
    await expect(home.nameSave).toBeEnabled();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    const beforeExplicitRetry = requests.length;
    await home.nameSave.click();
    await expect(home.actionDialog).toBeHidden();
    await expect(home.row('Explicitly retried fixture')).toBeVisible();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2);
    expect(requests.slice(beforeExplicitRetry).some(request => request.pathname === '/api/session')).toBe(true);
  });

  test('clears account A context when recovery passes through signed-out into account B', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    const accountBDataset: MockDataset = {
      ...datasets[0],
      id: 'fixture-account-b-dataset',
      name: 'Account B isolated fixture',
      ownerUsername: sessionB.username!,
    };
    let currentSession = sessionA;
    const requests = await mockHomeApi(page, {
      session: () => currentSession,
      createStatus: 403,
      datasetList: () => (currentSession === sessionB ? [accountBDataset] : datasets),
    });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('Account A pending operation');
    await home.nameSave.click();
    await expect(home.actionError).toContainText('操作未获授权');
    currentSession = signedOutSession;
    await home.sessionRefresh.click();
    await expect(home.account).toHaveText('未登录');
    await expect(home.actionDialog).toBeVisible();
    await expect(home.nameInput).toHaveValue('Account A pending operation');
    await expect(home.nameSave).toBeDisabled();
    await expect(home.rows).toHaveCount(0);
    currentSession = sessionB;
    await home.sessionRefresh.click();
    await expect(home.account).toHaveText(sessionB.username!);
    await expect(home.actionDialog).toBeHidden();
    await expect(home.notice).toContainText('当前账号已变化');
    await expect(home.rows).toHaveCount(1);
    await expect(home.row('Account B isolated fixture')).toBeVisible();
    await expect(home.row('Alpha fixture')).toHaveCount(0);
    await expect(home.root).not.toContainText('Account A pending operation');
    await home.create.click();
    await expect(home.nameInput).toHaveValue('');
    await home.actionCancel.click();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  test('requires a successful list check before retrying a write whose result is unknown', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    let releaseVerification: () => void;
    const pendingVerification = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const requests = await mockHomeApi(page, {
      createStatus: (write) => (write === 1 ? 500 : 200),
      beforeDatasets: (read) => (read === 2 ? pendingVerification : Promise.resolve()),
    });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('Unknown result fixture');
    await home.nameSave.click();
    await expect(home.actionError).toContainText('结果可能未知');
    await expect(home.actionDialog).toBeVisible();
    await expect(home.nameInput).toHaveValue('Unknown result fixture');
    await expect(home.nameSave).toBeDisabled();
    await expect(home.sessionRefresh).toBeVisible();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    await home.sessionRefresh.click();
    await expect
      .poll(
        () =>
          requests.filter(
            (request) => request.pathname === '/api/datasets' && request.method === 'GET'
          ).length
      )
      .toBe(2);
    await expect(home.nameSave).toBeDisabled();
    releaseVerification!();
    await expect(home.nameSave).toBeEnabled();
    await expect(home.nameInput).toHaveValue('Unknown result fixture');
    expect(
      requests.filter((request) => request.pathname === '/api/datasets' && request.method === 'GET')
    ).toHaveLength(2);
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    await home.nameSave.click();
    await expect(home.actionDialog).toBeHidden();
    await expect(home.row('Unknown result fixture')).toBeVisible();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2);
  });

  test('cancels a pending fresh session before it can send the create request', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    await observeUncancelledRead(page, '/api/session', 'armed');
    let releaseSession: () => void;
    const pendingSession = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    let holdSession = false;
    let heldSessionReads = 0;
    const requests = await mockHomeApi(page, {
      beforeSession: () => {
        if (holdSession) { heldSessionReads++; return pendingSession; }
        return Promise.resolve();
      },
    });
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill('Cancelled before request fixture');
    holdSession = true;
    await page.evaluate(() => { (window as any).__homeFixtureReadArmed = true; });
    await home.nameSave.click();
    await expect
      .poll(() => heldSessionReads)
      .toBeGreaterThanOrEqual(1);
    await expect(home.nameInput).toBeDisabled();
    await expect(home.nameSave).toBeDisabled();
    await expect(home.actionCancel).toBeEnabled();
    await home.actionCancel.click();
    await expect(home.actionDialog).toBeHidden();
    await expect(home.notice).toContainText('已停止等待操作');
    const lateSession = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/session'
    );
    releaseSession!();
    await (await lateSession).finished();
    await page.waitForFunction(() => (window as any).__homeFixtureReadParsed === true);
    await home.waitForNextPaint();
    await expect(home.rows).toHaveCount(3);
    await expect(home.row('Cancelled before request fixture')).toHaveCount(0);
    await expect(home.create).toBeEnabled();
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  test('locks a name during a pending write and preserves it for editing after failure', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    let releaseSession: () => void;
    const pendingSession = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    let holdSession = false;
    let heldSessionReads = 0;
    const requests = await mockHomeApi(page, {
      createStatus: 403,
      beforeSession: () => {
        if (holdSession) { heldSessionReads++; return pendingSession; }
        return Promise.resolve();
      },
    });
    const pendingName = 'Slow request name fixture';
    await home.visit();
    await expect(home.rows).toHaveCount(3);
    await home.create.click();
    await home.nameInput.fill(pendingName);
    holdSession = true;
    await home.nameSave.click();
    await expect
      .poll(() => heldSessionReads)
      .toBeGreaterThanOrEqual(1);
    await expect(home.nameInput).toBeDisabled();
    await expect(home.nameInput).toHaveValue(pendingName);
    await expect(home.actionCancel).toBeEnabled();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
    releaseSession!();
    await expect(home.actionError).toContainText('操作未获授权');
    await expect(home.nameInput).toBeEnabled();
    await expect(home.nameInput).toHaveValue(pendingName);
    await expect(home.nameSave).toBeDisabled();
    await home.nameInput.fill('Preserved context can be edited');
    await expect(home.nameInput).toHaveValue('Preserved context can be edited');
    await expect(home.actionDialog).toBeVisible();
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  test('selects a demo upload without fetching, reading file contents, or enabling import', async ({
    page,
    homePageObject: home,
  }) => {
    const fileName = 'fixture-demo-upload.dcm';
    await observeDemoFileAccess(page, fileName);
    const requests = await mockHomeApi(page);
    await home.visit();
    await home.enterDemo.click();
    await home.upload.click();
    await expect(home.uploadStart).toBeDisabled();
    await page.evaluate(() => {
      (window as any).__homeUploadObservations.active = true;
    });
    await home.uploadName.fill('Demo upload must stay local');
    await home.uploadFiles.setInputFiles({
      name: fileName,
      mimeType: 'application/dicom',
      buffer: Buffer.from('DICM-fixture-demo-content'),
    });
    await expect(home.actionDialog).toContainText(fileName);
    await expect(home.uploadStart).toBeDisabled();
    await home.waitForNextPaint();
    const observations = await page.evaluate(() => (window as any).__homeUploadObservations);
    expect(observations.reads).toEqual([]);
    expect(observations.fetches).toEqual([]);
    expect(requests).toEqual([]);
    await home.actionClose.click();
    await expect(home.actionDialog).toBeHidden();
  });

  test('requires selection and confirmation before changing the demo share list in memory', async ({
    page,
    homePageObject: home,
  }) => {
    const requests = await mockHomeApi(page);
    const datasetName = '待导入的影像集';
    const username = '示例协作者 A';
    await home.visit();
    await home.enterDemo.click();
    await home.moreForDataset(datasetName).click();
    await home.shareMenuItem.click();
    await expect(home.shareMembers).toHaveCount(0);
    await expect(home.shareAdd).toBeDisabled();
    await home.shareSearch.fill('示例');
    await home.shareSearchSubmit.click();
    await expect(home.userResults).toHaveCount(2);
    await home.userResult(username).click();
    await expect(home.shareMembers).toHaveCount(0);
    await expect(home.userResult(username)).toHaveAttribute('aria-pressed', 'true');
    await expect(home.shareAdd).toBeEnabled();
    await home.shareAdd.click();
    await expect(home.shareMember(username)).toBeVisible();
    await expect(home.shareNotice).toContainText('未保存到云端');
    await expect(home.shareAdd).toBeDisabled();
    await home.actionClose.click();
    await expect(home.actionDialog).toBeHidden();
    await home.moreForDataset(datasetName).click();
    await home.shareMenuItem.click();
    await expect(home.shareMember(username)).toBeVisible();
    await expect(home.shareMember(username)).toContainText('不可撤销');
    await expect(home.shareRemove(username)).toHaveCount(0);
    await expect(home.shareRemoveConfirm).toHaveCount(0);
    await expect(home.shareMembers).toHaveCount(1);
    await home.shareSearch.fill('示例');
    await home.shareSearchSubmit.click();
    await expect(home.userResult(username)).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('does not let a late real-list response overwrite an explicitly entered demo', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    await observeUncancelledRead(page, '/api/datasets', 1);
    let releaseDatasets: () => void;
    const pendingDatasets = new Promise<void>((resolve) => {
      releaseDatasets = resolve;
    });
    const requests = await mockHomeApi(page, { beforeDatasets: () => pendingDatasets });
    await home.visit();
    await expect
      .poll(() => requests.filter((request) => request.pathname === '/api/datasets').length)
      .toBe(1);
    await home.enterDemo.click();
    await expect(home.demoBanner).toBeVisible();
    await expect(home.rows).toHaveCount(12);
    const lateResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/datasets'
    );
    releaseDatasets!();
    await (await lateResponse).finished();
    await page.waitForFunction(() => (window as any).__homeFixtureReadParsed === true);
    await home.waitForNextPaint();
    await expect(home.datasetNames).toContainText(['待导入的影像集']);
    await expect(home.row('Alpha fixture')).toHaveCount(0);
    await expect(home.account).toHaveText('示例空间');
    await expect(home.rows).toHaveCount(12);
  });

  test('opens mobile details immediately and restores row focus without moving the list', async ({
    page,
    homePageObject: home,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests = await mockHomeApi(page);
    await home.visit();
    await home.enterDemo.click();
    const trigger = home.selectDataset('CTPelvis 骨盆 CT');
    await trigger.scrollIntoViewIfNeeded();
    const before = await home.scrollPosition();
    expect(before.y).toBeGreaterThan(0);
    await trigger.click();
    await expect(home.detail).toBeVisible();
    await expect(home.detail).toHaveAttribute('role', 'dialog');
    await expect(home.detail).toContainText('public-ctpelvis');
    await home.waitForDialogSettled(home.detail);
    await expect.poll(() => home.detailContainsFocus()).toBe(true);
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press('Tab');
      await expect.poll(() => home.detailContainsFocus()).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => home.detailContainsFocus()).toBe(true);
    await home.detailClose.click();
    await expect(home.detail).toBeHidden();
    await expect(trigger).toBeFocused();
    await home.waitForNextPaint();
    const after = await home.scrollPosition();
    expect(after.x).toBe(before.x);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await trigger.press('Enter');
    await expect(home.detail).toBeVisible();
    await home.detailClose.press('Escape');
    await expect(home.detail).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(requests).toEqual([]);
  });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`keeps the demo list and dialogs usable at ${viewport.width}px`, async ({
      page,
      homePageObject: home,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const requests = await mockHomeApi(page);
      await home.visit();
      await home.enterDemo.click();
      await expect(home.rows).toHaveCount(12);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBe(true);
      for (const control of [home.create, home.upload, home.search, home.sort, home.refresh]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        if (viewport.width === 390) {
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
      }
      await testInfo.attach(`home-demo-${viewport.width}`, {
        body: await home.root.screenshot(),
        contentType: 'image/png',
      });
      if (viewport.width <= 768) {
        await expect(page.getByTestId('home-entry-library')).toBeVisible();
        await expect(page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true })).toBeVisible();
        await expect(home.filterControl('owner')).toBeVisible();
        if (viewport.width === 390) {
          for (const control of [
            page.getByTestId('home-entry-library'),
            home.filterControl('owner'),
          ]) {
            const box = await control.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.width).toBeGreaterThanOrEqual(44);
          }
        }
        await home.filterControl('owner').focus();
        await page.keyboard.press('Enter');
        await expect(home.rows).toHaveCount(6);
      }
      await home.create.click();
      await home.waitForDialogSettled();
      await expect
        .poll(() =>
          home.actionDialog.evaluate((element) => getComputedStyle(element).animationName)
        )
        .toBe('none');
      const dialogBox = await home.actionDialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width === 390) {
        for (const control of [
          home.nameInput,
          home.nameSave,
          home.actionCancel,
          home.actionClose,
        ]) {
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
      }
      await testInfo.attach(`home-create-${viewport.width}`, {
        body: await home.actionDialog.screenshot(),
        contentType: 'image/png',
      });
      await home.actionCancel.click();
      await expect(home.actionDialog).toBeHidden();
      expect(requests).toEqual([]);
    });
  }
});

test.describe('MedCollab unified-account navigation fixtures', () => {
  test('keeps an unconfigured SSO entry separate from the password-form preview', async ({
    page,
    homePageObject: home,
    signInPageObject: signIn,
  }) => {
    const requests = await mockHomeApi(page);
    await home.visitSso();
    await expect(home.ssoInputs).toHaveCount(0);
    await expect(home.ssoLogin).toBeDisabled();
    await expect(home.ssoRegister).toBeDisabled();
    await expect(home.ssoStatus).toContainText('账号服务尚未接入');
    await home.ssoHome.click();
    await expect(home.heading).toHaveText('工作首页');
    await home.visitSso();
    await home.ssoPreview.click();
    await expect(signIn.root).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    expect(requests).toEqual([]);
  });

  test('navigates to configured login and registration without a local credential request', async ({
    page,
    homePageObject: home,
  }) => {
    await configureRealHome(page);
    const requests = await mockHomeApi(page);
    const navigations: { pathname: string; method: string; navigation: boolean }[] = [];
    await page.route('https://identity.example.test/auth/**', async (route) => {
      const request = route.request();
      navigations.push({
        pathname: new URL(request.url()).pathname,
        method: request.method(),
        navigation: request.isNavigationRequest(),
      });
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Controlled authentication navigation fixture</title>',
      });
    });
    await home.visitSso();
    await expect(home.ssoInputs).toHaveCount(0);
    await expect(home.ssoLogin).toHaveAttribute('href', 'https://identity.example.test/auth/login');
    await expect(home.ssoRegister).toHaveAttribute(
      'href',
      'https://identity.example.test/auth/register'
    );
    await home.ssoLogin.click();
    await expect(page).toHaveURL('https://identity.example.test/auth/login');
    await home.visitSso();
    await home.ssoRegister.click();
    await expect(page).toHaveURL('https://identity.example.test/auth/register');
    expect(navigations).toEqual([
      { pathname: '/auth/login', method: 'GET', navigation: true },
      { pathname: '/auth/register', method: 'GET', navigation: true },
    ]);
    expect(requests).toEqual([]);
  });
});
