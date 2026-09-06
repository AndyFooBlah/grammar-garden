import { describe, expect, it } from 'vitest';
import { checkStructure, findCrossing, loadsAbove, properlyCross } from '../src/core/structure';
import { interpret, type Segment } from '../src/core/turtle';

const seg = (x1: number, y1: number, x2: number, y2: number, pen: 'g' | 'w' = 'g', parent = -1): Segment => ({
  x1,
  y1,
  x2,
  y2,
  pen,
  parent,
  len: Math.hypot(x2 - x1, y2 - y1),
});

describe('properlyCross', () => {
  it('detects an X', () => {
    expect(properlyCross(seg(0, 0, 10, 10), seg(0, 10, 10, 0))).toBe(true);
  });
  it('ignores endpoint touches', () => {
    expect(properlyCross(seg(0, 0, 10, 0), seg(10, 0, 10, 10))).toBe(false);
    expect(properlyCross(seg(0, 0, 10, 0), seg(5, 0, 5, 10))).toBe(false);
  });
  it('ignores collinear overlap (forward then backward)', () => {
    expect(properlyCross(seg(0, 0, 0, -10), seg(0, -10, 0, 0))).toBe(false);
  });
});

describe('findCrossing', () => {
  it('finds nothing in a simple tree', () => {
    expect(findCrossing(interpret('f[lf][rf]f', 15, 10).segs)).toBeNull();
  });
  it('finds the crossing in a tangle', () => {
    const big = interpret('f[llllllf][rrrrrrf]', 15, 10);
    expect(findCrossing(big.segs)).toBeNull();
    const tangle = interpret('f[llllllfrrrrrrrrrr+f]ff', 15, 10); // branch swings back across the trunk
    expect(findCrossing(tangle.segs)).not.toBeNull();
  });
});

describe('loadsAbove', () => {
  it('sums subtree lengths, excluding the segment itself', () => {
    const g = interpret('f[lf][rff]f', 15, 10);
    const load = loadsAbove(g.segs);
    expect(load[0]).toBeCloseTo(40);
    expect(load[1]).toBeCloseTo(0);
    expect(load[2]).toBeCloseTo(10);
  });
});

describe('checkStructure', () => {
  it('passes a small green plant', () => {
    expect(checkStructure(interpret('ff[lf][rf]', 15, 10), 120).ok).toBe(true);
  });
  it('snaps a green stem carrying too much', () => {
    const v = checkStructure(interpret('f'.repeat(15), 15, 10), 120);
    expect(v).toMatchObject({ ok: false, reason: 'load', segs: [0] });
  });
  it('lets wood carry anything', () => {
    expect(checkStructure(interpret('w' + 'f'.repeat(15), 15, 10), 120).ok).toBe(true);
  });
  it('wood on top of green does not help', () => {
    const v = checkStructure(interpret('fw' + 'f'.repeat(15), 15, 10), 120);
    expect(v).toMatchObject({ ok: false, reason: 'load', segs: [0] });
  });
  it('fails when a segment goes underground', () => {
    expect(checkStructure(interpret('b', 15, 10), 120)).toMatchObject({ ok: false, reason: 'underground' });
  });
});

describe('wood limit', () => {
  it('snaps wood that holds more than the wood limit', () => {
    const tower = interpret('w' + 'f'.repeat(30), 15, 10);
    expect(checkStructure(tower, 120, 600).ok).toBe(true);
    expect(checkStructure(tower, 120, 200)).toMatchObject({ ok: false, reason: 'woodload', segs: [0] });
  });
});
