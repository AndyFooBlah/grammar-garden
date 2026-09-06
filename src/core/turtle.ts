/**
 * Turtle interpreter: turns a grown string into a tree of line segments and flowers.
 * Coordinates are in pixels relative to the seed, y grows downward (canvas style),
 * so a plant growing up has negative y. The ground is y = 0.
 */

export type Pen = 'g' | 'w';
export type FlowerKind = 'y' | 'p';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  pen: Pen;
  /** Index of the segment this one grows out of, or -1 for a root segment. */
  parent: number;
  len: number;
}

export interface Flower {
  x: number;
  y: number;
  kind: FlowerKind;
  /** Segment the flower sits on, or -1 if it is on the ground. */
  seg: number;
}

export interface Geometry {
  segs: Segment[];
  flowers: Flower[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface TurtleState {
  x: number;
  y: number;
  heading: number;
  step: number;
  pen: Pen;
  seg: number;
}

export function interpret(str: string, turnAngleDeg: number, stepPx: number): Geometry {
  const turn = (turnAngleDeg * Math.PI) / 180;
  const segs: Segment[] = [];
  const flowers: Flower[] = [];
  const stack: TurtleState[] = [];
  let t: TurtleState = { x: 0, y: 0, heading: -Math.PI / 2, step: stepPx, pen: 'g', seg: -1 };
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;

  const move = (dir: 1 | -1) => {
    const nx = t.x + Math.cos(t.heading) * t.step * dir;
    const ny = t.y + Math.sin(t.heading) * t.step * dir;
    segs.push({ x1: t.x, y1: t.y, x2: nx, y2: ny, pen: t.pen, parent: t.seg, len: t.step });
    t.seg = segs.length - 1;
    t.x = nx;
    t.y = ny;
    if (nx < minX) minX = nx;
    if (nx > maxX) maxX = nx;
    if (ny < minY) minY = ny;
    if (ny > maxY) maxY = ny;
  };

  for (const c of str) {
    switch (c) {
      case 'f':
        move(1);
        break;
      case 'b':
        move(-1);
        break;
      case 'l':
        t.heading -= turn;
        break;
      case 'r':
        t.heading += turn;
        break;
      case '+':
        t.step *= 2;
        break;
      case '-':
        t.step /= 2;
        break;
      case '[':
        stack.push({ ...t });
        break;
      case ']':
        if (stack.length) t = stack.pop()!;
        break;
      case 'g':
        t.pen = 'g';
        break;
      case 'w':
        t.pen = 'w';
        break;
      case 'y':
      case 'p':
        flowers.push({ x: t.x, y: t.y, kind: c, seg: t.seg });
        break;
      default:
        break; // variables and unknown symbols draw nothing
    }
  }

  return { segs, flowers, minX, maxX, minY, maxY };
}

export function countFlowers(geo: Geometry): { y: number; p: number } {
  let y = 0;
  let p = 0;
  for (const f of geo.flowers) {
    if (f.kind === 'y') y++;
    else p++;
  }
  return { y, p };
}
