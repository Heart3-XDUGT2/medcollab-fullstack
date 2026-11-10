import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import PortalShell, { PortalLayout } from './PortalShell';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test('shared chrome survives route changes while the old private route unmounts immediately', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const unmount = vi.fn();
  function Personal() {
    useEffect(() => unmount, []);
    return <PortalShell username="account-a" viewKey="home:work" contentReady primaryNavigation={
      <><span aria-current="page">工作首页</span><Link to="/teams">团队影像库</Link></>
    }><main><h1>private-personal-object</h1></main></PortalShell>;
  }
  function Team() {
    return <PortalShell username="account-a" activeSection="teams" viewKey="teams:index" contentReady>
      <main><h1>current-team</h1></main>
    </PortalShell>;
  }
  await act(async () => root.render(<MemoryRouter initialEntries={['/home']}><Routes>
    <Route element={<PortalLayout />}><Route path="/home" element={<Personal />} /><Route path="/teams" element={<Team />} /></Route>
  </Routes></MemoryRouter>));
  const header = container.querySelector('header');
  const oldObject = container.querySelector('main');
  await act(async () => (container.querySelector('a[href="/teams"]') as HTMLElement).click());
  expect(container.querySelector('header')).toBe(header);
  expect(oldObject?.isConnected).toBe(false);
  expect(unmount).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain('private-personal-object');
  expect(container.querySelectorAll('main')).toHaveLength(1);
  expect(container.querySelectorAll('.mc-shell--top')).toHaveLength(1);
  await act(async () => root.unmount());
});

test('invalidating current content cancels its paint immediately without an exit snapshot', async () => {
  const animations: { id: string; cancel: ReturnType<typeof vi.fn> }[] = [];
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('Animation', class {});
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = vi.fn(() => {
    const animation = { id: '', cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function Personal() {
    const [valid, setValid] = useState(true);
    return <PortalShell username={valid ? 'account-a' : ''} viewKey="home:work" contentReady={valid}>
      <main>{valid ? <h1>private-object</h1> : <h1>signed-out</h1>}<button onClick={() => setValid(false)}>invalidate</button></main>
    </PortalShell>;
  }
  await act(async () => root.render(<MemoryRouter><Routes><Route element={<PortalLayout />}><Route path="/" element={<Personal />} /></Route></Routes></MemoryRouter>));
  const content = animations.find(animation => animation.id === 'mc-route-content');
  expect(content).toBeDefined();
  await act(async () => (container.querySelector('main button') as HTMLElement).click());
  expect(content?.cancel).toHaveBeenCalled();
  expect(container.textContent).not.toContain('private-object');
  expect(container.textContent).not.toContain('account-a');
  expect(container.querySelectorAll('main')).toHaveLength(1);
  await act(async () => root.unmount());
  if (original) HTMLElement.prototype.animate = original;
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});
