// Fossil scripts. Holo and non-holo printings share one script.
import * as H from './helpers.js';
const { T, flipStatus, sureStatus, flipTimes, tailsNothing, preventNext, reduceNext, extraWater, discardDefenderEnergy, recover, drain, callFor, benchSnipe, countersOn, ownPokemon, findMon, mons, pullCard, P, toMon, removeMon, monCards, nameOf, monHP, smokescreen, selfDestruct, asDoll, typeFilter, hasType } = H;

const agility = (n) => ({ effect: (ctx, m) => { ctx.damage(n); if (ctx.flip()) { ctx.addFx(m, { k: 'preventAll', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, m.c)} is protected next turn`); } } });
const darkMind = benchSnipe(30, 10);
const waterGunCap = (base, cost) => extraWater(base, cost, 2);
const prophecy = { effect: (ctx) => {
  const who = ctx.choose({ id: 'prophecyWho', title: 'Look at which deck?', options: [{ key: 'me', label: 'My deck' }, { key: 'opp', label: "Opponent's deck" }] })[0];
  const s = who === 'me' ? ctx.seat : ctx.oppSeat; const p = P(ctx.g, s); const top = p.deck.slice(0, 3); if (!top.length) return;
  const order = ctx.chooseCards('Rearrange the top cards (first chosen goes on top)', top, { min: top.length, max: top.length, ordered: true, id: 'prophecy' });
  p.deck.splice(0, top.length, ...order.map((id) => top.find((c) => c.id === id))); ctx.log(`Prophecy: rearranged the top of ${ctx.name(s)}'s deck`);
} };

const byName = {
  Aerodactyl: { passive: { noEvolve: true } },
  Articuno: { attacks: { 'Freeze Dry': flipStatus(30, 'PAR'), Blizzard: { effect: (ctx) => { ctx.damage(50); if (ctx.flip()) ctx.benchDamage(ctx.oppSeat, 10); else ctx.benchDamage(ctx.seat, 10); } } } },
  Ditto: { passive: { transform: true } },
  Dragonite: { powers: { 'Step In': { canUse: ({ g, seat, m }) => (m.flags.stepTurn === g.turnNo ? 'Already used this turn' : P(g, seat).bench.some((b) => b.id === m.id) && P(g, seat).active ? true : 'Dragonite must be on the bench'), use: (ctx, m) => { m.flags.stepTurn = ctx.g.turnNo; ctx.switchActive(ctx.seat, m.id, 'Step In'); } } }, attacks: { Slam: flipTimes(40, 2) } },
  Gengar: { powers: { Curse: { canUse: ({ g, seat, m }) => (m.flags.curseTurn === g.turnNo ? 'Already used this turn' : mons(P(g, H.other(seat))).some((x) => x.dmg) && mons(P(g, H.other(seat))).length > 1 ? true : 'Nothing to curse'), use: (ctx, m) => { m.flags.curseTurn = ctx.g.turnNo; const from = ctx.chooseMon("Move 1 damage counter from which of the opponent's Pokémon?", mons(ctx.opp).filter((x) => x.dmg), { id: 'curseFrom' })[0]; const to = ctx.chooseMon('…to which?', mons(ctx.opp).filter((x) => x.id !== from), { id: 'curseTo' })[0]; const a = findMon(ctx.g, from).m, b = findMon(ctx.g, to).m; a.dmg -= 10; b.dmg += 10; ctx.log(`Curse: 10 from ${nameOf(ctx.db, a.c)} to ${nameOf(ctx.db, b.c)} (now ${b.dmg})`); } } }, attacks: { 'Dark Mind': darkMind } },
  Haunter: { passive: { onTargeted: (ctx, m) => { if (ctx.flip('Transparency')) { ctx.addFx(m, { k: 'preventAll', until: T(ctx) }); ctx.log('Transparency: the attack passes through Haunter'); } } }, attacks: { Nightmare: sureStatus(10, 'SLP') } },
  Hitmonlee: { attacks: { 'Stretch Kick': benchSnipe(0, 20) } },
  Hypno: { attacks: { Prophecy: prophecy, 'Dark Mind': darkMind } },
  Kabutops: { attacks: { Absorb: drain(40, true) } },
  Lapras: { attacks: { 'Water Gun': waterGunCap(10, 1), 'Confuse Ray': flipStatus(10, 'CNF') } },
  Magneton: { attacks: { Sonicboom: { effect: (ctx) => ctx.damage(20, { noWR: true }) }, Selfdestruct: selfDestruct(100, 20) } },
  Moltres: { attacks: { Wildfire: { effect: (ctx, m) => { const fires = m.en.filter((e) => hasType(ctx, e, 'Fire')); if (!fires.length) { ctx.log('Wildfire: nothing discarded'); return; } const k = ctx.chooseCards('Discard how many Fire Energy? (choose the cards)', fires, { min: 0, max: fires.length, id: 'wildfire' }); if (!k.length) return; ctx.discardEnergy(m, fires.filter((e) => k.includes(e.id))); const n = Math.min(k.length, ctx.opp.deck.length); ctx.opp.discard.push(...ctx.opp.deck.splice(0, n)); ctx.log(`Wildfire: ${n} card${n === 1 ? '' : 's'} discarded from the top of ${ctx.name(ctx.oppSeat)}'s deck`); } }, 'Dive Bomb': tailsNothing(80) } },
  Muk: { passive: { disablePowers: true }, attacks: { Sludge: flipStatus(30, 'PSN') } },
  Raichu: { attacks: { Gigashock: { effect: (ctx) => { ctx.damage(30); const b = ctx.opp.bench; if (!b.length) return; const k = b.length <= 3 ? b.map((x) => x.id) : ctx.chooseMon('Choose 3 Benched Pokémon', b, { min: 3, max: 3, id: 'gigashock' }); for (const id of k) ctx.benchDamageOne(id, 10); } } } },
  Zapdos: { attacks: { Thunderstorm: { effect: (ctx, m) => { ctx.damage(40); let tails = 0; for (const b of ctx.opp.bench.slice()) { if (ctx.flip()) ctx.benchDamageOne(b.id, 20); else tails++; } if (tails) ctx.selfDamage(10 * tails); } } } },
  Arbok: { attacks: { 'Terror Strike': { effect: (ctx) => { ctx.damage(10); if (ctx.flip() && ctx.opp.bench.length && ctx.opp.active) { const k = ctx.chooseMon('Choose the Pokémon to switch in', ctx.opp.bench, { seat: ctx.oppSeat, id: 'terror' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Terror Strike'); } } }, 'Poison Fang': sureStatus(20, 'PSN') } },
  Cloyster: { attacks: { Clamp: { effect: (ctx) => { if (ctx.flip()) { ctx.damage(30); ctx.status('PAR'); } else ctx.log('Clamp does nothing'); } }, 'Spike Cannon': flipTimes(30, 2) } },
  Gastly: { attacks: { Lick: flipStatus(10, 'PAR'), 'Energy Conversion': { effect: (ctx, m) => { if (ctx.towerLocked) { ctx.selfDamage(10); ctx.log('Pokémon Tower: no Energy comes back'); return; } const en = ctx.me.discard.filter((c) => ctx.db[c.c].st === 'Energy'); const k = ctx.chooseCards('Take up to 2 Energy from your discard pile', en, { min: 0, max: 2, id: 'econv' }); for (const id of k) ctx.toHand(ctx.seat, pullCard(ctx.g, id)); ctx.selfDamage(10); } } } },
  Golbat: { attacks: { 'Leech Life': drain(20, false) } },
  Golduck: { attacks: { Psyshock: flipStatus(10, 'PAR'), 'Hyper Beam': discardDefenderEnergy(20) } },
  Golem: { attacks: { Selfdestruct: selfDestruct(100, 20) } },
  Graveler: { attacks: { Harden: { effect: (ctx, m) => { ctx.addFx(m, { k: 'preventSmall', until: T(ctx) + 1 }); ctx.log('Harden: damage of 30 or less is prevented next turn'); } } } },
  Kingler: { attacks: { Flail: { effect: (ctx, m) => ctx.damage(10 * countersOn(m)) } } },
  Magmar: { attacks: { Smokescreen: smokescreen(10), Smog: flipStatus(20, 'PSN') } },
  Omastar: { attacks: { 'Water Gun': waterGunCap(20, 2), 'Spike Cannon': flipTimes(30, 2) } },
  Sandslash: { attacks: { 'Fury Swipes': flipTimes(20, 3) } },
  Seadra: { attacks: { 'Water Gun': waterGunCap(20, 2), Agility: agility(20) } },
  Slowbro: { powers: { 'Strange Behavior': { canUse: ({ g, seat, m }) => (mons(P(g, seat)).some((x) => x.id !== m.id && x.dmg) && m.dmg + 10 < 60 ? true : 'Nothing to move'), use: (ctx, m) => { const k = ctx.chooseMon('Move 1 damage counter from…', ownPokemon(ctx).filter((x) => x.id !== m.id && x.dmg), { id: 'strange' })[0]; const a = findMon(ctx.g, k).m; a.dmg -= 10; m.dmg += 10; ctx.log(`Strange Behavior: 10 from ${nameOf(ctx.db, a.c)} to Slowbro (now ${m.dmg})`); } } }, attacks: { Psyshock: flipStatus(20, 'PAR') } },
  Tentacruel: { attacks: { Supersonic: { effect: (ctx) => { if (ctx.flip()) ctx.status('CNF'); } }, 'Jellyfish Sting': sureStatus(10, 'PSN') } },
  Weezing: { attacks: { Smog: flipStatus(20, 'PSN'), Selfdestruct: selfDestruct(60, 10) } },
  Ekans: { attacks: { 'Spit Poison': flipStatus(0, 'PSN'), Wrap: flipStatus(20, 'PAR') } },
  Geodude: { attacks: { 'Stone Barrage': { effect: (ctx) => { let h = 0; while (ctx.flip()) h++; ctx.log(`${h} heads`); if (h) ctx.damage(10 * h); } } } },
  Grimer: { attacks: { 'Nasty Goo': flipStatus(10, 'PAR'), Minimize: reduceNext(20) } },
  Horsea: { attacks: { Smokescreen: smokescreen(10) } },
  Kabuto: { passive: { halveDamage: true } },
  Krabby: { attacks: { 'Call for Family': callFor('Search for a Krabby', (c) => c.name === 'Krabby') } },
  Omanyte: { passive: { revealOpponentHand: true }, attacks: { 'Water Gun': waterGunCap(10, 1) } },
  Psyduck: { attacks: { Headache: { effect: (ctx) => { ctx.addPlayerFx(ctx.oppSeat, { k: 'noTrainers', until: T(ctx) + 1 }); ctx.log(`${ctx.name(ctx.oppSeat)} can't play Trainers next turn`); } }, 'Fury Swipes': flipTimes(10, 3) } },
  Shellder: { attacks: { Supersonic: { effect: (ctx) => { if (ctx.flip()) ctx.status('CNF'); } }, 'Hide in Shell': preventNext('preventDamage') } },
  Slowpoke: { attacks: { 'Spacing Out': { canUse: ({ m }) => (m.dmg ? null : 'No damage to remove'), effect: (ctx, m) => { if (ctx.flip()) ctx.heal(m, 10); } }, Scavenge: { canUse: ({ g, db, m, seat }) => ((g.rules.energyTextAnyType ? m.en.length : m.en.some((e) => H.energyTypesOf(db, e).includes('Psychic'))) ? null : 'Needs a Psychic Energy to discard'), effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 1, typeFilter(ctx, 'Psychic')); const tr = ctx.me.discard.filter((c) => ctx.db[c.c].st === 'Trainer'); const k = ctx.chooseCards('Take a Trainer from your discard pile', tr, { min: 0, max: 1, id: 'scavenge' }); for (const id of k) ctx.toHand(ctx.seat, pullCard(ctx.g, id)); } } } },
  Tentacool: { powers: { Cowardice: { canUse: ({ g, m }) => (m.playedTurn === g.turnNo ? "Can't use the turn it was played" : true), use: (ctx, m) => { const f = removeMon(ctx.g, m.id); const rest = monCards(m).filter((c) => c.id !== m.id); f.p.discard.push(...rest); f.p.hand.push({ id: m.id, c: m.c }); ctx.log('Cowardice: Tentacool returns to hand'); if (!f.p.active) ctx.g.pending.push({ t: 'promote', seat: ctx.seat }); } } } },
  Zubat: { attacks: { Supersonic: { effect: (ctx) => { if (ctx.flip()) ctx.status('CNF'); } }, 'Leech Life': drain(10, false) } },
  'Mr. Fuji': { canPlay: ({ g, seat }) => (P(g, seat).bench.length ? true : 'No Benched Pokémon'), trainer: (ctx) => { const k = ctx.chooseMon('Shuffle which Benched Pokémon into your deck?', ctx.me.bench, { id: 'fuji' })[0]; const f = findMon(ctx.g, k); removeMon(ctx.g, k); ctx.me.deck.push(...monCards(f.m)); ctx.shuffle(ctx.seat); ctx.log(`Mr. Fuji: ${nameOf(ctx.db, f.m.c)} and its cards shuffled into the deck`); } },
  'Energy Search': { trainer: (ctx) => { const got = ctx.searchDeck(ctx.seat, 'Choose a basic Energy', (c) => c.st === 'Energy' && c.sub === 'Basic', { min: 0, max: 1 }); got.forEach((c) => ctx.toHand(ctx.seat, c)); ctx.shuffle(ctx.seat); } },
  Gambler: { trainer: (ctx) => { ctx.me.deck.push(...ctx.me.hand.filter((c) => c.id !== ctx.card.id)); ctx.me.hand = []; ctx.shuffle(ctx.seat); ctx.draw(ctx.seat, ctx.flip() ? 8 : 1); } },
  Recycle: { trainer: (ctx) => { if (!ctx.flip()) { ctx.log('Recycle: tails'); return; } const k = ctx.chooseCards('Put which card on top of your deck?', ctx.me.discard, { min: 0, max: 1, id: 'recycle' }); for (const id of k) ctx.me.deck.unshift(pullCard(ctx.g, id)); } },
  'Mysterious Fossil': asDoll,
};

const IDS = {
  Aerodactyl: ['base3-1', 'base3-16'], Articuno: ['base3-2', 'base3-17'], Ditto: ['base3-3', 'base3-18'], Dragonite: ['base3-4', 'base3-19'], Gengar: ['base3-5', 'base3-20'],
  Haunter: ['base3-6', 'base3-21'], Hitmonlee: ['base3-7', 'base3-22'], Hypno: ['base3-8', 'base3-23'], Kabutops: ['base3-9', 'base3-24'], Lapras: ['base3-10', 'base3-25'],
  Magneton: ['base3-11', 'base3-26'], Moltres: ['base3-12', 'base3-27'], Muk: ['base3-13', 'base3-28'], Raichu: ['base3-14', 'base3-29'], Zapdos: ['base3-15', 'base3-30'],
  Arbok: ['base3-31'], Cloyster: ['base3-32'], Gastly: ['base3-33'], Golbat: ['base3-34'], Golduck: ['base3-35'], Golem: ['base3-36'], Graveler: ['base3-37'], Kingler: ['base3-38'],
  Magmar: ['base3-39'], Omastar: ['base3-40'], Sandslash: ['base3-41'], Seadra: ['base3-42'], Slowbro: ['base3-43'], Tentacruel: ['base3-44'], Weezing: ['base3-45'], Ekans: ['base3-46'],
  Geodude: ['base3-47'], Grimer: ['base3-48'], Horsea: ['base3-49'], Kabuto: ['base3-50'], Krabby: ['base3-51'], Omanyte: ['base3-52'], Psyduck: ['base3-53'], Shellder: ['base3-54'],
  Slowpoke: ['base3-55'], Tentacool: ['base3-56'], Zubat: ['base3-57'], 'Mr. Fuji': ['base3-58'], 'Energy Search': ['base3-59'], Gambler: ['base3-60'], Recycle: ['base3-61'], 'Mysterious Fossil': ['base3-62'],
};
export const fossil = {};
for (const [name, ids] of Object.entries(IDS)) for (const id of ids) fossil[id] = byName[name];
