// Jungle scripts (in progress). Cards with plain damage need no entry.
export const jungle = {
  'base2-38': { attacks: { // Lickitung
    'Tongue Wrap': { effect: (ctx) => { ctx.damage(10); if (ctx.flip()) ctx.status('PAR'); } },
    Supersonic: { effect: (ctx) => { if (ctx.flip()) ctx.status('CNF'); else ctx.log('Supersonic: no effect'); } },
  } },
};
