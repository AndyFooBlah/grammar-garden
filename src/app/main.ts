import { describePlant, FamilyTracker } from '../core/families';
import { randomDna } from '../core/genetics';
import { formatDna, formatDnaLines, parseDna } from '../core/grammar';
import { describeVerdict } from '../core/structure';
import { STARTERS } from '../core/starters';
import { DEFAULT_SETTINGS, World, type Plant, type SaveFile, type Settings, type WorldEvent } from '../core/world';
import { Sounds } from './audio';
import { closeFamilyTree, openFamilyTree } from './family';
import { clampCamera, drawField, drawInspector, fieldView, fitZoom, hitTest, minimapRect, showsWholeField, toWorldX, type Camera } from './render';

const AUTOSAVE_KEY = 'grammar-garden-autosave';
const AUTOSAVE_EVERY = 5;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

// ---------- state ----------

let world = loadAutosave() ?? World.newGarden();
let paused = false;
let acc = 0;
let last = performance.now();
let selectedId: number | null = null;
/** True while the recipe box holds text the user typed that has not been applied. */
let editorDirty = false;
const sounds = new Sounds();
/** Start zoomed out so the whole field is visible; zoom 0 means "fit" until the canvas has a size. */
let cam: Camera = { x: 0, zoom: 0 };
/** While true the view keeps fitting the whole field, even when the window is resized. */
let fitMode = true;
const families = new FamilyTracker();

// ---------- elements ----------

const fieldCanvas = $<HTMLCanvasElement>('field');
const fieldCtx = fieldCanvas.getContext('2d')!;
const inspCanvas = $<HTMLCanvasElement>('insp-canvas');
const dnaBox = $<HTMLTextAreaElement>('dna');
const verdictEl = $('verdict');
const infoEl = $('insp-info');
const titleEl = $('insp-title');
const energyBar = $('energy-bar');
const energyLabel = $('energy-label');
const toastEl = $('toast');
const zoneBadges = [$('zone-left'), $('zone-right')];
const btnPlay = $<HTMLButtonElement>('btn-play');
const btnApply = $<HTMLButtonElement>('btn-apply');
const btnClone = $<HTMLButtonElement>('btn-clone');
const btnRemove = $<HTMLButtonElement>('btn-remove');
const btnFamily = $<HTMLButtonElement>('btn-family');
const speedInput = $<HTMLInputElement>('speed');
const speedOut = $<HTMLOutputElement>('speed-out');
const populationEl = $<HTMLDetailsElement>('population');
const populationBody = $('population-body');

// ---------- helpers ----------

let toastTimer = 0;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2200);
}

function selectedPlant(): Plant | null {
  return selectedId === null ? null : (world.plantById(selectedId) ?? null);
}

function handleEvents(events: WorldEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'planted':
        sounds.plip();
        break;
      case 'born':
        sounds.plip(1.3);
        break;
      case 'visit':
        if (e.kind === 'bee') sounds.buzz();
        else sounds.flutter();
        break;
      case 'collapse':
        sounds.thump();
        break;
      case 'death':
        sounds.rustle();
        break;
      case 'weather':
        if (e.kind === 'rain') sounds.rainShower();
        break;
    }
  }
}

/** Put a recipe into the editor, one rule per line, and size the box to fit. */
function setEditor(dna: string): void {
  const rules = parseDna(dna);
  dnaBox.value = Object.keys(rules).length ? formatDnaLines(rules) : dna;
  fitEditor();
}

function fitEditor(): void {
  const lines = dnaBox.value.split('\n').length;
  dnaBox.rows = Math.min(10, Math.max(3, lines + 1));
}

// ---------- autosave ----------

function loadAutosave(): World | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return World.fromJSON(JSON.parse(raw) as SaveFile);
  } catch {
    return null;
  }
}

function autosave(): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(world.toJSON()));
  } catch {
    /* storage may be unavailable; the game still runs */
  }
}

// ---------- simulation loop ----------

function doTick(): void {
  handleEvents(world.step());
  families.update(world.livePlants());
  if (selectedId !== null && !world.plantById(selectedId)) {
    selectedId = null;
    editorDirty = false;
  }
  if (world.tick % AUTOSAVE_EVERY === 0) autosave();
  refreshStats();
  refreshInspector();
  refreshPopulation();
}

function frame(now: number): void {
  const dt = Math.min(now - last, 250);
  last = now;
  const tickMs = world.settings.tickMs;
  if (!paused) {
    acc += dt;
    while (acc >= tickMs) {
      acc -= tickMs;
      doTick();
    }
  }
  const view = currentView();
  drawField(fieldCtx, world, view, { t: Math.min(1, acc / tickMs), time: now, selectedId });
  requestAnimationFrame(frame);
}

// ---------- camera ----------

function currentView() {
  if (cam.zoom === 0 || fitMode) cam = { x: 0, zoom: fitZoom(Math.max(1, fieldCanvas.clientWidth), world) };
  const view = fieldView(fieldCanvas, world, cam);
  cam = { x: view.camX, zoom: view.scale };
  return view;
}

/** Zoom by a factor, keeping the world point under screen x `sx` fixed. */
function zoomBy(factor: number, sx?: number): void {
  const view = currentView();
  fitMode = false;
  const anchor = sx ?? view.width / 2;
  const wx = toWorldX(view, anchor);
  const zoom = view.scale * factor;
  cam = clampCamera({ x: wx - anchor / zoom, zoom }, view.width, world);
}

function panBy(dxScreen: number): void {
  const view = currentView();
  fitMode = false;
  cam = clampCamera({ x: view.camX + dxScreen / view.scale, zoom: view.scale }, view.width, world);
}

/** Bring a world x into view, centred, zooming in a little if the whole field is showing. */
function focusOn(wx: number): void {
  const view = currentView();
  fitMode = false;
  const zoom = showsWholeField(view, world) ? Math.max(view.scale, 1) : view.scale;
  cam = clampCamera({ x: wx - view.width / zoom / 2, zoom }, view.width, world);
}

function zoomFit(): void {
  fitMode = true;
  cam = { x: 0, zoom: 0 };
}

// ---------- stats ----------

function refreshStats(): void {
  const live = world.livePlants();
  let flowers = 0;
  let topGen = 0;
  for (const p of live) {
    const f = world.geometry(p).flowers;
    flowers += f.y + f.p;
    topGen = Math.max(topGen, p.generation);
  }
  $('st-plants').textContent = String(live.filter((p) => p.stage !== 'seed').length);
  $('st-seeds').textContent = String(live.filter((p) => p.stage === 'seed').length);
  $('st-flowers').textContent = String(flowers);
  $('st-gen').textContent = String(topGen);
  $('st-born').textContent = String(world.stats.born);
  $('st-visits').textContent = String(world.stats.visits);
  $('st-collapsed').textContent = String(world.stats.collapsed);
  $('st-starved').textContent = String(world.stats.starved);
  $('st-old').textContent = String(world.stats.old);
  $('st-thirst').textContent = String(world.stats.thirst);
  $('st-recipes').textContent = String(world.genotypes().length);
  $('st-tick').textContent = `Tick ${world.tick} · ${live.length}/${world.settings.maxPlants} spots used`;
  world.zones.forEach((z, i) => {
    const weather = z.kind === 'rain' ? `🌧 Rain, ${z.ticksLeft} to go` : `☀️ Sun, ${z.ticksLeft} to go`;
    zoneBadges[i].textContent = `${weather} · soil ${Math.round(z.moisture * 100)}%`;
  });
}

// ---------- inspector ----------

function previewSteps(plant: Plant | null): number {
  return plant ? plant.steps : world.settings.maxSteps;
}

function refreshInspector(): void {
  const plant = selectedPlant();
  btnApply.disabled = !plant;
  btnClone.disabled = !plant;
  btnRemove.disabled = !plant;
  btnFamily.disabled = !plant;
  if (!editorDirty && plant) setEditor(plant.dna);

  const dna = dnaBox.value;
  const grown = world.preview(dna, previewSteps(plant));
  const highlight = grown.verdict.ok ? [] : grown.verdict.segs;
  drawInspector(inspCanvas, grown, highlight);

  if (grown.problems.length) {
    verdictEl.textContent = grown.problems[0];
    verdictEl.className = 'verdict bad';
  } else {
    verdictEl.textContent = (grown.verdict.ok ? '✔ ' : '✘ ') + describeVerdict(grown.verdict) + (editorDirty && plant ? ' (preview, not applied yet)' : '');
    verdictEl.className = 'verdict ' + (grown.verdict.ok ? 'ok' : 'bad');
  }

  const upkeep = world.upkeepFor(grown, 0);
  const need = world.waterNeedFor(grown);
  if (!plant) {
    titleEl.textContent = 'Seed designer';
    energyBar.style.width = '0%';
    energyLabel.textContent = '';
    infoEl.innerHTML = `<dt>Recipe size</dt><dd>${grown.str.length} symbols after ${grown.steps} steps</dd>
      <dt>Flowers</dt><dd>🟡 ${grown.flowers.y} · 🩷 ${grown.flowers.p}</dd>
      <dt>Upkeep</dt><dd>${upkeep.toFixed(1)} energy per tick when fully grown</dd>
      <dt>Water</dt><dd>needs soil at least ${Math.round(need * 100)}% wet</dd>
      <dt>Tip</dt><dd>Click a plant in the garden to see its recipe, or write one here and plant it.</dd>`;
    return;
  }

  const stageWords: Record<string, string> = {
    seed: 'a seed, waiting for rain',
    growing: 'growing',
    mature: 'fully grown',
    dying: plant.deathReason === 'collapsed' ? 'collapsed!' : plant.deathReason === 'starved' ? 'starved' : plant.deathReason === 'thirst' ? 'died of thirst' : 'died of old age',
  };
  const zone = world.zoneOfPlant(plant);
  const zoneName = world.zoneOf(plant.x) === 0 ? 'left' : 'right';
  const soilPct = Math.round(zone.moisture * 100);
  const needPct = Math.round(need * 100);
  const waterWord = need === 0 ? 'nothing yet' : `needs ${needPct}%, soil is ${soilPct}%${plant.thirst > 0 ? ` 💧 thirsty, −${plant.thirst.toFixed(1)}` : ''}`;
  titleEl.textContent = `${plant.name} · generation ${plant.generation}`;
  const pct = Math.round((100 * plant.energy) / world.settings.energyMax);
  energyBar.style.width = `${pct}%`;
  const net = plant.sun - plant.upkeep - plant.thirst;
  energyLabel.textContent = `energy ${Math.round(plant.energy)} · ${net >= 0 ? '+' : ''}${net.toFixed(1)} per tick`;
  const parents = plant.parents.length
    ? plant.parents.map((r) => `<button class="link" data-select="${r.id}">${r.name}</button>`).join(' + ')
    : 'none, a starter seed';
  const mutated = plant.mutated.length ? `<dt>Mutated</dt><dd class="mut">✨ rule${plant.mutated.length > 1 ? 's' : ''} ${plant.mutated.join(', ')}</dd>` : '';
  const sunWord = plant.stage === 'seed' ? 'none yet, seeds have no green' : `+${plant.sun.toFixed(1)} sunlight, −${plant.upkeep.toFixed(1)} upkeep`;
  infoEl.innerHTML = `<dt>Status</dt><dd>${stageWords[plant.stage]} · ${zoneName} climate</dd>
    <dt>Energy</dt><dd>${sunWord}</dd>
    <dt>Water</dt><dd>${waterWord}</dd>
    <dt>Age</dt><dd>${plant.age} of ${world.settings.lifespan} ticks</dd>
    <dt>Grown</dt><dd>${plant.steps} steps, ${grown.str.length} symbols</dd>
    <dt>Flowers</dt><dd>🟡 ${grown.flowers.y} · 🩷 ${grown.flowers.p}</dd>
    <dt>Parents</dt><dd>${parents}</dd>${mutated}`;
}

function select(id: number | null, focus = false): void {
  if (id !== selectedId) {
    selectedId = id;
    editorDirty = false;
    refreshInspector();
  }
  if (focus && id !== null) {
    const p = world.plantById(id);
    if (p) focusOn(p.x);
  }
}

infoEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-select]');
  if (!btn) return;
  const id = Number(btn.dataset.select);
  if (world.plantById(id)) select(id, true);
  else toast('That parent is gone now. Try the family tree.');
});

dnaBox.addEventListener('input', () => {
  editorDirty = true;
  fitEditor();
  refreshInspector();
});

btnApply.addEventListener('click', () => {
  const plant = selectedPlant();
  if (!plant) return;
  handleEvents(world.setDna(plant.id, dnaBox.value));
  editorDirty = false;
  refreshInspector();
  refreshStats();
});

btnClone.addEventListener('click', () => {
  const plant = selectedPlant();
  if (!plant) return;
  const seed = world.clonePlant(plant.id);
  if (!seed) return toast('No room for another seed');
  sounds.plip();
  select(seed.id, true);
  refreshStats();
});

$('btn-plant').addEventListener('click', () => {
  const rules = parseDna(dnaBox.value);
  if (!rules.A) return toast('The recipe needs a rule for A first');
  const seed = world.addSeed(formatDna(rules));
  if (!seed) return toast('No room for another seed');
  sounds.plip();
  select(seed.id, true);
  refreshStats();
});

$('btn-surprise').addEventListener('click', () => {
  setEditor(formatDna(randomDna(world.rng)));
  editorDirty = true;
  refreshInspector();
});

btnRemove.addEventListener('click', () => {
  const plant = selectedPlant();
  if (!plant) return;
  world.removePlant(plant.id);
  select(null);
  refreshStats();
});

// ---------- family tree ----------

btnFamily.addEventListener('click', () => {
  const plant = selectedPlant();
  if (!plant) return;
  setPaused(true);
  openFamilyTree(world, plant.id, {
    select: (id) => select(id, true),
    useRecipe: (dna) => {
      select(null);
      setEditor(dna);
      editorDirty = true;
      refreshInspector();
      toast('Recipe loaded into the seed designer');
    },
  });
});
$('family-close').addEventListener('click', closeFamilyTree);
$('family').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeFamilyTree();
});

// ---------- families ----------

let populationKey = '';
function refreshPopulation(): void {
  if (!populationEl.open) return;
  const fams = families.families.slice(0, 8);
  const total = world.livePlants().length || 1;
  const key = fams.map((f) => `${f.id}:${f.members.length}:${f.rep}`).join('|');
  if (key === populationKey) return;
  populationKey = key;
  populationBody.innerHTML = '';
  if (!fams.length) {
    populationBody.innerHTML = '<p class="muted">Nobody is alive right now.</p>';
    return;
  }
  for (const f of fams) {
    const row = document.createElement('div');
    row.className = 'geno';
    const canvas = document.createElement('canvas');
    const mid = document.createElement('div');
    const pct = Math.round((100 * f.members.length) / total);
    const grown = world.preview(f.rep, world.settings.maxSteps);
    const oldest = f.members.reduce((a, b) => (a.age >= b.age ? a : b));
    mid.innerHTML = `<div><span class="count">${f.members.length}</span> <span class="muted">${pct}% · ${f.variants} recipe${f.variants === 1 ? '' : 's'} · ${oldest.name}'s family</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="desc">${describePlant(grown)}</div>
      <div class="dna" title="${f.rep}">${f.rep}</div>`;
    const spark = document.createElement('canvas');
    spark.className = 'spark';
    spark.title = 'Family size over the last few hundred ticks';
    const btn = document.createElement('button');
    btn.textContent = '👀';
    btn.title = 'Show one of these';
    let i = 0;
    btn.addEventListener('click', () => {
      const p = f.members[i++ % f.members.length];
      if (world.plantById(p.id)) select(p.id, true);
    });
    const side = document.createElement('div');
    side.className = 'geno-side';
    side.append(spark, btn);
    row.append(canvas, mid, side);
    populationBody.append(row);
    drawInspector(canvas, grown, []);
    drawSparkline(spark, f.history);
  }
}

/** A tiny line chart of a family's size over time. */
function drawSparkline(canvas: HTMLCanvasElement, history: number[]): void {
  const dpr = window.devicePixelRatio || 1;
  const w = 64;
  const h = 22;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  const max = Math.max(...history, 1);
  ctx.strokeStyle = '#3d7d2f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  history.forEach((v, i) => {
    const x = (i / (history.length - 1)) * (w - 2) + 1;
    const y = h - 1 - (v / max) * (h - 3);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
populationEl.addEventListener('toggle', () => {
  populationKey = '';
  refreshPopulation();
});

// ---------- field interaction: click to select, drag to pan, wheel to pan, pinch or ctrl+wheel to zoom ----------

let drag: { startX: number; lastX: number; moved: boolean; pointerId: number } | null = null;

function canvasPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = fieldCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

fieldCanvas.addEventListener('pointerdown', (e) => {
  const pt = canvasPoint(e);
  const view = currentView();
  const mm = minimapRect(view);
  if (!showsWholeField(view, world) && pt.x >= mm.x && pt.x <= mm.x + mm.w && pt.y >= mm.y && pt.y <= mm.y + mm.h) {
    // Jump the view to where the minimap was clicked.
    fitMode = false;
    const wx = ((pt.x - mm.x) / mm.w) * world.settings.fieldWidth;
    cam = clampCamera({ x: wx - view.width / view.scale / 2, zoom: view.scale }, view.width, world);
    return;
  }
  drag = { startX: pt.x, lastX: pt.x, moved: false, pointerId: e.pointerId };
  fieldCanvas.setPointerCapture(e.pointerId);
});

fieldCanvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const pt = canvasPoint(e);
  if (!drag.moved && Math.abs(pt.x - drag.startX) > 5) drag.moved = true;
  if (drag.moved) {
    panBy(drag.lastX - pt.x);
    fieldCanvas.style.cursor = 'grabbing';
  }
  drag.lastX = pt.x;
});

const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const wasClick = !drag.moved;
  drag = null;
  fieldCanvas.style.cursor = '';
  if (wasClick) {
    const pt = canvasPoint(e);
    const hit = hitTest(world, currentView(), pt.x, pt.y);
    select(hit ? hit.id : null);
  }
};
fieldCanvas.addEventListener('pointerup', endDrag);
fieldCanvas.addEventListener('pointercancel', endDrag);

fieldCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const pt = canvasPoint(e);
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as ctrl+wheel; so does ctrl+scroll on a mouse.
      zoomBy(Math.exp(-e.deltaY * 0.01), pt.x);
    } else {
      panBy(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
    }
  },
  { passive: false },
);

$('btn-zoom-in').addEventListener('click', () => zoomBy(1.5));
$('btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.5));
$('btn-zoom-fit').addEventListener('click', zoomFit);

// ---------- controls ----------

function setPaused(p: boolean): void {
  paused = p;
  btnPlay.textContent = paused ? '▶ Play' : '⏸ Pause';
}

btnPlay.addEventListener('click', () => setPaused(!paused));
$('btn-step').addEventListener('click', () => {
  setPaused(true);
  acc = 0;
  doTick();
});
$('btn-rain').addEventListener('click', () => {
  world.rainNow();
  sounds.rainShower();
  refreshStats();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFamilyTree();
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.key === 'ArrowLeft') panBy(-80);
  else if (e.key === 'ArrowRight') panBy(80);
  else if (e.key === '+' || e.key === '=') zoomBy(1.5);
  else if (e.key === '-') zoomBy(1 / 1.5);
  else if (e.key === '0') zoomFit();
});

/** Speed slider: left is slow, right is fast; shown as ticks per second. */
const SPEED_MS = [3000, 2000, 1500, 1200, 1000, 700, 500, 300, 200, 100];
function speedLabel(ms: number): string {
  const tps = 1000 / ms;
  return `${tps >= 1 ? tps.toFixed(tps >= 5 ? 0 : 1) : tps.toFixed(2)} ticks/s`;
}
function applySpeed(): void {
  const ms = SPEED_MS[Number(speedInput.value) - 1];
  world.updateSettings({ tickMs: ms });
  speedOut.value = speedLabel(ms);
}
function syncSpeedUi(): void {
  const i = SPEED_MS.indexOf(world.settings.tickMs);
  speedInput.value = String(i >= 0 ? i + 1 : 5);
  speedOut.value = speedLabel(world.settings.tickMs);
}
speedInput.addEventListener('input', applySpeed);

// ---------- settings ----------

interface Spec {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const SPECS: Spec[] = [
  { key: 'rainLeft', label: 'Rain on the left', min: 0, max: 1, step: 0.05, format: pctFmt },
  { key: 'rainRight', label: 'Rain on the right', min: 0, max: 1, step: 0.05, format: pctFmt },
  { key: 'cycleLength', label: 'Weather cycle', min: 2, max: 400, step: 2, format: (v) => `${v} ticks` },
  { key: 'rainRate', label: 'Soil soaks', min: 0.01, max: 0.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%/tick` },
  { key: 'dryRate', label: 'Soil dries', min: 0.005, max: 0.3, step: 0.005, format: (v) => `${(v * 100).toFixed(1)}%/tick` },
  { key: 'waterScale', label: 'Thirstiness', min: 0, max: 0.05, step: 0.001, format: (v) => v.toFixed(3) },
  { key: 'thirstDamage', label: 'Thirst damage', min: 0, max: 10, step: 0.5, format: (v) => `${v.toFixed(1)}/10% dry` },
  { key: 'lifespan', label: 'Plant lifespan', min: 20, max: 2000, step: 20, format: (v) => `${v} ticks` },
  { key: 'bees', label: 'Bees', min: 0, max: 8, step: 1 },
  { key: 'butterflies', label: 'Butterflies', min: 0, max: 8, step: 1 },
  { key: 'maxPlants', label: 'Room for plants', min: 5, max: 300, step: 5 },
  { key: 'seedSpacing', label: 'Seed spacing', min: 2, max: 120, step: 2, format: (v) => `${v} px` },
  { key: 'maxSteps', label: 'Growth steps', min: 1, max: 30, step: 1 },
  { key: 'maxSymbols', label: 'Recipe size limit', min: 20, max: 1000, step: 10 },
  { key: 'turnAngle', label: 'Turn angle', min: 5, max: 90, step: 5, format: (v) => `${v}°` },
  { key: 'stepPx', label: 'Step size', min: 2, max: 30, step: 1, format: (v) => `${v} px` },
  { key: 'maxLoad', label: 'Green stem strength', min: 1, max: 60, step: 1, format: (v) => `${v} steps` },
  { key: 'sunPower', label: 'Sun strength', min: 0.1, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'rainLight', label: 'Light in rain', min: 0, max: 1, step: 0.05, format: pctFmt },
  { key: 'baseUpkeep', label: 'Cost of living', min: 0, max: 3, step: 0.1, format: (v) => v.toFixed(1) },
  { key: 'flowerUpkeep', label: 'Cost per flower', min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'woodUpkeep', label: 'Cost per wood bit', min: 0, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'startEnergy', label: 'Seed energy', min: 5, max: 100, step: 5 },
  { key: 'mutationRate', label: 'Mutation chance', min: 0, max: 1, step: 0.05, format: pctFmt },
  { key: 'visitChance', label: 'Bug curiosity', min: 0, max: 1, step: 0.05, format: pctFmt },
];

const settingInputs = new Map<keyof Settings, HTMLInputElement>();

function buildSettings(): void {
  const body = $('settings-body');
  body.innerHTML = '';
  for (const spec of SPECS) {
    const label = document.createElement('label');
    label.className = 'slider';
    const name = document.createElement('span');
    name.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const out = document.createElement('output');
    const show = () => (out.value = spec.format ? spec.format(Number(input.value)) : input.value);
    input.addEventListener('input', () => {
      show();
      handleEvents(world.updateSettings({ [spec.key]: Number(input.value) } as Partial<Settings>));
      refreshStats();
      refreshInspector();
    });
    label.append(name, input, out);
    body.append(label);
    settingInputs.set(spec.key, input);
    input.value = String(world.settings[spec.key]);
    show();
  }
  const selfing = $<HTMLInputElement>('selfing');
  selfing.checked = world.settings.allowSelfing;
  selfing.onchange = () => world.updateSettings({ allowSelfing: selfing.checked });
}

function syncSettingsUi(): void {
  for (const spec of SPECS) {
    const input = settingInputs.get(spec.key);
    if (!input) continue;
    input.value = String(world.settings[spec.key]);
    input.dispatchEvent(new Event('input'));
  }
  $<HTMLInputElement>('selfing').checked = world.settings.allowSelfing;
  syncSpeedUi();
}

const worldWidth = $<HTMLInputElement>('world-width');
worldWidth.addEventListener('input', () => ($('world-width-out') as HTMLOutputElement).value = `${worldWidth.value} px`);

// ---------- legend ----------

function buildStarters(): void {
  const wrap = $('starters');
  for (const s of STARTERS) {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.title = `${s.dna} — ${s.blurb}`;
    b.addEventListener('click', () => {
      select(null);
      setEditor(s.dna);
      editorDirty = true;
      refreshInspector();
      toast(`${s.name}: ${s.blurb}`);
    });
    wrap.append(b);
  }
}

// ---------- save / load / new ----------

function replaceWorld(next: World): void {
  world = next;
  selectedId = null;
  editorDirty = false;
  acc = 0;
  zoomFit();
  families.reset();
  families.update(world.livePlants());
  populationKey = '';
  syncSettingsUi();
  refreshStats();
  refreshInspector();
  refreshPopulation();
  autosave();
}

$('btn-save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(world.toJSON(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grammar-garden-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Garden saved');
});

const fileInput = $<HTMLInputElement>('file-input');
$('btn-load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    replaceWorld(World.fromJSON(JSON.parse(await file.text()) as SaveFile));
    toast(`Loaded ${file.name}`);
  } catch (err) {
    toast(`Could not load that file: ${(err as Error).message}`);
  }
});

$('btn-new').addEventListener('click', () => {
  if (!confirm('Start a brand new garden? The current one will be replaced (save it first if you want to keep it).')) return;
  replaceWorld(World.newGarden({ ...DEFAULT_SETTINGS, tickMs: world.settings.tickMs, fieldWidth: Number($<HTMLInputElement>('world-width').value) }));
  toast('A fresh field of seeds');
});

// ---------- sound ----------

const volume = $<HTMLInputElement>('volume');
const mute = $('mute');
volume.addEventListener('input', () => {
  sounds.setVolume(Number(volume.value));
  mute.textContent = Number(volume.value) === 0 || sounds.muted ? '🔇' : '🔊';
});
const toggleMute = () => {
  sounds.setMuted(!sounds.muted);
  mute.textContent = sounds.muted ? '🔇' : '🔊';
};
mute.addEventListener('click', toggleMute);
mute.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') toggleMute();
});
const unlock = () => sounds.unlock();
document.addEventListener('pointerdown', unlock, { capture: true });
document.addEventListener('keydown', unlock, { capture: true });

// ---------- go ----------

buildSettings();
buildStarters();
syncSpeedUi();
if (!world.plants.length) world = World.newGarden();
setEditor(STARTERS[3].dna);
families.update(world.livePlants());
refreshStats();
window.addEventListener('resize', () => {
  refreshInspector();
  populationKey = '';
  refreshPopulation();
});
// First draw after layout has settled, so canvases measure their real size.
requestAnimationFrame((now) => {
  last = now;
  refreshInspector();
  refreshPopulation();
  frame(now);
});
