import { expect, test } from './fixtures';

const unconfiguredMessage = '登录服务尚未接入，账号和密码未发送。';

test.describe('MedCollab sign-in preview', () => {
  test('redirects the root to dataset home without opening the password-form preview', async ({
    page,
    signInPageObject: signIn,
    homePageObject: home,
  }) => {
    await home.visitRoot();
    expect(new URL(page.url()).pathname).toBe('/home');
    await expect(page).not.toHaveURL(/\/sign-in(?:[/?#]|$)/);
    await expect(signIn.root).toBeHidden();
    await expect(home.heading).toHaveText('工作首页');
    await signIn.visit();
    await expect(signIn.form).toBeVisible();
    await expect(signIn.images).toHaveCount(0);
    await expect(signIn.returnHome).toHaveAttribute('href', '/home?lng=zh');
    await signIn.returnHome.click();
    await expect(home.heading).toHaveText('工作首页');
    await expect(page).toHaveURL(/\/home(?:\?|$)/);
  });

  test('validates required values and account formats without submitting', async ({
    signInPageObject: signIn,
  }) => {
    await signIn.visit();
    await expect(signIn.root).toContainText('MedCollab');
    await expect(signIn.identifier).toHaveAttribute('autocomplete', 'username');
    await expect(signIn.password).toHaveAttribute('autocomplete', 'current-password');

    await signIn.submit.click();
    await expect(signIn.identifierError).toBeVisible();
    await expect(signIn.passwordError).toBeVisible();
    await expect(signIn.identifier).toBeFocused();
    await expect(signIn.serviceError).toBeHidden();

    await signIn.identifier.fill('incomplete@');
    await signIn.password.fill('ui-only');
    await signIn.submit.click();
    await expect(signIn.identifierError).toContainText('邮箱');
    await expect(signIn.serviceError).toBeHidden();

    await signIn.identifier.fill('account with spaces');
    await signIn.submit.click();
    await expect(signIn.identifierError).toContainText('空格');
    await expect(signIn.serviceError).toBeHidden();

    await signIn.identifier.fill('demo-account');
    await signIn.password.fill('');
    await signIn.submit.click();
    await expect(signIn.identifierError).toBeHidden();
    await expect(signIn.passwordError).toBeVisible();
    await expect(signIn.serviceError).toBeHidden();
  });

  test('supports keyboard password visibility and Enter submission without exposing credentials', async ({
    page,
    signInPageObject: signIn,
  }) => {
    const identifier = 'local-ui-check@example.test';
    const password = '  private-ui-password-sentinel  ';
    const needles = [identifier, password, password.trim()].flatMap((value) => [
      value,
      encodeURIComponent(value),
    ]);
    let credentialsExposed = false;
    const containsCredential = (value: string) => needles.some((needle) => value.includes(needle));

    await signIn.visit();
    page.on('request', (request) => {
      if (containsCredential(request.url()) || containsCredential(request.postData() || '')) {
        credentialsExposed = true;
      }
    });
    page.on('console', (message) => {
      if (containsCredential(message.text())) {
        credentialsExposed = true;
      }
    });
    page.on('pageerror', (error) => {
      if (containsCredential(error.message)) {
        credentialsExposed = true;
      }
    });

    await signIn.identifier.fill(identifier);
    await signIn.password.fill(password);
    await expect(signIn.password).toHaveValue(password);
    await expect(signIn.password).toHaveAttribute('type', 'password');

    await signIn.password.press('Tab');
    await expect(signIn.passwordToggle).toBeFocused();
    await expect(signIn.passwordToggle).toHaveAttribute('aria-label', '显示密码');
    await signIn.passwordToggle.press('Space');
    await expect(signIn.password).toHaveAttribute('type', 'text');
    await expect(signIn.password).toHaveValue(password);
    await expect(signIn.passwordToggle).toHaveAttribute('aria-label', '隐藏密码');

    await signIn.password.press('Enter');
    await expect(signIn.serviceError).toHaveText(unconfiguredMessage);
    await expect(signIn.password).toHaveValue('');
    await expect(signIn.password).toHaveAttribute('type', 'password');
    await expect(signIn.submit).toBeEnabled();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);

    const storageContainsCredentials = await page.evaluate((values) => {
      const persisted = JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookies: document.cookie,
      });
      return values.some((value) => persisted.includes(value));
    }, needles);
    expect(storageContainsCredentials).toBe(false);
    expect(containsCredential(page.url())).toBe(false);
    expect(credentialsExposed).toBe(false);
  });

  test('registration and password-help dialogs close and return keyboard focus', async ({
    page,
    signInPageObject: signIn,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn.visit();

    await signIn.forgotPassword.click();
    await expect(signIn.helpDialog).toBeVisible();
    await expect
      .poll(() => signIn.helpDialog.evaluate((element) => getComputedStyle(element).animationName))
      .toBe('none');
    await expect(signIn.helpDialogTitle).toHaveCount(1);
    await expect(signIn.helpDialog).toContainText('尚未接入');
    await signIn.helpDialogClose.click();
    await expect(signIn.helpDialog).toBeHidden();
    await expect(signIn.forgotPassword).toBeFocused();

    await signIn.register.click();
    await expect(signIn.helpDialog).toBeVisible();
    await expect(signIn.helpDialog).toContainText('尚未接入');
    await signIn.helpDialogClose.press('Escape');
    await expect(signIn.helpDialog).toBeHidden();
    await expect(signIn.register).toBeFocused();

    await signIn.forgotPassword.click();
    await expect(signIn.helpDialog).toBeVisible();
    await signIn.helpDialogCloseIcon.click();
    await expect(signIn.helpDialog).toBeHidden();
    await expect(signIn.forgotPassword).toBeFocused();
  });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`keeps the sign-in form usable at ${viewport.width}px`, async ({
      page,
      signInPageObject: signIn,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await signIn.visit();
      await expect(signIn.form).toBeVisible();
      await expect(signIn.images).toHaveCount(0);
      await expect(signIn.identifier).toBeVisible();
      await expect(signIn.password).toBeVisible();
      await expect(signIn.submit).toBeVisible();

      const pageFits = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(pageFits).toBe(true);
      for (const control of [
        signIn.identifier,
        signIn.password,
        signIn.passwordToggle,
        signIn.submit,
        signIn.forgotPassword,
        signIn.register,
      ]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        if (viewport.width === 390) {
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
      }
      for (const image of await signIn.images.all()) {
        await expect
          .poll(() =>
            image.evaluate(
              (element: HTMLImageElement) => element.complete && element.naturalWidth > 0
            )
          )
          .toBe(true);
      }
      await testInfo.attach(`sign-in-${viewport.width}`, {
        body: await signIn.root.screenshot(),
        contentType: 'image/png',
      });
      if (viewport.width === 390) {
        await signIn.register.click();
        await expect(signIn.helpDialog).toBeVisible();
        await signIn.waitForHelpDialogSettled();
        const dialogBox = await signIn.helpDialog.boundingBox();
        expect(dialogBox).not.toBeNull();
        expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
        const closeBox = await signIn.helpDialogClose.boundingBox();
        expect(closeBox).not.toBeNull();
        expect(closeBox!.height).toBeGreaterThanOrEqual(44);
        await testInfo.attach('sign-in-help-390', {
          body: await signIn.helpDialog.screenshot(),
          contentType: 'image/png',
        });
        await signIn.helpDialogClose.click();
        await expect(signIn.helpDialog).toBeHidden();
      }
    });
  }
});
