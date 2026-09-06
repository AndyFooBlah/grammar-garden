/** Grow a DNA string into geometry and judge it. Pure: same inputs, same plant. */
import { grow, parseDna, validateDna, type Rules } from './grammar';
import { checkStructure, type Verdict } from './structure';
import { countFlowers, interpret, type Geometry } from './turtle';

export interface GeometrySettings {
  turnAngle: number;
  stepPx: number;
  maxLoad: number; // in step lengths
  maxSymbols: number;
}

export interface GrownPlant {
  rules: Rules;
  problems: string[];
  str: string;
  steps: number;
  capped: boolean;
  finished: boolean;
  geo: Geometry;
  verdict: Verdict;
  flowers: { y: number; p: number };
  /** Height above ground in pixels. */
  height: number;
}

export function growPlant(dna: string, steps: number, s: GeometrySettings): GrownPlant {
  const rules = parseDna(dna);
  const problems = validateDna(rules);
  const g = grow(rules, steps, s.maxSymbols);
  const geo = interpret(g.str, s.turnAngle, s.stepPx);
  const verdict = checkStructure(geo, s.maxLoad * s.stepPx);
  return {
    rules,
    problems,
    str: g.str,
    steps: g.steps,
    capped: g.capped,
    finished: g.finished,
    geo,
    verdict,
    flowers: countFlowers(geo),
    height: -geo.minY,
  };
}
