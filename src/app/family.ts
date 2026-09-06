/** Family tree overlay: a plant at the bottom, its ancestors stacked above, back several generations. */
import { formatDnaLines, parseDna } from '../core/grammar';
import type { LineageRecord, World } from '../core/world';
import { drawInspector } from './render';

const DEPTH = 4; // generations above the plant

export interface FamilyCallbacks {
  /** The user wants to see a living plant in the garden. */
  select: (id: number) => void;
  /** The user wants this recipe in the seed designer. */
  useRecipe: (dna: string) => void;
}

interface Slot {
  depth: number;
  index: number;
  record: LineageRecord | null;
}

function fateWords(r: LineageRecord, world: World): string {
  if (r.died === undefined) return world.plantById(r.id) ? 'alive' : 'gone';
  switch (r.fate) {
    case 'collapsed':
      return `collapsed at tick ${r.died}`;
    case 'starved':
      return `starved at tick ${r.died}`;
    case 'old':
      return `died of old age at tick ${r.died}`;
    case 'removed':
      return `removed at tick ${r.died}`;
    default:
      return `gone at tick ${r.died}`;
  }
}

/** Ancestor slots laid out as a binary tree: slot (d, i) has parents (d+1, 2i) and (d+1, 2i+1). */
function buildSlots(world: World, rootId: number): Slot[][] {
  const rows: Slot[][] = [];
  rows.push([{ depth: 0, index: 0, record: world.lineage.get(rootId) ?? null }]);
  for (let d = 1; d <= DEPTH; d++) {
    const prev = rows[d - 1];
    const row: Slot[] = [];
    for (const slot of prev) {
      const parents = slot.record?.parents ?? [];
      for (let k = 0; k < 2; k++) {
        const ref = parents[k];
        row.push({ depth: d, index: slot.index * 2 + k, record: ref ? (world.lineage.get(ref.id) ?? { id: ref.id, name: ref.name, dna: '', generation: 0, parents: [], mutated: [], born: 0 }) : null });
      }
    }
    rows.push(row);
  }
  return rows;
}

export function openFamilyTree(world: World, plantId: number, cb: FamilyCallbacks): void {
  const overlay = document.getElementById('family')!;
  const tree = document.getElementById('family-tree')!;
  const title = document.getElementById('family-title')!;
  const detail = document.getElementById('family-detail')!;
  const root = world.lineage.get(plantId);
  if (!root) return;
  title.textContent = `${root.name}'s family`;
  tree.innerHTML = '';
  detail.innerHTML = '<p class="muted">Tap any plant in the tree to see its recipe.</p>';

  const rows = buildSlots(world, plantId);
  const hasAnyAncestor = rows[1].some((s) => s.record);
  // Oldest generation at the top; drop empty rows beyond the known ancestry.
  let deepest = 0;
  rows.forEach((row, d) => {
    if (row.some((s) => s.record)) deepest = d;
  });
  const nodeEls = new Map<string, HTMLElement>();
  for (let d = deepest; d >= 0; d--) {
    const row = rows[d];
    const rowEl = document.createElement('div');
    rowEl.className = 'family-row';
    rowEl.style.gridTemplateColumns = `repeat(${row.length}, minmax(96px, 1fr))`;
    for (const slot of row) {
      const cell = document.createElement('div');
      cell.className = 'family-cell';
      if (slot.record) {
        const r = slot.record;
        const node = document.createElement('button');
        node.className = 'family-node' + (r.id === plantId ? ' me' : '') + (r.died !== undefined ? ' dead' : '');
        const canvas = document.createElement('canvas');
        canvas.className = 'family-canvas';
        const name = document.createElement('div');
        name.className = 'family-name';
        name.textContent = r.name;
        const gen = document.createElement('div');
        gen.className = 'family-gen';
        gen.textContent = `gen ${r.generation}${r.mutated.length ? ' ✨' : ''}`;
        node.append(canvas, name, gen);
        node.addEventListener('click', () => showDetail(r));
        cell.append(node);
        nodeEls.set(`${d}:${slot.index}`, node);
        // Draw after the node is in the DOM so the canvas has a size.
        queueMicrotask(() => {
          if (r.dna) drawInspector(canvas, world.preview(r.dna, world.settings.maxSteps), []);
        });
      }
      rowEl.append(cell);
    }
    tree.append(rowEl);
  }
  if (!hasAnyAncestor) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `${root.name} was a starter seed or a clone, so there is nobody above.`;
    tree.prepend(note);
  }

  function showDetail(r: LineageRecord): void {
    const rules = parseDna(r.dna);
    const mutated = r.mutated.length ? `<div class="mut">✨ Mutated when born: rule${r.mutated.length > 1 ? 's' : ''} ${r.mutated.join(', ')}</div>` : '';
    const parents = r.parents.length ? r.parents.map((p) => p.name).join(' + ') : 'none';
    const alive = !!world.plantById(r.id);
    detail.innerHTML = `<h3>${r.name} <span class="muted">gen ${r.generation}</span></h3>
      <div class="muted">${fateWords(r, world)} · born tick ${r.born} · parents: ${parents}</div>
      ${mutated}
      <pre class="dna">${formatDnaLines(rules) || '(recipe unknown)'}</pre>
      <div class="btn-row">
        <button data-act="use">📝 Use this recipe</button>
        ${alive ? '<button data-act="select">👀 Show in garden</button>' : ''}
      </div>`;
    detail.querySelector('[data-act="use"]')!.addEventListener('click', () => {
      cb.useRecipe(r.dna);
      closeFamilyTree();
    });
    detail.querySelector('[data-act="select"]')?.addEventListener('click', () => {
      cb.select(r.id);
      closeFamilyTree();
    });
  }

  showDetail(root);
  overlay.hidden = false;
  drawConnectors(tree, rows, nodeEls, deepest);
}

/** Lines from each plant up to its two parents, drawn on a canvas behind the grid. */
function drawConnectors(tree: HTMLElement, rows: Slot[][], nodes: Map<string, HTMLElement>, deepest: number): void {
  let canvas = tree.querySelector<HTMLCanvasElement>('canvas.family-lines');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'family-lines';
    tree.prepend(canvas);
  }
  const dpr = window.devicePixelRatio || 1;
  // Collapse the canvas before measuring, or its own size inflates the scroll extent.
  canvas.style.width = '0px';
  canvas.style.height = '0px';
  const w = tree.scrollWidth;
  const h = tree.scrollHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(90, 106, 85, 0.5)';
  ctx.lineWidth = 2;
  // Positions relative to the tree's content box, walking up offset parents.
  const center = (el: HTMLElement) => {
    let x = 0;
    let y = 0;
    for (let e: HTMLElement | null = el; e && e !== tree; e = e.offsetParent as HTMLElement | null) {
      x += e.offsetLeft;
      y += e.offsetTop;
    }
    return { x: x + el.offsetWidth / 2, top: y, bottom: y + el.offsetHeight };
  };
  for (let d = 0; d < deepest; d++) {
    for (const slot of rows[d]) {
      const child = nodes.get(`${d}:${slot.index}`);
      if (!child) continue;
      const c = center(child);
      for (let k = 0; k < 2; k++) {
        const parent = nodes.get(`${d + 1}:${slot.index * 2 + k}`);
        if (!parent) continue;
        const p = center(parent);
        ctx.beginPath();
        ctx.moveTo(c.x, c.top);
        ctx.bezierCurveTo(c.x, c.top - 16, p.x, p.bottom + 16, p.x, p.bottom);
        ctx.stroke();
      }
    }
  }
}

export function closeFamilyTree(): void {
  document.getElementById('family')!.hidden = true;
}
