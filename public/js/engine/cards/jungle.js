// Jungle scripts. Holo and non-holo printings share one script.
import * as H from './helpers.js';
const { T, flipStatus, sureStatus, flipTimes, headsPlus, preventNext, reduceNext, discardTypeThen, extraWater, oppSwitches, metronome, mirrorMove, noAttackNext, drain, callFor, rage, benchSnipe, countersOn, ownPokemon, findMon, mons, pullCard, P, toMon, removeMon, monCards, nameOf, monHP, typeOptions } = H;

const quickAttack = headsPlus(10, 20);
const stomp = headsPlus(20, 10);
const agility = (n) => ({ effect: (ctx, m) => { ctx.damage(n); if (ctx.flip()) { ctx.addFx(m, { k: 'preventAll', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, m.c)} is protected next turn`); } } });
const spore = sureStatus(0, 'SLP');

const byName = {
  Clefable: { attacks: { Metronome: metronome, Minimize: reduceNext(20) } },
  Electrode: { attacks: { 'Chain Lightning': { effect: (ctx) => { ctx.damage(20); const d = ctx.opp.active; if (!d) return; const type = ctx.cardFor(d).types ? ctx.cardFor(d).types[0] : 'Colorless'; if (type === 'Colorless') return; for (const s of ['a', 'b']) for (const b of P(ctx.g, s).bench) { const bt = (ctx.cardFor(b).types || ['Colorless'])[0]; if (bt === type) ctx.benchDamageOne(b.id, 10); } } } } },
  Flareon: { attacks: { 'Quick Attack': quickAttack, Flamethrower: discardTypeThen('Fire', 1, 60) } },
  Jolteon: { attacks: { 'Quick Attack': quickAttack, 'Pin Missile': flipTimes(20, 4) } },
  Kangaskhan: { attacks: { Fetch: { effect: (ctx) => ctx.draw(ctx.seat, 1) }, 'Comet Punch': flipTimes(20, 4) } },
  'Mr. Mime': { passive: { preventDamage: ({ amount }) => amount >= 30 }, attacks: { Meditate: { effect: (ctx) => { const d = ctx.opp.active; ctx.damage(10 + 10 * (d ? countersOn(d) : 0)); } } } },
  Nidoqueen: { attacks: { Boyfriends: { effect: (ctx) => ctx.damage(20 + 20 * ownPokemon(ctx).filter((m) => nameOf(ctx.db, m.c) === 'Nidoking').length) } } },
  Pidgeot: { attacks: { Hurricane: { effect: (ctx) => { const d = ctx.opp.active; if (!d) return; const dealt = ctx.damage(30); if (d.dmg < monHP(ctx.db, d, ctx.g)) { removeMon(ctx.g, d.id); ctx.returnToHand(ctx.oppSeat, monCards(d)); ctx.log(`Hurricane: ${nameOf(ctx.db, d.c)} and its cards return to ${ctx.name(ctx.oppSeat)}'s hand`); ctx.g.pending.push({ t: 'promote', seat: ctx.oppSeat }); } } } } },
  Pinsir: { attacks: { Irongrip: flipStatus(20, 'PAR') } },
  Scyther: { attacks: { 'Swords Dance': { effect: (ctx, m) => { ctx.addFx(m, { k: 'swordsDance', until: T(ctx) + 2 }); ctx.log('Swords Dance: Slash does 60 next turn'); } }, Slash: { effect: (ctx, m) => ctx.damage(m.fx.some((f) => f.k === 'swordsDance') ? 60 : 30) } } },
  Snorlax: { passive: { immuneConditions: true }, attacks: { 'Body Slam': flipStatus(30, 'PAR') } },
  Vaporeon: { attacks: { 'Quick Attack': quickAttack, 'Water Gun': extraWater(30, 2, 2) } },
  Venomoth: {
    powers: { Shift: {
      canUse: ({ g, db, seat, m }) => (m.flags.shiftTurn === g.turnNo ? 'Already used this turn' : true),
      use: (ctx, m) => { const types = [...new Set(H.mons(ctx.me).concat(H.mons(ctx.opp)).filter((x) => x.id !== m.id).map((x) => (ctx.cardFor(x).types || ['Colorless'])[0]).filter((t) => t !== 'Colorless'))]; if (!types.length) { ctx.log('No other types in play'); return; } const t = ctx.choose({ id: 'shift', title: 'Change Venomoth to which type?', options: types.map((x) => ({ key: x, label: x })) })[0]; m.flags.typeOverride = t; m.flags.shiftTurn = ctx.g.turnNo; ctx.log(`Shift: Venomoth is now ${t} type`); } } },
    attacks: { 'Venom Powder': { effect: (ctx) => { ctx.damage(10); if (ctx.flip()) { ctx.status('CNF'); ctx.status('PSN'); } } } },
  },
  Victreebel: { attacks: { Lure: { effect: (ctx) => { if (!ctx.opp.bench.length || !ctx.opp.active) return; const k = ctx.chooseMon("Lure which Benched Pokémon?", ctx.opp.bench, { id: 'lure' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Lure'); } }, Acid: { effect: (ctx) => { ctx.damage(20); const d = ctx.opp.active; if (d && ctx.flip()) { ctx.addFx(d, { k: 'noRetreat', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, d.c)} can't retreat next turn`); } } } } },
  Vileplume: {
    powers: { Heal: { canUse: ({ g, seat, m }) => (m.flags.healTurn === g.turnNo ? 'Already used this turn' : mons(P(g, seat)).some((x) => x.dmg) ? true : 'No damage to heal'), use: (ctx, m) => { m.flags.healTurn = ctx.g.turnNo; if (ctx.flip('Heal')) { const k = ctx.chooseMon('Heal 10 from…', ownPokemon(ctx).filter((x) => x.dmg), { id: 'heal' })[0]; ctx.heal(findMon(ctx.g, k).m, 10); } } } },
    attacks: { 'Petal Dance': { effect: (ctx, m) => { const h = ctx.flips(3); if (h) ctx.damage(40 * h); ctx.status('CNF', m); } } },
  },
  Wigglytuff: { attacks: { Lullaby: sureStatus(0, 'SLP'), 'Do the Wave': { effect: (ctx) => ctx.damage(10 + 10 * ctx.me.bench.length) } } },
  Butterfree: { attacks: { Whirlwind: oppSwitches(20), 'Mega Drain': drain(40, true) } },
  Dodrio: { passive: { retreatAid: 1 }, attacks: { Rage: rage(10) } },
  Exeggutor: { attacks: { Teleport: { canUse: ({ g, seat }) => (P(g, seat).bench.length ? null : 'No Benched Pokémon'), effect: (ctx) => { const k = ctx.chooseMon('Switch with…', ctx.me.bench, { id: 'teleport' })[0]; ctx.switchActive(ctx.seat, k, 'Teleport'); } }, 'Big Eggsplosion': { effect: (ctx, m) => { const h = ctx.flips(m.en.length); if (h) ctx.damage(20 * h); } } } },
  Fearow: { attacks: { Agility: agility(20) } },
  Gloom: { attacks: { Poisonpowder: sureStatus(0, 'PSN'), 'Foul Odor': { effect: (ctx, m) => { ctx.damage(20); ctx.status('CNF'); ctx.status('CNF', m); } } } },
  Lickitung: { attacks: { 'Tongue Wrap': flipStatus(10, 'PAR'), Supersonic: { effect: (ctx) => { if (ctx.flip()) ctx.status('CNF'); else ctx.log('Supersonic: no effect'); } } } },
  Marowak: { attacks: { Bonemerang: flipTimes(30, 2), 'Call for Friend': callFor('Search for a Fighting Basic Pokémon', (c) => (c.types || []).includes('Fighting')) } },
  Nidorina: { attacks: { Supersonic: { effect: (ctx) => { if (ctx.flip()) ctx.status('CNF'); } }, 'Double Kick': flipTimes(30, 2) } },
  Parasect: { attacks: { Spore: spore } },
  Persian: { attacks: { Pounce: { effect: (ctx, m) => { ctx.damage(30); ctx.addFx(m, { k: 'reduce', amount: 10, until: T(ctx) + 1 }); } } } },
  Primeape: { attacks: { 'Fury Swipes': flipTimes(20, 3), Tantrum: { effect: (ctx, m) => { ctx.damage(50); if (!ctx.flip()) ctx.status('CNF', m); } } } },
  Rapidash: { attacks: { Stomp: stomp, Agility: agility(30) } },
  Rhydon: { attacks: { Ram: { effect: (ctx, m) => { ctx.damage(50); ctx.selfDamage(20); const op = ctx.opp; if (op.bench.length && op.active) { const k = ctx.chooseMon('Choose the Pokémon to switch in', op.bench, { seat: ctx.oppSeat, id: 'ram' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Ram'); } } } } },
  Tauros: { attacks: { Stomp: stomp, Rampage: { effect: (ctx, m) => { ctx.damage(20 + 10 * countersOn(m)); if (!ctx.flip()) ctx.status('CNF', m); } } } },
  Weepinbell: { attacks: { Poisonpowder: flipStatus(10, 'PSN') } },
  Bellsprout: { attacks: { 'Call for Family': callFor('Search for a Bellsprout', (c) => c.name === 'Bellsprout') } },
  Cubone: { attacks: { Snivel: reduceNext(20), Rage: rage(10) } },
  Eevee: { attacks: { 'Tail Wag': noAttackNext(true), 'Quick Attack': quickAttack } },
  Exeggcute: { attacks: { Hypnosis: sureStatus(0, 'SLP'), 'Leech Seed': { effect: (ctx, m) => { if (ctx.damage(20) > 0) ctx.heal(m, 10); } } } },
  Jigglypuff: { attacks: { Lullaby: sureStatus(0, 'SLP') } },
  Mankey: { powers: { Peek: { canUse: ({ g, m }) => (m.flags.peekTurn === g.turnNo ? 'Already used this turn' : true), use: (ctx, m) => {
    m.flags.peekTurn = ctx.g.turnNo;
    const what = ctx.choose({ id: 'peek', title: 'Peek at…', options: [{ key: 'mydeck', label: 'Top of my deck' }, { key: 'theirdeck', label: "Top of opponent's deck" }, { key: 'hand', label: "A random card from the opponent's hand" }, { key: 'myprize', label: 'One of my prizes' }, { key: 'theirprize', label: "One of the opponent's prizes" }] })[0];
    let card = null; if (what === 'mydeck') card = ctx.me.deck[0]; else if (what === 'theirdeck') card = ctx.opp.deck[0]; else if (what === 'hand') { const h = ctx.opp.hand; card = h.length ? h[Math.floor(ctx.rng() * h.length)] : null; } else { const pz = what === 'myprize' ? ctx.me.prizes : ctx.opp.prizes; if (pz.length) { const i = ctx.choose({ id: 'peekPrize', title: 'Which prize?', options: pz.map((c, j) => ({ key: String(j), label: 'Prize ' + (j + 1) })) })[0]; card = pz[+i]; } }
    ctx.choose({ id: 'peekResult', title: card ? `Peek: ${nameOf(ctx.db, card.c)}` : 'Peek: nothing there', options: [{ key: 'ok', label: 'OK', cid: card ? card.c : undefined }] }); ctx.log('Peek used');
  } } } },
  Meowth: { attacks: { 'Pay Day': { effect: (ctx) => { ctx.damage(10); if (ctx.flip()) ctx.draw(ctx.seat, 1); } } } },
  'Nidoran ♀': { attacks: { 'Fury Swipes': flipTimes(10, 3), 'Call for Family': callFor('Search for a Nidoran', (c) => /^Nidoran/.test(c.name)) } },
  Oddish: { attacks: { 'Stun Spore': flipStatus(10, 'PAR'), Sprout: callFor('Search for an Oddish', (c) => c.name === 'Oddish') } },
  Paras: { attacks: { Spore: spore } },
  Pikachu: { attacks: { Spark: benchSnipe(20, 10) } },
  Rhyhorn: { attacks: { Leer: noAttackNext(true) } },
  Spearow: { attacks: { 'Mirror Move': mirrorMove } },
  Venonat: { attacks: { 'Stun Spore': flipStatus(10, 'PAR'), 'Leech Life': drain(10, false) } },
  'Poké Ball': { trainer: (ctx) => { if (!ctx.flip()) { ctx.log('Poké Ball: tails'); return; } const got = ctx.searchDeck(ctx.seat, 'Choose a Pokémon card', (c) => c.st === 'Pokémon', { min: 0, max: 1 }); got.forEach((c) => { ctx.toHand(ctx.seat, c); ctx.log(`Poké Ball: found ${nameOf(ctx.db, c.c)}`); }); ctx.shuffle(ctx.seat); } },
};

const IDS = {
  Clefable: ['base2-1', 'base2-17'], Electrode: ['base2-2', 'base2-18'], Flareon: ['base2-3', 'base2-19'], Jolteon: ['base2-4', 'base2-20'], Kangaskhan: ['base2-5', 'base2-21'],
  'Mr. Mime': ['base2-6', 'base2-22'], Nidoqueen: ['base2-7', 'base2-23'], Pidgeot: ['base2-8', 'base2-24'], Pinsir: ['base2-9', 'base2-25'], Scyther: ['base2-10', 'base2-26'],
  Snorlax: ['base2-11', 'base2-27'], Vaporeon: ['base2-12', 'base2-28'], Venomoth: ['base2-13', 'base2-29'], Victreebel: ['base2-14', 'base2-30'], Vileplume: ['base2-15', 'base2-31'],
  Wigglytuff: ['base2-16', 'base2-32'], Butterfree: ['base2-33'], Dodrio: ['base2-34'], Exeggutor: ['base2-35'], Fearow: ['base2-36'], Gloom: ['base2-37'], Lickitung: ['base2-38'],
  Marowak: ['base2-39'], Nidorina: ['base2-40'], Parasect: ['base2-41'], Persian: ['base2-42'], Primeape: ['base2-43'], Rapidash: ['base2-44'], Rhydon: ['base2-45'], Tauros: ['base2-47'],
  Weepinbell: ['base2-48'], Bellsprout: ['base2-49'], Cubone: ['base2-50'], Eevee: ['base2-51'], Exeggcute: ['base2-52'], Jigglypuff: ['base2-54'], Mankey: ['base2-55'], Meowth: ['base2-56'],
  'Nidoran ♀': ['base2-57'], Oddish: ['base2-58'], Paras: ['base2-59'], Pikachu: ['base2-60'], Rhyhorn: ['base2-61'], Spearow: ['base2-62'], Venonat: ['base2-63'], 'Poké Ball': ['base2-64'],
};
export const jungle = {};
for (const [name, ids] of Object.entries(IDS)) for (const id of ids) jungle[id] = byName[name];
