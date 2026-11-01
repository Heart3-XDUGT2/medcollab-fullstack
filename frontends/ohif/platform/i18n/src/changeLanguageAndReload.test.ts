import { changeLanguageAndReload } from './changeLanguageAndReload';

test('awaits language/cache update, replaces lng and preserves other query values/hash', async () => {
  let finish;
  const order = [];
  const instance = { changeLanguage: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  const browser = {
    location: { href: 'http://localhost:3000/segmentation?lng=zh&StudyInstanceUIDs=1&StudyInstanceUIDs=2&customization=tools%2Fct#panel',
      reload: jest.fn(() => order.push('reload')) },
    history: { state: { preserved: true }, replaceState: jest.fn(() => order.push('url')) },
  };
  const pending = changeLanguageAndReload('en-US', instance, browser as any);
  expect(browser.history.replaceState).not.toHaveBeenCalled();
  finish();
  await pending;
  const next = new URL(browser.history.replaceState.mock.calls[0][2]);
  expect(next.searchParams.get('lng')).toBe('en-US');
  expect(next.searchParams.getAll('StudyInstanceUIDs')).toEqual(['1', '2']);
  expect(next.searchParams.get('customization')).toBe('tools/ct');
  expect(next.hash).toBe('#panel');
  expect(browser.history.replaceState.mock.calls[0][0]).toEqual({ preserved: true });
  expect(order).toEqual(['url', 'reload']);
});

test('a language change failure does not change the URL or reload', async () => {
  const browser = { location: { href: 'http://localhost:3000/?lng=zh', reload: jest.fn() },
    history: { state: null, replaceState: jest.fn() } };
  await expect(changeLanguageAndReload('en-US', {
    changeLanguage: () => Promise.reject(new Error('language failed')),
  }, browser as any)).rejects.toThrow('language failed');
  expect(browser.history.replaceState).not.toHaveBeenCalled();
  expect(browser.location.reload).not.toHaveBeenCalled();
});
