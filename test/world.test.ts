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
    expect(w.plants.length).toBe(STARTERS.length + 3);
    expect(w.plants.every((p) => p.stage === 'seed')).toBe(true);
    expect(w.bugs.length).toBe(4);
  });

  it('only grows during rain', () => {
    const w = World.newGarden({ sunTicks: 5, rainTicks: 3 }, 2);
    run(w, 4);
    expect(w.plants.every((p) => p.steps === 0)).toBe(true);
    const events = run(w, 1);
    expect(events).toContainEqual({ type: 'weather', kind: 'rain' });
    run(w, 1);
    expect(w.plants.some((p) => p.steps > 0)).toBe(true);
  });

  it('collapses Tangle and Floppy, keeps Bramble', () => {
    const w = World.newGarden({ sunTicks: 1, rainTicks: 30, startEnergy: 1000, energyMax: 1000 }, 3);
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
    const w = World.newGarden({ sunTicks: 20, rainTicks: 10, maxPlants: 40 }, 4);
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
    const settings = { sunTicks: 20, rainTicks: 4, lifespan: 10000 };
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
    const w = World.newGarden({ sunTicks: 20, rainTicks: 10, maxPlants: 40 }, 4);
    run(w, 400);
    const child = w.plants.find((p) => p.parents.length === 2)!;
    for (const parent of child.parents) expect(w.lineage.get(parent.id)?.name).toBe(parent.name);
    expect(w.genotypes()[0].count).toBeGreaterThan(0);
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
    const w = World.newGarden({ sunTicks: 1, rainTicks: 10 }, 7);
    run(w, 6);
    const sprout = w.plants.find((p) => p.dna === 'A=fB;B=fC;C=y')!;
    expect(w.setDna(sprout.id, 'A=fffffffffffffffffff')).toContainEqual({ type: 'collapse', x: sprout.x });
  });

  it('honours the symbol cap when settings change', () => {
    const w = World.newGarden({ sunTicks: 1, rainTicks: 20, maxSymbols: 200 }, 8);
    run(w, 21);
    const before = Math.max(...w.plants.map((p) => w.geometry(p).str.length));
    expect(before).toBeLessThanOrEqual(200);
    w.updateSettings({ maxSymbols: 40 });
    for (const p of w.livePlants()) expect(w.geometry(p).str.length).toBeLessThanOrEqual(40);
  });
});
