import { describe, expect, it } from 'vitest';
import { describePlant, editDistance, FamilyTracker, ruleDistance } from '../src/core/families';
import { parseDna } from '../src/core/grammar';
import { growPlant } from '../src/core/plant';
import { DEFAULT_SETTINGS, World } from '../src/core/world';

describe('distances', () => {
  it('edit distance basics', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abc', 'abd')).toBe(1);
    expect(editDistance('abc', '')).toBe(3);
  });
  it('a single mutation is close, a different starter is far', () => {
    const bramble = parseDna('A=wf[lB][rB]wfA;B=gf[lgf][rgf]p');
    const mutant = parseDna('A=wf[lB][rB]wwfA;B=gf[lgf][rgf]p');
    const sprout = parseDna('A=fB;B=fC;C=y');
    expect(ruleDistance(bramble, bramble)).toBe(0);
    expect(ruleDistance(bramble, mutant)).toBeLessThan(0.1);
    expect(ruleDistance(bramble, sprout)).toBeGreaterThan(0.5);
  });
});

describe('FamilyTracker', () => {
  it('groups variants of a recipe and keeps ids across updates', () => {
    const w = new World({}, 1);
    const a = w.addSeed('A=wf[lB][rB]wfA;B=gf[lgf][rgf]p', { x: 100 })!;
    const b = w.addSeed('A=wf[lB][rB]wwfA;B=gf[lgf][rgf]p', { x: 200 })!;
    const c = w.addSeed('A=fB;B=fC;C=y', { x: 300 })!;
    const tracker = new FamilyTracker();
    let fams = tracker.update([a, b, c]);
    expect(fams).toHaveLength(2);
    expect(fams[0].members).toHaveLength(2);
    expect(fams[0].variants).toBe(2);
    const bigId = fams[0].id;
    fams = tracker.update([a, b, c, w.addSeed('A=wf[lB][rB]wfA;B=gf[lgf][rgf]p', { x: 400 })!]);
    expect(fams[0].id).toBe(bigId);
    expect(fams[0].history).toEqual([2, 3]);
    // A family that dies out disappears.
    fams = tracker.update([c]);
    expect(fams).toHaveLength(1);
    expect(fams[0].rep).toBe('A=fB;B=fC;C=y');
  });
});

describe('describePlant', () => {
  it('describes the starters sensibly', () => {
    const s = DEFAULT_SETTINGS;
    expect(describePlant(growPlant('A=fB;B=fC;C=y', 12, s))).toBe('short · green · 🟡 few');
    expect(describePlant(growPlant('A=wfA', 12, s))).toBe('medium · woody · no flowers');
    expect(describePlant(growPlant('A=wf[lB][rB]wfA;B=gf[lgf][rgf]p', 12, s))).toContain('🩷 many');
  });
});
