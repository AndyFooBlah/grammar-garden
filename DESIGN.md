# Grammar Garden — Game Summary and Design

*Status: implemented and live at https://andyfooblah.github.io/grammar-garden/. This document is kept current with the game; sections marked "v2" were added after the first playtest.*

## 1. One-paragraph summary

Grammar Garden is a browser game in which every plant is grown from a tiny "recipe" (its DNA): a handful of rewrite rules that turn letters into strings of drawing commands. A field of dirt starts out full of seeds. When it rains, the recipes run one step at a time and the plants grow as simple colored lines. Plants whose shapes don't hold up (lines that cross, or too much green weight on a thin stem) collapse. When the sun comes out, bees and butterflies visit flowers, carry DNA from plant to plant, and drop new seeds whose recipes are a shuffled mix of both parents with a few random copying mistakes. Over many rain-and-sun cycles the field fills up with whatever recipes happen to work. The player can pause at any moment, click any plant to see and edit its recipe, clone plants, tweak the rules of the world, and save or reload the whole garden as a file.

What a 7-year-old gets to discover, without anyone using the words:
- **Genotype vs. phenotype** — a short recipe makes a big, complicated plant.
- **Selection** — some recipes make plants that fall over; those don't get to have babies.
- **Reproduction and recombination** — bugs mix two recipes; babies look a bit like each parent.
- **Mutation** — copies aren't perfect; sometimes a mistake is an improvement.
- **Competition** — crowded seeds get shaded and don't grow.
- **Evolution** — after a while, the field looks different from how it started, and nobody designed it.

## 2. The plant language (DNA)

### 2.1 Alphabet

DNA is a single string of rules separated by semicolons, for example:

```
A=wfB;B=f[lC][rC]fB;C=gfy
```

Each rule is `Variable=replacement`. The start string is always `A`.

| Symbol | Meaning | Notes |
|---|---|---|
| `A`–`Z` | Variable | Replaced by its rule each growth step. A variable with no rule just stays put and draws nothing. |
| `f` | Forward one step, drawing a line | In the current pen color |
| `b` | Backward one step, drawing a line | Same as `f` but reversed |
| `l` | Turn left by the turn angle | Default 15° (a world setting) |
| `r` | Turn right by the turn angle | |
| `+` | Double the step size | |
| `-` | Halve the step size | |
| `[` | Remember where I am (start a branch) | Saves position, heading, step size, pen color |
| `]` | Go back to the remembered spot (end a branch) | |
| `g` | Pen color = green (leafy tissue) | Default at the start of every plant |
| `w` | Pen color = brown (wood) | Wood is what holds the plant up |
| `y` | Put a yellow flower here | Draws a small yellow dot at the current position |
| `p` | Put a pink flower here | Draws a small pink dot |

Anything else (spaces, unknown characters) is ignored so that editing is forgiving.

**Decision:** `[` and `]` were not in the original college grammar. Without them, the only way to make a side branch is to walk out with `f` and back with `b`, which retraces the same line. Brackets make bushy, tree-like shapes easy and are the standard L-system convention. The editor keeps them balanced automatically (an unmatched `]` is ignored; unclosed branches are closed at the end).

### 2.2 Growth

Growth is a classic parallel L-system rewrite. Each **growth step** replaces every variable in the current string with its rule, all at once. A plant remembers how many growth steps it has taken, so its shape is always a pure function of `(DNA, steps, world settings)`. That keeps saves tiny and makes "regrow from scratch" trivial.

Worked example with `A=fB;B=f[lC][rC]fB;C=gfy`:

| Step | String |
|---|---|
| 0 | `A` |
| 1 | `fB` |
| 2 | `ff[lC][rC]fB` |
| 3 | `ff[lgfy][rgfy]ff[lC][rC]fB` |

Limits (world settings): a maximum number of growth steps per plant, and a maximum string length (default 200 symbols; a few hundred is plenty for a nicely complex plant) after which the plant simply stops growing. This keeps the browser responsive when a kid types `A=AAAA`.

### 2.3 Drawing (the turtle)

The turtle starts at the plant's seed position on the ground line, pointing straight up, green pen, base step size (default 12 px). Every `f`/`b` produces a **segment** with a color and a parent segment (the one the turtle was standing on when it started), so the plant is a tree of segments. Flowers attach to the segment where they are placed.

## 3. Structural viability

After every growth step, each plant's geometry is checked. A plant that fails any check **collapses**: a short crack sound plays, the plant is drawn falling over and fading, and it is removed. Collapse happens immediately, regardless of age.

1. **No crossing lines.** Any two segments that properly intersect (cross at an interior point) is a failure. Touching at an endpoint or overlapping along the same line (as `f` then `b` does) is fine, because that is how branching and retracing naturally work. Checked with a uniform spatial grid so it stays fast for a few thousand segments.
2. **Sturdiness (the wood rule).** Every green segment is asked "how much plant are you holding up?" — the total length of all segments above it in the tree, including any wood higher up. If that load exceeds the **max unsupported load** setting (default: 12 step-lengths), the stem snaps. Wood segments can hold anything. So a plant needs wood at the bottom of any big structure, and wood sitting on top of a green stem doesn't help.
3. **No growing into the dirt.** A segment that goes below the ground line is a failure. (Alternative: clip it silently. Failure is simpler to explain: "plants can't grow down into the ground".)

The inspector shows *why* a plant collapsed and highlights the offending segment in red, and the DNA editor previews all three checks live as you type, so a kid can fix a recipe before planting it.

## 3b. Sunlight and energy (v2)

Every plant keeps an **energy** store (0 to 100). Sunlight comes straight down in narrow columns (2 px wide) across the whole field. Walking each column from the sky to the ground:

- a **green** segment it hits captures half of the light that reaches it and lets the other half through to whatever is below (its own lower branches or a neighbour);
- a **wood** segment blocks all of it;
- whatever is left lands on the dirt.

Segments are treated as 4 px wide so a vertical stem still catches a little light, but a leaning or horizontal branch catches far more. The sky and dirt are drawn darker wherever light has been caught above, so a child can see exactly where the shade falls.

**Income:** captured light × sun strength (default 0.6), in full on sunny ticks and at 30% during rain.
**Upkeep every tick:** a base cost of living (0.6, paid by seeds too), 0.05 per wood segment, 0.01 per green segment, and 0.25 per flower. Past the lifespan an old-age drain is added that grows every tick, so old plants always fade out.

Energy at zero means the plant **starves**. A seed starts with 50 energy and no green, so a recipe that never grows leaves dies within about 80 ticks. This replaces the old "shaded root" rule and is what makes room matter: seed spacing is now only 12 px, and a seedling under a big canopy simply cannot earn enough. The selection pressures a child can watch: grow taller than the neighbours, spread green sideways, don't carry more flowers than the sunlight pays for.

The starter recipes at full sun, from the calibration script: Bramble nets about +3.5 energy per tick, Candle with its 22 flowers about +1, Tower (all wood) −1.2, a bare seed −0.6.

## 4. Life cycle of a plant

```
seed ──rain──▶ sprout ──rain──▶ growing ──▶ mature ──age──▶ old ──▶ gone
                                   │
                                   └──fails a check──▶ collapsed ──▶ gone
```

- **Seed**: a small brown dot on the ground. Shows its DNA when clicked.
- **Growing**: takes one growth step per tick while it is raining. Stops when it reaches the max-steps limit, the string-length limit, or its string stops changing (no variables left). Then it is **mature**.
- **Energy**: 0–100, shown as a bar in the inspector with the net change per tick (see section 3b). At 0 the plant starves; past the lifespan the old-age drain finishes it. Either way: a soft rustle, it fades, and its space is freed. Starving plants are drawn faded so trouble is visible before it happens.
- **Room**: the world has a max plant count (40) and a minimum seed spacing (12 px). Bugs won't drop a seed if there is no room; the seed is simply lost (a quiet "plip" doesn't play, so the kid learns that silence means the field is full). Shade does the real spacing.

## 5. Weather and time

The world runs in **ticks** (default 1 second; adjustable). Weather alternates automatically:

- **Sun** (default 20 ticks): bugs fly and pollinate. No growth.
- **Rain** (default 8 ticks): plants grow one step per tick. Bugs shelter (they sit still at the edge of the field). Soft rain sound in the background.

Buttons: **Play/Pause**, **Step one tick**, **Make it rain now**, and a speed slider. Separating growth (rain) from pollination (sun) gives the game a rhythm a child can follow: "it rained, everything got bigger; now the bugs are out, let's see who gets a baby."

## 6. Bugs and reproduction

- **Bees** are yellow and only visit yellow flowers. **Butterflies** are pink and only visit pink flowers. Counts of each are world settings (default 2 and 2).
- Each bug wanders. On each sunny tick it may pick a target: a random flower of its color, weighted by how many flowers each plant has (more flowers, more visits — a selection pressure a kid can see).
- When a bug arrives at a flower:
  - If it is **carrying nothing**, it picks up that plant's DNA (a little glow on the bug shows it is carrying).
  - If it is **carrying DNA from a different plant**, the two DNAs are combined and a **new seed** is dropped at a random free spot on the field. The bug's pollen is then used up. Sound: a buzz for bees, a soft flutter for butterflies, then a "plip" for the seed.
  - Visiting the plant it already carries pollen from does nothing (self-pollination is off by default; there is a setting to allow it).
- A plant with both yellow and pink flowers can cross with plants of either flower color. That is an interesting strategy that evolution may or may not discover.

### 6.1 Combining DNA (crossover)

Take the set of variable names that appear in either parent. For each:
- Present in both parents → coin flip, take that parent's rule.
- Present in only one parent → included with 50% probability.
- `A` is always present (every parent has it).

Result: roughly half of each parent's rules, as you described. The child records both parents' names and its generation number (max parent generation + 1) so the family tree can be shown in the inspector.

### 6.2 Mutation

Each rule in the child mutates independently with probability **mutation rate** (default 15%). One of, chosen at random:
- insert a random symbol at a random position;
- delete one symbol;
- replace one symbol with another;
- duplicate a short chunk in place (this is how `f` becomes `ff` becomes `ffff` — plants get taller);
- add a brand-new branch `[…]` containing one or two random symbols.

Brackets are always inserted and deleted as matched pairs so the rule stays well-formed. The inspector marks mutated rules with a small ✨ so a kid can spot what changed compared with the parents.

## 7. Screen layout

```
┌──────────────────────────────────────────────┬───────────────────┐
│  sky (sun or rain drops)                     │  ▶ ⏸ ⏭  speed ──  │
│                                              │  🌧 Make it rain   │
│      bee        butterfly                    ├───────────────────┤
│        \        /                            │  Plants 14 Seeds 6│
│    plants growing as lines, flowers as dots  │  Flowers 🟡9 🩷4   │
│                                              │  Born 31 Died 17  │
│ ═══════════ ground line ═════════════════════ │  (collapsed 9,    │
│    dirt (light brown)                        │   shaded 5, old 3)│
│                                              ├───────────────────┤
│                                              │  INSPECTOR        │
│                                              │  [close-up canvas]│
│                                              │  "Zippy" gen 3    │
│                                              │  health ████░ age │
│                                              │  parents: … 🧬    │
│                                              │  DNA: [textarea]  │
│                                              │  ✔ ok / ✘ crosses │
│                                              │  Apply  Clone  ✕  │
│                                              ├───────────────────┤
│                                              │  WORLD SETTINGS   │
│                                              │  (sliders)        │
│                                              ├───────────────────┤
│                                              │  💾 Save  📂 Load  │
│                                              │  🔊  📖 Legend     │
└──────────────────────────────────────────────┴───────────────────┘
```

- **Field (left, most of the screen).** Sky band on top shows the weather. The ground line is about 15% from the bottom; seeds sit on it and plants grow upward. Plants are plain 2-px lines (green / brown), flowers are 4-px dots (yellow / pink), bugs are simple shapes (a striped yellow oval, a pink two-triangle butterfly). Click anything to select it; the selection gets a soft halo. Nothing needs precise clicking: the nearest plant within a generous radius is picked.
- **Inspector.** A close-up of the selected plant, auto-fitted, with segments drawn thicker. Auto-generated friendly name ("Zippy", "Bramble", "Pip") plus generation, age, health, status, parents (clickable to select them), and a count of flowers.
- **DNA editor.** A large-font textarea showing one rule per line (the saved file keeps them `;`-separated; the parser accepts either). As you type, the close-up redraws at the plant's current growth step and shows ✔ or the specific problem. **Apply** replaces the plant's DNA and regrows it from seed in place. **Clone to seed** drops a new seed with a copy of the DNA at a free spot (a great way to say "I like this one, make more"). **✕** removes the plant. **Surprise me** fills the editor with a random recipe.
- **World settings.** Sliders with plain labels: sun length, rain length, plant lifespan, bees, butterflies, room for plants, seed spacing, growth steps, recipe size limit, turn angle, step size, green stem strength, sun strength, light in rain, cost of living, cost per flower, cost per wood bit, seed energy, mutation chance, bug curiosity, allow self-pollination. Speed is its own slider at the top, shown as ticks per second. Changing a geometric setting (angle, step, load) regrows every plant so the effect is instantly visible.
- **Legend.** A one-card cheat sheet of the symbols, worded for a child, with three or four starter recipes you can click to load into the editor.
- **New seed** button: plants a seed with the editor's current DNA (or a random one) at a free spot.
- **Family tree (v2).** A full-screen overlay from the inspector: the selected plant at the bottom, parents above, back four generations, each drawn as a small close-up with its name, generation and a ✨ if a rule mutated when it was born. Curved lines connect children to parents; the same ancestor can appear on both sides. Tapping any plant shows its recipe and fate (alive, collapsed, starved, old age) with "Use this recipe" and, if alive, "Show in garden". Every plant ever born is kept in a lineage archive (capped at 4,000, oldest dead records pruned first) that survives save and load.
- **Who is winning? (v2).** A card grouping living plants by exact recipe: a close-up, the count, the share of the population as a bar, and a 👀 button that cycles through the plants with that recipe. The stats line also reports how many different recipes are alive.

## 8. Sounds

All sounds are synthesized in the browser with the Web Audio API, so there are no audio files and nothing to host. They are short (under half a second, except rain), quiet, and low-pass filtered so they sit in the background:

| Event | Sound |
|---|---|
| Rain starts / stops | Filtered noise fading in and out, very quiet, loops while raining |
| Seed planted | Soft water-drop "plip": a quiet low sine sliding down, low-passed so it has no click |
| Bee visits a flower | Low buzzy hum, ~0.3 s |
| Butterfly visits a flower | Two or three soft breathy puffs |
| Plant collapses | A dull low thump with a tiny crackle |
| Plant dies of age or shade | A gentle rustle of noise fading out |
| New seed from two parents | The plip, pitched slightly higher |

Master volume slider and a mute button. Sound starts only after the first click (browser autoplay rules).

## 9. Save and load

**Save** downloads `grammar-garden-<date>.json`. **Load** opens a file picker. The garden also autosaves to the browser's local storage every few ticks so an accidental tab close isn't a disaster.

The file stores the *inputs* to the simulation, not the drawn geometry, so it stays small and human-readable:

```json
{
  "version": 2,
  "tick": 412,
  "weather": { "kind": "sun", "ticksLeft": 7 },
  "rng": "seed-and-state",
  "settings": { "tickMs": 1000, "turnAngle": 15, "stepPx": 10, "...": "..." },
  "stats": { "born": 31, "collapsed": 9, "shaded": 5, "oldAge": 3 },
  "plants": [
    { "id": 17, "name": "Zippy", "dna": "A=wfB;B=f[lC][rC]fB;C=gfy",
      "x": 312, "steps": 6, "age": 40, "energy": 88, "stage": "mature",
      "generation": 3, "parents": [{ "id": 4, "name": "Pip" }, { "id": 9, "name": "Bramble" }] }
  ],
  "bugs": [ { "kind": "bee", "x": 100, "y": 60, "carrying": { "plantId": 17, "dna": "..." } } ],
  "lineage": [ { "id": 4, "name": "Pip", "dna": "...", "generation": 2, "parents": [], "born": 12, "died": 130, "fate": "old" } ]
}
```

Everything is regrown from DNA and step count on load. The random-number generator is seeded and saved, so a reloaded garden continues exactly the way it would have.

## 10. Technical plan

- **Stack:** TypeScript + Vite, plain HTML5 Canvas, no UI framework. One page, no backend, no cloud services. Works offline once loaded.
- **Hosting:** GitHub Pages from a new public repo `grammar-garden` (a `gh-pages` deploy from CI). Firebase Hosting would also work if you prefer to keep it alongside your other projects.
- **Modules** (each small and unit-tested with Vitest):
  - `grammar.ts` — parse DNA string, validate, expand one step, string-length cap.
  - `turtle.ts` — interpret a string into a segment tree plus flowers.
  - `structure.ts` — crossing check (grid-accelerated), load check, ground check; returns pass or a reason and the offending segment.
  - `light.ts` — the sunlight column walk: per-plant light captured, per-column shade for drawing.
  - `genetics.ts` — crossover, mutation, random DNA, bracket balancing.
  - `world.ts` — plants, bugs, weather, ticks, shading, room; pure state machine driven by a seeded RNG.
  - `render.ts` — field, shade layer and inspector drawing.
  - `family.ts` — the family tree overlay.
  - `audio.ts` — synthesized sound effects.
  - `ui.ts` — panels, sliders, editor, hit testing.
  - `save.ts` — serialize, deserialize, autosave.
- **Performance budget:** up to about 40 plants at 4,000 symbols each, one growth step per second, comfortably within a single frame on a laptop. Geometry is recomputed only when a plant grows or a geometric setting changes, then cached.
- **Determinism:** all randomness goes through one seeded RNG so a saved garden replays identically and bugs are reproducible.

## 11. Starter recipes

To be tuned during implementation so that the opening field has a mix of things that work, things that collapse, and things that get tangled:

| Name | DNA | What happens |
|---|---|---|
| Sprout | `A=fB;B=fC;C=y` | Two green segments and a yellow flower. Reliable, boring. |
| Tangle | `A=f[lA][rA]` | Branches every step; eventually crosses itself and collapses. |
| Tower | `A=wfA` | Endless wood. Never flowers, so never has children. |
| Bramble | `A=wf[lB][rB]wfA;B=gf[lgf][rgf]p` | Woody trunk with pink flowering side shoots. Healthy. |
| Floppy | `A=gf[lB][rB]gfA;B=gfgfy` | Same shape as Bramble but all green: snaps once it gets tall. |

Also a handful of fully random recipes, so the first pollination round is already a surprise.

## 12. Build order (once the design is approved)

1. Grammar, turtle, structure checks with tests, plus a bare page that renders one DNA string. *(Playable as a toy on its own.)*
2. World: field, seeds, rain/sun, growth, collapse, shading, lifespan, stats.
3. Inspector and DNA editor with live preview, clone, apply, new seed.
4. Bugs, crossover, mutation.
5. Sounds.
6. Save/load and autosave.
7. Settings panel, legend, starter recipes, polish, deploy to GitHub Pages.

## 13. Decisions taken

1. `[` `]` branch brackets are in the grammar.
2. Flowers are dots placed by `y`/`p`; `g`/`w` set the pen colour for lines.
3. The wood rule is load-based: a green segment may hold up at most N step-lengths of plant above it.
4. Growth happens only during rain; bugs fly only in sun. Accepted as a game rhythm rather than realism.
5. Growing below ground is a collapse, not a clip.
6. Crossover: coin flip for shared rules, 50% chance to keep rules only one parent has; mutation rate 15% per rule.
7. Stack and hosting: TypeScript + Vite + Canvas, GitHub repo + GitHub Pages.
8. Name: "Grammar Garden".
9. Recipe size limit defaults to 200 symbols.
10. (v2) Sunlight-and-energy model replaces root shading; seed spacing is dense and shade enforces distance.

## 14. Open question

Whether the single side view with plants growing up from one ground line gets too crowded to read. Watch for it in play; the field width, room and spacing are all settings.
