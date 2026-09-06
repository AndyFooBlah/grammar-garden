/**
 * The garden: plants, bugs, weather, sunlight and time. A pure state machine
 * driven by a seeded RNG, so a saved garden replays identically.
 */
import { crossover, mutate, randomDna } from './genetics';
import { formatDna, parseDna } from './grammar';
import { computeLight, type LightMap } from './light';
import { randomName } from './names';
import { growPlant, type GrownPlant } from './plant';
import { Rng } from './rng';
import { STARTERS } from './starters';

export interface Settings {
  tickMs: number;
  /** Average fraction of rainy ticks in the left / right climate zone. */
  rainLeft: number;
  rainRight: number;
  /** Ticks in one rain-plus-sun cycle; 2 alternates every tick, 200 gives 100 of each. */
  cycleLength: number;
  /** Soil moisture gained per rainy tick and lost per sunny tick (linear). */
  rainRate: number;
  dryRate: number;
  /** Moisture a plant needs per unit of tissue: green counts 1, a flower 2, wood 0.2. */
  waterScale: number;
  /** Energy lost per tick for every 10% the soil is drier than the plant needs. */
  thirstDamage: number;
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
  allowSelfing: boolean;
  fieldWidth: number;
  skyHeight: number;
  bugSpeed: number;
  visitChance: number;
  /** Energy gained per unit of captured light on a sunny tick. */
  sunPower: number;
  /** Fraction of sunlight that still gets through on a rainy tick. */
  rainLight: number;
  /** Energy every plant pays per tick just to stay alive (seeds included). */
  baseUpkeep: number;
  woodUpkeep: number;
  greenUpkeep: number;
  flowerUpkeep: number;
  startEnergy: number;
  energyMax: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tickMs: 1000,
  rainLeft: 0.2,
  rainRight: 0.5,
  cycleLength: 28,
  rainRate: 0.1,
  dryRate: 0.04,
  waterScale: 0.01,
  thirstDamage: 3,
  lifespan: 400,
  bees: 4,
  butterflies: 4,
  maxPlants: 120,
  seedSpacing: 12,
  maxSteps: 12,
  maxSymbols: 200,
  turnAngle: 15,
  stepPx: 12,
  maxLoad: 12,
  mutationRate: 0.15,
  allowSelfing: false,
  fieldWidth: 3600,
  skyHeight: 320,
  bugSpeed: 220,
  visitChance: 0.6,
  sunPower: 0.6,
  rainLight: 0.3,
  baseUpkeep: 0.6,
  woodUpkeep: 0.05,
  greenUpkeep: 0.01,
  flowerUpkeep: 0.25,
  startEnergy: 50,
  energyMax: 100,
};

/** Settings that change plant geometry; changing one regrows every plant. */
const GEOMETRY_KEYS: (keyof Settings)[] = ['turnAngle', 'stepPx', 'maxLoad', 'maxSymbols'];

/** Energy drained per tick past the lifespan, growing each tick so old plants always fade out. */
const OLD_AGE_DRAIN = 3;
const OLD_AGE_RAMP = 0.3;
export const DYING_TICKS = 3;
const SKY_BOTTOM = 40;
const EDGE_MARGIN = 20;
/** Lineage records kept beyond the living population, oldest pruned first. */
const LINEAGE_CAP = 4000;

export type Stage = 'seed' | 'growing' | 'mature' | 'dying';
export type DeathReason = 'collapsed' | 'starved' | 'thirst' | 'old';
export type WeatherKind = 'sun' | 'rain';

/** One climate zone: half of the field with its own weather and soil. */
export interface Zone {
  kind: WeatherKind;
  ticksLeft: number;
  /** Soil moisture, 0 (bone dry) to 1 (saturated). */
  moisture: number;
}

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
  /** Stored energy, 0..energyMax. At 0 the plant starves. */
  energy: number;
  /** Energy gained from sunlight last tick. */
  sun: number;
  /** Energy spent on upkeep last tick. */
  upkeep: number;
  /** Energy lost to dry soil last tick. */
  thirst: number;
  stage: Stage;
  generation: number;
  parents: ParentRef[];
  /** Rule names that mutated when this plant was born. */
  mutated: string[];
  deathReason?: DeathReason;
  dyingTicks?: number;
}

/** Everything the family tree needs to know about a plant, kept after it dies. */
export interface LineageRecord {
  id: number;
  name: string;
  dna: string;
  generation: number;
  parents: ParentRef[];
  mutated: string[];
  born: number;
  died?: number;
  fate?: DeathReason | 'removed';
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
  | { type: 'weather'; zone: number; kind: WeatherKind };

export interface Stats {
  planted: number;
  born: number;
  collapsed: number;
  starved: number;
  thirst: number;
  old: number;
  visits: number;
}

export interface Weather {
  kind: WeatherKind;
  ticksLeft: number;
}

export interface SaveFile {
  version: 3;
  savedAt: string;
  tick: number;
  zones: Zone[];
  rngState: number;
  settings: Settings;
  stats: Stats;
  plants: Plant[];
  bugs: Bug[];
  lineage: LineageRecord[];
  nextId: number;
}

/** Older save formats: v1 predates energy and lineage, v2 predates climate zones. */
type SaveFileV2 = Omit<SaveFile, 'version' | 'zones'> & { version: 2; weather: Weather };
type SaveFileV1 = Omit<SaveFileV2, 'version' | 'lineage'> & { version: 1 };

interface CacheEntry {
  key: string;
  grown: GrownPlant;
}

export class World {
  tick = 0;
  zones: Zone[] = [];
  settings: Settings;
  stats: Stats = { planted: 0, born: 0, collapsed: 0, starved: 0, thirst: 0, old: 0, visits: 0 };
  plants: Plant[] = [];
  bugs: Bug[] = [];
  lineage = new Map<number, LineageRecord>();
  nextId = 1;
  rng: Rng;
  /** Sunlight map from the last update; null before the first tick. */
  light: LightMap | null = null;
  /** Bumped whenever the light map changes, so renderers can cache. */
  lightVersion = 0;
  private cache = new Map<number, CacheEntry>();

  constructor(settings: Partial<Settings> = {}, seed = Date.now() % 2147483647) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = new Rng(seed);
    // Both zones start sunny, the right one half a spell ahead so they drift apart.
    this.zones = [
      { kind: 'sun', ticksLeft: this.spellLength(0, 'sun'), moisture: 0.6 },
      { kind: 'sun', ticksLeft: Math.max(1, Math.round(this.spellLength(1, 'sun') / 2)), moisture: 0.6 },
    ];
  }

  // ---------- climate ----------

  /** Which zone a field x position is in: 0 = left, 1 = right. */
  zoneOf(x: number): number {
    return x < this.settings.fieldWidth / 2 ? 0 : 1;
  }

  zoneOfPlant(plant: Plant): Zone {
    return this.zones[this.zoneOf(plant.x)];
  }

  anyRain(): boolean {
    return this.zones.some((z) => z.kind === 'rain');
  }

  /** Indices of zones where the sun is out, where bugs can work. */
  sunnyZones(): number[] {
    return this.zones.map((z, i) => (z.kind === 'sun' ? i : -1)).filter((i) => i >= 0);
  }

  /** Length of the next spell, from the zone's rain fraction and cycle length, with a little jitter. */
  private spellLength(zone: number, kind: WeatherKind): number {
    const s = this.settings;
    const fraction = zone === 0 ? s.rainLeft : s.rainRight;
    const share = kind === 'rain' ? fraction : 1 - fraction;
    const base = s.cycleLength * share;
    if (base <= 0) return 0;
    const jitter = s.cycleLength >= 4 ? this.rng.range(0.75, 1.25) : 1;
    return Math.max(1, Math.round(base * jitter));
  }

  /** Start rain in every zone now. */
  rainNow(): void {
    this.zones.forEach((z, i) => {
      if (z.kind === 'rain') return;
      z.kind = 'rain';
      z.ticksLeft = this.spellLength(i, 'rain') || 1;
    });
  }

  /** Soil moisture a plant needs, from its tissue. */
  waterNeedFor(grown: GrownPlant): number {
    let wood = 0;
    let green = 0;
    for (const seg of grown.geo.segs) {
      if (seg.pen === 'w') wood++;
      else green++;
    }
    const flowers = grown.flowers.y + grown.flowers.p;
    return Math.min(1, this.settings.waterScale * (green + 2 * flowers + 0.2 * wood));
  }

  /** A fresh garden: about one seed per 120 px, two thirds starter recipes (repeated) and one third random. */
  static newGarden(settings: Partial<Settings> = {}, seed?: number): World {
    const w = new World(settings, seed);
    const count = Math.max(STARTERS.length + 3, Math.round(w.settings.fieldWidth / 120));
    const recipes: string[] = [];
    for (let i = 0; i < count; i++) {
      recipes.push(i % 3 === 2 ? formatDna(randomDna(w.rng)) : STARTERS[Math.floor(i / 3) % STARTERS.length].dna);
    }
    // Spread seeds evenly with a little jitter, in shuffled order.
    const order = recipes.map((_, i) => i).sort(() => w.rng.next() - 0.5);
    const usable = w.settings.fieldWidth - 2 * EDGE_MARGIN;
    const slot = usable / recipes.length;
    order.forEach((ri, slotIndex) => {
      const x = EDGE_MARGIN + slot * (slotIndex + 0.5) + w.rng.range(-slot * 0.25, slot * 0.25);
      w.addSeed(recipes[ri], { x, silent: true });
    });
    w.syncBugs();
    w.updateLight();
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
      energy: this.settings.startEnergy,
      sun: 0,
      upkeep: 0,
      thirst: 0,
      stage: 'seed',
      generation: opts.generation ?? 0,
      parents: opts.parents ?? [],
      mutated: opts.mutated ?? [],
    };
    this.plants.push(plant);
    this.lineage.set(plant.id, {
      id: plant.id,
      name: plant.name,
      dna: plant.dna,
      generation: plant.generation,
      parents: plant.parents.map((r) => ({ ...r })),
      mutated: [...plant.mutated],
      born: this.tick,
    });
    this.pruneLineage();
    if (!opts.silent) this.stats.planted++;
    return plant;
  }

  /** Drop the oldest dead records once the archive gets big, never a living plant's. */
  private pruneLineage(): void {
    if (this.lineage.size <= LINEAGE_CAP) return;
    const alive = new Set(this.plants.map((p) => p.id));
    for (const [id, rec] of this.lineage) {
      if (this.lineage.size <= LINEAGE_CAP * 0.9) break;
      if (rec.died !== undefined && !alive.has(id)) this.lineage.delete(id);
    }
  }

  removePlant(id: number): void {
    const rec = this.lineage.get(id);
    if (rec && rec.died === undefined) {
      rec.died = this.tick;
      rec.fate = 'removed';
    }
    this.plants = this.plants.filter((p) => p.id !== id);
    this.cache.delete(id);
    for (const b of this.bugs) if (b.targetPlant === id) b.targetPlant = null;
    this.updateLight();
  }

  /** Replace a plant's DNA and regrow it at its current step. May collapse it. */
  setDna(id: number, dna: string): WorldEvent[] {
    const plant = this.plantById(id);
    if (!plant || plant.stage === 'dying') return [];
    plant.dna = formatDna(parseDna(dna));
    plant.mutated = [];
    const rec = this.lineage.get(id);
    if (rec) {
      rec.dna = plant.dna;
      rec.mutated = [];
    }
    const events = this.regrow(plant);
    this.updateLight();
    return events;
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
    const rec = this.lineage.get(plant.id);
    if (rec) {
      rec.died = this.tick;
      rec.fate = reason;
    }
    for (const b of this.bugs) if (b.targetPlant === plant.id) b.targetPlant = null;
    if (reason === 'collapsed') {
      this.stats.collapsed++;
      return { type: 'collapse', x: plant.x };
    }
    if (reason === 'starved') this.stats.starved++;
    else if (reason === 'thirst') this.stats.thirst++;
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
      this.updateLight();
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
    this.updateSoil();
    this.growAll(events);
    this.updateLight();
    this.energyAll(events);
    this.syncBugs();
    this.moveBugs(events);
    return events;
  }

  private advanceWeather(events: WorldEvent[]): void {
    this.zones.forEach((z, i) => {
      z.ticksLeft--;
      if (z.ticksLeft > 0) return;
      const next: WeatherKind = z.kind === 'sun' ? 'rain' : 'sun';
      const len = this.spellLength(i, next);
      if (len === 0) {
        // A zone with 0% or 100% rain never switches.
        z.ticksLeft = this.spellLength(i, z.kind);
        return;
      }
      z.kind = next;
      z.ticksLeft = len;
      events.push({ type: 'weather', zone: i, kind: next });
    });
  }

  /** Rain soaks the soil, sun dries it, both at a steady rate. */
  private updateSoil(): void {
    const s = this.settings;
    for (const z of this.zones) {
      z.moisture = z.kind === 'rain' ? Math.min(1, z.moisture + s.rainRate) : Math.max(0, z.moisture - s.dryRate);
    }
  }

  /** Recompute where sunlight falls. Dying plants no longer cast shade. */
  updateLight(): void {
    const live = this.livePlants();
    this.light = computeLight(
      live.map((p) => ({ id: p.id, x: p.x, geo: this.geometry(p).geo })),
      this.settings.fieldWidth,
    );
    this.lightVersion++;
  }

  /** Plants grow one step per tick while it rains in their zone. */
  private growAll(events: WorldEvent[]): void {
    for (const plant of this.livePlants()) {
      if (plant.stage === 'mature' || this.zoneOfPlant(plant).kind !== 'rain') continue;
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

  /** What a plant pays per tick to stay alive, given its current shape. */
  upkeepFor(grown: GrownPlant, age: number): number {
    const s = this.settings;
    let wood = 0;
    let green = 0;
    for (const seg of grown.geo.segs) {
      if (seg.pen === 'w') wood++;
      else green++;
    }
    const flowers = grown.flowers.y + grown.flowers.p;
    const oldAge = age > s.lifespan ? OLD_AGE_DRAIN + OLD_AGE_RAMP * (age - s.lifespan) : 0;
    return s.baseUpkeep + wood * s.woodUpkeep + green * s.greenUpkeep + flowers * s.flowerUpkeep + oldAge;
  }

  /** Sunlight in, upkeep and thirst out; starve at zero. Also ages plants and clears the dead. */
  private energyAll(events: WorldEvent[]): void {
    const s = this.settings;
    for (const plant of this.plants) {
      if (plant.stage === 'dying') {
        plant.dyingTicks = (plant.dyingTicks ?? DYING_TICKS) - 1;
        continue;
      }
      plant.age++;
      const grown = this.geometry(plant);
      const zone = this.zoneOfPlant(plant);
      const lightFactor = zone.kind === 'sun' ? 1 : s.rainLight;
      plant.sun = (this.light?.gain.get(plant.id) ?? 0) * s.sunPower * lightFactor;
      plant.upkeep = this.upkeepFor(grown, plant.age);
      const need = this.waterNeedFor(grown);
      plant.thirst = zone.moisture < need ? s.thirstDamage * (need - zone.moisture) * 10 : 0;
      plant.energy = Math.min(s.energyMax, plant.energy + plant.sun - plant.upkeep - plant.thirst);
      if (plant.energy <= 0) {
        plant.energy = 0;
        const reason: DeathReason = plant.age > s.lifespan ? 'old' : plant.thirst > 0.5 ? 'thirst' : 'starved';
        events.push(this.kill(plant, reason));
      }
    }
    const gone = this.plants.filter((p) => p.stage === 'dying' && (p.dyingTicks ?? 0) <= 0);
    for (const p of gone) {
      this.plants = this.plants.filter((q) => q.id !== p.id);
      this.cache.delete(p.id);
    }
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

  /** A random point in the sky over one of the sunny zones. */
  private randomSkyPoint(sunny: number[]): { x: number; y: number } {
    const half = this.settings.fieldWidth / 2;
    const zone = this.rng.pick(sunny);
    return {
      x: this.rng.range(zone * half + EDGE_MARGIN, (zone + 1) * half - EDGE_MARGIN),
      y: -this.rng.range(SKY_BOTTOM, this.settings.skyHeight),
    };
  }

  /** Plants in sunny zones with flowers of the bug's colour, weighted by flower count. */
  private chooseFlowerPlant(bug: Bug, sunny: number[]): Plant | null {
    const kind = bug.kind === 'bee' ? 'y' : 'p';
    const candidates = this.livePlants().filter((p) => p.stage !== 'seed' && sunny.includes(this.zoneOf(p.x)));
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
    const sunny = this.sunnyZones();
    for (const bug of this.bugs) {
      bug.px = bug.x;
      bug.py = bug.y;
      if (sunny.length === 0) {
        // Rain everywhere: hide at the edge of the field.
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
        const grown = plant && plant.stage !== 'dying' && sunny.includes(this.zoneOf(plant.x)) ? this.geometry(plant) : null;
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
      // Wandering: pick a flower to visit or a random point in the sky, always over a sunny zone.
      const arrived = Math.hypot(bug.tx - bug.x, bug.ty - bug.y) < 1;
      const targetInRain = !sunny.includes(this.zoneOf(bug.tx));
      if (arrived || targetInRain) {
        const plant = this.rng.chance(this.settings.visitChance) ? this.chooseFlowerPlant(bug, sunny) : null;
        if (plant) {
          bug.targetPlant = plant.id;
          bug.targetFlower = this.rng.int(1000);
          continue;
        }
        const p = this.randomSkyPoint(sunny);
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

  // ---------- population ----------

  /** Living plants grouped by exact DNA, biggest group first. */
  genotypes(): { dna: string; count: number; plants: Plant[] }[] {
    const groups = new Map<string, Plant[]>();
    for (const p of this.livePlants()) {
      const g = groups.get(p.dna);
      if (g) g.push(p);
      else groups.set(p.dna, [p]);
    }
    return [...groups.entries()].map(([dna, plants]) => ({ dna, count: plants.length, plants })).sort((a, b) => b.count - a.count);
  }

  // ---------- save / load ----------

  toJSON(): SaveFile {
    return {
      version: 3,
      savedAt: new Date().toISOString(),
      tick: this.tick,
      zones: this.zones.map((z) => ({ ...z })),
      rngState: this.rng.state,
      settings: { ...this.settings },
      stats: { ...this.stats },
      plants: this.plants.map((p) => ({ ...p, parents: p.parents.map((r) => ({ ...r })), mutated: [...p.mutated] })),
      bugs: this.bugs.map((b) => ({ ...b, carrying: b.carrying ? { ...b.carrying } : null })),
      lineage: [...this.lineage.values()].map((r) => ({ ...r, parents: r.parents.map((p) => ({ ...p })), mutated: [...r.mutated] })),
      nextId: this.nextId,
    };
  }

  static fromJSON(data: SaveFile | SaveFileV2 | SaveFileV1): World {
    if (!data || !(data.version === 1 || data.version === 2 || data.version === 3) || !Array.isArray(data.plants)) throw new Error('Not a Grammar Garden save file');
    const settings = { ...DEFAULT_SETTINGS, ...data.settings } as Settings & { sunTicks?: number; rainTicks?: number };
    delete settings.sunTicks;
    delete settings.rainTicks;
    const w = new World(settings, 1);
    w.rng.state = data.rngState;
    w.tick = data.tick;
    if (data.version === 3) w.zones = data.zones.map((z) => ({ ...z }));
    else w.zones = [0, 1].map(() => ({ kind: data.weather.kind, ticksLeft: data.weather.ticksLeft, moisture: 0.6 }));
    w.stats = { ...w.stats, ...data.stats };
    w.plants = data.plants.map((p) => ({
      ...p,
      parents: p.parents ?? [],
      mutated: p.mutated ?? [],
      energy: p.energy ?? w.settings.startEnergy,
      sun: p.sun ?? 0,
      upkeep: p.upkeep ?? 0,
      thirst: p.thirst ?? 0,
    }));
    w.bugs = (data.bugs ?? []).map((b) => ({ ...b }));
    const lineage = data.version === 1 ? [] : data.lineage;
    for (const r of lineage) w.lineage.set(r.id, { ...r, parents: r.parents ?? [], mutated: r.mutated ?? [] });
    // Older saves have no archive: reconstruct what we can from the living plants.
    for (const p of w.plants) {
      if (!w.lineage.has(p.id)) {
        w.lineage.set(p.id, { id: p.id, name: p.name, dna: p.dna, generation: p.generation, parents: p.parents, mutated: p.mutated, born: w.tick - p.age });
      }
    }
    w.nextId = data.nextId;
    w.syncBugs();
    w.updateLight();
    return w;
  }
}
