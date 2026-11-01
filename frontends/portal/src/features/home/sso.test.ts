import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SsoSignInPage from './SsoSignInPage';
import { HomeConfig } from './api';

vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return {
    Link: ({ children, to, ...props }: any) =>
      React.createElement('a', { ...props, href: to }, children),
  };
});
vi.mock('../../ui', async () => {
  const React = await import('react');
  return {
    Button: React.forwardRef(({ children, asChild, dataCY, variant, ...props }: any, ref) =>
      asChild
        ? React.cloneElement(children, { ...props, ref, 'data-cy': dataCY })
        : React.createElement('button', { ...props, ref, 'data-cy': dataCY }, children)
    ),
    Icons: { ChevronLeft: () => null, ChevronRight: () => null },
  };
});

describe('server-driven SSO entry', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousTitle: string;
  let previousConfig;
  let previousFetch;
  const fetchSpy = vi.fn();
  const config: HomeConfig = {
    apiEnabled: false,
    authOrigin: 'http://127.0.0.1:8080',
    logoutOrigins: [],
    workspacePath: null,
    publicSamplePath: null,
  };
  const control = (name: string) =>
    container.querySelector(`[data-cy="mc-sso-${name}"]`) as HTMLElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    previousTitle = document.title;
    previousConfig = (window as any).config;
    previousFetch = globalThis.fetch;
    (window as any).config = undefined;
    globalThis.fetch = fetchSpy;
    fetchSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    expect(document.title).toBe(previousTitle);
    expect(fetchSpy).not.toHaveBeenCalled();
    (window as any).config = previousConfig;
    globalThis.fetch = previousFetch;
    container.remove();
  });
  test('unconfigured entry is disabled and does not ask for credentials', () => {
    act(() => root.render(React.createElement(SsoSignInPage)));
    expect(document.title).toBe('账号登录 | MedCollab');
    expect((control('login') as HTMLButtonElement).disabled).toBe(true);
    expect((control('register') as HTMLButtonElement).disabled).toBe(true);
    expect(control('status').textContent).toBe('账号服务尚未接入，暂时无法登录。');
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(control('home').getAttribute('href')).toBe('/home');
    expect(control('preview').getAttribute('href')).toBe('/sign-in?lng=zh');
    expect(control('preview').textContent).toContain('密码表单外观预览');
  });
  test('configured navigation uses the server auth routes even while the API is not connected', () => {
    act(() => root.render(React.createElement(SsoSignInPage, { config })));
    expect(control('login').tagName).toBe('A');
    expect(control('login').getAttribute('href')).toBe('http://127.0.0.1:8080/auth/login');
    expect(control('register').getAttribute('href')).toBe('http://127.0.0.1:8080/auth/register');
    expect(control('login').getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(control('status')).toBeNull();
    expect(container.textContent).not.toContain('尚未接入');
  });
  test('invalid auth configuration never becomes a navigation target', () => {
    act(() =>
      root.render(
        React.createElement(SsoSignInPage, {
          config: { ...config, authOrigin: 'javascript:alert(1)' },
        })
      )
    );
    expect((control('login') as HTMLButtonElement).disabled).toBe(true);
    expect(control('login').hasAttribute('href')).toBe(false);
    expect(container.textContent).not.toContain('javascript:');
  });
});
