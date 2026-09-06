# Grammar Garden

A browser game for exploring evolution with a seven-year-old. Every plant grows
from a tiny recipe (an L-system), bad recipes fall over, bees and butterflies
mix the good ones, and the field slowly fills with whatever works.

Play it: https://andyfooblah.github.io/grammar-garden/

The full game summary and design is in [DESIGN.md](DESIGN.md).

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests (vitest)
npm run build    # typecheck + production build into dist/
```

No backend and no cloud services: the game is static files. Pushing to `main`
runs the tests and deploys to GitHub Pages.

## Layout

- `src/core/` — the simulation, framework-free and unit-tested:
  `grammar` (rules, growth), `turtle` (drawing), `structure` (collapse checks),
  `genetics` (crossover, mutation), `world` (plants, bugs, weather, save/load).
- `src/app/` — the browser app: `render` (canvas), `audio` (synthesized
  sounds), `main` (UI wiring).
