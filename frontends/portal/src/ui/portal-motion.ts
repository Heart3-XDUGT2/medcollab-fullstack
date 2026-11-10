import { useLayoutEffect, useRef, type RefObject } from 'react';
import { spatialMotionAllowed } from './motion';

const easing = 'cubic-bezier(0.16, 1, 0.3, 1)';
const unfinished = (animation: Animation) => animation.playState === 'running' || animation.playState === 'paused';
type Marker = { x: number; width: number; navWidth: number };

/** Current DOM only: geometry is the sole continuity state, never an outgoing view. */
export function usePortalMotion(root: RefObject<HTMLElement>, viewKey: string, ready: boolean) {
  const marker = useRef<Marker | null>(null);
  const active = useRef<Animation[]>([]);
  const currentView = useRef('');
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const nav = node.querySelector<HTMLElement>('.mc-top-primary');
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    const changed = !!viewKey && currentView.current !== viewKey;
    const previousIndicator = nav?.querySelector<HTMLElement>('.mc-navigation-marker');
    const painted = previousIndicator?.getBoundingClientRect();
    const navBox = nav?.getBoundingClientRect();
    const interrupted = active.current.some(unfinished);
    for (const animation of active.current) animation.cancel();
    active.current = [];
    if (selected && nav && navBox) {
      const box = selected.getBoundingClientRect();
      const next = { x: box.x - navBox.x, width: box.width, navWidth: navBox.width };
      const before = interrupted && painted
        ? { x: painted.x - navBox.x, width: painted.width, navWidth: navBox.width }
        : marker.current;
      const indicator = previousIndicator || document.createElement('span');
      indicator.className = 'mc-navigation-marker';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.style.width = `${next.width}px`;
      indicator.style.transform = `translateX(${next.x}px)`;
      if (!previousIndicator) nav.append(indicator);
      if (changed && before && Math.abs(before.navWidth - next.navWidth) < 1 &&
        typeof indicator.animate === 'function' && !document.hidden &&
        Math.abs(before.x - next.x) > 1) {
        const animation = indicator.animate(spatialMotionAllowed()
          ? [{ transform: `translateX(${before.x}px) scaleX(${before.width / next.width})` },
              { transform: `translateX(${next.x}px) scaleX(1)` }]
          : [{ opacity: 0.5 }, { opacity: 1 }],
          { duration: spatialMotionAllowed() ? 240 : 90, easing });
        animation.id = 'mc-navigation';
        active.current.push(animation);
      }
      marker.current = next;
      nav.dataset.continuous = 'true';
    }
    if (ready && (changed || currentView.current !== viewKey)) {
      const main = node.querySelector<HTMLElement>('main');
      if (main && typeof main.animate === 'function' && !document.hidden) {
        const animation = main.animate(
          [{ opacity: spatialMotionAllowed() ? 0.88 : 0.97 }, { opacity: 1 }],
          { duration: spatialMotionAllowed() ? 180 : 80, easing });
        animation.id = 'mc-route-content';
        active.current.push(animation);
      }
      currentView.current = viewKey;
    } else if (!ready) {
      // A loading/invalidated view cannot continue an animation of private content.
      currentView.current = '';
    }
    return () => {
      // Save only the painted underline geometry before a rapid navigation replaces it.
      const rect = nav?.querySelector('.mc-navigation-marker')?.getBoundingClientRect();
      if (rect && navBox && active.current.some(unfinished)) {
        marker.current = { x: rect.x - navBox.x, width: rect.width, navWidth: navBox.width };
      }
      for (const animation of active.current) animation.cancel();
      active.current = [];
    };
  }, [root, viewKey, ready]);
  useLayoutEffect(() => {
    const stop = () => {
      for (const animation of active.current) animation.cancel();
      active.current = [];
    };
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const resize = () => {
      stop();
      const nav = root.current?.querySelector<HTMLElement>('.mc-top-primary');
      const selected = nav?.querySelector('[aria-current="page"]');
      const indicator = nav?.querySelector<HTMLElement>('.mc-navigation-marker');
      if (!nav || !selected || !indicator) return;
      const navBox = nav.getBoundingClientRect(), box = selected.getBoundingClientRect();
      marker.current = { x: box.x - navBox.x, width: box.width, navWidth: navBox.width };
      indicator.style.width = `${box.width}px`;
      indicator.style.transform = `translateX(${box.x - navBox.x}px)`;
    };
    media?.addEventListener?.('change', stop);
    window.addEventListener('resize', resize);
    return () => {
      media?.removeEventListener?.('change', stop);
      window.removeEventListener('resize', resize);
      stop();
    };
  }, []);
}
