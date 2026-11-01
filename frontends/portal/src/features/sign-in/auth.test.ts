import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SignInPage from './SignInPage';
import { unconfiguredSignInAdapter, validateSignIn } from './auth';

vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return {
    Link: ({ children, to }: any) => React.createElement('a', { href: to.pathname }, children),
    useLocation: () => ({ search: '' }),
  };
});
vi.mock('../../ui', async () => {
  const React = await import('react');
  const element = (tag: string) =>
    React.forwardRef(({ children, dataCY, variant, size, ...props }: any, ref) =>
      React.createElement(
        tag,
        { ...props, ref, ...(dataCY ? { 'data-cy': dataCY } : {}) },
        children
      )
    );
  return {
    Button: element('button'),
    Input: element('input'),
    Label: element('label'),
    Dialog: ({ open, children }: any) => (open ? React.createElement('div', {}, children) : null),
    DialogContent: element('div'),
    DialogHeader: element('div'),
    DialogTitle: element('h2'),
    DialogDescription: element('p'),
    Icons: { ChevronLeft: () => null, EyeVisible: () => null, EyeHidden: () => null },
  };
});

describe('sign-in validation and unconfigured authentication', () => {
  test('requires identifier and password', () => {
    expect(validateSignIn({ identifier: '  ', password: '' })).toEqual({
      identifier: '请填写邮箱或账号',
      password: '请填写密码',
    });
  });
  test.each(['broken@', 'a@b', 'a@@b.test', 'a b@example.test'])(
    'rejects malformed email %s',
    (identifier) => {
      expect(validateSignIn({ identifier, password: 'x' }).identifier).toContain('邮箱');
    }
  );
  test('accepts accounts without inventing a password policy or trimming passwords', () => {
    expect(validateSignIn({ identifier: '  researcher  ', password: '   ' })).toEqual({});
    expect(validateSignIn({ identifier: 'person@example.test', password: ' x ' })).toEqual({});
    expect(validateSignIn({ identifier: '研究者', password: 'x' })).toEqual({});
  });
  test('rejects whitespace within an account', () => {
    expect(validateSignIn({ identifier: 'two names', password: 'x' }).identifier).toContain('空格');
  });
  test('default adapter only returns unconfigured and never invents a session', async () => {
    await expect(
      unconfiguredSignInAdapter.signIn({
        identifier: 'local@example.test',
        password: 'ui-only',
      })
    ).resolves.toEqual({ status: 'unconfigured' });
  });
});

describe('sign-in form submission boundaries', () => {
  let root: Root;
  let container: HTMLDivElement;
  const control = <T extends HTMLElement>(name: string) =>
    container.querySelector(`[data-cy="sign-in-${name}"]`) as T;
  const change = (name: string, value: string) => {
    act(() => Simulate.change(control<HTMLInputElement>(name), { target: { value } } as any));
  };
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('blocks duplicate pending submissions and passes the exact password to the adapter', async () => {
    let finish;
    const adapter = {
      signIn: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      ),
    };
    act(() => root.render(React.createElement(SignInPage, { adapter: adapter as any })));
    change('identifier', '  local@example.test  ');
    change('password', '  exact password  ');
    act(() => {
      Simulate.submit(control<HTMLFormElement>('form'));
      Simulate.submit(control<HTMLFormElement>('form'));
    });
    expect(adapter.signIn).toHaveBeenCalledTimes(1);
    expect(adapter.signIn).toHaveBeenCalledWith({
      identifier: 'local@example.test',
      password: '  exact password  ',
    });
    expect(control<HTMLButtonElement>('submit').disabled).toBe(true);
    expect(control<HTMLFormElement>('form').getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      finish({ status: 'unconfigured' });
    });
    expect(control<HTMLInputElement>('password').value).toBe('');
    expect(control<HTMLInputElement>('password').type).toBe('password');
    expect(control<HTMLButtonElement>('submit').disabled).toBe(false);
    expect(control('service-error').textContent).toBe('登录服务尚未接入，账号和密码未发送。');
  });
  test('unexpected adapter errors do not echo details or leave the form stuck', async () => {
    const adapter = { signIn: vi.fn().mockRejectedValue(new Error('private-provider-detail')) };
    act(() => root.render(React.createElement(SignInPage, { adapter })));
    change('identifier', 'account');
    change('password', '   ');
    await act(async () => {
      Simulate.submit(control<HTMLFormElement>('form'));
    });
    expect(container.textContent).not.toContain('private-provider-detail');
    expect(control('service-error').textContent).toBe('当前无法登录，请稍后重试。');
    expect(control<HTMLInputElement>('password').value).toBe('');
    expect(control<HTMLButtonElement>('submit').disabled).toBe(false);
  });
});
