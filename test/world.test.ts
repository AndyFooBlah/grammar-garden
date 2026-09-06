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
    const w = World.newGarden({ sunTicks: 1, rainTicks: 30 }, 3);
    const events = run(w, 32);
    expect(events.some((e) => e.type === 'collapse')).toBe(true);
    const names = (dna: string) => w.plants.find((p) => p.dna === dna);
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

  it('kills shaded seeds and old plants', () => {
    const w = World.newGarden({ lifespan: 10, sunTicks: 2, rainTicks: 2 }, 5);
    // Force a seed right under the Tower.
    const tower = w.plants.find((p) => p.dna === 'A=wfA')!;
    w.addSeed('A=fy', { x: tower.x + 1 });
    const events = run(w, 60);
    expect(events.some((e) => e.type === 'death')).toBe(true);
    expect(w.stats.shaded + w.stats.old).toBeGreaterThan(0);
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
