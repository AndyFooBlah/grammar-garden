import { randomDna } from '../core/genetics';
import { formatDna, formatDnaLines, parseDna } from '../core/grammar';
import { describeVerdict } from '../core/structure';
import { STARTERS } from '../core/starters';
import { DEFAULT_SETTINGS, World, type Plant, type SaveFile, type Settings, type WorldEvent } from '../core/world';
import { Sounds } from './audio';
import { closeFamilyTree, openFamilyTree } from './family';
import { drawField, drawInspector, fieldView, hitTest } from './render';

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
const weatherBadge = $('weather-badge');
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
        sounds.setRain(e.kind === 'rain');
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
  const view = fieldView(fieldCanvas, world);
  drawField(fieldCtx, world, view, { t: Math.min(1, acc / tickMs), time: now, selectedId });
  requestAnimationFrame(frame);
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
  $('st-tick').textContent = `Tick ${world.tick} · ${live.length}/${world.settings.maxPlants} spots used · ${world.genotypes().length} different recipes`;
  const w = world.weather;
  weatherBadge.textContent = w.kind === 'rain' ? `🌧 Raining, ${w.ticksLeft} to go` : `☀️ Sunny, ${w.ticksLeft} to go`;
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
  if (!plant) {
    titleEl.textContent = 'Seed designer';
    energyBar.style.width = '0%';
    energyLabel.textContent = '';
    infoEl.innerHTML = `<dt>Recipe size</dt><dd>${grown.str.length} symbols after ${grown.steps} steps</dd>
      <dt>Flowers</dt><dd>🟡 ${grown.flowers.y} · 🩷 ${grown.flowers.p}</dd>
      <dt>Upkeep</dt><dd>${upkeep.toFixed(1)} energy per tick when fully grown</dd>
      <dt>Tip</dt><dd>Click a plant in the garden to see its recipe, or write one here and plant it.</dd>`;
    return;
  }

  const stageWords: Record<string, string> = {
    seed: 'a seed, waiting for rain',
    growing: 'growing',
    mature: 'fully grown',
    dying: plant.deathReason === 'collapsed' ? 'collapsed!' : plant.deathReason === 'starved' ? 'starved' : 'died of old age',
  };
  titleEl.textContent = `${plant.name} · generation ${plant.generation}`;
  const pct = Math.round((100 * plant.energy) / world.settings.energyMax);
  energyBar.style.width = `${pct}%`;
  const net = plant.sun - plant.upkeep;
  energyLabel.textContent = `energy ${Math.round(plant.energy)} · ${net >= 0 ? '+' : ''}${net.toFixed(1)} per tick`;
  const parents = plant.parents.length
    ? plant.parents.map((r) => `<button class="link" data-select="${r.id}">${r.name}</button>`).join(' + ')
    : 'none, a starter seed';
  const mutated = plant.mutated.length ? `<dt>Mutated</dt><dd class="mut">✨ rule${plant.mutated.length > 1 ? 's' : ''} ${plant.mutated.join(', ')}</dd>` : '';
  const sunWord = plant.stage === 'seed' ? 'none yet, seeds have no green' : `+${plant.sun.toFixed(1)} sunlight, −${plant.upkeep.toFixed(1)} upkeep`;
  infoEl.innerHTML = `<dt>Status</dt><dd>${stageWords[plant.stage]}</dd>
    <dt>Energy</dt><dd>${sunWord}</dd>
    <dt>Age</dt><dd>${plant.age} of ${world.settings.lifespan} ticks</dd>
    <dt>Grown</dt><dd>${plant.steps} steps, ${grown.str.length} symbols</dd>
    <dt>Flowers</dt><dd>🟡 ${grown.flowers.y} · 🩷 ${grown.flowers.p}</dd>
    <dt>Parents</dt><dd>${parents}</dd>${mutated}`;
}

function select(id: number | null): void {
  if (id === selectedId) return;
  selectedId = id;
  editorDirty = false;
  refreshInspector();
}

infoEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-select]');
  if (!btn) return;
  const id = Number(btn.dataset.select);
  if (world.plantById(id)) select(id);
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
  select(seed.id);
  refreshStats();
});

$('btn-plant').addEventListener('click', () => {
  const rules = parseDna(dnaBox.value);
  if (!rules.A) return toast('The recipe needs a rule for A first');
  const seed = world.addSeed(formatDna(rules));
  if (!seed) return toast('No room for another seed');
  sounds.plip();
  select(seed.id);
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
    select: (id) => select(id),
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

// ---------- population ----------

let populationKey = '';
function refreshPopulation(): void {
  if (!populationEl.open) return;
  const groups = world.genotypes().slice(0, 8);
  const total = world.livePlants().length || 1;
  const key = groups.map((g) => `${g.dna}:${g.count}`).join('|');
  if (key === populationKey) return;
  populationKey = key;
  populationBody.innerHTML = '';
  if (!groups.length) {
    populationBody.innerHTML = '<p class="muted">Nobody is alive right now.</p>';
    return;
  }
  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'geno';
    const canvas = document.createElement('canvas');
    const mid = document.createElement('div');
    const pct = Math.round((100 * g.count) / total);
    mid.innerHTML = `<div><span class="count">${g.count}</span> <span class="muted">${pct}% · like ${g.plants[0].name}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="dna" title="${g.dna}">${g.dna}</div>`;
    const btn = document.createElement('button');
    btn.textContent = '👀';
    btn.title = 'Show one of these';
    let i = 0;
    btn.addEventListener('click', () => {
      const p = g.plants[i++ % g.plants.length];
      if (world.plantById(p.id)) select(p.id);
    });
    row.append(canvas, mid, btn);
    populationBody.append(row);
    drawInspector(canvas, world.preview(g.dna, world.settings.maxSteps), []);
  }
}
populationEl.addEventListener('toggle', () => {
  populationKey = '';
  refreshPopulation();
});

// ---------- field interaction ----------

fieldCanvas.addEventListener('pointerdown', (e) => {
  const rect = fieldCanvas.getBoundingClientRect();
  const view = fieldView(fieldCanvas, world);
  const hit = hitTest(world, view, e.clientX - rect.left, e.clientY - rect.top);
  select(hit ? hit.id : null);
});

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
  if (world.weather.kind === 'rain') return;
  world.weather = { kind: 'rain', ticksLeft: world.settings.rainTicks };
  sounds.setRain(true);
  refreshStats();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFamilyTree();
  if (e.code === 'Space' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    setPaused(!paused);
  }
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
  { key: 'sunTicks', label: 'Sunny spell', min: 2, max: 60, step: 1, format: (v) => `${v} ticks` },
  { key: 'rainTicks', label: 'Rain spell', min: 1, max: 40, step: 1, format: (v) => `${v} ticks` },
  { key: 'lifespan', label: 'Plant lifespan', min: 20, max: 2000, step: 20, format: (v) => `${v} ticks` },
  { key: 'bees', label: 'Bees', min: 0, max: 8, step: 1 },
  { key: 'butterflies', label: 'Butterflies', min: 0, max: 8, step: 1 },
  { key: 'maxPlants', label: 'Room for plants', min: 5, max: 80, step: 1 },
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
  populationKey = '';
  sounds.setRain(world.weather.kind === 'rain');
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
  replaceWorld(World.newGarden({ ...DEFAULT_SETTINGS, tickMs: world.settings.tickMs }));
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
const unlock = () => {
  sounds.unlock();
  sounds.setRain(world.weather.kind === 'rain');
};
document.addEventListener('pointerdown', unlock, { capture: true });
document.addEventListener('keydown', unlock, { capture: true });

// ---------- go ----------

buildSettings();
buildStarters();
syncSpeedUi();
if (!world.plants.length) world = World.newGarden();
setEditor(STARTERS[3].dna);
refreshStats();
window.addEventListener('resize', refreshInspector);
// First draw after layout has settled, so canvases measure their real size.
requestAnimationFrame((now) => {
  last = now;
  refreshInspector();
  refreshPopulation();
  frame(now);
});
