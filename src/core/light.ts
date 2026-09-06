/**
 * Sunlight falls straight down in narrow columns across the whole field. Walking
 * each column from the sky to the ground, every green segment it hits captures
 * half of the light that reaches it and lets the other half through; a wood
 * segment blocks all of it. Whatever is left lands on the dirt as ground light.
 * Plants shade each other and themselves this way.
 */
import type { Geometry, Pen, Segment } from './turtle';

/** Width of one light column in world pixels. */
export const LIGHT_COL = 2;
/** Segments are treated as this wide (half width, px) so vertical stems still catch light. */
const SEG_HALF_WIDTH = 2;

export interface LightColumn {
  /** Crossing heights from the top of the sky down (negative = above ground). */
  ys: number[];
  /** Light level just below each crossing, 0..1. */
  lights: number[];
}

export interface LightMap {
  col: number;
  columns: LightColumn[];
  /** Light reaching the dirt in each column, 0..1. */
  ground: Float32Array;
  /** Light units captured per plant id this pass (before the sun-strength multiplier). */
  gain: Map<number, number>;
}

export interface LitPlant {
  id: number;
  x: number;
  geo: Geometry;
}

interface Crossing {
  y: number;
  pen: Pen;
  id: number;
}

function yAt(s: Segment, cx: number): number {
  const dx = s.x2 - s.x1;
  if (Math.abs(dx) < 1e-6) return (s.y1 + s.y2) / 2;
  const t = Math.min(1, Math.max(0, (cx - s.x1) / dx));
  return s.y1 + t * (s.y2 - s.y1);
}

export function computeLight(plants: LitPlant[], fieldWidth: number): LightMap {
  const ncol = Math.max(1, Math.ceil(fieldWidth / LIGHT_COL));
  const cross: Crossing[][] = Array.from({ length: ncol }, () => []);
  for (const p of plants) {
    for (const s of p.geo.segs) {
      const x0 = p.x + Math.min(s.x1, s.x2) - SEG_HALF_WIDTH;
      const x1 = p.x + Math.max(s.x1, s.x2) + SEG_HALF_WIDTH;
      const c0 = Math.max(0, Math.floor(x0 / LIGHT_COL));
      const c1 = Math.min(ncol - 1, Math.floor(x1 / LIGHT_COL));
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * LIGHT_COL - p.x;
        cross[c].push({ y: yAt(s, cx), pen: s.pen, id: p.id });
      }
    }
  }
  const columns: LightColumn[] = new Array(ncol);
  const ground = new Float32Array(ncol);
  const gain = new Map<number, number>();
  for (let c = 0; c < ncol; c++) {
    const list = cross[c];
    list.sort((a, b) => a.y - b.y);
    const ys: number[] = [];
    const lights: number[] = [];
    let light = 1;
    for (const k of list) {
      if (light <= 0) break;
      if (k.pen === 'g') {
        gain.set(k.id, (gain.get(k.id) ?? 0) + 0.5 * light * LIGHT_COL);
        light *= 0.5;
      } else {
        light = 0;
      }
      ys.push(k.y);
      lights.push(light);
    }
    columns[c] = { ys, lights };
    ground[c] = light;
  }
  return { col: LIGHT_COL, columns, ground, gain };
}
