import { describe, expect, it } from 'vitest';
import { cleanSymbols, expandOnce, formatDna, grow, parseDna, validateDna } from '../src/core/grammar';

describe('parseDna', () => {
  it('parses rules and ignores whitespace and junk', () => {
    expect(parseDna(' A = f B ; B=f[lC][rC]fB; C = g f y !!')).toEqual({ A: 'fB', B: 'f[lC][rC]fB', C: 'gfy' });
  });
  it('balances brackets', () => {
    expect(cleanSymbols('f]]f[lf')).toBe('ff[lf]');
    expect(cleanSymbols('[[f]')).toBe('[[f]]');
  });
  it('round-trips through formatDna with A first', () => {
    expect(formatDna(parseDna('C=y;B=fC;A=fB'))).toBe('A=fB;B=fC;C=y');
  });
  it('reports a missing A rule', () => {
    expect(validateDna(parseDna('B=f'))).toHaveLength(1);
    expect(validateDna(parseDna('A=f'))).toHaveLength(0);
  });
});

describe('grow', () => {
  const rules = parseDna('A=fB;B=f[lC][rC]fB;C=gfy');
  it('expands in parallel', () => {
    expect(expandOnce('A', rules)).toBe('fB');
    expect(expandOnce('fB', rules)).toBe('ff[lC][rC]fB');
  });
  it('matches the worked example from the design', () => {
    expect(grow(rules, 3, 1000).str).toBe('ff[lgfy][rgfy]ff[lC][rC]fB');
  });
  it('stops before exceeding the symbol cap', () => {
    const g = grow(parseDna('A=f[lA][rA]'), 20, 200);
    expect(g.str.length).toBeLessThanOrEqual(200);
    expect(g.capped).toBe(true);
    expect(g.steps).toBeLessThan(20);
  });
  it('reports finished when no variables remain', () => {
    const g = grow(parseDna('A=fB;B=fC;C=y'), 10, 200);
    expect(g.str).toBe('ffy');
    expect(g.steps).toBe(3);
    expect(g.finished).toBe(true);
  });
});
