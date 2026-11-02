export type Segment = { number: number; label: string; color: number[] };
export type Mask = { instanceId: string; runs: number[] };
export type Labelmap = { segments: Segment[]; masks: Mask[] };
export type MaskOperation = {
  clientOpId: string;
  baseSeq: number;
  segments: Segment[];
  masks: Mask[];
};

/** Sweep sparse run boundaries, including background. No full-volume pixel allocation. */
function combine(before: number[], after: number[], patch: boolean): number[] {
  const boundaries = new Set<number>();
  for (const runs of [before, after])
    for (let i = 0; i < runs.length; i += 3) {
      boundaries.add(runs[i]);
      boundaries.add(runs[i] + runs[i + 1]);
    }
  const points = [...boundaries].sort((a, b) => a - b),
    result: number[] = [];
  let a = 0,
    b = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i],
      end = points[i + 1];
    while (a < before.length && before[a] + before[a + 1] <= start) a += 3;
    while (b < after.length && after[b] + after[b + 1] <= start) b += 3;
    const old = a < before.length && before[a] <= start ? before[a + 2] : 0;
    const covered = b < after.length && after[b] <= start;
    const next = covered ? after[b + 2] : 0;
    const value = patch && !covered ? old : next;
    if (patch ? value === 0 : old === next) continue;
    if (
      result.length &&
      result[result.length - 3] + result[result.length - 2] === start &&
      result[result.length - 1] === value
    )
      result[result.length - 2] += end - start;
    else result.push(start, end - start, value);
  }
  return result;
}

export function applyMaskOperation(data: Labelmap, operation: MaskOperation): Labelmap {
  const masks = new Map(data.masks.map(mask => [mask.instanceId, mask.runs]));
  for (const patch of operation.masks)
    masks.set(patch.instanceId, combine(masks.get(patch.instanceId) || [], patch.runs, true));
  return {
    segments: operation.segments,
    masks: [...masks]
      .filter(([, runs]) => runs.length)
      .map(([instanceId, runs]) => ({ instanceId, runs })),
  };
}

export function buildMaskOperations(
  before: Labelmap,
  after: Labelmap,
  baseSeq: number
): MaskOperation[] {
  const previous = new Map(before.masks.map(mask => [mask.instanceId, mask.runs]));
  const next = new Map(after.masks.map(mask => [mask.instanceId, mask.runs]));
  const chunks: Mask[][] = [];
  let masks: Mask[] = [],
    count = 0;
  for (const instanceId of new Set([...previous.keys(), ...next.keys()])) {
    const runs = combine(previous.get(instanceId) || [], next.get(instanceId) || [], false);
    for (let offset = 0; offset < runs.length; ) {
      if (count === 9000) {
        chunks.push(masks);
        masks = [];
        count = 0;
      }
      const part = runs.slice(offset, offset + 9000 - count);
      masks.push({ instanceId, runs: part });
      count += part.length;
      offset += part.length;
    }
  }
  if (masks.length) chunks.push(masks);
  if (!chunks.length && JSON.stringify(before.segments) !== JSON.stringify(after.segments))
    chunks.push([]);
  // Retain removed definitions until all their voxels have been cleared by earlier chunks.
  const intermediate = [
    ...new Map([...before.segments, ...after.segments].map(s => [s.number, s])).values(),
  ];
  return chunks.map((masks, index) => ({
    clientOpId: crypto.randomUUID(),
    baseSeq: baseSeq + index,
    segments: index === chunks.length - 1 ? after.segments : intermediate,
    masks,
  }));
}
