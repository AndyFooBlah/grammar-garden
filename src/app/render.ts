/** Canvas drawing for the field (through a pan/zoom camera) and the inspector close-up, plus hit testing. */
import type { GrownPlant } from '../core/plant';
import { DYING_TICKS, type Bug, type Plant, type World } from '../core/world';

export const COLORS = {
  leaf: '#4f9e3f',
  wood: '#7a4e2d',
  sun: '#f0bd2c',
  pink: '#ee6ea8',
  dirt: '#d9b98a',
  dirtDry: '#e6d2a8',
  dirtWet: '#8e6236',
  dirtDark: '#b8925e',
  divider: 'rgba(60, 50, 30, 0.35)',
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
  minimapBg: 'rgba(255, 255, 255, 0.55)',
  minimapView: 'rgba(61, 125, 47, 0.9)',
};

/** Where the player is looking: world x at the left edge of the canvas, and pixels per world unit. */
export interface Camera {
  x: number;
  zoom: number;
}

export interface View {
  width: number;
  height: number;
  /** Screen pixels per world pixel. */
  scale: number;
  /** World x at the left edge of the canvas. */
  camX: number;
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

/** The zoom that shows the whole field. */
export function fitZoom(canvasWidth: number, world: World): number {
  return Math.max(0.02, canvasWidth / world.settings.fieldWidth);
}

/** Keep the camera inside the field and within sensible zoom limits. */
export function clampCamera(cam: Camera, canvasWidth: number, world: World): Camera {
  const minZoom = fitZoom(canvasWidth, world);
  const zoom = Math.min(4, Math.max(minZoom, cam.zoom));
  const maxX = Math.max(0, world.settings.fieldWidth - canvasWidth / zoom);
  return { x: Math.min(maxX, Math.max(0, cam.x)), zoom };
}

export function fieldView(canvas: HTMLCanvasElement, world: World, cam: Camera): View {
  const { width, height } = fitCanvas(canvas);
  const c = clampCamera(cam, width, world);
  return { width, height, scale: c.zoom, camX: c.x, groundY: height * 0.84 };
}

export const toScreenX = (view: View, wx: number): number => (wx - view.camX) * view.scale;
export const toWorldX = (view: View, sx: number): number => sx / view.scale + view.camX;

export interface FieldFrame {
  /** Fraction of the current tick elapsed, 0..1, for smooth bug motion. */
  t: number;
  /** Wall-clock milliseconds, for ambient animation. */
  time: number;
  selectedId: number | null;
}

const LOW_ENERGY = 25;
const SKY_SHADE = 0.22;
const GROUND_SHADE = 0.32;
const MINIMAP = { w: 260, h: 34, margin: 12 };

export function drawField(ctx: CanvasRenderingContext2D, world: World, view: View, frame: FieldFrame): void {
  const { width, height, scale, groundY } = view;
  const zones = zoneScreenRanges(world, view);
  drawSky(ctx, world, view, zones, frame);
  // Ground: each zone's dirt darkens with its soil moisture.
  zones.forEach(({ x0, x1 }, i) => {
    if (x1 <= 0 || x0 >= width) return;
    ctx.fillStyle = mixColor(COLORS.dirtDry, COLORS.dirtWet, world.zones[i].moisture);
    ctx.fillRect(x0, groundY, x1 - x0 + 1, height - groundY);
  });
  drawShade(ctx, world, view);
  // Zone divider
  const div = toScreenX(view, world.settings.fieldWidth / 2);
  if (div > 0 && div < width) {
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(div, 0);
    ctx.lineTo(div, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = COLORS.dirtDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // Plants, shortest last so small ones stay visible in front. Skip anything off screen.
  const plants = [...world.plants].sort((a, b) => world.geometry(b).height - world.geometry(a).height);
  for (const plant of plants) {
    const grown = world.geometry(plant);
    const sx = toScreenX(view, plant.x);
    if (sx + (grown.geo.maxX + 20) * scale < 0 || sx + (grown.geo.minX - 20) * scale > width) continue;
    ctx.save();
    ctx.translate(sx, groundY);
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
    const lw = Math.max(1.2, 2 * Math.min(1, scale)) / scale;
    drawPlant(ctx, grown, lw, lw * 1.5, plant.stage === 'dying' && plant.deathReason === 'collapsed' ? failSegs(grown) : []);
    // Seed / root
    ctx.fillStyle = COLORS.seed;
    ctx.beginPath();
    ctx.ellipse(0, 1, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const bug of world.bugs) drawBug(ctx, bug, view, frame);
  drawMinimap(ctx, world, view);
}

/** Screen x ranges of the climate zones. */
function zoneScreenRanges(world: World, view: View): { x0: number; x1: number }[] {
  const n = world.zones.length;
  const zw = world.settings.fieldWidth / n;
  return world.zones.map((_, i) => ({ x0: toScreenX(view, i * zw), x1: toScreenX(view, (i + 1) * zw) }));
}

let shadeCache: { key: string; canvas: HTMLCanvasElement } | null = null;

/**
 * Darken the sky and dirt wherever sunlight has been caught above. Rebuilt only
 * when the light map, camera or canvas size changes, then stamped each frame.
 */
function drawShade(ctx: CanvasRenderingContext2D, world: World, view: View): void {
  const lm = world.light;
  if (!lm) return;
  const { width, height, scale, groundY, camX } = view;
  const key = `${world.lightVersion}|${width}|${height}|${camX.toFixed(1)}|${scale.toFixed(4)}`;
  if (!shadeCache || shadeCache.key !== key) {
    const dpr = window.devicePixelRatio || 1;
    const canvas = shadeCache?.canvas ?? document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    const colW = lm.col * scale;
    const c0 = Math.max(0, Math.floor(camX / lm.col));
    const c1 = Math.min(lm.columns.length - 1, Math.ceil((camX + width / scale) / lm.col));
    for (let i = c0; i <= c1; i++) {
      const col = lm.columns[i];
      if (!col.ys.length) continue;
      const x = (i * lm.col - camX) * scale;
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

/** Blend two hex colours; t = 0 gives a, t = 1 gives b. */
function mixColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Each climate zone gets its own sky: a sun in the sunny half, falling rain in the rainy half. */
function drawSky(ctx: CanvasRenderingContext2D, world: World, view: View, zones: { x0: number; x1: number }[], frame: FieldFrame): void {
  const { width, groundY } = view;
  zones.forEach(({ x0, x1 }, zi) => {
    const vx0 = Math.max(0, x0);
    const vx1 = Math.min(width, x1);
    if (vx1 <= vx0) return;
    const zone = world.zones[zi];
    const raining = zone.kind === 'rain';
    const [top, bottom] = raining ? COLORS.skyRain : COLORS.skySun;
    const grad = ctx.createLinearGradient(0, 0, 0, groundY);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(vx0, 0, vx1 - vx0 + 1, groundY);
    if (raining) {
      ctx.strokeStyle = COLORS.rainDrop;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const i0 = Math.floor(vx0 / 14);
      const i1 = Math.ceil(vx1 / 14);
      for (let i = i0; i < i1; i++) {
        // Deterministic pseudo-random columns, scrolling with time.
        const seed = ((i + zi * 977) * 9301 + 49297) % 233280;
        const x = (i + 0.5) * 14 + (seed % 7) - 3;
        const speed = 0.35 + (seed % 5) * 0.05;
        const y = ((frame.time * speed + seed) % (groundY + 20)) - 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y + 12);
      }
      ctx.stroke();
    } else {
      const sunX = Math.min(vx1 - 60, Math.max(vx0 + 60, x1 - 60));
      ctx.fillStyle = COLORS.sun;
      ctx.beginPath();
      ctx.arc(sunX, 52, 26, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawBug(ctx: CanvasRenderingContext2D, bug: Bug, view: View, frame: FieldFrame): void {
  const { scale, groundY, width } = view;
  const t = frame.t;
  const x = toScreenX(view, bug.px + (bug.x - bug.px) * t);
  if (x < -30 || x > width + 30) return;
  const y = groundY + (bug.py + (bug.y - bug.py) * t) * scale + Math.sin(frame.time / 180 + bug.id) * 2;
  const facing = bug.x >= bug.px ? 1 : -1;
  const size = Math.max(0.6, Math.min(1.4, scale));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * size, size);
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

/** Screen rectangle of the minimap, so clicks on it can be routed. */
export function minimapRect(view: View): { x: number; y: number; w: number; h: number } {
  return { x: MINIMAP.margin, y: view.height - MINIMAP.h - MINIMAP.margin, w: MINIMAP.w, h: MINIMAP.h };
}

/** True when the camera already shows the whole field, so no minimap is needed. */
export function showsWholeField(view: View, world: World): boolean {
  return view.scale <= fitZoom(view.width, world) * 1.01;
}

/** A strip showing the whole field: every plant as a tick, the two climates, and the current view. */
function drawMinimap(ctx: CanvasRenderingContext2D, world: World, view: View): void {
  if (showsWholeField(view, world)) return;
  const r = minimapRect(view);
  const fw = world.settings.fieldWidth;
  const mx = (wx: number) => r.x + (wx / fw) * r.w;
  ctx.fillStyle = COLORS.minimapBg;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  world.zones.forEach((z, i) => {
    ctx.fillStyle = mixColor(COLORS.dirtDry, COLORS.dirtWet, z.moisture);
    ctx.fillRect(r.x + (i * r.w) / world.zones.length, r.y + r.h - 6, r.w / world.zones.length, 6);
  });
  for (const p of world.plants) {
    const g = world.geometry(p);
    const h = Math.min(r.h - 8, 2 + (g.height / 300) * (r.h - 8));
    ctx.fillStyle = g.flowers.y + g.flowers.p > 0 ? COLORS.pink : COLORS.leaf;
    ctx.fillRect(mx(p.x) - 0.5, r.y + r.h - 6 - h, 1.5, h);
  }
  ctx.strokeStyle = COLORS.minimapView;
  ctx.lineWidth = 2;
  ctx.strokeRect(mx(view.camX), r.y + 1, Math.max(4, (view.width / view.scale / fw) * r.w), r.h - 2);
}

/** The plant under a canvas point, or null. Generous: bounding boxes first, then nearest root. */
export function hitTest(world: World, view: View, cx: number, cy: number): Plant | null {
  const wx = toWorldX(view, cx);
  const wy = (cy - view.groundY) / view.scale;
  let best: Plant | null = null;
  let bestArea = Infinity;
  const pad = 8 / Math.min(1, view.scale);
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
  let bestDist = 25 / Math.min(1, view.scale);
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
