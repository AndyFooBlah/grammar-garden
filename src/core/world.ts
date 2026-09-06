/**
 * The garden: plants, bugs, weather and time. A pure state machine driven by a
 * seeded RNG, so a saved garden replays identically.
 */
import { crossover, mutate, randomDna } from './genetics';
import { formatDna, parseDna } from './grammar';
import { randomName } from './names';
import { growPlant, type GrownPlant } from './plant';
import { Rng } from './rng';
import { STARTERS } from './starters';

export interface Settings {
  tickMs: number;
  sunTicks: number;
  rainTicks: number;
  lifespan: number;
  bees: number;
  butterflies: number;
  maxPlants: number;
  seedSpacing: number;
  maxSteps: number;
  maxSymbols: number;
  turnAngle: number;
  stepPx: number;
  maxLoad: number;
  mutationRate: number;
  shadeMargin: number;
  allowSelfing: boolean;
  fieldWidth: number;
  skyHeight: number;
  bugSpeed: number;
  visitChance: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tickMs: 1000,
  sunTicks: 20,
  rainTicks: 8,
  lifespan: 150,
  bees: 2,
  butterflies: 2,
  maxPlants: 30,
  seedSpacing: 40,
  maxSteps: 12,
  maxSymbols: 200,
  turnAngle: 15,
  stepPx: 12,
  maxLoad: 12,
  mutationRate: 0.15,
  shadeMargin: 10,
  allowSelfing: false,
  fieldWidth: 1200,
  skyHeight: 320,
  bugSpeed: 150,
  visitChance: 0.6,
};

/** Settings that change plant geometry; changing one regrows every plant. */
const GEOMETRY_KEYS: (keyof Settings)[] = ['turnAngle', 'stepPx', 'maxLoad', 'maxSymbols'];

const SHADE_DAMAGE = 4;
const OLD_AGE_DAMAGE = 3;
export const DYING_TICKS = 3;
const SKY_BOTTOM = 40;
const EDGE_MARGIN = 20;

export type Stage = 'seed' | 'growing' | 'mature' | 'dying';
export type DeathReason = 'collapsed' | 'shaded' | 'old';
export type WeatherKind = 'sun' | 'rain';

export interface ParentRef {
  id: number;
  name: string;
}

export interface Plant {
  id: number;
  name: string;
  dna: string;
  x: number;
  steps: number;
  age: number;
  health: number;
  stage: Stage;
  generation: number;
  parents: ParentRef[];
  /** Rule names that mutated when this plant was born. */
  mutated: string[];
  shaded: boolean;
  deathReason?: DeathReason;
  dyingTicks?: number;
}

export type BugKind = 'bee' | 'butterfly';

export interface Pollen {
  plantId: number;
  name: string;
  dna: string;
  generation: number;
}

export interface Bug {
  id: number;
  kind: BugKind;
  x: number;
  y: number;
  /** Position at the previous tick, for smooth drawing. */
  px: number;
  py: number;
  tx: number;
  ty: number;
  targetPlant: number | null;
  targetFlower: number;
  carrying: Pollen | null;
  rest: number;
}

export type WorldEvent =
  | { type: 'planted'; x: number }
  | { type: 'born'; x: number }
  | { type: 'visit'; kind: BugKind; x: number; y: number }
  | { type: 'collapse'; x: number }
  | { type: 'death'; x: number }
  | { type: 'weather'; kind: WeatherKind };

export interface Stats {
  planted: number;
  born: number;
  collapsed: number;
  shaded: number;
  old: number;
  visits: number;
}

export interface Weather {
  kind: WeatherKind;
  ticksLeft: number;
}

export interface SaveFile {
  version: 1;
  savedAt: string;
  tick: number;
  weather: Weather;
  rngState: number;
  settings: Settings;
  stats: Stats;
  plants: Plant[];
  bugs: Bug[];
  nextId: number;
}

interface CacheEntry {
  key: string;
  grown: GrownPlant;
}

export class World {
  tick = 0;
  weather: Weather = { kind: 'sun', ticksLeft: DEFAULT_SETTINGS.sunTicks };
  settings: Settings;
  stats: Stats = { planted: 0, born: 0, collapsed: 0, shaded: 0, old: 0, visits: 0 };
  plants: Plant[] = [];
  bugs: Bug[] = [];
  nextId = 1;
  rng: Rng;
  private cache = new Map<number, CacheEntry>();

  constructor(settings: Partial<Settings> = {}, seed = Date.now() % 2147483647) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = new Rng(seed);
    this.weather = { kind: 'sun', ticksLeft: this.settings.sunTicks };
  }

  /** A fresh garden with the starter recipes and a few random ones. */
  static newGarden(settings: Partial<Settings> = {}, seed?: number): World {
    const w = new World(settings, seed);
    const recipes = STARTERS.map((s) => s.dna);
    for (let i = 0; i < 3; i++) recipes.push(formatDna(randomDna(w.rng)));
    // Spread seeds evenly with a little jitter, in shuffled order.
    const order = recipes.map((_, i) => i).sort(() => w.rng.next() - 0.5);
    const usable = w.settings.fieldWidth - 2 * EDGE_MARGIN;
    const slot = usable / recipes.length;
    order.forEach((ri, slotIndex) => {
      const x = EDGE_MARGIN + slot * (slotIndex + 0.5) + w.rng.range(-slot * 0.25, slot * 0.25);
      w.addSeed(recipes[ri], { x, silent: true });
    });
    w.syncBugs();
    return w;
  }

  // ---------- geometry ----------

  private geometryKey(): string {
    return GEOMETRY_KEYS.map((k) => this.settings[k]).join('|');
  }

  /** Grown geometry for a plant at its current step, cached. */
  geometry(plant: Plant): GrownPlant {
    const key = `${plant.dna}|${plant.steps}|${this.geometryKey()}`;
    const hit = this.cache.get(plant.id);
    if (hit && hit.key === key) return hit.grown;
    const grown = growPlant(plant.dna, plant.steps, this.settings);
    this.cache.set(plant.id, { key, grown });
    return grown;
  }

  /** Grow a DNA string without touching the world, for previews. */
  preview(dna: string, steps: number): GrownPlant {
    return growPlant(dna, steps, this.settings);
  }

  livePlants(): Plant[] {
    return this.plants.filter((p) => p.stage !== 'dying');
  }

  plantById(id: number): Plant | undefined {
    return this.plants.find((p) => p.id === id);
  }

  // ---------- seeds ----------

  /** A free spot on the ground, or null when the field is full. */
  findFreeX(): number | null {
    const s = this.settings;
    if (this.livePlants().length >= s.maxPlants) return null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = this.rng.range(EDGE_MARGIN, s.fieldWidth - EDGE_MARGIN);
      if (this.plants.every((p) => Math.abs(p.x - x) >= s.seedSpacing)) return x;
    }
    return null;
  }

  addSeed(
    dna: string,
    opts: { x?: number; parents?: ParentRef[]; generation?: number; mutated?: string[]; silent?: boolean } = {},
  ): Plant | null {
    const x = opts.x ?? this.findFreeX();
    if (x === null) return null;
    const plant: Plant = {
      id: this.nextId++,
      name: randomName(this.rng),
      dna: formatDna(parseDna(dna)),
      x,
      steps: 0,
      age: 0,
      health: 100,
      stage: 'seed',
      generation: opts.generation ?? 0,
      parents: opts.parents ?? [],
      mutated: opts.mutated ?? [],
      shaded: false,
    };
    this.plants.push(plant);
    if (!opts.silent) this.stats.planted++;
    return plant;
  }

  removePlant(id: number): void {
    this.plants = this.plants.filter((p) => p.id !== id);
    this.cache.delete(id);
    for (const b of this.bugs) if (b.targetPlant === id) b.targetPlant = null;
  }

  /** Replace a plant's DNA and regrow it at its current step. May collapse it. */
  setDna(id: number, dna: string): WorldEvent[] {
    const plant = this.plantById(id);
    if (!plant || plant.stage === 'dying') return [];
    plant.dna = formatDna(parseDna(dna));
    plant.mutated = [];
    return this.regrow(plant);
  }

  clonePlant(id: number): Plant | null {
    const plant = this.plantById(id);
    if (!plant) return null;
    return this.addSeed(plant.dna, { parents: [{ id: plant.id, name: plant.name }], generation: plant.generation });
  }

  /** Recompute a plant at its current step count and apply the structure verdict. */
  private regrow(plant: Plant): WorldEvent[] {
    this.cache.delete(plant.id);
    const grown = this.geometry(plant);
    if (grown.steps !== plant.steps) {
      // Fewer steps were possible than recorded (for example a lower symbol cap).
      plant.steps = grown.steps;
      this.cache.set(plant.id, { key: `${plant.dna}|${plant.steps}|${this.geometryKey()}`, grown });
    }
    if (!grown.verdict.ok) return [this.kill(plant, 'collapsed')];
    this.updateStage(plant, grown);
    return [];
  }

  private updateStage(plant: Plant, grown: GrownPlant): void {
    if (plant.stage === 'dying') return;
    if (plant.steps === 0) plant.stage = 'seed';
    else if (grown.finished || grown.capped || plant.steps >= this.settings.maxSteps) plant.stage = 'mature';
    else plant.stage = 'growing';
  }

  private kill(plant: Plant, reason: DeathReason): WorldEvent {
    plant.stage = 'dying';
    plant.deathReason = reason;
    plant.dyingTicks = DYING_TICKS;
    for (const b of this.bugs) if (b.targetPlant === plant.id) b.targetPlant = null;
    if (reason === 'collapsed') {
      this.stats.collapsed++;
      return { type: 'collapse', x: plant.x };
    }
    if (reason === 'shaded') this.stats.shaded++;
    else this.stats.old++;
    return { type: 'death', x: plant.x };
  }

  // ---------- settings ----------

  updateSettings(patch: Partial<Settings>): WorldEvent[] {
    const before = this.geometryKey();
    this.settings = { ...this.settings, ...patch };
    const events: WorldEvent[] = [];
    if (this.geometryKey() !== before) {
      this.cache.clear();
      for (const p of this.livePlants()) events.push(...this.regrow(p));
    }
    this.syncBugs();
    return events;
  }

  // ---------- time ----------

  /** Advance one tick. Returns the events that happened, for sounds and effects. */
  step(): WorldEvent[] {
    const events: WorldEvent[] = [];
    this.tick++;
    this.advanceWeather(events);
    this.updateShade();
    if (this.weather.kind === 'rain') this.growAll(events);
    this.ageAll(events);
    this.syncBugs();
    this.moveBugs(events);
    return events;
  }

  private advanceWeather(events: WorldEvent[]): void {
    this.weather.ticksLeft--;
    if (this.weather.ticksLeft > 0) return;
    if (this.weather.kind === 'sun') this.weather = { kind: 'rain', ticksLeft: this.settings.rainTicks };
    else this.weather = { kind: 'sun', ticksLeft: this.settings.sunTicks };
    events.push({ type: 'weather', kind: this.weather.kind });
  }

  /** A plant is shaded when a taller neighbour's canopy reaches over its root. */
  private updateShade(): void {
    const live = this.livePlants();
    const geos = live.map((p) => this.geometry(p));
    const margin = this.settings.shadeMargin;
    live.forEach((p, i) => {
      p.shaded = false;
      for (let j = 0; j < live.length; j++) {
        if (i === j) continue;
        const q = live[j];
        const gq = geos[j];
        if (gq.height <= geos[i].height + 1) continue;
        if (p.x >= q.x + gq.geo.minX - margin && p.x <= q.x + gq.geo.maxX + margin) {
          p.shaded = true;
          break;
        }
      }
    });
  }

  private growAll(events: WorldEvent[]): void {
    for (const plant of this.livePlants()) {
      if (plant.shaded || plant.stage === 'mature') continue;
      if (plant.steps >= this.settings.maxSteps) {
        plant.stage = 'mature';
        continue;
      }
      const next = growPlant(plant.dna, plant.steps + 1, this.settings);
      if (next.steps === plant.steps) {
        plant.stage = 'mature';
        continue;
      }
      plant.steps = next.steps;
      this.cache.set(plant.id, { key: `${plant.dna}|${plant.steps}|${this.geometryKey()}`, grown: next });
      if (!next.verdict.ok) {
        events.push(this.kill(plant, 'collapsed'));
        continue;
      }
      this.updateStage(plant, next);
    }
  }

  private ageAll(events: WorldEvent[]): void {
    for (const plant of this.plants) {
      if (plant.stage === 'dying') {
        plant.dyingTicks = (plant.dyingTicks ?? DYING_TICKS) - 1;
        continue;
      }
      plant.age++;
      if (plant.shaded) plant.health -= SHADE_DAMAGE;
      if (plant.age > this.settings.lifespan) plant.health -= OLD_AGE_DAMAGE;
      if (plant.health <= 0) {
        plant.health = 0;
        events.push(this.kill(plant, plant.shaded ? 'shaded' : 'old'));
      }
    }
    const gone = this.plants.filter((p) => p.stage === 'dying' && (p.dyingTicks ?? 0) <= 0);
    for (const p of gone) this.removePlant(p.id);
  }

  // ---------- bugs ----------

  private shelter(kind: BugKind): { x: number; y: number } {
    return { x: kind === 'bee' ? 30 : this.settings.fieldWidth - 30, y: -SKY_BOTTOM };
  }

  /** Make the bug population match the settings. */
  private syncBugs(): void {
    for (const kind of ['bee', 'butterfly'] as BugKind[]) {
      const want = kind === 'bee' ? this.settings.bees : this.settings.butterflies;
      const have = this.bugs.filter((b) => b.kind === kind);
      for (let i = have.length; i < want; i++) {
        const s = this.shelter(kind);
        this.bugs.push({
          id: this.nextId++,
          kind,
          x: s.x,
          y: s.y,
          px: s.x,
          py: s.y,
          tx: s.x,
          ty: s.y,
          targetPlant: null,
          targetFlower: 0,
          carrying: null,
          rest: 0,
        });
      }
      for (let i = want; i < have.length; i++) this.bugs = this.bugs.filter((b) => b !== have[i]);
    }
  }

  private randomSkyPoint(): { x: number; y: number } {
    return {
      x: this.rng.range(EDGE_MARGIN, this.settings.fieldWidth - EDGE_MARGIN),
      y: -this.rng.range(SKY_BOTTOM, this.settings.skyHeight),
    };
  }

  /** Plants with flowers of the bug's colour, weighted by flower count. */
  private chooseFlowerPlant(bug: Bug): Plant | null {
    const kind = bug.kind === 'bee' ? 'y' : 'p';
    const candidates = this.livePlants().filter((p) => p.stage !== 'seed');
    const weights = candidates.map((p) => this.geometry(p).flowers[kind]);
    const i = this.rng.weighted(weights);
    return i < 0 ? null : candidates[i];
  }

  private moveTowards(bug: Bug, tx: number, ty: number): boolean {
    const dx = tx - bug.x;
    const dy = ty - bug.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= this.settings.bugSpeed) {
      bug.x = tx;
      bug.y = ty;
      return true;
    }
    bug.x += (dx / dist) * this.settings.bugSpeed;
    bug.y += (dy / dist) * this.settings.bugSpeed;
    return false;
  }

  private moveBugs(events: WorldEvent[]): void {
    for (const bug of this.bugs) {
      bug.px = bug.x;
      bug.py = bug.y;
      if (this.weather.kind === 'rain') {
        const s = this.shelter(bug.kind);
        bug.targetPlant = null;
        this.moveTowards(bug, s.x, s.y);
        continue;
      }
      if (bug.rest > 0) {
        bug.rest--;
        continue;
      }
      if (bug.targetPlant !== null) {
        const plant = this.plantById(bug.targetPlant);
        const grown = plant && plant.stage !== 'dying' ? this.geometry(plant) : null;
        const kind = bug.kind === 'bee' ? 'y' : 'p';
        const flowers = grown ? grown.geo.flowers.filter((f) => f.kind === kind) : [];
        if (!plant || !grown || flowers.length === 0) {
          bug.targetPlant = null;
        } else {
          const f = flowers[Math.min(bug.targetFlower, flowers.length - 1)];
          bug.tx = plant.x + f.x;
          bug.ty = f.y;
          if (this.moveTowards(bug, bug.tx, bug.ty)) {
            this.visit(bug, plant, events);
            bug.targetPlant = null;
            bug.rest = 1;
          }
          continue;
        }
      }
      // Wandering: pick a flower to visit or a random point in the sky.
      const arrived = Math.hypot(bug.tx - bug.x, bug.ty - bug.y) < 1;
      if (arrived) {
        const plant = this.rng.chance(this.settings.visitChance) ? this.chooseFlowerPlant(bug) : null;
        if (plant) {
          bug.targetPlant = plant.id;
          bug.targetFlower = this.rng.int(1000);
          continue;
        }
        const p = this.randomSkyPoint();
        bug.tx = p.x;
        bug.ty = p.y;
      }
      this.moveTowards(bug, bug.tx, bug.ty);
    }
  }

  /** The bug lands on a flower: pick up pollen, or make a seed from two parents. */
  private visit(bug: Bug, plant: Plant, events: WorldEvent[]): void {
    this.stats.visits++;
    events.push({ type: 'visit', kind: bug.kind, x: bug.x, y: bug.y });
    const here: Pollen = { plantId: plant.id, name: plant.name, dna: plant.dna, generation: plant.generation };
    if (!bug.carrying) {
      bug.carrying = here;
      return;
    }
    if (bug.carrying.plantId === plant.id && !this.settings.allowSelfing) return;
    const mother = bug.carrying;
    const childRules = crossover(parseDna(mother.dna), parseDna(plant.dna), this.rng);
    const { rules, mutated } = mutate(childRules, this.settings.mutationRate, this.rng);
    bug.carrying = null;
    const child = this.addSeed(formatDna(rules), {
      parents: [
        { id: mother.plantId, name: mother.name },
        { id: plant.id, name: plant.name },
      ],
      generation: Math.max(mother.generation, plant.generation) + 1,
      mutated,
      silent: true,
    });
    if (child) {
      this.stats.born++;
      events.push({ type: 'born', x: child.x });
    }
  }

  // ---------- save / load ----------

  toJSON(): SaveFile {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      tick: this.tick,
      weather: { ...this.weather },
      rngState: this.rng.state,
      settings: { ...this.settings },
      stats: { ...this.stats },
      plants: this.plants.map((p) => ({ ...p, parents: p.parents.map((r) => ({ ...r })), mutated: [...p.mutated] })),
      bugs: this.bugs.map((b) => ({ ...b, carrying: b.carrying ? { ...b.carrying } : null })),
      nextId: this.nextId,
    };
  }

  static fromJSON(data: SaveFile): World {
    if (!data || data.version !== 1 || !Array.isArray(data.plants)) throw new Error('Not a Grammar Garden save file');
    const w = new World({ ...DEFAULT_SETTINGS, ...data.settings }, 1);
    w.rng.state = data.rngState;
    w.tick = data.tick;
    w.weather = { ...data.weather };
    w.stats = { ...w.stats, ...data.stats };
    w.plants = data.plants.map((p) => ({ ...p, parents: p.parents ?? [], mutated: p.mutated ?? [], shaded: p.shaded ?? false }));
    w.bugs = (data.bugs ?? []).map((b) => ({ ...b }));
    w.nextId = data.nextId;
    w.syncBugs();
    return w;
  }
}
