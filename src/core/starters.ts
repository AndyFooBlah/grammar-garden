/** Hand-made recipes for the opening field and the legend. */
export interface Starter {
  name: string;
  dna: string;
  blurb: string;
}

export const STARTERS: Starter[] = [
  { name: 'Sprout', dna: 'A=fB;B=fC;C=y', blurb: 'Two green segments and a yellow flower. Reliable, boring.' },
  { name: 'Tangle', dna: 'A=f[lA][rA]', blurb: 'Branches every step; eventually crosses itself and collapses.' },
  { name: 'Tower', dna: 'A=wfA', blurb: 'Endless wood. Never flowers, so never has children.' },
  { name: 'Bramble', dna: 'A=wf[lB][rB]wfA;B=gf[lgf][rgf]p', blurb: 'Woody trunk with pink flowering side shoots. Healthy.' },
  { name: 'Floppy', dna: 'A=gf[lB][rB]gfA;B=gfgfy', blurb: 'Same shape as Bramble but all green: snaps once it gets tall.' },
  { name: 'Candle', dna: 'A=wfwfB;B=[llgfy][rrgfy]gfB', blurb: 'A short woody stem with yellow flowers up a green spike.' },
  { name: 'Fan', dna: 'A=wf[lllB][llB][lB]B[rB][rrB][rrrB];B=gfgfp', blurb: 'One woody stem, a fan of pink-tipped green rays.' },
];
