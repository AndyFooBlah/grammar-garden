import { describe, expect, it } from 'vitest';
import { crossover, MAX_RULES, mutate, mutateGenome, mutateRule, randomDna } from '../src/core/genetics';
import { cleanSymbols, formatDna, parseDna } from '../src/core/grammar';
import { Rng } from '../src/core/rng';

const balanced = (s: string) => cleanSymbols(s) === s;

describe('crossover', () => {
  it('always keeps A and only uses rules from the parents', () => {
    const a = parseDna('A=fB;B=fy;D=ff');
    const b = parseDna('A=wfA;B=fp;C=gf');
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) {
      const child = crossover(a, b, rng);
      expect(child.A === a.A || child.A === b.A).toBe(true);
      for (const [name, body] of Object.entries(child)) {
        expect([a[name], b[name]]).toContain(body);
      }
    }
  });
  it('takes roughly half of each parent for shared rules', () => {
    const a = parseDna('A=f;B=f');
    const b = parseDna('A=w;B=w');
    const rng = new Rng(3);
    let fromA = 0;
    for (let i = 0; i < 400; i++) if (crossover(a, b, rng).B === 'f') fromA++;
    expect(fromA).toBeGreaterThan(150);
    expect(fromA).toBeLessThan(250);
  });
});

describe('mutateRule', () => {
  it('keeps brackets balanced across many random edits', () => {
    const rng = new Rng(11);
    let body = 'wf[lB][rB]wfA';
    for (let i = 0; i < 500; i++) {
      body = mutateRule(body, rng, ['A', 'B']).body;
      expect(balanced(body)).toBe(true);
    }
  });
});

describe('mutate', () => {
  it('leaves rules alone at rate 0 and changes them at rate 1', () => {
    const rules = parseDna('A=fB;B=fy');
    expect(mutate(rules, 0, new Rng(1))).toEqual({ rules, mutated: [] });
    const m = mutate(rules, 1, new Rng(1));
    expect(m.mutated).toEqual(expect.arrayContaining(['A', 'B']));
  });
});

describe('randomDna', () => {
  it('produces parseable recipes with an A rule', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 50; i++) {
      const rules = randomDna(rng);
      expect(rules.A.length).toBeGreaterThan(0);
      expect(parseDna(formatDna(rules))).toEqual(rules);
    }
  });
});

describe('mutateGenome', () => {
  it('can invent a new letter with a rule and wire it in', () => {
    const rng = new Rng(5);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) {
      const r = mutateGenome(parseDna('A=wfB;B=gfp'), rng);
      if (r.kind === 'newrule') {
        seen = true;
        expect(Object.keys(r.rules)).toHaveLength(3);
        const letter = r.touched[0];
        expect(r.rules[letter]).toBeDefined();
        expect(Object.values(r.rules).some((b) => b.includes(letter))).toBe(true);
      }
    }
    expect(seen).toBe(true);
  });
  it('duplicates a rule and re-points a reference at the copy', () => {
    const rng = new Rng(8);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) {
      const r = mutateGenome(parseDna('A=wfB;B=gfp'), rng);
      if (r.kind === 'copyrule') {
        seen = true;
        const letter = r.touched[0];
        expect(['wfB', 'gfp']).toContain(r.rules[letter]);
        expect(Object.values(r.rules).some((b) => b.includes(letter))).toBe(true);
      }
    }
    expect(seen).toBe(true);
  });
  it('drops unused rules and never exceeds the letter limit', () => {
    const rng = new Rng(2);
    const r = mutateGenome(parseDna('A=fB;B=fy;C=ff'), rng);
    if (r.kind === 'droprule') expect(r.rules.C).toBeUndefined();
    let rules = parseDna('A=fB;B=fy');
    for (let i = 0; i < 300; i++) rules = mutate(rules, 1, rng).rules;
    expect(Object.keys(rules).length).toBeLessThanOrEqual(MAX_RULES);
    for (const body of Object.values(rules)) expect(balanced(body)).toBe(true);
    expect(rules.A).toBeDefined();
  });
});
