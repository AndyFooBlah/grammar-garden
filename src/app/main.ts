import { randomDna } from '../core/genetics';
import { formatDna, parseDna } from '../core/grammar';
import { describeVerdict } from '../core/structure';
import { STARTERS } from '../core/starters';
import { DEFAULT_SETTINGS, World, type Plant, type SaveFile, type Settings, type WorldEvent } from '../core/world';
import { Sounds } from './audio';
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
const healthBar = $('health-bar');
const toastEl = $('toast');
const weatherBadge = $('weather-badge');
const btnPlay = $<HTMLButtonElement>('btn-play');
const btnApply = $<HTMLButtonElement>('btn-apply');
const btnClone = $<HTMLButtonElement>('btn-clone');
const btnRemove = $<HTMLButtonElement>('btn-remove');
const speedInput = $<HTMLInputElement>('speed');
const speedOut = $<HTMLOutputElement>('speed-out');

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
  $('st-shaded').textContent = String(world.stats.shaded);
  $('st-old').textContent = String(world.stats.old);
  $('st-tick').textContent = `Tick ${world.tick} · ${live.length}/${world.settings.maxPlants} spots used`;
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
  if (!editorDirty) dnaBox.value = plant ? plant.dna : dnaBox.value;

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

  if (!plant) {
    titleEl.textContent = 'Seed designer';
    healthBar.style.width = '0%';
    infoEl.innerHTML = `<dt>Recipe size</dt><dd>${grown.str.length} symbols after ${grown.steps} steps</dd>
      <dt>Flowers</dt><dd>🟡 ${grown.flowers.y} · 🩷 ${grown.flowers.p}</dd>
      <dt>Tip</dt><dd>Click a plant in the garden to see its recipe, or write one here and plant it.</dd>`;
    return;
  }

  const stageWords: Record<string, string> = {
    seed: 'a seed, waiting for rain',
    growing: plant.shaded ? 'growing, but shaded by a neighbour' : 'growing',
    mature: plant.shaded ? 'fully grown, shaded by a neighbour' : 'fully grown',
    dying: plant.deathReason === 'collapsed' ? 'collapsed!' : plant.deathReason === 'shaded' ? 'faded away in the shade' : 'died of old age',
  };
  titleEl.textContent = `${plant.name} · generation ${plant.generation}`;
  healthBar.style.width = `${plant.health}%`;
  const parents = plant.parents.length
    ? plant.parents.map((r) => `<button class="link" data-select="${r.id}">${r.name}</button>`).join(' + ')
    : 'none, a starter seed';
  const mutated = plant.mutated.length ? `<dt>Mutated</dt><dd class="mut">✨ rule${plant.mutated.length > 1 ? 's' : ''} ${plant.mutated.join(', ')}</dd>` : '';
  infoEl.innerHTML = `<dt>Status</dt><dd>${stageWords[plant.stage]}</dd>
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
  else toast('That parent is gone now');
});

dnaBox.addEventListener('input', () => {
  editorDirty = true;
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
  dnaBox.value = formatDna(randomDna(world.rng));
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
  if (e.code === 'Space' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    setPaused(!paused);
  }
});

/** Speed slider: 1 = slow (3 s per tick), 10 = fast (0.1 s per tick). */
const SPEED_MS = [3000, 2000, 1500, 1200, 1000, 700, 500, 300, 200, 100];
function applySpeed(): void {
  const ms = SPEED_MS[Number(speedInput.value) - 1];
  world.updateSettings({ tickMs: ms });
  speedOut.value = `${(ms / 1000).toFixed(1)}s`;
}
speedInput.addEventListener('input', applySpeed);
speedInput.value = String(SPEED_MS.indexOf(world.settings.tickMs) + 1 || 5);
speedOut.value = `${(world.settings.tickMs / 1000).toFixed(1)}s`;

// ---------- settings ----------

interface Spec {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

const SPECS: Spec[] = [
  { key: 'sunTicks', label: 'Sunny spell', min: 2, max: 60, step: 1, format: (v) => `${v} ticks` },
  { key: 'rainTicks', label: 'Rain spell', min: 1, max: 40, step: 1, format: (v) => `${v} ticks` },
  { key: 'lifespan', label: 'Plant lifespan', min: 10, max: 600, step: 10, format: (v) => `${v} ticks` },
  { key: 'bees', label: 'Bees', min: 0, max: 8, step: 1 },
  { key: 'butterflies', label: 'Butterflies', min: 0, max: 8, step: 1 },
  { key: 'maxPlants', label: 'Room for plants', min: 5, max: 60, step: 1 },
  { key: 'seedSpacing', label: 'Seed spacing', min: 10, max: 120, step: 5, format: (v) => `${v} px` },
  { key: 'maxSteps', label: 'Growth steps', min: 1, max: 30, step: 1 },
  { key: 'maxSymbols', label: 'Recipe size limit', min: 20, max: 1000, step: 10 },
  { key: 'turnAngle', label: 'Turn angle', min: 5, max: 90, step: 5, format: (v) => `${v}°` },
  { key: 'stepPx', label: 'Step size', min: 2, max: 30, step: 1, format: (v) => `${v} px` },
  { key: 'maxLoad', label: 'Green stem strength', min: 1, max: 60, step: 1, format: (v) => `${v} steps` },
  { key: 'mutationRate', label: 'Mutation chance', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'shadeMargin', label: 'Shade reach', min: 0, max: 60, step: 2, format: (v) => `${v} px` },
  { key: 'visitChance', label: 'Bug curiosity', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
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
  speedInput.value = String(SPEED_MS.indexOf(world.settings.tickMs) + 1 || 5);
  speedOut.value = `${(world.settings.tickMs / 1000).toFixed(1)}s`;
}

// ---------- legend ----------

function buildStarters(): void {
  const wrap = $('starters');
  for (const s of STARTERS) {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.title = `${s.dna} — ${s.blurb}`;
    b.addEventListener('click', () => {
      dnaBox.value = s.dna;
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
  sounds.setRain(world.weather.kind === 'rain');
  syncSettingsUi();
  refreshStats();
  refreshInspector();
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
if (!world.plants.length) world = World.newGarden();
dnaBox.value = STARTERS[3].dna;
refreshStats();
window.addEventListener('resize', refreshInspector);
// First draw after layout has settled, so canvases measure their real size.
requestAnimationFrame((now) => {
  last = now;
  refreshInspector();
  frame(now);
});
