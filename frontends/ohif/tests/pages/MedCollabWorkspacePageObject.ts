import type { Page, Locator } from '@playwright/test';

export class MedCollabWorkspacePageObject {
  constructor(readonly page: Page) {}
  get bar() {
    return this.page.getByTestId('dataset-workspace-bar');
  }
  get acquire() {
    return this.page.getByTestId('dataset-acquire-edit');
  }
  get release() { return this.page.getByTestId('dataset-release-edit'); }
  async releaseIfHeld() {
    // The idle check can already have released a fully synced stroke.
    if (await this.release.isEnabled()) await this.release.click();
  }
  get brush() {
    return this.page.getByTestId('Brush-btn');
  }
  get renderedCanvases() {
    return this.page.getByTestId('viewport-pane').locator('canvas.cornerstone-canvas');
  }
  async login(origin: string, user: { username: string; password: string }) {
    await this.page.goto(origin + '/auth/login');
    await this.page.locator('[name="username"]').fill(user.username);
    await this.page.locator('[name="password"]').fill(user.password);
    await Promise.all([
      this.page.waitForURL(origin + '/home'),
      this.page.locator('#kc-login').click(),
    ]);
    await this.page.evaluate(() => {
      localStorage.setItem('medcollab:realtime:enabled', 'true');
      localStorage.setItem('medcollab:dataset-bar:expanded', 'true');
    });
  }
  async open(url: string) {
    await this.page.goto(url);
    const notice = this.page.getByTestId('confirm-and-hide-button');
    if (await notice.isVisible()) await notice.click();
    await this.page.waitForFunction(
      () => {
        const w = (window as any).services?.datasetWorkspaceService;
        return w?.state.ready && w.reliable?.initialized;
      },
      null,
      { timeout: 120000 }
    );
    if (await notice.isVisible()) await notice.click();
  }
  async waitSynced(seq: number) {
    await this.page.waitForFunction(
      n => {
        const s = (window as any).services?.datasetWorkspaceService.state;
        return s && s.operationSeq >= n && !s.dirty && !s.pendingOps && !s.collabConflict;
      },
      seq,
      { timeout: 20000 }
    );
  }
  async paintedPixels(canvas: Locator, path?: string): Promise<number[]> {
    const png = await canvas.screenshot({
      ...(path ? { path } : {}),
      // Compare the labelmap raster without transient local/remote mouse cursors or floating UI.
      style: 'svg.svg-layer, canvas[aria-hidden="true"]:not(.cornerstone-canvas), [data-cy="dataset-workspace-bar"], [data-cy="dataset-collaborators"] { visibility: hidden !important; }',
    });
    return this.page.evaluate(async encoded => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const copy = document.createElement('canvas');
      copy.width = image.width;
      copy.height = image.height;
      const context = copy.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      const red: number[] = [];
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 80 && data[i] > data[i + 1] * 1.3 && data[i] > data[i + 2] * 1.3)
          red.push(i / 4);
      return red;
    }, png.toString('base64'));
  }
}
