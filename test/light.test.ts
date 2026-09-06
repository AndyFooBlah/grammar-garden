import { describe, expect, it } from 'vitest';
import { computeLight, LIGHT_COL } from '../src/core/light';
import { interpret } from '../src/core/turtle';

describe('computeLight', () => {
  it('gives a lone horizontal green segment half the light over its width', () => {
    const geo = interpret('llllllf', 15, 40); // points left, 40 px long
    const lm = computeLight([{ id: 1, x: 100, geo }], 200);
    // 40 px plus 2 px of thickness each side, half captured.
    expect(Math.abs(lm.gain.get(1)! - 0.5 * 44)).toBeLessThan(2.5);
    const shadedCols = [...lm.ground].filter((g) => g < 1).length;
    expect(shadedCols).toBeGreaterThan(40 / LIGHT_COL - 2);
    expect(Math.min(...lm.ground)).toBeCloseTo(0.5);
  });

  it('halves again for each green layer and blocks fully under wood', () => {
    const top = interpret('llllllf', 15, 40);
    const lm = computeLight(
      [
        { id: 1, x: 100, geo: interpret('f'.repeat(4) + 'llllllf', 15, 20) }, // higher branch at y=-80
        { id: 2, x: 100, geo: interpret('llllllf', 15, 20) }, // lower branch at y=0 (touching ground)
      ],
      200,
    );
    expect(lm.gain.get(1)!).toBeGreaterThan(lm.gain.get(2)!);
    const wood = computeLight([{ id: 3, x: 100, geo: interpret('wllllllf', 15, 40) }, { id: 4, x: 100, geo: top }], 200);
    // Both at the same height; sorting is stable by y so the tie goes to insertion order, but ground is dark either way.
    expect(Math.min(...wood.ground)).toBe(0);
  });

  it('gives a vertical stem some light thanks to its thickness', () => {
    const lm = computeLight([{ id: 1, x: 50, geo: interpret('ffff', 15, 12) }], 100);
    expect(lm.gain.get(1)!).toBeGreaterThan(0);
  });
});
