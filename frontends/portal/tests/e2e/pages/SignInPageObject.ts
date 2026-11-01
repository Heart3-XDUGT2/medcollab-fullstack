import type { Page } from '@playwright/test';

export class SignInPageObject {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async visit() {
    await this.page.goto('/sign-in?lng=zh');
    await this.root.waitFor({ state: 'visible' });
  }

  get root() {
    return this.page.getByTestId('medcollab-sign-in');
  }

  get form() {
    return this.page.getByTestId('sign-in-form');
  }

  get returnHome() {
    return this.page.getByTestId('sign-in-home');
  }

  get identifier() {
    return this.page.getByTestId('sign-in-identifier');
  }

  get password() {
    return this.page.getByTestId('sign-in-password');
  }

  get passwordToggle() {
    return this.page.getByTestId('sign-in-password-toggle');
  }

  get submit() {
    return this.page.getByTestId('sign-in-submit');
  }

  get identifierError() {
    return this.page.getByTestId('sign-in-identifier-error');
  }

  get passwordError() {
    return this.page.getByTestId('sign-in-password-error');
  }

  get serviceError() {
    return this.page.getByTestId('sign-in-service-error');
  }

  get forgotPassword() {
    return this.page.getByTestId('sign-in-forgot');
  }

  get register() {
    return this.page.getByTestId('sign-in-register');
  }

  get helpDialog() {
    return this.page.getByTestId('sign-in-help-dialog');
  }

  async waitForHelpDialogSettled() {
    await this.helpDialog.waitFor({ state: 'visible' });
    await this.helpDialog.evaluate(async (element) => {
      const animations = element.getAnimations({ subtree: true });
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    });
  }

  get helpDialogTitle() {
    return this.helpDialog.getByRole('heading');
  }

  get helpDialogClose() {
    return this.page.getByTestId('sign-in-help-close');
  }

  get helpDialogCloseIcon() {
    return this.helpDialog.getByTestId('dialog-close-button');
  }

  get images() {
    return this.root.locator('img');
  }
}
