/** Crossover, mutation and random recipes. All randomness goes through the supplied Rng. */
import { cleanSymbols, isVariable, VARIABLES, type Rules } from './grammar';
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

export type MutationKind = 'insert' | 'delete' | 'replace' | 'duplicate' | 'branch' | 'swapvar';

/** Most letters a recipe may use; keeps recipes readable and the editor sane. */
export const MAX_RULES = 8;

const RULE_EDIT_WEIGHTS: [MutationKind, number][] = [
  ['insert', 3],
  ['delete', 2],
  ['replace', 3],
  ['duplicate', 2],
  ['branch', 1],
  ['swapvar', 1],
];

function pickWeighted<T>(rng: Rng, items: [T, number][]): T {
  const i = rng.weighted(items.map(([, w]) => w));
  return items[Math.max(0, i)][0];
}

/** Apply one random edit to a rule body. Brackets stay balanced. */
export function mutateRule(body: string, rng: Rng, variables: string[]): { body: string; kind: MutationKind } {
  const kind = pickWeighted(rng, RULE_EDIT_WEIGHTS);
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
      // Try a few random spans; fall back to another edit.
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
    case 'swapvar': {
      // Point one letter at a different rule.
      const spots: number[] = [];
      for (let i = 0; i < n; i++) if (isVariable(body[i])) spots.push(i);
      if (!spots.length || variables.length < 2) return mutateRule(body, rng, variables);
      const i = rng.pick(spots);
      const others = variables.filter((v) => v !== body[i]);
      return { body: body.slice(0, i) + rng.pick(others) + body.slice(i + 1), kind };
    }
  }
}

/** Genome-level events that add, copy, drop or shuffle whole rules. */
export type GenomeEvent = 'newrule' | 'copyrule' | 'droprule' | 'transpose';

function unusedLetter(rules: Rules): string | null {
  for (const c of VARIABLES) if (!(c in rules)) return c;
  return null;
}

/** A short random body for a brand-new rule; may lean on existing letters. */
function randomBody(rng: Rng, variables: string[]): string {
  let body = '';
  const len = 2 + rng.int(4);
  for (let i = 0; i < len; i++) {
    body += rng.chance(0.2) ? '[' + (rng.chance(0.5) ? 'l' : 'r') + randomSymbol(rng, variables) + ']' : randomSymbol(rng, variables);
  }
  return cleanSymbols(body);
}

/** Insert a reference to `letter` at a random spot in a random existing rule. Returns the rule touched. */
function wireIn(rules: Rules, letter: string, rng: Rng): string {
  const hosts = Object.keys(rules).filter((n) => n !== letter);
  const host = hosts.length ? rng.pick(hosts) : 'A';
  const body = rules[host] ?? '';
  const i = rng.int(body.length + 1);
  rules[host] = body.slice(0, i) + letter + body.slice(i);
  return host;
}

/** Letters that no rule (including A's chain) ever refers to; A itself is never unused. */
function unusedRules(rules: Rules): string[] {
  const referenced = new Set<string>(['A']);
  for (const body of Object.values(rules)) for (const c of body) if (isVariable(c)) referenced.add(c);
  return Object.keys(rules).filter((n) => !referenced.has(n));
}

/** Apply one genome-level event. Returns the names of rules that changed (new ones included). */
export function mutateGenome(rules: Rules, rng: Rng): { rules: Rules; kind: GenomeEvent; touched: string[] } {
  const out: Rules = { ...rules };
  const names = Object.keys(out);
  const options: [GenomeEvent, number][] = [];
  if (names.length < MAX_RULES) options.push(['newrule', 2], ['copyrule', 2]);
  if (unusedRules(out).length) options.push(['droprule', 2]);
  if (names.length >= 2) options.push(['transpose', 1]);
  if (!options.length) return { rules: out, kind: 'transpose', touched: [] };
  const kind = pickWeighted(rng, options);
  switch (kind) {
    case 'newrule': {
      // A brand-new letter with its own little recipe, plugged into an existing rule.
      const letter = unusedLetter(out)!;
      out[letter] = randomBody(rng, names);
      const host = wireIn(out, letter, rng);
      return { rules: out, kind, touched: [letter, host] };
    }
    case 'copyrule': {
      // Gene duplication: copy a rule to a new letter and point one reference at the copy,
      // so the two can drift apart in later generations.
      const src = rng.pick(names);
      const letter = unusedLetter(out)!;
      out[letter] = out[src];
      const refs: [string, number][] = [];
      for (const n of Object.keys(out)) for (let i = 0; i < out[n].length; i++) if (out[n][i] === src) refs.push([n, i]);
      let host: string;
      if (refs.length) {
        const [n, i] = rng.pick(refs);
        out[n] = out[n].slice(0, i) + letter + out[n].slice(i + 1);
        host = n;
      } else {
        host = wireIn(out, letter, rng);
      }
      return { rules: out, kind, touched: [letter, host] };
    }
    case 'droprule': {
      const letter = rng.pick(unusedRules(out));
      delete out[letter];
      return { rules: out, kind, touched: [letter] };
    }
    case 'transpose': {
      // Move a balanced chunk from one rule into another.
      const from = rng.pick(names);
      const to = rng.pick(names.filter((n) => n !== from));
      const body = out[from];
      for (let attempt = 0; attempt < 6 && body.length; attempt++) {
        const i = rng.int(body.length);
        const len = 1 + rng.int(Math.min(5, body.length - i));
        const chunk = body.slice(i, i + len);
        if (!isBalanced(chunk)) continue;
        out[from] = body.slice(0, i) + body.slice(i + len);
        const j = rng.int(out[to].length + 1);
        out[to] = out[to].slice(0, j) + chunk + out[to].slice(j);
        return { rules: out, kind, touched: [from, to] };
      }
      return { rules: out, kind, touched: [] };
    }
  }
}

/**
 * Mutate a child's recipe. Each rule gets one edit with probability `rate`, and
 * with probability `rate / 2` the genome itself changes: a new letter and rule,
 * a duplicated rule, an unused rule dropped, or a chunk moved between rules.
 * Returns the names of rules that changed.
 */
export function mutate(rules: Rules, rate: number, rng: Rng): { rules: Rules; mutated: string[] } {
  let out: Rules = {};
  const mutated = new Set<string>();
  const variables = Object.keys(rules);
  for (const name of variables) {
    if (rng.chance(rate)) {
      const { body } = mutateRule(rules[name], rng, variables);
      out[name] = cleanSymbols(body);
      mutated.add(name);
    } else {
      out[name] = rules[name];
    }
  }
  if (rng.chance(rate / 2)) {
    const g = mutateGenome(out, rng);
    out = g.rules;
    for (const n of g.touched) mutated.add(n);
  }
  for (const n of Object.keys(out)) out[n] = cleanSymbols(out[n]);
  return { rules: out, mutated: [...mutated].filter((n) => n in out) };
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
