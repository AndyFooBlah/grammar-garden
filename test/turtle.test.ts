import { describe, expect, it } from 'vitest';
import { interpret } from '../src/core/turtle';

describe('interpret', () => {
  it('draws forward as an upward segment', () => {
    const g = interpret('f', 15, 10);
    expect(g.segs).toHaveLength(1);
    expect(g.segs[0].x2).toBeCloseTo(0);
    expect(g.segs[0].y2).toBeCloseTo(-10);
    expect(g.segs[0].parent).toBe(-1);
    expect(g.minY).toBeCloseTo(-10);
  });
  it('turns left toward negative x', () => {
    const g = interpret('lf', 90, 10);
    expect(g.segs[0].x2).toBeCloseTo(-10);
    expect(g.segs[0].y2).toBeCloseTo(0);
  });
  it('tracks parents through branches', () => {
    const g = interpret('f[lf][rf]f', 15, 10);
    expect(g.segs.map((s) => s.parent)).toEqual([-1, 0, 0, 0]);
  });
  it('restores step size and pen after a branch', () => {
    const g = interpret('f[+wf]f', 15, 10);
    expect(g.segs[1].len).toBe(20);
    expect(g.segs[1].pen).toBe('w');
    expect(g.segs[2].len).toBe(10);
    expect(g.segs[2].pen).toBe('g');
  });
  it('places flowers on the current segment', () => {
    const g = interpret('fy[lfp]', 15, 10);
    expect(g.flowers).toEqual([
      { x: expect.closeTo(0), y: expect.closeTo(-10), kind: 'y', seg: 0 },
      expect.objectContaining({ kind: 'p', seg: 1 }),
    ]);
  });
});
