import {
  test,
  expect,
} from "../../frontends/portal/node_modules/@playwright/test/index.js";
import type {
  BrowserContext,
  Page,
} from "../../frontends/portal/node_modules/@playwright/test/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createHomeApi,
  identityOf,
} from "../../frontends/portal/src/features/home/api";
import { createStatisticsApi } from "../../frontends/portal/src/features/home/statistics/api";
import {
  liveOrigin,
  readOnlyFetch,
} from "../../frontends/portal/tests/integration/read-only-transport";

type User = { username: string; subject: string };
type Stack = {
  schemaVersion: number;
  projectName: string;
  runtimeRoot: string;
  sourceRoot: string;
  urls: { portal: string; java: string; keycloak: string; orthanc: string };
  realm: string;
  issuer: string;
  users: { a: User; b: User };
  paths: { credentials: string; dicomManifest: string };
  dicomFiles: string[];
};
const manifestPath = process.env.PORTAL_STACK_MANIFEST;
test.skip(
  !manifestPath,
  "Root must explicitly select the independently prepared integration stack.",
);
const protectedPorts = new Set([
  "8080",
  "8081",
  "8082",
  "8042",
  "60833",
  "61037",
]);
const inside = (root: string, value: string) =>
  value.toLowerCase().startsWith(root.toLowerCase() + path.sep);
const check = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
};
async function setup() {
  check(
    !!manifestPath && path.isAbsolute(manifestPath),
    "An absolute integration manifest is required.",
  );
  const manifest = JSON.parse(
    await fs.readFile(manifestPath!, "utf8"),
  ) as Stack;
  check(
    manifest.schemaVersion === 1 &&
      manifest.projectName === "medcollab-work-home-integration",
    "The selected stack is not the isolated integration project.",
  );
  const runtime = await fs.realpath(manifest.runtimeRoot);
  check(
    (await fs.realpath(path.dirname(manifestPath!))) === runtime,
    "Manifest location differs from the prepared runtime.",
  );
  check(
    runtime.includes(`${path.sep}.runtime${path.sep}integration${path.sep}`),
    "Runtime is outside the integration boundary.",
  );
  check(
    (await fs.realpath(manifest.sourceRoot)) !==
      (await fs.realpath(process.cwd())),
    "The original checkout cannot be the integration build root.",
  );
  const origins = Object.values(manifest.urls).map((value) =>
    liveOrigin(value),
  );
  check(
    new Set(origins).size === 4,
    "Stack services must use distinct origins.",
  );
  for (const value of origins) {
    const url = new URL(value);
    check(
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
        !!url.port &&
        !protectedPorts.has(url.port),
      "Live writes are restricted to independent loopback ports.",
    );
  }
  check(
    manifest.issuer === `${manifest.urls.keycloak}/realms/${manifest.realm}`,
    "The prepared OIDC issuer is not isolated.",
  );
  const credentialsPath = await fs.realpath(manifest.paths.credentials);
  check(
    inside(runtime, credentialsPath),
    "Credentials must stay inside the private integration runtime.",
  );
  const credentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
  for (const slot of ["a", "b"] as const) {
    check(
      credentials.users?.[slot]?.username === manifest.users[slot].username &&
        typeof credentials.users[slot].password === "string" &&
        credentials.users[slot].password.length > 0,
      "Prepared test credentials are incomplete.",
    );
  }
  const fixturePath = await fs.realpath(manifest.paths.dicomManifest);
  check(
    inside(runtime, fixturePath),
    "Synthetic fixture manifest is outside the prepared runtime.",
  );
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  check(
    fixture.synthetic === true &&
      fixture.totalSlices === 2 &&
      fixture.rows === 16 &&
      fixture.columns === 16 &&
      manifest.dicomFiles.length === 2,
    "Only the explicitly synthetic two-frame fixture is accepted.",
  );
  for (const filename of manifest.dicomFiles) {
    const resolved = await fs.realpath(filename);
    const stat = await fs.stat(resolved);
    check(
      inside(runtime, resolved) &&
        stat.isFile() &&
        stat.size > 0 &&
        stat.size < 64 * 1024 * 1024,
      "Synthetic upload fixture is outside the bounded runtime.",
    );
  }
  return { manifest, credentials };
}
function api(context: BrowserContext, manifest: Stack) {
  return createHomeApi(
    {
      apiEnabled: true,
      authOrigin: manifest.urls.portal,
      logoutOrigins: [manifest.urls.keycloak],
      workspacePath: "/workspace",
      publicSamplePath: null,
    },
    readOnlyFetch(manifest.urls.portal, context.request),
  );
}
async function login(
  page: Page,
  context: BrowserContext,
  manifest: Stack,
  slot: "a" | "b",
  password: string,
) {
  await page.goto(manifest.urls.portal + "/home?view=library");
  await page
    .getByRole("link", { name: "使用平台账号登录", exact: true })
    .click();
  await page.waitForURL((url) => url.origin === manifest.urls.keycloak);
  check(
    new URL(page.url()).pathname.includes(`/realms/${manifest.realm}/`),
    "Login reached a different realm.",
  );
  const action = await page.locator("#kc-form-login").getAttribute("action");
  check(
    !!action && new URL(action, page.url()).origin === manifest.urls.keycloak,
    "Login form target is not the isolated issuer.",
  );
  await page.locator("#username").fill(manifest.users[slot].username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL(
    (url) => url.origin === manifest.urls.portal && url.pathname === "/home",
  );
  await page.getByTestId("home-entry-library").click();
  await expect
    .poll(
      async () => {
        const session = await api(context, manifest).getSession();
        return (
          session.loggedIn &&
          session.issuer === manifest.issuer &&
          session.subject === manifest.users[slot].subject
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
}
async function readCoverage(
  context: BrowserContext,
  manifest: Stack,
  datasetId: string,
  annotated = 0,
) {
  const home = api(context, manifest);
  const identity = identityOf(await home.getSession());
  check(!!identity, "Coverage requires a real authenticated session.");
  const stats = createStatisticsApi({
    identity: identity!,
    sessionApi: home,
    fetchImpl: readOnlyFetch(manifest.urls.portal, context.request),
  });
  const signal = new AbortController().signal;
  check(
    await stats.capability(signal),
    "Running backend does not advertise statistics v1.",
  );
  await stats.verifyIdentity(signal);
  const data = await stats.read({ type: "dataset", datasetId }, signal);
  await stats.verifyIdentity(signal);
  check(
    "progress" in data &&
      "publishedProgress" in data &&
      data.progress.totalSlices === 2 &&
      data.progress.annotatedSlices === annotated &&
      data.progress.ratio === annotated / 2 &&
      data.progress.percent === annotated * 50 &&
      data.publishedProgress.totalSlices === 2 &&
      data.publishedProgress.annotatedSlices === annotated &&
      data.publishedProgress.ratio === annotated / 2 &&
      data.publishedProgress.percent === annotated * 50,
    "Synthetic source coverage did not match the real imported CT frames.",
  );
}
async function publishOneSyntheticPixel(
  context: BrowserContext,
  manifest: Stack,
  datasetId: string,
) {
  const base = `${manifest.urls.portal}/api/datasets/${encodeURIComponent(datasetId)}`;
  const sourceResponse = await context.request.get(
    `${base}/segmentation/sources`,
    { maxRedirects: 0 },
  );
  check(sourceResponse.status() === 200, "Normal source-frame lookup failed.");
  const sources = await sourceResponse.json();
  await sourceResponse.dispose();
  check(
    sources.total === 2 &&
      Array.isArray(sources.items) &&
      sources.items.length === 2 &&
      sources.items.every(
        (item: any) =>
          typeof item.id === "string" &&
          typeof item.seriesId === "string" &&
          item.rows === 16 &&
          item.columns === 16,
      ) &&
      sources.items[0].seriesId === sources.items[1].seriesId,
    "Publication requires exactly the two prepared synthetic source frames.",
  );
  const seriesPath = `${base}/segmentations/${encodeURIComponent(sources.items[0].seriesId)}`;
  const statusResponse = await context.request.get(`${seriesPath}/status`, {
    maxRedirects: 0,
  });
  check(
    statusResponse.status() === 200,
    "Normal publication baseline lookup failed.",
  );
  const baseline = await statusResponse.json();
  await statusResponse.dispose();
  check(
    baseline.publishedVersion === 0,
    "The newly created synthetic dataset must have no prior publication.",
  );
  const session = await api(context, manifest).getSession();
  check(
    session.loggedIn &&
      session.issuer === manifest.issuer &&
      session.subject === manifest.users.a.subject,
    "Publication identity no longer matches account A.",
  );
  const response = await context.request.post(
    `${seriesPath}/publish-labelmap`,
    {
      maxRedirects: 0,
      timeout: 150000,
      headers: {
        [session.csrfHeaderName]: session.csrfToken,
        "X-Medcollab-Issuer": session.issuer!,
        "X-Medcollab-Subject": session.subject!,
      },
      data: {
        expectedPublishedVersion: baseline.publishedVersion,
        publicationId: randomUUID(),
        label: "Synthetic integration",
        data: {
          segments: [
            { number: 1, label: "Synthetic region", color: [255, 80, 80] },
          ],
          masks: [{ instanceId: sources.items[0].id, runs: [0, 1, 1] }],
        },
      },
    },
  );
  // An unknown POST outcome fails this run; no automatic publication replay.
  check(
    response.status() === 200,
    "Normal synthetic Labelmap publication was not confirmed.",
  );
  const published = await response.json();
  await response.dispose();
  check(
    published.publishedVersion === 1 &&
      published.seriesId === sources.items[0].seriesId,
    "Synthetic Labelmap publication receipt did not match its baseline.",
  );
  const after = identityOf(await api(context, manifest).getSession());
  check(
    after?.issuer === session.issuer && after?.subject === session.subject,
    "Publication account changed before verification.",
  );
}

async function verifyNonzeroPage(page: Page, manifest: Stack, name: string) {
  await page.goto(manifest.urls.portal + "/home?view=library");
  await page.getByRole("button", { name: "资料清单", exact: true }).click();
  await page.getByTestId("home-display-preferences").click();
  await page
    .getByTestId("home-display-preferences-panel")
    .getByRole("radio", { name: "紧凑", exact: true })
    .check();
  await page.keyboard.press("Escape");
  const row = page.getByTestId("home-dataset-row").filter({ hasText: name });
  const coverage = row.getByTestId("dataset-coverage");
  await expect(coverage).toHaveAttribute("data-status", "ready", {
    timeout: 30000,
  });
  await expect(coverage.getByTestId("coverage-summary")).toContainText(
    "CT 共享画布 50%",
  );
  await expect(coverage.getByTestId("coverage-summary")).toContainText(
    "已归档 50%",
  );
  await coverage.getByTestId("coverage-summary").click();
  for (const label of ["共享画布", "已归档"]) {
    await expect(
      coverage.locator(".mc-coverage-line").filter({
        has: page.locator(".mc-coverage-label", { hasText: label }),
      }),
    ).toContainText("1 / 2 帧");
  }
  await row.getByTestId("home-dataset-select").click();
  const detail = page
    .getByTestId("home-detail")
    .locator(".mc-coverage--detail");
  await expect(detail).toHaveAttribute("data-status", "ready", {
    timeout: 30000,
  });
  await expect(detail.locator(".mc-coverage-count")).toHaveText([
    "1 / 2 帧",
    "1 / 2 帧",
  ]);
  await expect(detail.locator(".mc-coverage-percent")).toHaveText([
    "50%",
    "50%",
  ]);
  await page.getByRole("button", { name: "关闭资料概览", exact: true }).click();
}
async function upload(
  page: Page,
  files: string[],
  expected:
    | { success: number; alreadyStored: number }
    | readonly { success: number; alreadyStored: number }[],
  name?: string,
) {
  const choices = Array.isArray(expected) ? expected : [expected];
  check(
    choices.every(
      (value) => value.success + value.alreadyStored === files.length,
    ),
    "Upload expectations must account for every selected synthetic file.",
  );
  if (name) await page.getByTestId("home-upload-name").fill(name);
  await page.getByTestId("home-upload-files").setInputFiles(files);
  await page.getByTestId("home-upload-start").click();
  const summary = page.getByTestId("home-upload-summary");
  await expect
    .poll(
      async () => {
        const actual = await summary.locator("span").allTextContents();
        return choices.some(
          (value) =>
            JSON.stringify(actual) ===
            JSON.stringify([
              `已处理 ${files.length} / ${files.length}`,
              `成功 ${value.success}`,
              `已存在 ${value.alreadyStored}`,
              "失败 0",
            ]),
        );
      },
      { timeout: 90000 },
    )
    .toBe(true);
  await page.getByTestId("home-upload-close").click();
}
async function logout(page: Page, context: BrowserContext, manifest: Stack) {
  await page.goto(manifest.urls.portal + "/home?view=library");
  await expect(
    page.getByRole("button", { name: "账号菜单", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账号菜单", exact: true }).click();
  await page.getByTestId("home-logout").click();
  await page.waitForURL(
    (url) => url.origin === manifest.urls.portal && url.pathname === "/home",
  );
  await expect
    .poll(async () => !(await api(context, manifest).getSession()).loggedIn)
    .toBe(true);
  await page
    .getByRole("link", { name: "使用平台账号登录", exact: true })
    .click();
  await page.waitForURL((url) => url.origin === manifest.urls.keycloak);
  await expect(page.locator("#password")).toBeVisible();
}

test("real OIDC, serial CT import, sharing, team scope, statistics and federated logout", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  let stage = "preflight";
  try {
    const { manifest, credentials } = await setup();
    const a = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    const b = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    contexts.push(a, b);
    for (const context of contexts) {
      context.setDefaultTimeout(15000);
      context.setDefaultNavigationTimeout(30000);
    }
    const page = await a.newPage(),
      other = await b.newPage();
    const publicHealth = await a.request.get(
      manifest.urls.portal + "/__medcollab_portal_health",
      { maxRedirects: 0 },
    );
    const gateway = await publicHealth.json();
    check(
      publicHealth.status() === 200 &&
        gateway.javaPort === Number(new URL(manifest.urls.java).port),
      "Gateway is not bound to the prepared isolated Java port.",
    );
    await page.goto(manifest.urls.portal + "/home");
    const runtime = await page.evaluate(
      () => (window as any).config?.medcollab,
    );
    check(
      runtime?.apiEnabled === true &&
        runtime.authOrigin === manifest.urls.portal &&
        runtime.workspacePath === "/workspace" &&
        runtime.logoutOrigins.includes(manifest.urls.keycloak),
      "Runtime auth, workspace or logout configuration is not aligned.",
    );
    stage = "real OIDC account A";
    await login(page, a, manifest, "a", credentials.users.a.password);
    stage = "real OIDC account B";
    await login(other, b, manifest, "b", credentials.users.b.password);
    const suffix = Date.now().toString(36);
    const personalName = `integration-personal-${suffix}`;
    stage = "personal serial import";
    await page.getByTestId("home-upload").click();
    // An earlier interrupted test may already have stored this exact immutable fixture.
    await upload(
      page,
      manifest.dicomFiles,
      [
        { success: 2, alreadyStored: 0 },
        { success: 0, alreadyStored: 2 },
      ],
      personalName,
    );
    const personal = (await api(a, manifest).listDatasets()).find(
      (item) => item.name === personalName,
    );
    check(
      !!personal && personal.instanceCount === 2 && personal.access === "owner",
      "Personal upload was not confirmed.",
    );
    const denied = await b.request.get(
      `${manifest.urls.portal}/api/datasets/${encodeURIComponent(personal!.id)}/workspace`,
      { maxRedirects: 0 },
    );
    check(
      denied.status() === 404,
      "An unshared test resource was unexpectedly accessible.",
    );
    await denied.dispose();
    await readCoverage(a, manifest, personal!.id);
    stage = "one-pixel real Labelmap publication";
    await publishOneSyntheticPixel(a, manifest, personal!.id);
    await readCoverage(a, manifest, personal!.id, 1);
    stage = "nonzero compact and detail coverage";
    await verifyNonzeroPage(page, manifest, personalName);
    const row = page
      .getByTestId("home-dataset-row")
      .filter({ hasText: personalName });
    stage = "idempotent existing-target import";
    await row.getByTestId("home-dataset-more").click();
    await page.getByTestId("home-menu-append").click();
    await upload(page, manifest.dicomFiles, { success: 0, alreadyStored: 2 });
    check(
      (await api(a, manifest).listDatasets()).find(
        (item) => item.id === personal!.id,
      )?.instanceCount === 2,
      "Repeated synthetic imports duplicated dataset membership.",
    );
    stage = "personal account sharing";
    await row.getByTestId("home-dataset-more").click();
    await page.getByTestId("home-menu-share").click();
    await page.getByTestId("home-share-search").fill(manifest.users.b.username);
    await page.getByTestId("home-share-search-submit").click();
    await page
      .getByTestId("home-user-result")
      .filter({ hasText: manifest.users.b.username })
      .click();
    await page.getByTestId("home-share-add").click();
    await expect(
      page
        .getByTestId("home-share-member")
        .filter({ hasText: manifest.users.b.username }),
    ).toBeVisible();
    await page
      .getByTestId("home-action-dialog")
      .getByTestId("dialog-close-button")
      .click();
    await other.goto(manifest.urls.portal + "/home?view=library");
    await expect(
      other.getByTestId("home-dataset-row").filter({ hasText: personalName }),
    ).toContainText("与我共享");
    await readCoverage(b, manifest, personal!.id, 1);
    stage = "team creation";
    await page.goto(manifest.urls.portal + "/teams");
    await page.getByRole("button", { name: "创建团队", exact: true }).click();
    const teamName = `integration-team-${suffix}`;
    await page.getByLabel("团队名称", { exact: true }).fill(teamName);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "完成", exact: true })
      .click();
    const team = (await api(a, manifest).listTeams()).find(
      (item) => item.name === teamName,
    );
    check(
      !!team && team.role === "leader",
      "The isolated team was not created.",
    );
    stage = "team membership";
    await page.getByRole("tab", { name: /成员/ }).click();
    await page.getByRole("button", { name: "添加成员", exact: true }).click();
    await page
      .getByLabel("已有账号名称", { exact: true })
      .fill(manifest.users.b.username);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "搜索", exact: true })
      .click();
    await page
      .locator(".mc-team-search-results label")
      .filter({ hasText: manifest.users.b.username })
      .locator("input")
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    stage = "team serial import";
    await page.getByRole("tab", { name: /数据集/ }).click();
    await page
      .locator(".mc-team-toolbar")
      .getByRole("button", { name: "新建数据集", exact: true })
      .click();
    const teamDatasetName = `integration-team-data-${suffix}`;
    await page.getByLabel("数据集名称", { exact: true }).fill(teamDatasetName);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `${teamDatasetName} 数据集操作`,
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: "追加文件", exact: true }).click();
    await upload(page, manifest.dicomFiles, { success: 0, alreadyStored: 2 });
    const teamDataset = (
      await api(a, manifest).listTeamDatasets(team!.id)
    ).find((item) => item.name === teamDatasetName);
    check(
      !!teamDataset && teamDataset.instanceCount === 2,
      "Team import was not confirmed.",
    );
    stage = "shared team scope and coverage";
    await other.goto(
      `${manifest.urls.portal}/teams?team=${encodeURIComponent(team!.id)}`,
    );
    await expect(
      other.getByRole("heading", { name: teamName, exact: true }),
    ).toBeVisible();
    await expect(
      other.locator(".mc-team-data-row").filter({ hasText: teamDatasetName }),
    ).toBeVisible();
    const membership = await api(b, manifest).getTeam(team!.id);
    check(
      membership.role === "member",
      "Team access did not use the real membership.",
    );
    check(
      (await api(b, manifest).listTeamDatasets(team!.id)).find(
        (item) => item.id === teamDataset!.id,
      )?.canDelete === false,
      "A different team uploader was given deletion controls.",
    );
    await readCoverage(b, manifest, teamDataset!.id);
    const launch = await b.request.get(
      `${manifest.urls.portal}/api/datasets/${encodeURIComponent(teamDataset!.id)}/workspace`,
      { maxRedirects: 0 },
    );
    const workspace = await launch.json();
    check(
      launch.status() === 200 &&
        workspace.datasetId === teamDataset!.id &&
        workspace.series?.length === 1,
      "Real workspace launch context was not accepted.",
    );
    await launch.dispose();
    stage = "federated logout B";
    await logout(other, b, manifest);
    stage = "federated logout A";
    await logout(page, a, manifest);
  } catch {
    // Close private pages before reporting; do not attach Keycloak forms, invite codes or API payloads.
    for (const context of contexts) await context.close().catch(() => {});
    throw new Error(
      `Isolated Portal integration failed during ${stage}. Private pages were closed; inspect the coordinated private runtime without publishing credentials.`,
    );
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
});
