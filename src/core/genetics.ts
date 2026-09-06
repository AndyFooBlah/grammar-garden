/** Crossover, mutation and random recipes. All randomness goes through the supplied Rng. */
import { cleanSymbols, isVariable, type Rules } from './grammar';
import type { Rng } from './rng';

/** Symbols a mutation may insert, weighted so plants mostly grow and turn. */
const INSERT_POOL = 'ffffffbllllrrrrggwwwyypp+-';

/**
 * Child rules from two parents: shared variables are a coin flip, variables only
 * one parent has are kept half the time. `A` is always present.
 */
export function crossover(a: Rules, b: Rules, rng: Rng): Rules {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  const child: Rules = {};
  for (const n of names) {
    const inA = n in a;
    const inB = n in b;
    if (inA && inB) child[n] = rng.chance(0.5) ? a[n] : b[n];
    else if (n === 'A') child[n] = inA ? a[n] : b[n];
    else if (rng.chance(0.5)) child[n] = inA ? a[n] : b[n];
  }
  if (!('A' in child)) child.A = a.A ?? b.A ?? '';
  return child;
}

/** Index of the bracket matching the one at `i`, or -1. */
function matchBracket(s: string, i: number): number {
  const open = s[i] === '[';
  let depth = 0;
  if (open) {
    for (let j = i; j < s.length; j++) {
      if (s[j] === '[') depth++;
      else if (s[j] === ']' && --depth === 0) return j;
    }
  } else {
    for (let j = i; j >= 0; j--) {
      if (s[j] === ']') depth++;
      else if (s[j] === '[' && --depth === 0) return j;
    }
  }
  return -1;
}

function isBalanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '[') depth++;
    else if (c === ']' && --depth < 0) return false;
  }
  return depth === 0;
}

function randomSymbol(rng: Rng, variables: string[]): string {
  if (variables.length && rng.chance(0.15)) return rng.pick(variables);
  return rng.pick([...INSERT_POOL]);
}

export type MutationKind = 'insert' | 'delete' | 'replace' | 'duplicate' | 'branch';

/** Apply one random edit to a rule body. Brackets stay balanced. */
export function mutateRule(body: string, rng: Rng, variables: string[]): { body: string; kind: MutationKind } {
  const kinds: MutationKind[] = ['insert', 'delete', 'replace', 'duplicate', 'branch'];
  const kind = rng.pick(kinds);
  const n = body.length;
  switch (kind) {
    case 'insert': {
      const i = rng.int(n + 1);
      return { body: body.slice(0, i) + randomSymbol(rng, variables) + body.slice(i), kind };
    }
    case 'delete': {
      if (n === 0) return mutateRule(body, rng, variables);
      const i = rng.int(n);
      if (body[i] === '[' || body[i] === ']') {
        const j = matchBracket(body, i);
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        return { body: body.slice(0, lo) + body.slice(lo + 1, hi) + body.slice(hi + 1), kind };
      }
      return { body: body.slice(0, i) + body.slice(i + 1), kind };
    }
    case 'replace': {
      const spots: number[] = [];
      for (let i = 0; i < n; i++) if (body[i] !== '[' && body[i] !== ']') spots.push(i);
      if (!spots.length) return mutateRule(body, rng, variables);
      const i = rng.pick(spots);
      return { body: body.slice(0, i) + randomSymbol(rng, variables) + body.slice(i + 1), kind };
    }
    case 'duplicate': {
      if (n === 0) return mutateRule(body, rng, variables);
      // Try a few random spans; fall back to doubling one non-bracket symbol.
      for (let attempt = 0; attempt < 6; attempt++) {
        const i = rng.int(n);
        const len = 1 + rng.int(Math.min(4, n - i));
        const chunk = body.slice(i, i + len);
        if (isBalanced(chunk)) return { body: body.slice(0, i + len) + chunk + body.slice(i + len), kind };
      }
      return mutateRule(body, rng, variables);
    }
    case 'branch': {
      const i = rng.int(n + 1);
      const inner = (rng.chance(0.5) ? 'l' : 'r') + randomSymbol(rng, variables) + (rng.chance(0.5) ? randomSymbol(rng, variables) : '');
      return { body: body.slice(0, i) + '[' + inner + ']' + body.slice(i), kind };
    }
  }
}

/** Mutate each rule independently with probability `rate`. Returns the mutated rule names. */
export function mutate(rules: Rules, rate: number, rng: Rng): { rules: Rules; mutated: string[] } {
  const out: Rules = {};
  const mutated: string[] = [];
  const variables = Object.keys(rules);
  for (const name of Object.keys(rules)) {
    if (rng.chance(rate)) {
      const { body } = mutateRule(rules[name], rng, variables);
      out[name] = cleanSymbols(body);
      mutated.push(name);
    } else {
      out[name] = rules[name];
    }
  }
  return { rules: out, mutated };
}

/** A random recipe that usually grows into something. */
export function randomDna(rng: Rng): Rules {
  const count = 1 + rng.int(3);
  const names = ['A', 'B', 'C'].slice(0, count);
  const rules: Rules = {};
  for (const name of names) {
    let body = '';
    const len = 3 + rng.int(6);
    for (let i = 0; i < len; i++) {
      if (rng.chance(0.2)) {
        body += '[' + (rng.chance(0.5) ? 'l' : 'r') + randomSymbol(rng, names) + ']';
      } else {
        body += randomSymbol(rng, names);
      }
    }
    // Give every recipe a fair chance of a flower and of pointing forward.
    if (!/[yp]/.test(body) && rng.chance(0.6)) body += rng.chance(0.5) ? 'y' : 'p';
    if (!body.includes('f')) body = 'f' + body;
    rules[name] = cleanSymbols(body);
  }
  // Make sure A leads somewhere, so the plant grows for more than one step.
  if (![...rules.A].some(isVariable)) rules.A += rng.pick(names);
  return rules;
}
