/**
 * Headless balance harness. Runs gardens for many ticks across several seeds and
 * prints what happened, so a balance change can be judged before it ships.
 *
 *   npm run sim                                  # defaults: 3 seeds, 1500 ticks
 *   npm run sim -- --seeds 5 --ticks 3000
 *   npm run sim -- --set rainLeft=0.3 --set beetles=0
 *   npm run sim -- --csv out.csv                 # per-sample rows for plotting
 *   npm run sim -- --recipes                     # also list the top recipes at the end
 *
 * Every `--set key=value` overrides a world setting (see DEFAULT_SETTINGS).
 */
import { writeFileSync } from 'node:fs';
import { FamilyTracker } from '../src/core/families';
import { KINDS } from '../src/core/phenotype';
import { DEFAULT_SETTINGS, World, type Settings } from '../src/core/world';

interface Args {
  seeds: number[];
  ticks: number;
  every: number;
  set: Partial<Settings>;
  csv?: string;
  recipes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seeds: [1, 2, 3], ticks: 1500, every: 250, set: {}, recipes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--seeds') {
      const v = next();
      args.seeds = v.includes(',') ? v.split(',').map(Number) : Array.from({ length: Number(v) }, (_, k) => k + 1);
    } else if (a === '--ticks') args.ticks = Number(next());
    else if (a === '--every') args.every = Number(next());
    else if (a === '--csv') args.csv = next();
    else if (a === '--recipes') args.recipes = true;
    else if (a === '--set') {
      const [k, v] = next().split('=');
      if (!(k in DEFAULT_SETTINGS)) throw new Error(`Unknown setting ${k}`);
      const cur = DEFAULT_SETTINGS[k as keyof Settings];
      (args.set as Record<string, unknown>)[k] = typeof cur === 'boolean' ? v === 'true' : Number(v);
    } else throw new Error(`Unknown argument ${a}`);
  }
  return args;
}

interface Sample {
  seed: number;
  tick: number;
  live: number;
  left: number;
  right: number;
  bornLeft: number;
  bornRight: number;
  collapsed: number;
  starved: number;
  thirst: number;
  old: number;
  visits: number;
  families: number;
  topGen: number;
  kinds: Record<string, number>;
  needLeft: number;
  needRight: number;
  woodLeft: number;
  woodRight: number;
}

function pad(v: string | number, w: number): string {
  return String(v).padStart(w);
}

function runSeed(seed: number, args: Args, rows: Sample[]): Sample {
  const w = World.newGarden(args.set, seed);
  const families = new FamilyTracker();
  const born = [0, 0];
  let last!: Sample;
  for (let t = 1; t <= args.ticks; t++) {
    for (const e of w.step()) if (e.type === 'born') born[w.zoneOf(e.x)]++;
    if (t % args.every === 0 || t === args.ticks) {
      families.update(w.livePlants());
      const live = w.livePlants();
      const byZone = [0, 1].map((z) => live.filter((p) => w.zoneOf(p.x) === z));
      const avg = (ps: typeof live, f: (g: ReturnType<World['geometry']>) => number) => (ps.length ? ps.reduce((a, p) => a + f(w.geometry(p)), 0) / ps.length : 0);
      const wood = (g: ReturnType<World['geometry']>) => g.geo.segs.filter((s) => s.pen === 'w').length;
      last = {
        seed,
        tick: t,
        live: live.length,
        left: byZone[0].length,
        right: byZone[1].length,
        bornLeft: born[0],
        bornRight: born[1],
        collapsed: w.stats.collapsed,
        starved: w.stats.starved,
        thirst: w.stats.thirst,
        old: w.stats.old,
        visits: w.stats.visits,
        families: families.families.length,
        topGen: Math.max(0, ...live.map((p) => p.generation)),
        kinds: w.kindCounts(),
        needLeft: avg(byZone[0], (g) => w.waterNeedFor(g)),
        needRight: avg(byZone[1], (g) => w.waterNeedFor(g)),
        woodLeft: avg(byZone[0], wood),
        woodRight: avg(byZone[1], wood),
      };
      rows.push(last);
      console.log(
        `seed ${pad(seed, 2)} tick ${pad(t, 5)}  live ${pad(live.length, 3)} (L${pad(byZone[0].length, 3)} R${pad(byZone[1].length, 3)})  born L${pad(born[0], 4)} R${pad(born[1], 4)}  ` +
          `collapsed ${pad(w.stats.collapsed, 3)} starved ${pad(w.stats.starved, 3)} thirst ${pad(w.stats.thirst, 3)} old ${pad(w.stats.old, 3)}  ` +
          `fam ${pad(families.families.length, 2)} gen ${pad(last.topGen, 2)}  ` +
          KINDS.map((k) => `${k[0]}${last.kinds[k]}`).join(' '),
      );
    }
  }
  if (args.recipes) {
    for (const f of families.families.slice(0, 5)) console.log(`   ${pad(f.members.length, 3)}x  ${f.rep}`);
  }
  return last;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const settings = { ...DEFAULT_SETTINGS, ...args.set };
  console.log(`Grammar Garden harness: seeds ${args.seeds.join(',')} · ${args.ticks} ticks · overrides ${JSON.stringify(args.set)}`);
  console.log(`climate L ${settings.rainLeft * 100}% rain, R ${settings.rainRight * 100}% rain · bugs ${settings.bees}/${settings.butterflies}/${settings.beetles} · mutation ${settings.mutationRate}`);
  const rows: Sample[] = [];
  const finals = args.seeds.map((s) => runSeed(s, args, rows));

  const mean = (f: (s: Sample) => number) => finals.reduce((a, s) => a + f(s), 0) / finals.length;
  console.log('\nAverages at the end across seeds:');
  console.log(`  live ${mean((s) => s.live).toFixed(1)}  left ${mean((s) => s.left).toFixed(1)}  right ${mean((s) => s.right).toFixed(1)}`);
  console.log(`  births left ${mean((s) => s.bornLeft).toFixed(0)}  right ${mean((s) => s.bornRight).toFixed(0)}  (right share ${((100 * mean((s) => s.bornRight)) / Math.max(1, mean((s) => s.bornLeft + s.bornRight))).toFixed(0)}%)`);
  console.log(`  deaths: collapsed ${mean((s) => s.collapsed).toFixed(0)}  starved ${mean((s) => s.starved).toFixed(0)}  thirst ${mean((s) => s.thirst).toFixed(0)}  old ${mean((s) => s.old).toFixed(0)}`);
  console.log(`  families ${mean((s) => s.families).toFixed(1)}  top generation ${mean((s) => s.topGen).toFixed(1)}`);
  console.log(`  water need left ${mean((s) => s.needLeft).toFixed(2)}  right ${mean((s) => s.needRight).toFixed(2)}   wood segs left ${mean((s) => s.woodLeft).toFixed(1)}  right ${mean((s) => s.woodRight).toFixed(1)}`);
  console.log(`  kinds ${KINDS.map((k) => `${k} ${mean((s) => s.kinds[k]).toFixed(1)}`).join(' · ')}`);

  if (args.csv) {
    const head = ['seed', 'tick', 'live', 'left', 'right', 'bornLeft', 'bornRight', 'collapsed', 'starved', 'thirst', 'old', 'visits', 'families', 'topGen', ...KINDS, 'needLeft', 'needRight', 'woodLeft', 'woodRight'];
    const lines = rows.map((r) =>
      [r.seed, r.tick, r.live, r.left, r.right, r.bornLeft, r.bornRight, r.collapsed, r.starved, r.thirst, r.old, r.visits, r.families, r.topGen, ...KINDS.map((k) => r.kinds[k]), r.needLeft.toFixed(3), r.needRight.toFixed(3), r.woodLeft.toFixed(2), r.woodRight.toFixed(2)].join(','),
    );
    writeFileSync(args.csv, [head.join(','), ...lines].join('\n') + '\n');
    console.log(`\nwrote ${rows.length} rows to ${args.csv}`);
  }
}

main();
