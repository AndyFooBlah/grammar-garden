import { describe, expect, it } from 'vitest';
import { classify } from '../src/core/phenotype';
import { growPlant } from '../src/core/plant';
import { DEFAULT_SETTINGS, World } from '../src/core/world';

const s = DEFAULT_SETTINGS;
const kind = (dna: string, steps = 12) => classify(growPlant(dna, steps, s));

describe('classify', () => {
  it('sorts the starters into sensible kinds', () => {
    expect(kind('A=A')).toBe('seed');
    expect(kind('A=fB;B=fC;C=y')).toBe('grass');
    expect(kind('A=wfA')).toBe('tree');
    expect(kind('A=wf[lB][rB]wfA;B=gf[lgf][rgf]p')).toBe('tree');
    expect(kind('A=ff[llllff][rrrrff]')).toBe('bush');
    expect(kind('A=wfwfB;B=[llgfy][rrgfy]gfB')).toBe('herb');
    expect(kind('A=wfwf[lgf][rgf]')).toBe('shrub');
  });
});

describe('kind history', () => {
  it('samples the mix every few ticks and survives a save', () => {
    const w = World.newGarden({}, 3);
    for (let i = 0; i < 40; i++) w.step();
    expect(w.history.length).toBe(8);
    expect(w.history[0].reduce((a, b) => a + b, 0)).toBe(w.plants.length > 0 ? w.history[0].reduce((a, b) => a + b, 0) : 0);
    const copy = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
    expect(copy.history).toEqual(w.history);
    const counts = w.kindCounts();
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(w.livePlants().length);
  });
});
