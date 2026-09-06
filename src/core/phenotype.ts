/**
 * Sort grown plants into a handful of everyday kinds from simple measurements:
 * height, how wide they are for their height, and how much of them is wood.
 */
import type { GrownPlant } from './plant';

export type Kind = 'seed' | 'grass' | 'herb' | 'bush' | 'shrub' | 'tree';

/** Drawing order for charts and legends, ground-huggers first. */
export const KINDS: Kind[] = ['seed', 'grass', 'herb', 'bush', 'shrub', 'tree'];

export const KIND_COLORS: Record<Kind, string> = {
  seed: '#b08a5a',
  grass: '#9ad36a',
  herb: '#4f9e3f',
  bush: '#2f7d5a',
  shrub: '#a2713f',
  tree: '#6b3f1f',
};

export const KIND_WORDS: Record<Kind, string> = {
  seed: 'seeds (nothing grown yet)',
  grass: 'grass: short, green, narrow',
  herb: 'herbs: taller green stalks',
  bush: 'bushes: green and at least as wide as tall',
  shrub: 'shrubs: woody but short',
  tree: 'trees: woody and tall',
};

export interface Measures {
  height: number;
  width: number;
  woodShare: number;
  segments: number;
}

export function measure(grown: GrownPlant): Measures {
  let wood = 0;
  const segments = grown.geo.segs.length;
  for (const s of grown.geo.segs) if (s.pen === 'w') wood++;
  return {
    height: grown.height,
    width: grown.geo.maxX - grown.geo.minX,
    woodShare: segments ? wood / segments : 0,
    segments,
  };
}

/** Thresholds are in world pixels at the default 12 px step, i.e. roughly 8 and 5 steps tall. */
export function classify(grown: GrownPlant): Kind {
  const m = measure(grown);
  if (m.segments === 0) return 'seed';
  if (m.woodShare >= 0.25 && m.height >= 100) return 'tree';
  if (m.woodShare >= 0.15) return 'shrub';
  if (m.width >= m.height * 0.8 && m.height >= 30) return 'bush';
  if (m.height < 60) return 'grass';
  return 'herb';
}

export function emptyCounts(): Record<Kind, number> {
  return { seed: 0, grass: 0, herb: 0, bush: 0, shrub: 0, tree: 0 };
}
