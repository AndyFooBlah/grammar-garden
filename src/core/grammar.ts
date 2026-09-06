/**
 * The plant language: an L-system over a fixed alphabet.
 *
 *   A–Z  variables, replaced by their rule on every growth step
 *   f b  forward / backward one step, drawing a line
 *   l r  turn left / right by the world's turn angle
 *   + -  double / halve the step size
 *   [ ]  start / end a branch (save / restore the turtle state)
 *   g w  pen colour: green (leafy) / wood (brown)
 *   y p  place a yellow / pink flower here
 */

export const COMMANDS = 'fblr+-[]gwyp';
export const VARIABLES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Variable name -> replacement string. */
export type Rules = Record<string, string>;

export function isVariable(c: string): boolean {
  return c.length === 1 && c >= 'A' && c <= 'Z';
}

export function isCommand(c: string): boolean {
  return c.length === 1 && COMMANDS.includes(c);
}

/**
 * Keep only known symbols and balance brackets: an unmatched `]` is dropped,
 * unclosed `[` are closed at the end.
 */
export function cleanSymbols(s: string): string {
  let out = '';
  let depth = 0;
  for (const c of s) {
    if (c === '[') {
      depth++;
      out += c;
    } else if (c === ']') {
      if (depth > 0) {
        depth--;
        out += c;
      }
    } else if (isVariable(c) || isCommand(c)) {
      out += c;
    }
  }
  return out + ']'.repeat(depth);
}

/** Parse `A=fB;B=f[lC]` into rules. Rules may be separated by `;` or newlines; whitespace and unknown characters are ignored. */
export function parseDna(dna: string): Rules {
  const rules: Rules = {};
  for (const part of dna.split(/[;\r\n]+/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!isVariable(name)) continue;
    rules[name] = cleanSymbols(part.slice(eq + 1));
  }
  return rules;
}

function ruleNames(rules: Rules): string[] {
  return Object.keys(rules).sort((a, b) => (a === 'A' ? -1 : b === 'A' ? 1 : a.localeCompare(b)));
}

/** Canonical DNA string for storage: A first, then the other rules alphabetically, `;`-separated. */
export function formatDna(rules: Rules): string {
  return ruleNames(rules)
    .map((n) => `${n}=${rules[n]}`)
    .join(';');
}

/** The same rules, one per line, for the editor. */
export function formatDnaLines(rules: Rules): string {
  return ruleNames(rules)
    .map((n) => `${n}=${rules[n]}`)
    .join('\n');
}

/** Problems a child can understand; empty means the DNA is usable. */
export function validateDna(rules: Rules): string[] {
  const problems: string[] = [];
  if (!('A' in rules)) problems.push('Every recipe needs a rule for A, the seed.');
  if ('A' in rules && rules.A.length === 0) problems.push('The rule for A is empty, so nothing will grow.');
  return problems;
}

/** Apply every rule once, in parallel. */
export function expandOnce(s: string, rules: Rules): string {
  let out = '';
  for (const c of s) {
    const r = rules[c];
    out += r === undefined ? c : r;
  }
  return out;
}

export interface Growth {
  /** The string after growing. */
  str: string;
  /** How many steps were actually applied (may be fewer than asked). */
  steps: number;
  /** True when a further step would exceed the symbol cap. */
  capped: boolean;
  /** True when a further step would change nothing (no variables left). */
  finished: boolean;
}

/**
 * Grow from the start symbol `A` for up to `steps` steps. Growth stops early
 * when the next string would exceed `maxSymbols` or when nothing changes.
 */
export function grow(rules: Rules, steps: number, maxSymbols: number): Growth {
  let s = 'A';
  let taken = 0;
  for (let i = 0; i < steps; i++) {
    const next = expandOnce(s, rules);
    if (next === s) return { str: s, steps: taken, capped: false, finished: true };
    if (next.length > maxSymbols) return { str: s, steps: taken, capped: true, finished: false };
    s = next;
    taken++;
  }
  // Report whether the plant could still grow if given more steps.
  const peek = expandOnce(s, rules);
  return {
    str: s,
    steps: taken,
    capped: peek !== s && peek.length > maxSymbols,
    finished: peek === s,
  };
}
