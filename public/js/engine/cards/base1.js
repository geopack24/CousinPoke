// Base Set scripts. Attacks with plain damage need no script; everything with text is here.
// ctx API: see engine.js makeCtx. `m` is the attacking Pokémon, `T` the current turn number.
import { energyTypesOf, nameOf, monHP, hasFx, runAttack } from '../engine.js';
import { findMon, mons, pullCard, removeMon, monCards, P, other, toMon } from '../state.js';

const T = (ctx) => ctx.g.turnNo;
const hasType = (ctx, e, type) => (ctx.g.rules.energyTextAnyType ? true : energyTypesOf(ctx.db, e).includes(type));
const typeFilter = (ctx, type) => (e) => hasType(ctx, e, type);
const dmg = (n) => ({ effect: (ctx) => ctx.damage(n) });
const flipStatus = (n, code) => ({ effect: (ctx) => { if (n) ctx.damage(n); if (ctx.flip()) ctx.status(code); } });
const sureStatus = (n, code) => ({ effect: (ctx) => { if (n) ctx.damage(n); ctx.status(code); } });
const tailsSelf = (n, self) => ({ effect: (ctx) => { ctx.damage(n); if (!ctx.flip()) ctx.selfDamage(self); } });
const flipTimes = (per, flips) => ({ effect: (ctx) => { const h = ctx.flips(flips); ctx.log(`${h} heads`); if (h) ctx.damage(per * h); } });
const preventNext = (kind) => ({ effect: (ctx, m) => { if (ctx.flip()) { ctx.addFx(m, { k: kind, until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, m.c)} is protected during the opponent's next turn`); } } });
const discardTypeThen = (type, n, damage) => ({
  canUse: ({ g, db, m }) => (g.rules.energyTextAnyType ? m.en.length >= n : m.en.filter((e) => energyTypesOf(db, e).includes(type)).length >= n) ? null : `Needs ${n} ${type} Energy to discard`,
  effect: (ctx, m) => { ctx.requireDiscardEnergy(m, n, typeFilter(ctx, type)); ctx.damage(damage); },
});
const extraWater = (base, cost, cap) => ({ effect: (ctx, m) => { const w = m.en.reduce((k, e) => k + energyTypesOf(ctx.db, e).filter((t) => t === 'Water').length, 0); const extra = Math.min(cap, Math.max(0, w - cost)); ctx.damage(base + 10 * extra); } });
const oppSwitches = (n) => ({ effect: (ctx) => { ctx.damage(n); const op = ctx.opp; if (op.bench.length) { const k = ctx.chooseMon('Choose the Pokémon to switch in', op.bench, { seat: ctx.oppSeat, id: 'whirlwind' }); ctx.switchActive(ctx.oppSeat, k[0], 'Whirlwind'); } } });
const selfDestruct = (n, bench) => ({ effect: (ctx, m) => { ctx.damage(n); ctx.benchDamage(ctx.oppSeat, bench); ctx.benchDamage(ctx.seat, bench); ctx.selfDamage(n); } });
const recover = (type) => ({ canUse: ({ g, db, m }) => (g.rules.energyTextAnyType ? m.en.length : m.en.filter((e) => energyTypesOf(db, e).includes(type)).length) ? null : `Needs a ${type} Energy to discard`, effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 1, typeFilter(ctx, type)); ctx.heal(m); } });
const discardDefenderEnergy = (n) => ({ effect: (ctx) => { ctx.damage(n); const d = ctx.opp.active; if (d && d.en.length) { const k = ctx.chooseCards('Choose an Energy to discard from the Defending Pokémon', d.en, { id: 'discardTheirs' }); ctx.discardEnergy(d, d.en.filter((e) => k.includes(e.id))); } } });
const ownPokemon = (ctx) => mons(ctx.me);
const countersOn = (m) => m.dmg / 10;

export const base1 = {
  // ----- Pokémon -----
  'base1-1': { // Alakazam
    powers: { 'Damage Swap': {
      canUse: ({ g, seat }) => (mons(P(g, seat)).some((m) => m.dmg > 0) ? true : 'No damage to move'),
      use: (ctx) => {
        const from = ctx.chooseMon('Move 1 damage counter from…', ownPokemon(ctx).filter((m) => m.dmg > 0), { id: 'swapFrom' })[0];
        const to = ctx.chooseMon('…to which Pokémon?', ownPokemon(ctx).filter((m) => m.id !== from && m.dmg + 10 < monHP(ctx.db, m)), { id: 'swapTo' })[0];
        const a = findMon(ctx.g, from).m, b = findMon(ctx.g, to).m; a.dmg -= 10; b.dmg += 10;
        ctx.log(`Damage Swap: 10 from ${nameOf(ctx.db, a.c)} (now ${a.dmg}) to ${nameOf(ctx.db, b.c)} (now ${b.dmg})`); ctx.event({ t: 'swap', from, to });
      } } },
    attacks: { 'Confuse Ray': flipStatus(30, 'CNF') },
  },
  'base1-2': { // Blastoise
    powers: { 'Rain Dance': {
      canUse: ({ g, db, seat }) => { const p = P(g, seat); const w = p.hand.some((c) => db[c.c].st === 'Energy' && energyTypesOf(db, c).includes('Water')); const t = mons(p).some((m) => (db[m.c].types || []).includes('Water')); return w && t ? true : 'Needs a Water Energy in hand and a Water Pokémon'; },
      use: (ctx) => {
        const ws = ctx.me.hand.filter((c) => ctx.db[c.c].st === 'Energy' && energyTypesOf(ctx.db, c).includes('Water'));
        const card = ctx.chooseCards('Attach which Water Energy?', ws, { id: 'rainCard' })[0];
        const tgt = ctx.chooseMon('To which Water Pokémon?', ownPokemon(ctx).filter((m) => (ctx.db[m.c].types || []).includes('Water')), { id: 'rainTo' })[0];
        const c = pullCard(ctx.g, card); const m = findMon(ctx.g, tgt).m; m.en.push(c); ctx.log(`Rain Dance: attached Water Energy to ${nameOf(ctx.db, m.c)}`); ctx.event({ t: 'attach', card: c, target: m.id });
      } } },
    attacks: { 'Hydro Pump': extraWater(40, 3, 2) },
  },
  'base1-3': { attacks: { Scrunch: preventNext('preventDamage'), 'Double-edge': { effect: (ctx) => { ctx.damage(80); ctx.selfDamage(80); } } } },
  'base1-4': { // Charizard
    powers: { 'Energy Burn': { use: (ctx, m) => { m.flags.energyBurn = T(ctx); ctx.log('Energy Burn: all energy on Charizard counts as Fire this turn'); } } },
    attacks: { 'Fire Spin': { canUse: ({ m }) => (m.en.length >= 2 ? null : 'Needs 2 Energy cards to discard'), effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 2, null, 'Discard 2 Energy for Fire Spin'); ctx.damage(100); } } },
  },
  'base1-5': { attacks: {
    Sing: flipStatus(0, 'SLP'),
    Metronome: { effect: (ctx, m) => {
      const d = ctx.opp.active; if (!d) return; const atks = ctx.db[d.c].atk || []; if (!atks.length) { ctx.log('Nothing to copy'); return; }
      const k = ctx.choose({ id: 'metronome', title: 'Copy which attack?', options: atks.map((a) => ({ key: a.n, label: `${a.n} ${a.d || ''}` })) })[0];
      const atk = atks.find((a) => a.n === k); ctx.log(`Metronome copies ${atk.n}`);
      const was = ctx.copying; ctx.copying = true; try { runAttack(ctx, m, atk, d.c); } finally { ctx.copying = was; }
    } },
  } },
  'base1-6': { attacks: { Bubblebeam: flipStatus(40, 'PAR') } },
  'base1-8': { passive: { onDamaged: ({ ctx, source }) => { source.dmg += 10; ctx.log(`Strikes Back: 10 damage to ${nameOf(ctx.db, source.c)} (now ${source.dmg})`); ctx.event({ t: 'damage', target: source.id, amount: 10 }); } } },
  'base1-9': { attacks: { 'Thunder Wave': flipStatus(30, 'PAR'), Selfdestruct: selfDestruct(80, 20) } },
  'base1-10': { attacks: {
    Psychic: { effect: (ctx) => { const d = ctx.opp.active; ctx.damage(10 + 10 * (d ? d.en.length : 0)); } },
    Barrier: { canUse: ({ g, db, m }) => (g.rules.energyTextAnyType ? m.en.length : m.en.filter((e) => energyTypesOf(db, e).includes('Psychic')).length) ? null : 'Needs a Psychic Energy to discard', effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 1, typeFilter(ctx, 'Psychic')); ctx.addFx(m, { k: 'preventAll', until: T(ctx) + 1 }); ctx.log('Barrier: Mewtwo is protected from all effects of attacks next turn'); } },
  } },
  'base1-11': { attacks: {
    Thrash: { effect: (ctx) => { if (ctx.flip()) ctx.damage(40); else { ctx.damage(30); ctx.selfDamage(10); } } },
    Toxic: { effect: (ctx) => { ctx.damage(20); const d = ctx.opp.active; if (d && ctx.status('PSN')) d.flags.toxic = true; } },
  } },
  'base1-12': { attacks: {
    Lure: { effect: (ctx) => { const op = ctx.opp; if (!op.bench.length) return; const k = ctx.chooseMon("Choose the opponent's Benched Pokémon to lure", op.bench, { id: 'lure' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Lure'); } },
    'Fire Blast': discardTypeThen('Fire', 1, 80),
  } },
  'base1-13': { attacks: { 'Water Gun': extraWater(30, 3, 2), Whirlpool: discardDefenderEnergy(40) } },
  'base1-14': { attacks: { Agility: { effect: (ctx, m) => { ctx.damage(20); if (ctx.flip()) { ctx.addFx(m, { k: 'preventAll', until: T(ctx) + 1 }); ctx.log('Agility: Raichu is protected next turn'); } } }, Thunder: tailsSelf(60, 30) } },
  'base1-15': { powers: { 'Energy Trans': {
    canUse: ({ g, db, seat }) => (mons(P(g, seat)).some((m) => m.en.some((e) => energyTypesOf(db, e).includes('Grass'))) ? true : 'No Grass Energy to move'),
    use: (ctx) => {
      const from = ctx.chooseMon('Take a Grass Energy from…', ownPokemon(ctx).filter((m) => m.en.some((e) => energyTypesOf(ctx.db, e).includes('Grass'))), { id: 'transFrom' })[0];
      const fm = findMon(ctx.g, from).m; const card = ctx.chooseCards('Which Grass Energy?', fm.en.filter((e) => energyTypesOf(ctx.db, e).includes('Grass')), { id: 'transCard' })[0];
      const to = ctx.chooseMon('…to which Pokémon?', ownPokemon(ctx).filter((m) => m.id !== from), { id: 'transTo' })[0];
      const c = pullCard(ctx.g, card); findMon(ctx.g, to).m.en.push(c); ctx.log(`Energy Trans: moved Grass Energy from ${nameOf(ctx.db, fm.c)} to ${nameOf(ctx.db, findMon(ctx.g, to).m.c)}`);
    } } } },
  'base1-16': { attacks: { Thunder: tailsSelf(60, 30), Thunderbolt: { effect: (ctx, m) => { if (!ctx.copying) ctx.discardEnergy(m, m.en.slice()); ctx.damage(100); } } } },
  'base1-17': { attacks: { Twineedle: flipTimes(30, 2), 'Poison Sting': flipStatus(40, 'PSN') } },
  'base1-18': { attacks: { Slam: flipTimes(30, 2), 'Hyper Beam': discardDefenderEnergy(20) } },
  'base1-19': { attacks: { Earthquake: { effect: (ctx) => { ctx.damage(70); ctx.benchDamage(ctx.seat, 10); } } } },
  'base1-20': { attacks: { Thundershock: flipStatus(10, 'PAR'), Thunderpunch: { effect: (ctx) => { if (ctx.flip()) ctx.damage(40); else { ctx.damage(30); ctx.selfDamage(10); } } } } },
  'base1-21': { // Electrode
    powers: { Buzzap: {
      canUse: ({ g, seat, m }) => (mons(P(g, seat)).some((x) => x.id !== m.id) ? true : 'No other Pokémon to attach to'),
      use: (ctx, m) => {
        const to = ctx.chooseMon('Attach Electrode as Energy to…', ownPokemon(ctx).filter((x) => x.id !== m.id), { id: 'buzzapTo' })[0];
        const type = ctx.choose({ id: 'buzzapType', title: 'Electrode provides 2 Energy of which type?', options: ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting'].map((t) => ({ key: t, label: t })) })[0];
        const f = removeMon(ctx.g, m.id); const rest = monCards(m).filter((c) => c.id !== m.id); P(ctx.g, ctx.seat).discard.push(...rest);
        const tgt = findMon(ctx.g, to).m; tgt.en.push({ id: m.id, c: m.c, asEnergy: { type } });
        ctx.log(`Buzzap: Electrode is Knocked Out and attached to ${nameOf(ctx.db, tgt.c)} as 2 ${type} Energy. ${ctx.name(ctx.oppSeat)} takes a prize.`);
        ctx.g.pending.push({ t: 'prize', seat: ctx.oppSeat, n: 1 }); if (!P(ctx.g, ctx.seat).active) ctx.g.pending.push({ t: 'promote', seat: ctx.seat });
      } } },
    attacks: { 'Electric Shock': tailsSelf(50, 10) },
  },
  'base1-22': { attacks: {
    Whirlwind: oppSwitches(20),
    'Mirror Move': { canUse: ({ g, m }) => (m.flags.lastHit && m.flags.lastHit.turn === g.turnNo - 1 ? null : "Pidgeotto wasn't attacked last turn"), effect: (ctx, m) => { ctx.damage(m.flags.lastHit.amount, { noWR: true }); } },
  } },
  'base1-23': { attacks: { Flamethrower: discardTypeThen('Fire', 1, 50), 'Take Down': { effect: (ctx) => { ctx.damage(80); ctx.selfDamage(30); } } } },
  'base1-24': { attacks: { Flamethrower: discardTypeThen('Fire', 1, 50) } },
  'base1-25': { attacks: { 'Ice Beam': flipStatus(30, 'PAR') } },
  'base1-27': { attacks: { 'Leek Slap': { oncePerLife: true, effect: (ctx) => { if (ctx.flip()) ctx.damage(30); else ctx.log('Leek Slap does nothing'); } } } },
  'base1-29': { attacks: { Hypnosis: sureStatus(0, 'SLP'), 'Dream Eater': { canUse: ({ g, seat }) => (P(g, other(seat)).active && P(g, other(seat)).active.st.includes('SLP') ? null : 'The Defending Pokémon must be Asleep'), effect: (ctx) => ctx.damage(50) } } },
  'base1-30': { attacks: { Poisonpowder: sureStatus(20, 'PSN') } },
  'base1-31': { attacks: { Doubleslap: flipTimes(10, 2), Meditate: { effect: (ctx) => { const d = ctx.opp.active; ctx.damage(20 + 10 * (d ? countersOn(d) : 0)); } } } },
  'base1-32': { attacks: { Recover: recover('Psychic') } },
  'base1-33': { attacks: { Stiffen: preventNext('preventDamage'), Poisonpowder: flipStatus(20, 'PSN') } },
  'base1-34': { attacks: { 'Karate Chop': { effect: (ctx, m) => ctx.damage(Math.max(0, 50 - 10 * countersOn(m))) }, Submission: { effect: (ctx) => { ctx.damage(60); ctx.selfDamage(20); } } } },
  'base1-35': { attacks: { Flail: { effect: (ctx, m) => ctx.damage(10 * countersOn(m)) } } },
  'base1-36': { attacks: { Flamethrower: discardTypeThen('Fire', 1, 50) } },
  'base1-37': { attacks: { 'Double Kick': flipTimes(30, 2) } },
  'base1-38': { attacks: {
    Amnesia: { effect: (ctx) => { const d = ctx.opp.active; if (!d) return; const atks = ctx.db[d.c].atk || []; if (!atks.length) return; const k = ctx.choose({ id: 'amnesia', title: "Which attack can't be used next turn?", options: atks.map((a) => ({ key: a.n, label: a.n })) })[0]; ctx.addFx(d, { k: 'noAttack', attack: k, until: T(ctx) + 1 }); ctx.log(`Amnesia: ${nameOf(ctx.db, d.c)} can't use ${k} next turn`); } },
    Doubleslap: flipTimes(30, 2),
  } },
  'base1-39': { attacks: {
    'Conversion 1': { effect: (ctx) => { const d = ctx.opp.active; if (!d || !(ctx.db[d.c].wk || []).length) { ctx.log('No Weakness to change'); return; } const t = ctx.choose({ id: 'conv1', title: 'Change its Weakness to…', options: ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting'].map((x) => ({ key: x, label: x })) })[0]; d.flags.wkOverride = t; ctx.log(`${nameOf(ctx.db, d.c)}'s Weakness is now ${t}`); } },
    'Conversion 2': { effect: (ctx, m) => { const t = ctx.choose({ id: 'conv2', title: 'Change Porygon\'s Resistance to…', options: ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting'].map((x) => ({ key: x, label: x })) })[0]; m.flags.rsOverride = t; ctx.log(`Porygon's Resistance is now ${t}`); } },
  } },
  'base1-40': { attacks: { 'Super Fang': { effect: (ctx) => { const d = ctx.opp.active; if (!d) return; const left = monHP(ctx.db, d) - d.dmg; ctx.damage(Math.ceil(left / 20) * 10, { noWR: true }); } } } },
  'base1-42': { attacks: { Withdraw: preventNext('preventDamage') } },
  'base1-43': { attacks: { Psyshock: flipStatus(10, 'PAR') } },
  'base1-44': { attacks: { 'Leech Seed': { effect: (ctx, m) => { const dealt = ctx.damage(20); if (dealt > 0) ctx.heal(m, 10); } } } },
  'base1-45': { attacks: { 'String Shot': flipStatus(10, 'PAR') } },
  'base1-46': { attacks: { Ember: discardTypeThen('Fire', 1, 30) } },
  'base1-48': { attacks: { 'Fury Attack': flipTimes(10, 2) } },
  'base1-49': { attacks: { 'Confuse Ray': flipStatus(10, 'CNF') } },
  'base1-50': { attacks: { 'Sleeping Gas': flipStatus(0, 'SLP'), 'Destiny Bond': { canUse: ({ g, db, m }) => (g.rules.energyTextAnyType ? m.en.length : m.en.filter((e) => energyTypesOf(db, e).includes('Psychic')).length) ? null : 'Needs a Psychic Energy to discard', effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 1, typeFilter(ctx, 'Psychic')); ctx.addFx(m, { k: 'destinyBond', until: T(ctx) + 1 }); ctx.log('Destiny Bond is set'); } } } },
  'base1-51': { attacks: { 'Foul Gas': { effect: (ctx) => { ctx.damage(10); ctx.status(ctx.flip() ? 'PSN' : 'CNF'); } } } },
  'base1-53': { attacks: { 'Thunder Wave': flipStatus(10, 'PAR'), Selfdestruct: selfDestruct(40, 10) } },
  'base1-54': { attacks: { Stiffen: preventNext('preventDamage'), 'Stun Spore': flipStatus(20, 'PAR') } },
  'base1-55': { attacks: { 'Horn Hazard': { effect: (ctx) => { if (ctx.flip()) ctx.damage(30); else ctx.log('Horn Hazard does nothing'); } } } },
  'base1-56': { attacks: { Harden: { effect: (ctx, m) => { ctx.addFx(m, { k: 'preventSmall', until: T(ctx) + 1 }); ctx.log('Harden: damage of 30 or less is prevented next turn'); } } } },
  'base1-57': { attacks: { Whirlwind: oppSwitches(10) } },
  'base1-58': { attacks: { 'Thunder Jolt': tailsSelf(30, 10) } },
  'base1-59': { attacks: { 'Water Gun': extraWater(10, 1, 2) } },
  'base1-62': { attacks: { 'Sand-attack': { effect: (ctx) => { ctx.damage(10); const d = ctx.opp.active; if (d) { ctx.addFx(d, { k: 'sandAttack', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, d.c)} must flip to attack next turn`); } } } } },
  'base1-63': { attacks: { Bubble: flipStatus(10, 'PAR'), Withdraw: preventNext('preventDamage') } },
  'base1-64': { attacks: { Recover: recover('Water'), 'Star Freeze': flipStatus(20, 'PAR') } },
  'base1-66': { attacks: { Bind: flipStatus(20, 'PAR'), Poisonpowder: sureStatus(20, 'PSN') } },
  'base1-68': { attacks: { 'Confuse Ray': flipStatus(10, 'CNF') } },
  'base1-69': { attacks: { 'Poison Sting': flipStatus(10, 'PSN') } },

  // ----- Trainers -----
  'base1-70': { asPokemon: { noPrize: true, noConditions: true, noRetreat: true, canDiscard: true } }, // Clefairy Doll
  'base1-71': { canPlay: ({ g, seat }) => (P(g, seat).hand.length >= 3 ? true : 'Needs 2 other cards to discard'), trainer: (ctx) => {
    const others = ctx.me.hand.filter((c) => c.id !== ctx.card.id); const k = ctx.chooseCards('Discard 2 cards for Computer Search', others, { min: 2, max: 2, id: 'csDiscard' }); for (const id of k) ctx.discardFromHand(ctx.seat, id);
    const got = ctx.searchDeck(ctx.seat, 'Choose a card from your deck', null, { min: 0, max: 1 }); got.forEach((c) => ctx.toHand(ctx.seat, c)); ctx.shuffle(ctx.seat); ctx.log(`Computer Search: ${got.length ? 'found ' + nameOf(ctx.db, got[0].c) : 'found nothing'}; deck shuffled`);
  } },
  'base1-72': { canPlay: ({ g, seat }) => (mons(P(g, seat)).some((m) => m.un.length) ? true : 'No evolved Pokémon'), trainer: (ctx) => { // Devolution Spray
    const tgt = ctx.chooseMon('Devolve which Pokémon?', ownPokemon(ctx).filter((m) => m.un.length), { id: 'devolve' })[0]; const m = findMon(ctx.g, tgt).m;
    const stages = ['Basic', 'Stage 1', 'Stage 2']; const cur = ctx.db[m.c].sub; const opts = stages.slice(1, stages.indexOf(cur) + 1).map((s) => ({ key: s, label: `${s} and higher` }));
    const stage = ctx.choose({ id: 'devolveStage', title: 'Discard Evolution cards of which Stage or higher?', options: opts })[0];
    const keepIdx = stages.indexOf(stage) - 1; // stage index to keep
    let cur2 = { id: m.id, c: m.c }; const stack = [cur2, ...m.un]; // top first
    const keep = stack.find((c) => stages.indexOf(ctx.db[c.c].sub || 'Basic') <= keepIdx); const discard = stack.filter((c) => stages.indexOf(ctx.db[c.c].sub || 'Basic') > keepIdx);
    const f = findMon(ctx.g, m.id); const nm = { ...m, id: keep.id, c: keep.c, un: stack.slice(stack.indexOf(keep) + 1), st: [], fx: [], flags: {} };
    f.p.discard.push(...discard); if (f.p.active && f.p.active.id === m.id) f.p.active = nm; else f.p.bench[f.p.bench.findIndex((x) => x.id === m.id)] = nm;
    ctx.log(`Devolution Spray: ${nameOf(ctx.db, m.c)} devolved to ${nameOf(ctx.db, keep.c)}`);
  } },
  'base1-73': { trainer: (ctx) => { const op = ctx.opp; op.deck.push(...op.hand); op.hand = []; ctx.shuffle(ctx.oppSeat); ctx.draw(ctx.oppSeat, 7); } },
  'base1-74': { canPlay: ({ g, db, seat }) => (P(g, seat).hand.length >= 3 && P(g, seat).discard.some((c) => db[c.c].st === 'Trainer') ? true : 'Needs 2 other cards to discard and a Trainer in the discard pile'), trainer: (ctx) => {
    const others = ctx.me.hand.filter((c) => c.id !== ctx.card.id); const k = ctx.chooseCards('Discard 2 cards for Item Finder', others, { min: 2, max: 2, id: 'ifDiscard' }); for (const id of k) ctx.discardFromHand(ctx.seat, id);
    const trainers = ctx.me.discard.filter((c) => ctx.db[c.c].st === 'Trainer'); const got = ctx.chooseCards('Take a Trainer from your discard pile', trainers, { min: 0, max: 1, id: 'ifPick' });
    for (const id of got) ctx.toHand(ctx.seat, pullCard(ctx.g, id)); ctx.log(`Item Finder: ${got.length ? 'took ' + nameOf(ctx.db, ctx.me.hand[ctx.me.hand.length - 1].c) : 'took nothing'}`);
  } },
  'base1-75': { trainer: (ctx) => { for (const s of ['a', 'b']) { const p = P(ctx.g, s); const tr = p.hand.filter((c) => ctx.db[c.c].st === 'Trainer'); ctx.log(`${ctx.name(s)} shows: ${p.hand.map((c) => nameOf(ctx.db, c.c)).join(', ') || 'nothing'}`); p.hand = p.hand.filter((c) => ctx.db[c.c].st !== 'Trainer'); p.deck.push(...tr); ctx.shuffle(s); } } },
  'base1-76': { canPlay: ({ g, db, seat }) => { const p = P(g, seat); const ok = p.hand.some((c) => db[c.c].st === 'Pokémon' && db[c.c].sub === 'Stage 2' && mons(p).some((m) => breederMatch(db, c.c, m) && canEvolveLoose(g, m))); return ok ? true : 'No Stage 2 that fits a Basic in play'; }, trainer: (ctx) => {
    const cards = ctx.me.hand.filter((c) => ctx.db[c.c].st === 'Pokémon' && ctx.db[c.c].sub === 'Stage 2' && ownPokemon(ctx).some((m) => breederMatch(ctx.db, c.c, m) && canEvolveLoose(ctx.g, m)));
    const card = ctx.chooseCards('Which Stage 2?', cards, { id: 'breederCard' })[0]; const tgts = ownPokemon(ctx).filter((m) => breederMatch(ctx.db, card ? ctx.me.hand.find((c) => c.id === card).c : '', m) && canEvolveLoose(ctx.g, m));
    const tgt = ctx.chooseMon('Onto which Basic?', tgts, { id: 'breederTo' })[0]; const f = findMon(ctx.g, tgt); const c = ctx.me.hand.find((x) => x.id === card);
    const nm = { ...f.m, id: c.id, c: c.c, st: [], fx: [], un: [{ id: f.m.id, c: f.m.c }, ...f.m.un], evolvedTurn: ctx.g.turnNo, flags: {} }; pullCard(ctx.g, c.id); if (f.p.active && f.p.active.id === f.m.id) f.p.active = nm; else f.p.bench[f.p.bench.findIndex((x) => x.id === f.m.id)] = nm;
    ctx.log(`Pokémon Breeder: ${nameOf(ctx.db, f.m.c)} evolved into ${nameOf(ctx.db, c.c)}`);
  } },
  'base1-77': { canPlay: ({ g, db, seat }) => (P(g, seat).hand.some((c) => db[c.c].st === 'Pokémon') ? true : 'No Pokémon card in hand to trade'), trainer: (ctx) => {
    const mine = ctx.me.hand.filter((c) => ctx.db[c.c].st === 'Pokémon'); const give = ctx.chooseCards('Trade which Pokémon from your hand?', mine, { id: 'traderGive' })[0];
    const got = ctx.searchDeck(ctx.seat, 'Take which Pokémon from your deck?', (card) => card.st === 'Pokémon', { min: 0, max: 1 });
    const g1 = pullCard(ctx.g, give); ctx.me.deck.push(g1); got.forEach((c) => ctx.toHand(ctx.seat, c)); ctx.shuffle(ctx.seat); ctx.log(`Pokémon Trader: ${nameOf(ctx.db, g1.c)} for ${got.length ? nameOf(ctx.db, got[0].c) : 'nothing'}`);
  } },
  'base1-78': { canPlay: ({ g, seat }) => (mons(P(g, seat)).length ? true : 'No Pokémon in play'), trainer: (ctx) => {
    const tgt = ctx.chooseMon('Scoop Up which Pokémon?', ownPokemon(ctx), { id: 'scoop' })[0]; const f = findMon(ctx.g, tgt); const m = f.m; removeMon(ctx.g, m.id);
    const stack = [{ id: m.id, c: m.c }, ...m.un]; const basic = stack[stack.length - 1]; const rest = monCards(m).filter((c) => c.id !== basic.id); f.p.discard.push(...rest); f.p.hand.push(basic);
    ctx.log(`Scoop Up: ${nameOf(ctx.db, basic.c)} returned to hand`); if (!f.p.active) ctx.g.pending.push({ t: 'promote', seat: ctx.seat });
  } },
  'base1-79': { canPlay: ({ g, seat }) => (mons(P(g, seat)).some((m) => m.en.length) && mons(P(g, other(seat))).some((m) => m.en.length) ? true : 'Needs energy on both sides'), trainer: (ctx) => {
    const mine = ctx.chooseMon('Discard an Energy from which of your Pokémon?', ownPokemon(ctx).filter((m) => m.en.length), { id: 'serMine' })[0]; const mm = findMon(ctx.g, mine).m;
    const mc = ctx.chooseCards('Which Energy to discard?', mm.en, { id: 'serMyCard' }); ctx.discardEnergy(mm, mm.en.filter((e) => mc.includes(e.id)));
    const theirs = ctx.chooseMon("Choose the opponent's Pokémon", mons(ctx.opp).filter((m) => m.en.length), { id: 'serTheirs' })[0]; const tm = findMon(ctx.g, theirs).m;
    const tc = ctx.chooseCards('Discard up to 2 Energy', tm.en, { min: 1, max: 2, id: 'serTheirCards' }); ctx.discardEnergy(tm, tm.en.filter((e) => tc.includes(e.id)));
  } },
  'base1-80': { canPlay: ({ g, seat }) => (mons(P(g, seat)).length ? true : 'No Pokémon in play'), trainer: (ctx) => { const tgt = ctx.chooseMon('Attach Defender to…', ownPokemon(ctx), { id: 'defender' })[0]; const m = findMon(ctx.g, tgt).m; m.tools.push(ctx.card); m.fx.push({ k: 'defender', card: ctx.card.id, until: T(ctx) + 1 }); ctx.log(`Defender on ${nameOf(ctx.db, m.c)}`); return true; } },
  'base1-81': { canPlay: ({ g, db, seat }) => (P(g, seat).hand.length >= 2 && P(g, seat).discard.some((c) => db[c.c].st === 'Energy' && db[c.c].sub === 'Basic') ? true : 'Needs a card to discard and basic Energy in the discard pile'), trainer: (ctx) => {
    const others = ctx.me.hand.filter((c) => c.id !== ctx.card.id); const k = ctx.chooseCards('Discard 1 card for Energy Retrieval', others, { id: 'erDiscard' }); ctx.discardFromHand(ctx.seat, k[0]);
    const basics = ctx.me.discard.filter((c) => ctx.db[c.c].st === 'Energy' && ctx.db[c.c].sub === 'Basic'); const got = ctx.chooseCards('Take up to 2 basic Energy', basics, { min: 1, max: 2, id: 'erPick' }); for (const id of got) ctx.toHand(ctx.seat, pullCard(ctx.g, id)); ctx.log(`Energy Retrieval: took ${got.length} Energy`);
  } },
  'base1-82': { canPlay: ({ g, seat }) => (P(g, seat).active && P(g, seat).active.st.length ? true : 'Your Active Pokémon has no conditions'), trainer: (ctx) => { const m = ctx.me.active; ctx.cure(m); ctx.log(`Full Heal: ${nameOf(ctx.db, m.c)} is cured`); } },
  'base1-83': { canPlay: ({ g, seat }) => (P(g, seat).hand.length >= 3 ? true : 'Needs 2 other cards'), trainer: (ctx) => { const others = ctx.me.hand.filter((c) => c.id !== ctx.card.id); const k = ctx.chooseCards('Shuffle 2 cards into your deck', others, { min: 2, max: 2, id: 'maint' }); for (const id of k) ctx.me.deck.push(pullCard(ctx.g, id)); ctx.shuffle(ctx.seat); ctx.draw(ctx.seat, 1); } },
  'base1-84': { canPlay: ({ g, seat }) => (P(g, seat).active ? true : 'No Active Pokémon'), trainer: (ctx) => { const m = ctx.me.active; m.tools.push(ctx.card); m.fx.push({ k: 'plusPower', card: ctx.card.id }); ctx.log(`PlusPower on ${nameOf(ctx.db, m.c)}: +10 to this turn's attack`); return true; } },
  'base1-85': { canPlay: ({ g, seat }) => (mons(P(g, seat)).some((m) => m.dmg) ? true : 'No damaged Pokémon'), trainer: (ctx) => { for (const m of ownPokemon(ctx)) if (m.dmg) { ctx.discardEnergy(m, m.en.slice()); ctx.heal(m); } ctx.log('Pokémon Center: all damage removed'); } },
  'base1-86': { canPlay: ({ g, db, seat }) => { const op = P(g, other(seat)); return op.bench.length < g.rules.benchSize && op.discard.some((c) => c && db[c.c] && db[c.c].st === 'Pokémon' && db[c.c].sub === 'Basic') ? true : "Opponent's bench is full or no Basic in their discard"; }, trainer: (ctx) => {
    const basics = ctx.opp.discard.filter((c) => ctx.db[c.c].st === 'Pokémon' && ctx.db[c.c].sub === 'Basic'); const k = ctx.chooseCards("Put which Basic onto the opponent's bench?", basics, { id: 'flute' })[0]; const c = pullCard(ctx.g, k); ctx.opp.bench.push(toMon(c, ctx.g.turnNo)); ctx.log(`Pokémon Flute: ${nameOf(ctx.db, c.c)} onto ${ctx.name(ctx.oppSeat)}'s bench`);
  } },
  'base1-87': { canPlay: ({ g, seat }) => (P(g, seat).deck.length ? true : 'Deck is empty'), trainer: (ctx) => { const top = ctx.me.deck.slice(0, 5); const order = ctx.chooseCards('Rearrange the top cards (first chosen goes on top)', top, { min: top.length, max: top.length, ordered: true, id: 'pokedex' }); const picked = order.map((id) => top.find((c) => c.id === id)); ctx.me.deck.splice(0, top.length, ...picked); ctx.log('Pokédex: rearranged the top of the deck'); } },
  'base1-88': { trainer: (ctx) => { ctx.discardHand(ctx.seat); ctx.draw(ctx.seat, 7); } },
  'base1-89': { canPlay: ({ g, db, seat }) => { const p = P(g, seat); return p.bench.length < g.rules.benchSize && p.discard.some((c) => db[c.c].st === 'Pokémon' && db[c.c].sub === 'Basic') ? true : 'Bench is full or no Basic in the discard pile'; }, trainer: (ctx) => {
    const basics = ctx.me.discard.filter((c) => ctx.db[c.c].st === 'Pokémon' && ctx.db[c.c].sub === 'Basic'); const k = ctx.chooseCards('Revive which Basic?', basics, { id: 'revive' })[0]; const c = pullCard(ctx.g, k); const m = toMon(c, ctx.g.turnNo); m.dmg = Math.floor(monHP(ctx.db, m) / 20) * 10; ctx.me.bench.push(m); ctx.log(`Revive: ${nameOf(ctx.db, c.c)} onto the bench with ${m.dmg} damage`);
  } },
  'base1-90': { canPlay: ({ g, seat }) => (mons(P(g, seat)).some((m) => m.en.length && m.dmg) ? true : 'Needs a damaged Pokémon with Energy'), trainer: (ctx) => { const tgt = ctx.chooseMon('Super Potion on which Pokémon?', ownPokemon(ctx).filter((m) => m.en.length && m.dmg), { id: 'superPotion' })[0]; const m = findMon(ctx.g, tgt).m; ctx.requireDiscardEnergy(m, 1, null, 'Discard 1 Energy for Super Potion'); ctx.heal(m, 40); } },
  'base1-91': { trainer: (ctx) => ctx.draw(ctx.seat, 2) },
  'base1-92': { canPlay: ({ g, seat }) => (mons(P(g, other(seat))).some((m) => m.en.length) ? true : 'No energy on their side'), trainer: (ctx) => { const tgt = ctx.chooseMon("Choose the opponent's Pokémon", mons(ctx.opp).filter((m) => m.en.length), { id: 'erMon' })[0]; const m = findMon(ctx.g, tgt).m; const k = ctx.chooseCards('Discard which Energy?', m.en, { id: 'erCard' }); ctx.discardEnergy(m, m.en.filter((e) => k.includes(e.id))); } },
  'base1-93': { canPlay: ({ g, seat }) => (P(g, other(seat)).bench.length && P(g, other(seat)).active ? true : 'Opponent has no Benched Pokémon'), trainer: (ctx) => { const k = ctx.chooseMon("Choose the opponent's Benched Pokémon", ctx.opp.bench, { id: 'gust' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Gust of Wind'); } },
  'base1-94': { canPlay: ({ g, seat }) => (mons(P(g, seat)).some((m) => m.dmg) ? true : 'No damaged Pokémon'), trainer: (ctx) => { const tgt = ctx.chooseMon('Potion on which Pokémon?', ownPokemon(ctx).filter((m) => m.dmg), { id: 'potion' })[0]; ctx.heal(findMon(ctx.g, tgt).m, 20); } },
  'base1-95': { canPlay: ({ g, seat }) => (P(g, seat).active && P(g, seat).bench.length ? true : 'Nothing to switch with'), trainer: (ctx) => { const k = ctx.chooseMon('Switch with which Benched Pokémon?', ctx.me.bench, { id: 'switch' })[0]; ctx.switchActive(ctx.seat, k, 'Switch'); } },
  // ----- Energy -----
  'base1-96': { energy: ['Colorless', 'Colorless'] },
};

function breederMatch(db, stage2Id, m) {
  const s2 = db[stage2Id]; if (!s2 || s2.sub !== 'Stage 2') return false;
  const basic = db[m.c]; if (!basic || basic.sub !== 'Basic') return false;
  const mid = Object.values(db).find((c) => c.st === 'Pokémon' && c.name === s2.ev); return !!(mid && mid.ev === basic.name);
}
function canEvolveLoose(g, m) { return m.playedTurn < g.turnNo; }
