import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ReflowMotion, spatialMotionAllowed, useConfirmedFeedback } from './motion';

function rect(x: number, y = 0) {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + 200,
    bottom: y + 60,
    width: 200,
    height: 60,
    toJSON() {},
  } as DOMRect;
}
function item(key: string, initial = 0) {
  const node = document.createElement('article');
  node.dataset.motionItem = key;
  let x = initial;
  node.getBoundingClientRect = vi.fn(() => rect(x));
  const animations: any[] = [];
  node.animate = vi.fn(() => {
    const animation: any = { id: '', onfinish: null, oncancel: null };
    animation.cancel = vi.fn(() => animation.oncancel?.());
    animations.push(animation);
    return animation;
  });
  return {
    node,
    animations,
    position: (next: number) => {
      x = next;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('bounded paint-only layout continuity', () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement('div');
    root.getBoundingClientRect = () => rect(0);
    document.body.append(root);
  });
  test('initial content stays visible without entrance; an existing item follows its changed position', () => {
    const entry = item('a');
    root.append(entry.node);
    const motion = new ReflowMotion();
    motion.sync(root);
    expect(entry.node.animate).not.toHaveBeenCalled();
    entry.position(120);
    motion.sync(root);
    expect(entry.node.animate).toHaveBeenCalledWith(
      [
        { transform: 'translate(-120px, 0px)', zIndex: 2 },
        { transform: 'translate(0px, 0px)', zIndex: 2 },
      ],
      expect.objectContaining({ duration: 260 })
    );
    expect(entry.node.style.opacity).toBe('');
    motion.clear();
  });
  test('rapid changes start from current paint, cancelling old movement rather than queueing', () => {
    const entry = item('a');
    root.append(entry.node);
    const motion = new ReflowMotion();
    motion.sync(root);
    entry.position(120);
    motion.sync(root);
    entry.node.style.transform = 'matrix(1,0,0,1,-60,0)';
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        m41 = -60;
        m42 = 0;
      }
    );
    entry.position(120);
    motion.sync(root);
    expect(entry.animations[0].cancel).toHaveBeenCalledOnce();
    expect(vi.mocked(entry.node.animate).mock.calls[1][0]).toEqual([
      { transform: 'translate(-120px, 0px)', zIndex: 2 },
      { transform: 'translate(0px, 0px)', zIndex: 2 },
    ]);
    motion.clear();
  });
  test('reduced motion gives a gentle feedback without moving content', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );
    const entry = item('a');
    root.append(entry.node);
    const motion = new ReflowMotion();
    motion.sync(root);
    entry.position(90);
    motion.sync(root);
    expect(entry.node.animate).toHaveBeenCalledWith(
      [{ opacity: 0.94 }, { opacity: 1 }],
      expect.objectContaining({ duration: 90 })
    );
    motion.clear();
  });
  test.each([
    { old: 0, next: 464 },
    { old: -20, next: 20 },
  ])('large displacement or an offscreen origin uses the gentle fallback: %j', ({ old, next }) => {
    const entry = item('a', old);
    root.append(entry.node);
    const motion = new ReflowMotion();
    motion.sync(root);
    entry.position(next);
    motion.sync(root);
    expect(entry.node.animate).toHaveBeenCalledWith(
      [{ opacity: 0.94 }, { opacity: 1 }],
      expect.objectContaining({ duration: 160 })
    );
    motion.clear();
  });
  test('low concurrency and save-data decline spatial effects', () => {
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(2);
    expect(spatialMotionAllowed()).toBe(false);
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    });
    expect(spatialMotionAllowed()).toBe(false);
    Reflect.deleteProperty(navigator, 'connection');
  });
  test('measurement and animation budgets are bounded', () => {
    const entries = Array.from({ length: 80 }, (_, index) => item(String(index)));
    root.append(...entries.map((entry) => entry.node));
    const motion = new ReflowMotion();
    motion.sync(root);
    for (const entry of entries) entry.position(40);
    motion.sync(root);
    expect(entries.filter((entry) => vi.mocked(entry.node.animate).mock.calls.length)).toHaveLength(
      12
    );
    expect(entries[64].node.getBoundingClientRect).not.toHaveBeenCalled();
    motion.clear();
  });
  test('empty scope clears private positions and cancels without retaining exit content', () => {
    const entry = item('private-a');
    root.append(entry.node);
    const motion = new ReflowMotion();
    motion.sync(root);
    entry.position(100);
    motion.sync(root);
    root.replaceChildren();
    motion.sync(root);
    expect(entry.animations[0].cancel).toHaveBeenCalledOnce();
    const other = item('private-a', 180);
    root.append(other.node);
    motion.sync(root);
    expect(other.node.animate).not.toHaveBeenCalled();
    expect(root.children).toHaveLength(1);
    motion.clear();
  });
  test('hidden documents and missing animation APIs remain static and usable', () => {
    const entry = item('a');
    root.append(entry.node);
    const motion = new ReflowMotion();
    motion.sync(root);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    entry.position(50);
    motion.sync(root);
    expect(entry.node.animate).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    entry.node.animate = undefined as any;
    entry.position(80);
    motion.sync(root);
    expect(root.contains(entry.node)).toBe(true);
    expect(entry.node.style.visibility).toBe('');
    motion.clear();
  });
});

test('favorite feedback is neither initial-load nor pending feedback; only confirmed changes animate', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Control({ value, enabled }: { value: boolean; enabled: boolean }) {
    const ref = useRef<HTMLButtonElement>(null);
    useConfirmedFeedback(ref, value, enabled);
    return (
      <button ref={ref} aria-pressed={value}>
        Favorite
      </button>
    );
  }
  act(() => root.render(<Control value={false} enabled={false} />));
  const button = host.querySelector('button')!;
  const animation = { id: '', cancel: vi.fn() } as unknown as Animation;
  button.animate = vi.fn(() => animation);
  act(() => root.render(<Control value={true} enabled />));
  expect(button.animate).not.toHaveBeenCalled();
  act(() => root.render(<Control value={false} enabled={false} />));
  expect(button.animate).not.toHaveBeenCalled();
  act(() => root.render(<Control value={false} enabled />));
  expect(button.animate).toHaveBeenCalledOnce();
  act(() => root.unmount());
  expect(animation.cancel).toHaveBeenCalledOnce();
});
