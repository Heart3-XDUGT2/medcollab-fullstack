import {
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';

const easing = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MAX_MEASURED = 64;
const MAX_ANIMATED = 12;
const MAX_SPATIAL_DISTANCE = 160;
type Position = { node: HTMLElement; x: number; y: number; width: number; height: number };

export function spatialMotionAllowed() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return (
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
    !connection?.saveData &&
    (!navigator.hardwareConcurrency || navigator.hardwareConcurrency > 2)
  );
}
function translation(node: HTMLElement) {
  const transform = getComputedStyle(node).transform;
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
  } catch {
    return { x: 0, y: 0 };
  }
}

/** Paint-only continuity: no cloned content, retained exits, delayed state, or request ownership. */
export class ReflowMotion {
  private previous = new Map<string, Position>();
  private active = new Map<HTMLElement, Animation>();
  private scroll = { x: 0, y: 0 };

  clear = () => {
    for (const animation of this.active.values()) animation.cancel();
    this.active.clear();
    this.previous.clear();
  };

  sync(root: HTMLElement, selector = '[data-motion-item]') {
    const box = root.getBoundingClientRect();
    const next = new Map<string, Position>();
    const jobs: { node: HTMLElement; dx: number; dy: number; spatial: boolean }[] = [];
    const spatial = spatialMotionAllowed();
    const visibleTop = Math.max(
      0,
      parseFloat(getComputedStyle(root).getPropertyValue('--mc-top-height')) || 0
    );
    const sameScroll = this.scroll.x === window.scrollX && this.scroll.y === window.scrollY;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>(selector)).slice(
      0,
      MAX_MEASURED
    )) {
      const key = node.dataset.motionItem;
      if (!key) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const offset = this.active.has(node) ? translation(node) : { x: 0, y: 0 };
      const target = {
        node,
        x: rect.left - box.left - offset.x,
        y: rect.top - box.top - offset.y,
        width: rect.width,
        height: rect.height,
      };
      const before = this.previous.get(key);
      next.set(key, target);
      if (
        !this.previous.size ||
        document.hidden ||
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        jobs.length >= MAX_ANIMATED ||
        typeof node.animate !== 'function'
      )
        continue;
      const dx = before ? before.x + (before.node === node ? offset.x : 0) - target.x : 0;
      const dy = before ? before.y + (before.node === node ? offset.y : 0) - target.y : 0;
      const moved = Math.abs(dx) + Math.abs(dy) > 1;
      const replaced = before && before.node !== node;
      const previousLeft = before ? box.left + before.x + offset.x : 0;
      const previousTop = before ? box.top + before.y + offset.y : 0;
      const oldVisible =
        !!before &&
        previousLeft >= 0 &&
        previousTop >= visibleTop &&
        previousLeft + before.width <= innerWidth &&
        previousTop + before.height <= innerHeight;
      const nextLeft = box.left + target.x,
        nextTop = box.top + target.y;
      const nextVisible =
        nextLeft >= 0 &&
        nextTop >= visibleTop &&
        nextLeft + target.width <= innerWidth &&
        nextTop + target.height <= innerHeight;
      if (moved || !before || replaced)
        jobs.push({
          node,
          dx,
          dy,
          spatial:
            spatial &&
            sameScroll &&
            oldVisible &&
            nextVisible &&
            Math.hypot(dx, dy) <= MAX_SPATIAL_DISTANCE &&
            !!before &&
            !replaced &&
            Math.abs(before.width - target.width) < 2,
        });
    }
    // Read current paint positions before cancelling an interrupted movement.
    for (const animation of this.active.values()) animation.cancel();
    this.active.clear();
    this.previous = next;
    this.scroll = { x: window.scrollX, y: window.scrollY };
    for (const { node, dx, dy, spatial: move } of jobs) {
      if (node.tagName === 'SECTION') {
        for (const animation of node.getAnimations?.({ subtree: true }) || []) {
          if (animation.id === 'mc-reflow') animation.cancel();
        }
      }
      const animation = node.animate(
        move
          ? [
              { transform: `translate(${dx}px, ${dy}px)`, zIndex: 2 },
              { transform: 'translate(0px, 0px)', zIndex: 2 },
            ]
          : [{ opacity: 0.94 }, { opacity: 1 }],
        {
          duration: move ? 260 : spatial ? 160 : 90,
          easing,
        }
      );
      animation.id = 'mc-reflow';
      this.active.set(node, animation);
      const release = () => {
        if (this.active.get(node) === animation) this.active.delete(node);
      };
      animation.onfinish = release;
      animation.oncancel = release;
    }
  }
}

export function useReflowMotion<T extends HTMLElement>(
  root: RefObject<T>,
  revision: string,
  selector = '[data-motion-item]'
) {
  const controller = useRef<ReflowMotion>();
  if (!controller.current) controller.current = new ReflowMotion();
  useLayoutEffect(() => {
    if (root.current) controller.current!.sync(root.current, selector);
  }, [root, revision, selector]);
  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const clear = () => controller.current!.clear();
    media?.addEventListener?.('change', clear);
    return () => {
      media?.removeEventListener?.('change', clear);
      clear();
    };
  }, []);
}

export function MotionRegion({
  children,
  revision,
  className,
}: {
  children: ReactNode;
  revision: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useReflowMotion(root, revision);
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

export function useConfirmedFeedback<T extends HTMLElement>(
  root: RefObject<T>,
  value: boolean,
  enabled = true
) {
  const previous = useRef<boolean | null>(enabled ? value : null);
  const current = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const changed = previous.current !== null && previous.current !== value;
    previous.current = value;
    const button = root.current;
    if (!changed || !button || document.hidden || typeof button.animate !== 'function') return;
    for (const animation of current.current) animation.cancel();
    const wash = button.animate(
      [{ backgroundColor: '#dceff4' }, { backgroundColor: 'transparent' }],
      { duration: spatialMotionAllowed() ? 320 : 100, easing }
    );
    wash.id = 'mc-confirmed-feedback';
    current.current = [wash];
    const icon = button.querySelector('svg');
    if (icon && spatialMotionAllowed() && typeof icon.animate === 'function') {
      const ink = icon.animate(
        [{ transform: 'scale(0.82) rotate(-10deg)' }, { transform: 'scale(1) rotate(0deg)' }],
        { duration: 200, easing }
      );
      ink.id = 'mc-confirmed-feedback';
      current.current.push(ink);
    }
  }, [root, value, enabled]);
  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const clear = () => {
      for (const animation of current.current) animation.cancel();
    };
    media?.addEventListener?.('change', clear);
    return () => {
      media?.removeEventListener?.('change', clear);
      clear();
    };
  }, []);
}

export function useViewFeedback<T extends HTMLElement>(root: RefObject<T>, key: string | null) {
  const previous = useRef<string | null>(null);
  const current = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const node = root.current;
    const changed = previous.current !== null && key !== null && previous.current !== key;
    previous.current = key;
    const start =
      current.current && node ? Math.max(0.96, Number(getComputedStyle(node).opacity) || 1) : 0.96;
    current.current?.cancel();
    if (!changed || !node || document.hidden || typeof node.animate !== 'function') return;
    current.current = node.animate([{ opacity: start }, { opacity: 1 }], {
      duration: spatialMotionAllowed() ? 180 : 80,
      easing,
    });
    current.current.id = 'mc-view-feedback';
  }, [root, key]);
  useLayoutEffect(() => () => current.current?.cancel(), []);
}

export function useDisclosureMotion() {
  const current = useRef<Animation | null>(null);
  const last = useRef(-Infinity);
  useLayoutEffect(() => () => current.current?.cancel(), []);
  return (event: SyntheticEvent<HTMLDetailsElement>) => {
    const panel = event.currentTarget.querySelector<HTMLElement>('.mc-coverage-expanded');
    current.current?.cancel();
    const now = performance.now(),
      recent = now - last.current < 280;
    last.current = now;
    if (
      !event.currentTarget.open ||
      recent ||
      !panel ||
      document.hidden ||
      typeof panel.animate !== 'function'
    )
      return;
    current.current = panel.animate([{ opacity: 0.94 }, { opacity: 1 }], {
      duration: spatialMotionAllowed() ? 180 : 80,
      easing,
    });
    current.current.id = 'mc-disclosure';
  };
}
