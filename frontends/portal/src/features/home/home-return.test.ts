import { afterEach, expect, test, vi } from 'vitest';
import { checkHomeReturnIdentity, clearHomeReturn, rememberHomeReturn, takeHomeReturn } from './home-return';
const a = { issuer: 'issuer-a', subject: 'subject-a' };
const state = { search: 'private in-memory query', workSearch: 'private work-directory query', sort: 'name', selectedId: 'opaque-id', scrollY: 420 };
afterEach(() => { clearHomeReturn(); vi.restoreAllMocks(); });
test('route return is consumed once only for the same verified identity', () => {
  rememberHomeReturn(a, state);
  expect(takeHomeReturn(a)).toEqual(state);
  expect(takeHomeReturn(a)).toBeNull();
});
test.each([null, { issuer: 'issuer-b', subject: 'subject-a' }, { issuer: 'issuer-a', subject: 'subject-b' }])(
  'anonymous or changed identity clears private return state: %j', identity => {
    rememberHomeReturn(a, state);
    checkHomeReturnIdentity(identity);
    expect(takeHomeReturn(a)).toBeNull();
  }
);
test('private query and IDs never enter browser storage', () => {
  const local = vi.spyOn(Storage.prototype, 'setItem');
  rememberHomeReturn(a, state);
  checkHomeReturnIdentity(a);
  expect(takeHomeReturn(a)).toEqual(state);
  expect(local).not.toHaveBeenCalled();
});
