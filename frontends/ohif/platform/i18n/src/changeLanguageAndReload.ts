/**
 * Keep the query-string detector and its cached language in agreement.
 * The caller must obtain confirmation before reloading unsaved work.
 */
export async function changeLanguageAndReload(
  language: string,
  instance: { changeLanguage: (language: string) => Promise<unknown> },
  browser: Pick<Window, 'location' | 'history'> = window
): Promise<void> {
  await instance.changeLanguage(language);
  const url = new URL(browser.location.href);
  url.searchParams.set('lng', language);
  browser.history.replaceState(browser.history.state, '', url.toString());
  browser.location.reload();
}
