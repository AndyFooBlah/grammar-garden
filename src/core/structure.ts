/**
 * Structural viability checks. A plant collapses if any of these fail:
 *   1. two of its segments properly cross (touching at endpoints is fine);
 *   2. a green segment holds up more plant than the max unsupported load, or a
 *      wood segment more than the (larger) wood limit;
 *   3. any segment dips below the ground line.
 */
import type { Geometry, Segment } from './turtle';

export type FailReason = 'crossing' | 'load' | 'woodload' | 'underground';

export type Verdict = { ok: true } | { ok: false; reason: FailReason; segs: number[] };

const EPS = 1e-6;

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** True if the segments cross at a point interior to both. Collinear overlap and endpoint touches do not count. */
export function properlyCross(a: Segment, b: Segment): boolean {
  const d1 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  if (!((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS))) return false;
  const d3 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return (d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS);
}

/** Find the first pair of crossing segments using a uniform grid. */
export function findCrossing(segs: Segment[], cellSize = 12): [number, number] | null {
  const grid = new Map<string, number[]>();
  const cellsOf = (s: Segment): string[] => {
    const x0 = Math.floor(Math.min(s.x1, s.x2) / cellSize);
    const x1 = Math.floor(Math.max(s.x1, s.x2) / cellSize);
    const y0 = Math.floor(Math.min(s.y1, s.y2) / cellSize);
    const y1 = Math.floor(Math.max(s.y1, s.y2) / cellSize);
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
    return keys;
  };
  for (let i = 0; i < segs.length; i++) {
    const keys = cellsOf(segs[i]);
    const seen = new Set<number>();
    for (const k of keys) {
      const bucket = grid.get(k);
      if (bucket) {
        for (const j of bucket) {
          if (seen.has(j)) continue;
          seen.add(j);
          if (properlyCross(segs[i], segs[j])) return [j, i];
        }
      }
    }
    for (const k of keys) {
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, (bucket = []));
      bucket.push(i);
    }
  }
  return null;
}

/** For each segment, the total length of everything growing out of it (itself excluded). */
export function loadsAbove(segs: Segment[]): Float64Array {
  const load = new Float64Array(segs.length);
  // Children always come after their parent, so a reverse pass accumulates subtrees.
  for (let i = segs.length - 1; i >= 0; i--) {
    const p = segs[i].parent;
    if (p >= 0) load[p] += load[i] + segs[i].len;
  }
  return load;
}

export function checkStructure(geo: Geometry, maxLoadPx: number, maxWoodLoadPx = Infinity): Verdict {
  const { segs } = geo;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].y2 > EPS || segs[i].y1 > EPS) return { ok: false, reason: 'underground', segs: [i] };
  }
  const cross = findCrossing(segs);
  if (cross) return { ok: false, reason: 'crossing', segs: cross };
  const load = loadsAbove(segs);
  let worst = -1;
  let worstOver = 0;
  for (let i = 0; i < segs.length; i++) {
    const limit = segs[i].pen === 'g' ? maxLoadPx : maxWoodLoadPx;
    const over = load[i] - limit;
    if (over > EPS && over > worstOver) {
      worst = i;
      worstOver = over;
    }
  }
  if (worst >= 0) return { ok: false, reason: segs[worst].pen === 'g' ? 'load' : 'woodload', segs: [worst] };
  return { ok: true };
}

export function describeVerdict(v: Verdict): string {
  if (v.ok) return 'Stands up fine';
  switch (v.reason) {
    case 'crossing':
      return 'Tangled: two lines cross';
    case 'load':
      return 'Floppy: a green stem holds too much';
    case 'woodload':
      return 'Snapped: even wood can only hold so much';
    case 'underground':
      return 'Grows down into the dirt';
  }
}
