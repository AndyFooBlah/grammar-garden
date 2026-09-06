import { describe, expect, it } from 'vitest';
import { STARTERS } from '../src/core/starters';
import { World, type WorldEvent } from '../src/core/world';

const run = (w: World, ticks: number): WorldEvent[] => {
  const all: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...w.step());
  return all;
};

describe('World', () => {
  it('starts with the starters plus random seeds, all as seeds', () => {
    const w = World.newGarden({}, 1);
    expect(w.plants.length).toBe(Math.round(w.settings.fieldWidth / 120));
    for (const st of STARTERS) expect(w.plants.some((p) => p.dna === st.dna)).toBe(true);
    expect(w.plants.every((p) => p.stage === 'seed')).toBe(true);
    expect(w.bugs.length).toBe(w.settings.bees + w.settings.butterflies);
  });

  it('only grows during rain in its own zone', () => {
    const w = World.newGarden({ rainLeft: 0.3, rainRight: 0.3, cycleLength: 20 }, 2);
    // Nothing grows until some zone's first rain.
    let rained: number | null = null;
    for (let i = 0; i < 40 && rained === null; i++) {
      expect(w.plants.every((p) => p.steps === 0)).toBe(true);
      const e = w.step().find((x) => x.type === 'weather' && x.kind === 'rain');
      if (e && e.type === 'weather') rained = e.zone;
    }
    expect(rained).not.toBeNull();
    run(w, 1);
    const inRain = w.plants.filter((p) => w.zoneOf(p.x) === rained);
    const inSun = w.plants.filter((p) => w.zoneOf(p.x) !== rained);
    expect(inRain.some((p) => p.steps > 0)).toBe(true);
    expect(inSun.every((p) => p.steps === 0)).toBe(true);
  });

  it('cycle length 2 alternates every tick, long cycles give long spells', () => {
    const fast = new World({ rainLeft: 0.5, rainRight: 0.5, cycleLength: 2 }, 1);
    const kinds = [];
    for (let i = 0; i < 6; i++) {
      fast.step();
      kinds.push(fast.zones[0].kind);
    }
    expect(kinds).toEqual(['rain', 'sun', 'rain', 'sun', 'rain', 'sun']);
    const slow = new World({ rainLeft: 0.5, rainRight: 0.5, cycleLength: 200 }, 1);
    let switches = 0;
    for (let i = 0; i < 400; i++) if (slow.step().some((e) => e.type === 'weather' && e.zone === 0)) switches++;
    expect(switches).toBeLessThanOrEqual(5);
    expect(switches).toBeGreaterThanOrEqual(2);
  });

  it('soil soaks in rain and dries in sun', () => {
    const w = new World({ rainLeft: 1, rainRight: 0, cycleLength: 20, rainRate: 0.1, dryRate: 0.03 }, 1);
    run(w, 10);
    expect(w.zones[0].moisture).toBeCloseTo(1);
    expect(w.zones[1].moisture).toBeCloseTo(0.3);
  });

  it('thirsty plants die in a dry climate and live in a wet one', () => {
    const leafy = 'A=wfB;B=[lllgfp][rrrgfp]wfB'; // a green spike with flowering leaves: needs damp soil
    const dry = new World({ rainLeft: 0.1, rainRight: 0.1, cycleLength: 40, lifespan: 10000 }, 3);
    const d = dry.addSeed(leafy, { x: 300 })!;
    run(dry, 300);
    expect(dry.plantById(d.id)).toBeUndefined();
    expect(dry.stats.thirst).toBe(1);
    const wet = new World({ rainLeft: 0.5, rainRight: 0.5, cycleLength: 10, lifespan: 10000 }, 3);
    const p = wet.addSeed(leafy, { x: 300 })!;
    run(wet, 300);
    expect(wet.plantById(p.id)?.energy).toBeGreaterThan(0);
  });

  it('bugs stay in the sunny zone when the other one rains', () => {
    const w = World.newGarden({ rainLeft: 0, rainRight: 1, cycleLength: 20 }, 9);
    run(w, 60);
    for (const b of w.bugs) expect(w.zoneOf(b.x)).toBe(0);
    const both = World.newGarden({ rainLeft: 1, rainRight: 1, cycleLength: 20 }, 9);
    run(both, 60);
    for (const b of both.bugs) expect(Math.abs(b.y)).toBeLessThanOrEqual(40);
  });

  it('collapses Tangle and Floppy, keeps Bramble', () => {
    const w = World.newGarden({ rainLeft: 1, rainRight: 1, cycleLength: 30, startEnergy: 1000, energyMax: 1000 }, 3);
    const events = run(w, 32);
    expect(events.some((e) => e.type === 'collapse')).toBe(true);
    const names = (dna: string) => w.plants.find((p) => p.dna === dna);
    expect(w.lineage.get(w.plants[0].id)).toBeDefined();
    expect(names(STARTERS.find((s) => s.name === 'Tangle')!.dna)).toBeUndefined();
    expect(names(STARTERS.find((s) => s.name === 'Floppy')!.dna)).toBeUndefined();
    const bramble = names(STARTERS.find((s) => s.name === 'Bramble')!.dna);
    expect(bramble?.stage).toBe('mature');
    expect(w.geometry(bramble!).flowers.p).toBeGreaterThan(0);
  });

  it('bugs eventually make babies', () => {
    const w = World.newGarden({ maxPlants: 40 }, 4);
    const events = run(w, 400);
    expect(events.filter((e) => e.type === 'visit').length).toBeGreaterThan(0);
    expect(w.stats.born).toBeGreaterThan(0);
    const child = w.plants.find((p) => p.parents.length === 2);
    expect(child).toBeDefined();
    expect(child!.generation).toBeGreaterThanOrEqual(1);
  });

  it('starves a seed that never grows anything green', () => {
    const w = new World({}, 5);
    const seed = w.addSeed('A=A')!;
    const events = run(w, 120);
    expect(events.some((e) => e.type === 'death')).toBe(true);
    expect(w.plantById(seed.id)).toBeUndefined();
    expect(w.stats.starved).toBe(1);
  });

  it('starves a small plant in the shade of a big one, and feeds it in the open', () => {
    const settings = { rainLeft: 0.5, rainRight: 0.5, cycleLength: 24, lifespan: 10000 };
    const shaded = new World(settings, 5);
    shaded.addSeed('A=wfwfwfwfwf[llllllB][rrrrrrB]A;B=g+f', { x: 300 }); // a wooden umbrella, no flowers
    const under = shaded.addSeed('A=fB;B=fC;C=y', { x: 305 })!;
    run(shaded, 400);
    expect(shaded.plantById(under.id)).toBeUndefined();

    const open = new World(settings, 5);
    const alone = open.addSeed('A=fB;B=fC;C=y', { x: 305 })!;
    run(open, 400);
    expect(open.plantById(alone.id)?.energy).toBeGreaterThan(0);
  });

  it('kills plants of old age once past the lifespan', () => {
    const w = new World({ lifespan: 30 }, 5);
    w.addSeed('A=wf[lllB][llB][lB]B[rB][rrB][rrrB];B=gf[lgf][rgf]p');
    run(w, 120);
    expect(w.stats.old).toBe(1);
  });

  it('keeps a lineage archive for the family tree', () => {
    const w = World.newGarden({ maxPlants: 40 }, 4);
    run(w, 400);
    const child = w.plants.find((p) => p.parents.length === 2)!;
    for (const parent of child.parents) expect(w.lineage.get(parent.id)?.name).toBe(parent.name);
    expect(w.genotypes()[0].count).toBeGreaterThan(0);
  });

  it('drops new seeds near the parent, with a long tail', () => {
    const w = new World({ seedSpacing: 1, maxPlants: 100000, seedSpread: 50 }, 11);
    const dists: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = w.findFreeX(1800);
      expect(x).not.toBeNull();
      dists.push(Math.abs(x! - 1800));
    }
    dists.sort((a, b) => a - b);
    expect(dists[Math.floor(dists.length / 2)]).toBeLessThan(80); // most land close
    expect(dists[Math.floor(dists.length * 0.95)]).toBeGreaterThan(200); // some travel far
  });

  it('round-trips through JSON and replays identically', () => {
    const w = World.newGarden({}, 6);
    run(w, 25);
    const copy = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
    const a = run(w, 100);
    const b = run(copy, 100);
    expect(b).toEqual(a);
    expect(copy.toJSON().plants).toEqual(w.toJSON().plants);
  });

  it('setDna regrows in place and can collapse', () => {
    const w = World.newGarden({ rainLeft: 1, rainRight: 1, cycleLength: 10 }, 7);
    run(w, 6);
    const sprout = w.plants.find((p) => p.dna === 'A=fB;B=fC;C=y')!;
    expect(w.setDna(sprout.id, 'A=fffffffffffffffffff')).toContainEqual({ type: 'collapse', x: sprout.x });
  });

  it('honours the symbol cap when settings change', () => {
    const w = World.newGarden({ rainLeft: 1, rainRight: 1, cycleLength: 20, maxSymbols: 200 }, 8);
    run(w, 21);
    const before = Math.max(...w.plants.map((p) => w.geometry(p).str.length));
    expect(before).toBeLessThanOrEqual(200);
    w.updateSettings({ maxSymbols: 40 });
    for (const p of w.livePlants()) expect(w.geometry(p).str.length).toBeLessThanOrEqual(40);
  });
});
