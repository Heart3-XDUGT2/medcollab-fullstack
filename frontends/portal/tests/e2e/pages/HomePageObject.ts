import type { Locator, Page } from '@playwright/test';

type HomeFilter = 'all' | 'owner' | 'shared' | 'public';

export class HomePageObject {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async visit() {
    await this.page.goto('/home?lng=zh&view=library');
    await this.root.waitFor({ state: 'visible' });
  }

  async visitRoot() {
    await this.page.goto('/?lng=zh');
    await this.root.waitFor({ state: 'visible' });
  }

  async visitSso() {
    await this.page.goto('/account/sign-in?lng=zh');
    await this.ssoRoot.waitFor({ state: 'visible' });
  }

  get root() {
    return this.page.getByTestId('medcollab-home');
  }

  get heading() {
    return this.root.locator('h1');
  }

  get images() {
    return this.root.locator('img');
  }

  async navigationTargets() {
    return this.root
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') || ''));
  }

  get sampleUnconfigured() {
    return this.page.getByTestId('home-sample-unconfigured');
  }

  get sampleLink() {
    return this.page.getByTestId('home-sample-link');
  }

  get navigationFixture() {
    return this.page.getByTestId('portal-navigation-fixture');
  }

  get ssoRoot() {
    return this.page.getByTestId('mc-sso');
  }

  get ssoLogin() {
    return this.page.getByTestId('mc-sso-login');
  }

  get ssoRegister() {
    return this.page.getByTestId('mc-sso-register');
  }

  get ssoStatus() {
    return this.page.getByTestId('mc-sso-status');
  }

  get ssoHome() {
    return this.page.getByTestId('mc-sso-home');
  }

  get ssoPreview() {
    return this.page.getByTestId('mc-sso-preview');
  }

  get ssoInputs() {
    return this.ssoRoot.locator('input');
  }

  get enterDemo() {
    return this.page.getByTestId('home-enter-demo');
  }

  get demoBanner() {
    return this.page.getByTestId('home-demo-banner');
  }

  get connectionState() {
    return this.page.getByTestId('home-connection-state');
  }

  get account() {
    return this.page.getByTestId('home-account');
  }

  get logout() {
    return this.page.getByTestId('home-logout');
  }

  get create() {
    return this.page.getByTestId('home-create');
  }

  get upload() {
    return this.page.getByTestId('home-upload');
  }

  get search() {
    return this.page.getByTestId('home-search');
  }

  get sort() {
    return this.page.getByTestId('home-sort');
  }

  get refresh() {
    return this.page.getByTestId('home-refresh');
  }

  get rows() {
    return this.page.getByTestId('home-dataset-row');
  }

  get datasetNames() {
    return this.rows.getByTestId('home-dataset-select').locator('strong');
  }

  get tableHeadings() {
    return this.page.getByTestId('home-datasets').locator('thead th');
  }

  row(name: string) {
    return this.rows.filter({ hasText: name });
  }

  selectDataset(name: string) {
    return this.row(name).getByTestId('home-dataset-select');
  }

  moreForDataset(name: string) {
    return this.row(name).getByTestId('home-dataset-more');
  }

  async focusedDatasetControl(name: string) {
    return this.row(name).evaluate((element) => {
      const focused = document.activeElement;
      return focused && element.contains(focused)
        ? focused.getAttribute('data-cy')
        : focused?.tagName;
    });
  }

  datasetCreationTime(name: string) {
    return this.row(name).locator('.mc-resource-date-cell time, .mc-resource-card-facts time');
  }

  get renameMenuItem() {
    return this.page.getByTestId('home-menu-rename');
  }

  get shareMenuItem() {
    return this.page.getByTestId('home-menu-share');
  }

  get detail() {
    return this.page.getByTestId('home-detail');
  }

  get detailClose() {
    return this.detail.getByTestId('dialog-close-button');
  }

  async detailContainsFocus() {
    return this.detail.evaluate((element) => element.contains(document.activeElement));
  }

  async scrollPosition() {
    return this.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  }

  get openWorkspace() {
    return this.page.getByTestId('home-open-workspace');
  }

  get notice() {
    return this.page.getByTestId('home-notice');
  }

  get empty() {
    return this.page.getByTestId('home-empty');
  }

  get actionDialog() {
    return this.page.getByTestId('home-action-dialog');
  }

  get nameInput() {
    return this.page.getByTestId('home-name-input');
  }

  get nameSave() {
    return this.page.getByTestId('home-name-save');
  }

  get actionError() {
    return this.page.getByTestId('home-action-error');
  }

  get actionCancel() {
    return this.page.getByTestId('home-action-cancel');
  }

  get actionClose() {
    return this.actionDialog.getByTestId('dialog-close-button');
  }

  get sessionRefresh() {
    return this.page.getByTestId('home-session-refresh');
  }

  get uploadName() {
    return this.page.getByTestId('home-upload-name');
  }

  get uploadFiles() {
    return this.page.getByTestId('home-upload-files');
  }

  get uploadStart() {
    return this.page.getByTestId('home-upload-start');
  }

  get shareSearch() {
    return this.page.getByTestId('home-share-search');
  }

  get shareSearchSubmit() {
    return this.page.getByTestId('home-share-search-submit');
  }

  get userResults() {
    return this.page.getByTestId('home-user-result');
  }

  userResult(username: string) {
    return this.userResults.filter({ hasText: username });
  }

  get shareAdd() {
    return this.page.getByTestId('home-share-add');
  }

  get shareMembers() {
    return this.page.getByTestId('home-share-member');
  }

  shareMember(username: string) {
    return this.shareMembers.filter({ hasText: username });
  }

  shareRemove(username: string) {
    return this.shareMember(username).getByTestId('home-share-remove');
  }

  get shareRemoveConfirm() {
    return this.page.getByTestId('home-share-remove-confirm');
  }

  get shareNotice() {
    return this.page.getByTestId('home-share-notice');
  }

  get navigationToggle() {
    return this.page.getByTestId('home-navigation-toggle');
  }

  get navigationDialog() {
    return this.page.getByTestId('home-navigation-dialog');
  }

  get navigationClose() {
    return this.navigationDialog.getByTestId('dialog-close-button');
  }

  filterControl(filter: HomeFilter) {
    return this.page.locator(`[data-cy="home-filter-${filter}"]:visible`);
  }

  async filterBy(filter: HomeFilter) {
    if (!(await this.filterControl(filter).isVisible())) {
      await this.navigationToggle.click();
      await this.navigationDialog.waitFor({ state: 'visible' });
    }
    await this.filterControl(filter).click();
  }

  async waitForDialogSettled(dialog: Locator = this.actionDialog) {
    await dialog.waitFor({ state: 'visible' });
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
  }

  async waitForNextPaint() {
    await this.root.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
  }
}
