/**
 * Group living plants into families of similar recipes, so "who is winning" still
 * makes sense once mutations make exact matches rare. Families keep a stable id
 * from tick to tick and remember their size over time.
 */
import { parseDna, type Rules } from './grammar';
import { classify } from './phenotype';
import type { GrownPlant } from './plant';
import type { Plant } from './world';

/** Edit distance between two strings (Levenshtein). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * How different two recipes are, 0 (same) to 1 (nothing in common): rules are
 * compared by name, and a rule only one side has counts as fully different.
 */
export function ruleDistance(a: Rules, b: Rules): number {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  let diff = 0;
  let total = 0;
  for (const n of names) {
    const ra = a[n] ?? '';
    const rb = b[n] ?? '';
    diff += editDistance(ra, rb);
    total += Math.max(ra.length, rb.length);
  }
  return total === 0 ? 0 : diff / total;
}

export interface Family {
  /** Stable id across ticks. */
  id: number;
  /** The most common recipe in the family. */
  rep: string;
  members: Plant[];
  /** Distinct recipes inside the family. */
  variants: number;
  /** Member count per update, oldest first. */
  history: number[];
}

const HISTORY_LEN = 240;

/**
 * Greedy clustering: genotypes are taken most-common first, and each joins the
 * first family whose representative is within `threshold`, else founds a new one.
 */
export class FamilyTracker {
  families: Family[] = [];
  private nextId = 1;

  constructor(public threshold = 0.3) {}

  reset(): void {
    this.families = [];
    this.nextId = 1;
  }

  update(livePlants: Plant[]): Family[] {
    const groups = new Map<string, Plant[]>();
    for (const p of livePlants) {
      const g = groups.get(p.dna);
      if (g) g.push(p);
      else groups.set(p.dna, [p]);
    }
    const genotypes = [...groups.entries()].map(([dna, plants]) => ({ dna, rules: parseDna(dna), plants })).sort((a, b) => b.plants.length - a.plants.length);

    // Start from last tick's families (keeping ids) but empty their members.
    const fresh: { id: number; rep: string; rules: Rules; members: Plant[]; variants: number }[] = this.families.map((f) => ({
      id: f.id,
      rep: f.rep,
      rules: parseDna(f.rep),
      members: [],
      variants: 0,
    }));
    for (const g of genotypes) {
      let best = -1;
      let bestD = this.threshold;
      for (let i = 0; i < fresh.length; i++) {
        const d = ruleDistance(g.rules, fresh[i].rules);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) {
        fresh.push({ id: this.nextId++, rep: g.dna, rules: g.rules, members: [...g.plants], variants: 1 });
      } else {
        const f = fresh[best];
        f.members.push(...g.plants);
        f.variants++;
      }
    }
    // The representative follows the most common recipe in the family; empty families are forgotten.
    const histories = new Map(this.families.map((f) => [f.id, f.history]));
    this.families = fresh
      .filter((f) => f.members.length > 0)
      .map((f) => {
        const counts = new Map<string, number>();
        for (const m of f.members) counts.set(m.dna, (counts.get(m.dna) ?? 0) + 1);
        const rep = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const history = histories.get(f.id) ?? [];
        history.push(f.members.length);
        if (history.length > HISTORY_LEN) history.splice(0, history.length - HISTORY_LEN);
        return { id: f.id, rep, members: f.members, variants: f.variants, history };
      })
      .sort((a, b) => b.members.length - a.members.length);
    return this.families;
  }
}

/** Plain words for a plant's shape, for the family list. */
export function describePlant(grown: GrownPlant): string {
  const kind = classify(grown);
  if (kind === 'seed') return 'never grows';
  const words: string[] = [kind, grown.height < 60 ? 'short' : grown.height < 150 ? 'medium' : 'tall'];
  const { y, p } = grown.flowers;
  if (y + p === 0) words.push('no flowers');
  else {
    const kinds = (y ? '🟡' : '') + (p ? '🩷' : '');
    words.push(`${kinds} ${y + p >= 8 ? 'many' : 'few'}`);
  }
  return words.join(' · ');
}
