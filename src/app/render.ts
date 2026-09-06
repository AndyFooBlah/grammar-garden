/** Canvas drawing for the field and the inspector close-up, plus hit testing. */
import type { GrownPlant } from '../core/plant';
import { DYING_TICKS, type Bug, type Plant, type World } from '../core/world';

export const COLORS = {
  leaf: '#4f9e3f',
  wood: '#7a4e2d',
  sun: '#f0bd2c',
  pink: '#ee6ea8',
  dirt: '#d9b98a',
  dirtDark: '#b8925e',
  seed: '#6b4423',
  skySun: ['#bfe3f7', '#e9f4fb'],
  skyRain: ['#9fb4c4', '#cfd9e1'],
  rainDrop: 'rgba(120, 150, 180, 0.55)',
  bad: '#c3462d',
  halo: 'rgba(61, 125, 47, 0.35)',
  bee: '#f2c230',
  beeStripe: '#3b2a10',
  butterfly: '#f07ab4',
  butterflyDark: '#c9448a',
  wing: 'rgba(255,255,255,0.7)',
  pollen: 'rgba(255, 240, 150, 0.8)',
  shade: 'rgba(40, 40, 60, 0.35)',
};

export interface View {
  width: number;
  height: number;
  scale: number;
  groundY: number;
}

/** Size a canvas to its CSS box at device pixel ratio. Returns the CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

export function fieldView(canvas: HTMLCanvasElement, world: World): View {
  const { width, height } = fitCanvas(canvas);
  return { width, height, scale: Math.max(0.05, width / world.settings.fieldWidth), groundY: height * 0.84 };
}

export interface FieldFrame {
  /** Fraction of the current tick elapsed, 0..1, for smooth bug motion. */
  t: number;
  /** Wall-clock milliseconds, for ambient animation. */
  time: number;
  selectedId: number | null;
}

export function drawField(ctx: CanvasRenderingContext2D, world: World, view: View, frame: FieldFrame): void {
  const { width, height, scale, groundY } = view;
  drawSky(ctx, world, view, frame);
  // Ground
  ctx.fillStyle = COLORS.dirt;
  ctx.fillRect(0, groundY, width, height - groundY);
  drawShade(ctx, world, view);
  ctx.strokeStyle = COLORS.dirtDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // Plants, shortest last so small ones stay visible in front.
  const plants = [...world.plants].sort((a, b) => world.geometry(b).height - world.geometry(a).height);
  for (const plant of plants) {
    const grown = world.geometry(plant);
    ctx.save();
    ctx.translate(plant.x * scale, groundY);
    ctx.scale(scale, scale);
    if (plant.stage === 'dying') {
      const progress = Math.min(1, (DYING_TICKS - (plant.dyingTicks ?? 0) + frame.t) / DYING_TICKS);
      ctx.globalAlpha = 1 - progress * 0.9;
      if (plant.deathReason === 'collapsed') {
        const dir = plant.id % 2 === 0 ? 1 : -1;
        ctx.rotate(dir * progress * progress * 1.4);
      }
    } else if (plant.energy < LOW_ENERGY) {
      // Starving plants fade so a child can see who is in trouble.
      ctx.globalAlpha = 0.45 + 0.55 * (plant.energy / LOW_ENERGY);
    }
    if (plant.id === frame.selectedId) {
      ctx.strokeStyle = COLORS.halo;
      ctx.lineWidth = 8 / scale;
      const pad = 10;
      ctx.strokeRect(grown.geo.minX - pad, grown.geo.minY - pad, grown.geo.maxX - grown.geo.minX + 2 * pad, -grown.geo.minY + 2 * pad);
    }
    drawPlant(ctx, grown, 2 / scale, 3 / scale, plant.stage === 'dying' && plant.deathReason === 'collapsed' ? failSegs(grown) : []);
    // Seed / root
    ctx.fillStyle = COLORS.seed;
    ctx.beginPath();
    ctx.ellipse(0, 1, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const bug of world.bugs) drawBug(ctx, bug, view, frame);
}

const LOW_ENERGY = 25;
const SKY_SHADE = 0.22;
const GROUND_SHADE = 0.32;

let shadeCache: { key: string; canvas: HTMLCanvasElement } | null = null;

/**
 * Darken the sky and dirt wherever sunlight has been caught above. Rebuilt only
 * when the light map or the canvas size changes, then stamped each frame.
 */
function drawShade(ctx: CanvasRenderingContext2D, world: World, view: View): void {
  const lm = world.light;
  if (!lm) return;
  const { width, height, scale, groundY } = view;
  const key = `${world.lightVersion}|${width}|${height}`;
  if (!shadeCache || shadeCache.key !== key) {
    const dpr = window.devicePixelRatio || 1;
    const canvas = shadeCache?.canvas ?? document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    const colW = lm.col * scale;
    for (let i = 0; i < lm.columns.length; i++) {
      const col = lm.columns[i];
      if (!col.ys.length) continue;
      const x = i * colW;
      for (let k = 0; k < col.ys.length; k++) {
        const light = col.lights[k];
        if (light >= 1) continue;
        const y0 = groundY + col.ys[k] * scale;
        const y1 = k + 1 < col.ys.length ? groundY + col.ys[k + 1] * scale : groundY;
        if (y1 <= y0) continue;
        c.fillStyle = `rgba(25, 35, 60, ${((1 - light) * SKY_SHADE).toFixed(3)})`;
        c.fillRect(x, y0, colW + 0.6, y1 - y0);
        if (light <= 0) break;
      }
      const ground = lm.ground[i];
      if (ground < 1) {
        c.fillStyle = `rgba(60, 35, 10, ${((1 - ground) * GROUND_SHADE).toFixed(3)})`;
        c.fillRect(x, groundY, colW + 0.6, height - groundY);
      }
    }
    shadeCache = { key, canvas };
  }
  ctx.drawImage(shadeCache.canvas, 0, 0, width, height);
}

function failSegs(grown: GrownPlant): number[] {
  return grown.verdict.ok ? [] : grown.verdict.segs;
}

/** Draw a grown plant with the origin at its root. Line widths are in the current transform. */
export function drawPlant(ctx: CanvasRenderingContext2D, grown: GrownPlant, lineWidth: number, flowerRadius: number, highlight: number[]): void {
  const { segs, flowers } = grown.geo;
  ctx.lineCap = 'round';
  // Draw wood, then green, then highlights, so colours group into fewer path changes.
  for (const pen of ['w', 'g'] as const) {
    ctx.strokeStyle = pen === 'w' ? COLORS.wood : COLORS.leaf;
    ctx.lineWidth = pen === 'w' ? lineWidth * 1.4 : lineWidth;
    ctx.beginPath();
    for (const s of segs) {
      if (s.pen !== pen) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
  }
  if (highlight.length) {
    ctx.strokeStyle = COLORS.bad;
    ctx.lineWidth = lineWidth * 2.2;
    ctx.beginPath();
    for (const i of highlight) {
      const s = segs[i];
      if (!s) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
  }
  for (const f of flowers) {
    ctx.fillStyle = f.kind === 'y' ? COLORS.sun : COLORS.pink;
    ctx.beginPath();
    ctx.arc(f.x, f.y, flowerRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSky(ctx: CanvasRenderingContext2D, world: World, view: View, frame: FieldFrame): void {
  const { width, groundY } = view;
  const raining = world.weather.kind === 'rain';
  const [top, bottom] = raining ? COLORS.skyRain : COLORS.skySun;
  const grad = ctx.createLinearGradient(0, 0, 0, groundY);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, groundY);
  if (raining) {
    ctx.strokeStyle = COLORS.rainDrop;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = Math.floor(width / 14);
    for (let i = 0; i < n; i++) {
      // Deterministic pseudo-random columns, scrolling with time.
      const seed = (i * 9301 + 49297) % 233280;
      const x = (i + 0.5) * 14 + (seed % 7) - 3;
      const speed = 0.35 + (seed % 5) * 0.05;
      const y = ((frame.time * speed + seed) % (groundY + 20)) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 12);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = COLORS.sun;
    ctx.beginPath();
    ctx.arc(width - 60, 52, 26, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBug(ctx: CanvasRenderingContext2D, bug: Bug, view: View, frame: FieldFrame): void {
  const { scale, groundY } = view;
  const t = frame.t;
  const x = (bug.px + (bug.x - bug.px) * t) * scale;
  const y = groundY + (bug.py + (bug.y - bug.py) * t) * scale + Math.sin(frame.time / 180 + bug.id) * 2;
  const facing = bug.x >= bug.px ? 1 : -1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  if (bug.carrying) {
    ctx.fillStyle = COLORS.pollen;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  const flap = Math.abs(Math.sin(frame.time / 60 + bug.id));
  if (bug.kind === 'bee') {
    ctx.fillStyle = COLORS.wing;
    ctx.beginPath();
    ctx.ellipse(-1, -6, 5, 3 + flap * 3, -0.4, 0, Math.PI * 2);
    ctx.ellipse(3, -6, 5, 3 + flap * 3, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.bee;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.beeStripe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -5);
    ctx.lineTo(-2, 5);
    ctx.moveTo(2, -5);
    ctx.lineTo(2, 5);
    ctx.stroke();
  } else {
    const open = 4 + flap * 6;
    ctx.fillStyle = COLORS.butterfly;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-open - 4, -9);
    ctx.lineTo(-open - 2, 3);
    ctx.closePath();
    ctx.moveTo(0, 0);
    ctx.lineTo(open + 4, -9);
    ctx.lineTo(open + 2, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.butterflyDark;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-open - 2, 7);
    ctx.lineTo(-open + 1, 2);
    ctx.closePath();
    ctx.moveTo(0, 0);
    ctx.lineTo(open + 2, 7);
    ctx.lineTo(open - 1, 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLORS.beeStripe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 6);
    ctx.stroke();
  }
  ctx.restore();
}

/** The plant under a canvas point, or null. Generous: bounding boxes first, then nearest root. */
export function hitTest(world: World, view: View, cx: number, cy: number): Plant | null {
  const wx = cx / view.scale;
  const wy = (cy - view.groundY) / view.scale;
  let best: Plant | null = null;
  let bestArea = Infinity;
  const pad = 8;
  for (const plant of world.plants) {
    const g = world.geometry(plant).geo;
    const x0 = plant.x + g.minX - pad;
    const x1 = plant.x + g.maxX + pad;
    const y0 = g.minY - pad;
    const y1 = pad;
    if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) {
      const area = (x1 - x0) * (y1 - y0);
      if (area < bestArea) {
        best = plant;
        bestArea = area;
      }
    }
  }
  if (best) return best;
  let bestDist = 25;
  for (const plant of world.plants) {
    const d = Math.hypot(plant.x - wx, wy);
    if (d < bestDist) {
      best = plant;
      bestDist = d;
    }
  }
  return best;
}

/** Draw a plant fitted into the inspector canvas. */
export function drawInspector(canvas: HTMLCanvasElement, grown: GrownPlant | null, highlight: number[]): void {
  const { width, height } = fitCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  const groundY = height - 24;
  const grad = ctx.createLinearGradient(0, 0, 0, groundY);
  grad.addColorStop(0, COLORS.skySun[0]);
  grad.addColorStop(1, COLORS.skySun[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, groundY);
  ctx.fillStyle = COLORS.dirt;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.strokeStyle = COLORS.dirtDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
  if (!grown || width < 60 || height < 60) return;
  const g = grown.geo;
  const pad = 16;
  const w = Math.max(g.maxX - g.minX, 1);
  const h = Math.max(-g.minY, 1);
  const scale = Math.max(0.05, Math.min((width - 2 * pad) / w, (groundY - pad) / h, 6));
  const cx = width / 2 - ((g.minX + g.maxX) / 2) * scale;
  ctx.save();
  ctx.translate(cx, groundY);
  ctx.scale(scale, scale);
  drawPlant(ctx, grown, 3 / scale, 4 / scale, highlight);
  ctx.fillStyle = COLORS.seed;
  ctx.beginPath();
  ctx.ellipse(0, 1 / scale, 5 / scale, 3.5 / scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
