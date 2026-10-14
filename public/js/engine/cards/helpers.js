// Shared building blocks for card scripts. ctx is the engine context (see engine.js makeCtx).
import { energyTypesOf, nameOf, monHP, hasFx, scriptOf } from '../engine.js';
import { findMon, mons, pullCard, P, other, toMon, removeMon, monCards } from '../state.js';

export const T = (ctx) => ctx.g.turnNo;
export const TYPES6 = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting'];
export const hasType = (ctx, e, type) => (ctx.g.rules.energyTextAnyType ? true : energyTypesOf(ctx.db, e).includes(type));
export const typeFilter = (ctx, type) => (e) => hasType(ctx, e, type);
export const countType = (ctx, m, type) => m.en.reduce((k, e) => k + energyTypesOf(ctx.db, e).filter((t) => t === type).length, 0);
export const countersOn = (m) => m.dmg / 10;
export const ownPokemon = (ctx) => mons(ctx.me);
export const typeOptions = () => TYPES6.map((t) => ({ key: t, label: t }));

export const dmg = (n) => ({ effect: (ctx) => ctx.damage(n) });
export const flipStatus = (n, code) => ({ effect: (ctx) => { if (n) ctx.damage(n); if (ctx.flip()) ctx.status(code); } });
export const sureStatus = (n, code) => ({ effect: (ctx) => { if (n) ctx.damage(n); ctx.status(code); } });
export const tailsSelf = (n, self) => ({ effect: (ctx) => { ctx.damage(n); if (!ctx.flip()) ctx.selfDamage(self); } });
export const tailsNothing = (n) => ({ effect: (ctx) => { if (ctx.flip()) ctx.damage(n); else ctx.log('The attack does nothing'); } });
export const flipTimes = (per, flips) => ({ effect: (ctx) => { const h = ctx.flips(flips); ctx.log(`${h} heads`); if (h) ctx.damage(per * h); } });
export const headsPlus = (base, plus) => ({ effect: (ctx) => ctx.damage(ctx.flip() ? base + plus : base) });
export const preventNext = (kind) => ({ effect: (ctx, m) => { if (ctx.flip()) { ctx.addFx(m, { k: kind, until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, m.c)} is protected during the opponent's next turn`); } } });
export const sureProtect = (kind, extra) => ({ effect: (ctx, m) => { ctx.addFx(m, { k: kind, until: T(ctx) + 1, ...(extra || {}) }); ctx.log(`${nameOf(ctx.db, m.c)} is protected during the opponent's next turn`); } });
export const reduceNext = (amount) => ({ effect: (ctx, m) => { ctx.addFx(m, { k: 'reduce', amount, until: T(ctx) + 1 }); ctx.log(`Damage to ${nameOf(ctx.db, m.c)} is reduced by ${amount} next turn`); } });
export const discardTypeThen = (type, n, damage) => ({
  canUse: ({ g, db, m }) => (g.rules.energyTextAnyType ? m.en.length >= n : m.en.filter((e) => energyTypesOf(db, e).includes(type)).length >= n) ? null : `Needs ${n} ${type} Energy to discard`,
  effect: (ctx, m) => { ctx.requireDiscardEnergy(m, n, typeFilter(ctx, type)); ctx.damage(damage); },
});
export const extraWater = (base, cost, cap) => ({ effect: (ctx, m) => { const extra = Math.min(cap, Math.max(0, countType(ctx, m, 'Water') - cost)); ctx.damage(base + 10 * extra); } });
export const oppSwitches = (n, label) => ({ effect: (ctx) => { ctx.damage(n); const op = ctx.opp; if (op.bench.length && op.active) { const k = ctx.chooseMon('Choose the Pokémon to switch in', op.bench, { seat: ctx.oppSeat, id: 'oppswitch' }); ctx.switchActive(ctx.oppSeat, k[0], label || 'Whirlwind'); } } });
export const selfDestruct = (n, bench) => ({ effect: (ctx, m) => { ctx.damage(n); ctx.benchDamage(ctx.oppSeat, bench); ctx.benchDamage(ctx.seat, bench); ctx.selfDamage(n); } });
export const recover = (type) => ({ canUse: ({ g, db, m }) => (g.rules.energyTextAnyType ? m.en.length : m.en.filter((e) => energyTypesOf(db, e).includes(type)).length) ? null : `Needs a ${type} Energy to discard`, effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 1, typeFilter(ctx, type)); ctx.heal(m); } });
export const discardDefenderEnergy = (n) => ({ effect: (ctx) => { ctx.damage(n); const d = ctx.opp.active; if (d && d.en.length) { const k = ctx.chooseCards('Choose an Energy to discard from the Defending Pokémon', d.en, { id: 'discardTheirs' }); ctx.discardEnergy(d, d.en.filter((e) => k.includes(e.id))); } } });
/** n damage to the Active plus `snipe` to one chosen Benched Pokémon of the opponent. */
export const benchSnipe = (n, snipe) => ({ effect: (ctx) => { if (n) ctx.damage(n); if (ctx.opp.bench.length) { const k = ctx.chooseMon(`Choose a Benched Pokémon to take ${snipe}`, ctx.opp.bench, { id: 'snipe' })[0]; ctx.benchDamageOne(k, snipe); } } });
/** Heal self by the damage dealt (Leech Life style); `half` rounds half up to 10. */
export const drain = (n, half) => ({ effect: (ctx, m) => { const dealt = ctx.damage(n); const heal = half ? Math.ceil(dealt / 20) * 10 : dealt; if (heal) ctx.heal(m, heal); } });
/** Search the deck for a Basic matching `filter` and bench it. */
export const callFor = (label, filter) => ({
  canUse: ({ g, seat }) => (P(g, seat).bench.length < g.rules.benchSize ? null : 'Bench is full'),
  effect: (ctx) => { const got = ctx.searchDeck(ctx.seat, label, (card) => card.st === 'Pokémon' && card.sub === 'Basic' && filter(card), { min: 0, max: 1 }); for (const c of got) { ctx.me.bench.push(toMon(c, ctx.g.turnNo)); ctx.log(`${nameOf(ctx.db, c.c)} joins the bench`); } ctx.shuffle(ctx.seat); },
});
export const rage = (base) => ({ effect: (ctx, m) => ctx.damage(base + 10 * countersOn(m)) });
export const metronome = { effect: (ctx, m) => {
  const d = ctx.opp.active; if (!d) return; const atks = ctx.cardFor(d).atk || []; if (!atks.length) { ctx.log('Nothing to copy'); return; }
  const k = ctx.choose({ id: 'metronome', title: 'Copy which attack?', options: atks.map((a) => ({ key: a.n, label: `${a.n} ${a.d || ''}` })) })[0];
  const atk = atks.find((a) => a.n === k); ctx.log(`Metronome copies ${atk.n}`);
  const was = ctx.copying; ctx.copying = true; try { ctx.runAttack(m, atk, ctx.cardFor(d).id); } finally { ctx.copying = was; }
} };
export const mirrorMove = { canUse: ({ g, m }) => (m.flags.lastHit && m.flags.lastHit.turn === g.turnNo - 1 ? null : "Wasn't attacked last turn"), effect: (ctx, m) => { ctx.damage(m.flags.lastHit.amount, { noWR: true }); } };
/** "Can't attack me next turn" (Tail Wag, Leer): approximated as the Defending Pokémon can't attack next turn. */
export const noAttackNext = (needFlip) => ({ effect: (ctx) => { const d = ctx.opp.active; if (!d) return; if (needFlip && !ctx.flip()) return; ctx.addFx(d, { k: 'noAttack', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, d.c)} can't attack next turn`); } });
export const smokescreen = (n) => ({ effect: (ctx) => { ctx.damage(n); const d = ctx.opp.active; if (d) { ctx.addFx(d, { k: 'sandAttack', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, d.c)} must flip to attack next turn`); } } });
export const onceStatusSelf = (n, code) => ({ effect: (ctx, m) => { ctx.damage(n); ctx.status(code, m); } });
export const asDoll = { asPokemon: { noPrize: true, noConditions: true, noRetreat: true, canDiscard: true } };
export { findMon, mons, pullCard, P, other, toMon, removeMon, monCards, nameOf, monHP, hasFx, energyTypesOf, scriptOf };
