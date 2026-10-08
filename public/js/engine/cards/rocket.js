// Team Rocket scripts (in progress). Cards with plain damage need no entry.
import { energyTypesOf, nameOf } from '../engine.js';
import { findMon, mons, pullCard, P } from '../state.js';

const isFire = (ctx, e) => (ctx.g.rules.energyTextAnyType ? true : energyTypesOf(ctx.db, e).includes('Fire'));

export const rocket = {
  'base5-50': { // Charmander: Gather Fire (once per turn)
    powers: { 'Gather Fire': {
      canUse: ({ g, db, seat, m }) => {
        if (m.flags.gatherFireTurn === g.turnNo) return 'Already used this turn';
        const src = mons(P(g, seat)).some((x) => x.id !== m.id && x.en.some((e) => g.rules.energyTextAnyType || energyTypesOf(db, e).includes('Fire')));
        return src ? true : 'No Fire Energy on your other Pokémon';
      },
      use: (ctx, m) => {
        const srcs = mons(ctx.me).filter((x) => x.id !== m.id && x.en.some((e) => isFire(ctx, e)));
        const from = ctx.chooseMon('Take a Fire Energy from…', srcs, { id: 'gatherFrom' })[0]; const fm = findMon(ctx.g, from).m;
        const card = ctx.chooseCards('Which Fire Energy?', fm.en.filter((e) => isFire(ctx, e)), { id: 'gatherCard' })[0];
        const c = pullCard(ctx.g, card); m.en.push(c); m.flags.gatherFireTurn = ctx.g.turnNo;
        ctx.log(`Gather Fire: moved ${nameOf(ctx.db, c.c)} from ${nameOf(ctx.db, fm.c)} to Charmander`); ctx.event({ t: 'attach', card: c, target: m.id });
      } } },
  },
  'base5-32': { attacks: { // Dark Charmeleon
    Fireball: {
      canUse: ({ g, db, m }) => (m.en.some((e) => g.rules.energyTextAnyType || energyTypesOf(db, e).includes('Fire')) ? null : 'Needs a Fire Energy attached'),
      effect: (ctx, m) => { if (ctx.flip()) { ctx.requireDiscardEnergy(m, 1, (e) => isFire(ctx, e), 'Discard 1 Fire Energy for Fireball'); ctx.damage(70); } else ctx.log('Fireball does nothing'); },
    },
  } },
};
