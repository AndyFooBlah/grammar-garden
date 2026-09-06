import type { Rng } from './rng';

const STARTS = ['Zip', 'Pip', 'Bram', 'Wil', 'Tuf', 'Mo', 'Fen', 'Lu', 'Dan', 'Ivy', 'Bo', 'Fig', 'Nib', 'Twig', 'Sprig', 'Dot', 'Kip', 'Mim', 'Rue', 'Sol', 'Tam', 'Ula', 'Vin', 'Wisp', 'Yam', 'Zed'];
const ENDS = ['py', 'ble', 'o', 'a', 'kin', 'let', 'sy', 'dle', 'bit', 'ly', 'ster', 'ie', 'nut', 'bug', 'leaf'];

export function randomName(rng: Rng): string {
  return rng.pick(STARTS) + rng.pick(ENDS);
}
