import { applyMaskOperation, buildMaskOperations, type Labelmap } from './maskOperations';
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const segments = [{ number: 1, label: '心脏', color: [255, 80, 80] }];
const map = (runs: number[]): Labelmap => ({
  segments,
  masks: runs.length ? [{ instanceId: 'slice', runs }] : [],
});
function normalize(data: Labelmap) {
  return {
    ...data,
    masks: [...data.masks].sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
  };
}

test('encodes erasure explicitly and reproduces the exact final pixels', () => {
  const before = map([1, 8, 1]),
    after = map([1, 2, 1, 6, 3, 1]);
  const ops = buildMaskOperations(before, after, 10);
  expect(ops[0].masks[0].runs).toEqual([3, 3, 0]);
  expect(ops.reduce(applyMaskOperation, before)).toEqual(after);
});
test('removing a slice erases its old pixels and metadata-only changes are operations', () => {
  const before = map([0, 10, 1]),
    after = map([]);
  expect(buildMaskOperations(before, after, 0).reduce(applyMaskOperation, before)).toEqual(after);
  const renamed = { ...after, segments: [{ ...segments[0], label: '新名称' }] };
  expect(buildMaskOperations(after, renamed, 1)[0].masks).toEqual([]);
});
test('large sparse edits split into bounded operations with consecutive bases', () => {
  const runs = Array.from({ length: 5000 }, (_, n) => [n * 2, 1, 1]).flat();
  const ops = buildMaskOperations(map([]), map(runs), 7);
  expect(ops).toHaveLength(2);
  expect(ops.map(op => op.baseSeq)).toEqual([7, 8]);
  expect(ops.every(op => op.masks.reduce((n, m) => n + m.runs.length, 0) <= 9000)).toBe(true);
  expect(ops.reduce(applyMaskOperation, map([]))).toEqual(map(runs));
});
test('different labels, sparse gaps and all background round-trip across randomized edits', () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  function volume(): Labelmap {
    const masks = ['a', 'b'].map(instanceId => {
      const pixels = Array.from({ length: 100 }, () => random() % 3),
        runs: number[] = [];
      for (let i = 0; i < pixels.length; ) {
        let end = i + 1;
        while (end < pixels.length && pixels[end] === pixels[i]) end++;
        if (pixels[i]) runs.push(i, end - i, pixels[i]);
        i = end;
      }
      return { instanceId, runs };
    });
    return { segments: [...segments, { number: 2, label: '其他', color: [0, 100, 200] }], masks };
  }
  for (let n = 0; n < 100; n++) {
    const before = volume(),
      after = volume();
    expect(
      normalize(buildMaskOperations(before, after, n).reduce(applyMaskOperation, before))
    ).toEqual(normalize(after));
  }
});
