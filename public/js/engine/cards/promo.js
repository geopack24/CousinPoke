// Wizards Black Star Promos (basep). Keyed by card id; a few reuse scripts from the main sets (see promoScripts).
import * as H from './helpers.js';
import { energyUnits, baseSpecies, energyIs } from '../engine.js';
import { replaceMon } from '../state.js';
const { T, flipStatus, sureStatus, flipTimes, headsPlus, tailsNothing, reduceNext, noAttackNext, drain, oppSwitches, hasType, typeFilter, countersOn, ownPokemon, TYPES6, findMon, mons, pullCard, P, other, toMon, removeMon, monCards, nameOf, monHP } = H;

const plain = (n) => ({ effect: (ctx) => ctx.damage(n) });
const oncePerTurn = (key, power) => ({
  ...power,
  canUse: (a) => (a.m.flags[key] === a.g.turnNo ? 'Already used this turn' : power.canUse ? power.canUse(a) : true),
  use: (ctx, m) => { m.flags[key] = ctx.g.turnNo; power.use(ctx, m); },
});
const untilTails = (ctx) => { let h = 0; while (h < 30 && ctx.flip()) h++; ctx.log(`${h} heads before tails`); return h; };
const protectSelf = (ctx, m) => { ctx.addFx(m, { k: 'preventAll', until: T(ctx) + 1 }); ctx.log(`${nameOf(ctx.db, m.c)} is protected during the opponent's next turn`); };
const isEvolved = (db, m) => !!(db[m.c] && (db[m.c].sub === 'Stage 1' || db[m.c].sub === 'Stage 2'));
const shuffleIntoDeck = (ctx, m, why) => { const f = findMon(ctx.g, m.id); if (!f) return; removeMon(ctx.g, m.id); f.p.deck.push(...monCards(m)); ctx.shuffle(f.seat); ctx.log(`${why}: ${nameOf(ctx.db, m.c)} and its cards are shuffled into the deck`); if (!f.p.active) ctx.g.pending.push({ t: 'promote', seat: f.seat }); };

const energyAbsorption = { effect: (ctx, m) => {
  if (ctx.copying) return; const pool = ctx.me.discard.filter((c) => ctx.db[c.c].st === 'Energy'); if (!pool.length) { ctx.log('No Energy in the discard pile'); return; }
  const k = ctx.chooseCards('Energy Absorption: attach up to 2 Energy from your discard pile', pool, { min: 0, max: Math.min(2, pool.length), id: 'absorb' });
  for (const id of k) { const c = pullCard(ctx.g, id); m.en.push(c); ctx.event({ t: 'attach', card: c, target: m.id }); } ctx.log(`Energy Absorption: ${k.length} Energy attached`);
} };
const psywave = { effect: (ctx) => { const d = ctx.opp.active; ctx.damage(10 * (d ? d.en.length : 0)); } };
const devolutionBeam = { effect: (ctx) => {
  const all = mons(ctx.me).concat(mons(ctx.opp)).filter((m) => m.un.length); if (!all.length) { ctx.log('No evolved Pokémon'); return; }
  const k = ctx.chooseMon('Devolution Beam: devolve which Pokémon?', all, { id: 'devobeam' })[0]; const f = findMon(ctx.g, k); if (!f) return;
  const m = f.m; const below = m.un[0]; const nm = { ...m, id: below.id, c: below.c, un: m.un.slice(1), st: [], fx: [], flags: {}, evolvedTurn: -1 };
  replaceMon(ctx.g, f, nm); ctx.returnToHand(f.seat, [{ id: m.id, c: m.c }]);
  ctx.log(`Devolution Beam: ${nameOf(ctx.db, m.c)} goes back to ${ctx.name(f.seat)}'s hand; ${nameOf(ctx.db, nm.c)} is left in play`);
} };
const thundershock = (n) => flipStatus(n, 'PAR');
const quickAttack = headsPlus(10, 20);
const thunderboltAll = (n) => ({ effect: (ctx, m) => { if (!ctx.copying) ctx.discardEnergy(m, m.en.slice()); ctx.damage(n); } });

const S = {
  // 1 Pikachu
  'basep-1': { attacks: { Growl: { effect: (ctx, m) => { ctx.addFx(m, { k: 'reduce', amount: 10, until: T(ctx) + 1, benchClears: true }); ctx.log('Growl: damage to Pikachu is reduced by 10 next turn'); } }, Thundershock: thundershock(20) } },
  // 2 Electabuzz
  'basep-2': { attacks: { 'Light Screen': { effect: (ctx, m) => { ctx.addFx(m, { k: 'halveNext', until: T(ctx) + 1 }); ctx.log('Light Screen: damage to Electabuzz is halved next turn'); } }, 'Quick Attack': quickAttack } },
  // 3, 14 Mewtwo
  'basep-3': { attacks: { 'Energy Absorption': energyAbsorption, Psyburn: plain(40) } },
  'basep-14': { attacks: { 'Energy Absorption': energyAbsorption, Psyburn: plain(40) } },
  // 4 Pikachu
  'basep-4': { attacks: {
    Recharge: { effect: (ctx, m) => { const got = ctx.searchDeck(ctx.seat, 'Recharge: attach a Lightning Energy', (c) => c.st === 'Energy' && c.sub === 'Basic' && energyIs(null, c, 'Lightning'), { min: 0, max: 1 }); for (const c of got) { m.en.push(c); ctx.event({ t: 'attach', card: c, target: m.id }); ctx.log('Recharge: Lightning Energy attached'); } ctx.shuffle(ctx.seat); } },
    Thunderbolt: thunderboltAll(50) } },
  // 5 Dragonite
  'basep-5': { powers: { 'Special Delivery': oncePerTurn('specialDelivery', { canUse: ({ g, seat }) => (P(g, seat).deck.length ? true : 'Your deck is empty'), use: (ctx) => {
    ctx.draw(ctx.seat, 1); if (!ctx.me.hand.length) return;
    const k = ctx.chooseCards('Special Delivery: put a card from your hand on top of your deck', ctx.me.hand, { id: 'delivery', hidden: true })[0]; const c = pullCard(ctx.g, k); ctx.me.deck.unshift(c); ctx.log('Special Delivery: a card goes back on top of the deck');
  } }) }, attacks: { 'Supersonic Flight': tailsNothing(60) } },
  // 6 Arcanine
  'basep-6': { attacks: { 'Quick Attack': quickAttack, 'Flames of Rage': {
    canUse: ({ g, db, m }) => ((g.rules.energyTextAnyType ? m.en.length : m.en.filter((e) => H.energyIs(db, e, 'Fire')).length) >= 2 ? null : 'Needs 2 Fire Energy to discard'),
    effect: (ctx, m) => { ctx.requireDiscardEnergy(m, 2, typeFilter(ctx, 'Fire')); ctx.damage(40 + 10 * countersOn(m)); } } } },
  // 7 Jigglypuff
  'basep-7': { attacks: { 'First Aid': { effect: (ctx, m) => ctx.heal(m, 10) }, 'Double-edge': { effect: (ctx) => { ctx.damage(40); ctx.selfDamage(20); } } } },
  // 8, 9 Mew
  'basep-8': { attacks: { Psywave: psywave, 'Devolution Beam': devolutionBeam } },
  'basep-9': { attacks: { Psywave: psywave, 'Devolution Beam': devolutionBeam } },
  // 10 Meowth
  'basep-10': { attacks: { 'Cat Punch': { effect: (ctx) => {
    if (ctx.flip()) { ctx.damage(20); return; }
    if (ctx.opp.bench.length) { const k = ctx.chooseMon('Cat Punch: choose one of your Benched Pokémon to take 20', ctx.opp.bench, { seat: ctx.oppSeat, id: 'catpunch' })[0]; ctx.benchDamageOne(k, 20); }
  } } } },
  // 11 Eevee: when one of your Pokémon evolves, evolve Eevee straight from the deck
  'basep-11': { powers: { 'Chain Reaction': oncePerTurn('chainReaction', {
    canUse: ({ g, db, seat, m }) => {
      if (!mons(P(g, seat)).some((x) => x.evolvedTurn === g.turnNo && x.id !== m.id)) return 'Only after one of your Pokémon evolves this turn';
      return P(g, seat).deck.some((c) => db[c.c].st === 'Pokémon' && db[c.c].ev && baseSpecies(db[c.c].ev) === 'Eevee') ? true : 'No Eevee evolutions in your deck';
    },
    use: (ctx, m) => {
      const pool = ctx.me.deck.filter((c) => ctx.db[c.c].st === 'Pokémon' && ctx.db[c.c].ev && baseSpecies(ctx.db[c.c].ev) === 'Eevee');
      const k = ctx.chooseCards('Chain Reaction: evolve Eevee into…', pool, { min: 0, max: 1, id: 'chain' })[0];
      if (k) { const card = ctx.me.deck.find((c) => c.id === k); ctx.evolveWith(m, card); }
      ctx.shuffle(ctx.seat);
    } }) }, attacks: { Bite: plain(20) } },
  // 12 Mewtwo
  'basep-12': { attacks: {
    'Energy Control': { effect: (ctx) => {
      if (!ctx.flip()) return; const holders = mons(ctx.opp).filter((m) => m.en.some((e) => ctx.db[e.c].sub === 'Basic')); if (!holders.length || mons(ctx.opp).length < 2) { ctx.log('Nothing to move'); return; }
      const from = findMon(ctx.g, ctx.chooseMon('Energy Control: move an Energy from…', holders, { id: 'ecFrom' })[0]).m;
      const e = ctx.chooseCards('Which basic Energy?', from.en.filter((x) => ctx.db[x.c].sub === 'Basic'), { id: 'ecCard' })[0];
      const to = findMon(ctx.g, ctx.chooseMon('…to which of their other Pokémon?', mons(ctx.opp).filter((m) => m.id !== from.id), { id: 'ecTo' })[0]).m;
      to.en.push(pullCard(ctx.g, e)); ctx.log(`Energy Control: moved an Energy from ${nameOf(ctx.db, from.c)} to ${nameOf(ctx.db, to.c)}`);
    } },
    Telekinesis: { effect: (ctx) => {
      const k = ctx.chooseMon('Telekinesis: 30 damage to which Pokémon?', mons(ctx.opp), { id: 'telekinesis' })[0]; const t = findMon(ctx.g, k); if (!t) return;
      if (t.p.active && t.p.active.id === k) ctx.damage(30, { target: t.m, noWR: true }); else ctx.benchDamageOne(k, 30);
    } } } },
  // 13 Venusaur
  'basep-13': { powers: { 'Solar Power': oncePerTurn('solarPower', { use: (ctx) => { for (const m of [ctx.me.active, ctx.opp.active]) if (m && m.st.length) { ctx.cure(m); ctx.log(`Solar Power: ${nameOf(ctx.db, m.c)} is no longer affected by Special Conditions`); } } }) }, attacks: { 'Mega Drain': drain(40, true) } },
  // 15 Cool Porygon
  'basep-15': { attacks: {
    'Texture Magic': { effect: (ctx, m) => {
      const types = TYPES6.concat(['Darkness', 'Metal']);
      const r = ctx.choose({ id: 'texRes', title: "Texture Magic: change Cool Porygon's Resistance to…", options: [{ key: 'keep', label: 'Keep it' }, ...types.map((t) => ({ key: t, label: t }))] })[0];
      if (r !== 'keep') { m.flags.rsOverride = r; ctx.log(`Cool Porygon's Resistance is now ${r}`); }
      const d = ctx.opp.active; if (d && (ctx.cardFor(d).wk || []).length) { const w = ctx.choose({ id: 'texWeak', title: "…and the Defending Pokémon's Weakness to…", options: [{ key: 'keep', label: 'Keep it' }, ...types.map((t) => ({ key: t, label: t }))] })[0]; if (w !== 'keep') { d.flags.wkOverride = w; ctx.log(`${nameOf(ctx.db, d.c)}'s Weakness is now ${w}`); } }
    } },
    '3-D Attack': flipTimes(20, 3) } },
  // 16 Computer Error (Rocket's Secret Machine)
  'basep-16': { trainer: (ctx) => {
    const opts = [0, 1, 2, 3, 4, 5].map((n) => ({ key: String(n), label: n ? `Draw ${n}` : 'Draw none' }));
    const mine = +ctx.choose({ id: 'ceMine', title: 'Computer Error: draw how many (up to 5)?', options: opts })[0]; if (mine) ctx.draw(ctx.seat, mine);
    const theirs = +ctx.choose({ id: 'ceTheirs', title: 'Computer Error: your opponent let you draw up to 5. How many?', options: opts, seat: ctx.oppSeat })[0]; if (theirs) ctx.draw(ctx.oppSeat, theirs);
    ctx.endTurnNow = true;
  } },
  // 17 Dark Persian
  'basep-17': { attacks: { Tempt: { effect: (ctx) => { if (!ctx.opp.bench.length || !ctx.flip()) return; const k = ctx.chooseMon('Tempt: switch which Benched Pokémon in?', ctx.opp.bench, { id: 'tempt' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Tempt'); } }, 'Poison Claws': flipStatus(10, 'PSN') } },
  // 18 Team Rocket's Meowth
  'basep-18': { attacks: { 'Miraculous Comeback': { effect: (ctx) => {
    const n = mons(ctx.me).length + mons(ctx.opp).length; const h = ctx.flips(n); ctx.log(`${h} heads, ${n - h} tails`);
    if (h) ctx.damage(10 * h); if (n - h) ctx.selfDamage(10 * (n - h));
  } } } },
  // 19 Sabrina's Abra (Synchronize reused from Gym Challenge)
  'basep-19': { attacks: { Pound: plain(10) } },
  // 20 Psyduck
  'basep-20': { attacks: { Headache: { effect: (ctx) => { ctx.addPlayerFx(ctx.oppSeat, { k: 'noTrainers', until: T(ctx) + 1 }); ctx.log(`${ctx.name(ctx.oppSeat)} can't play Trainers next turn`); } }, 'Fury Swipes': flipTimes(10, 3) } },
  // 21 Moltres
  'basep-21': { attacks: { 'Hyper Flame': { effect: (ctx, m) => {
    if (ctx.copying) { ctx.damage(60); return; }
    if (ctx.flip()) { const fire = m.en.filter(typeFilter(ctx, 'Fire')); if (!fire.length) { ctx.log('No Fire Energy to discard: the attack does nothing'); return; } ctx.requireDiscardEnergy(m, 1, typeFilter(ctx, 'Fire')); }
    else { if (!m.en.length) { ctx.log('No Energy to discard: the attack does nothing'); return; } ctx.discardEnergy(m, m.en.slice()); }
    ctx.damage(60);
  } } } },
  // 22 Articuno
  'basep-22': { attacks: { 'Diamond Dust': { effect: (ctx) => { ctx.damage(20); if (ctx.flip()) { ctx.status('PAR'); ctx.benchDamage(ctx.oppSeat, 10); } } } } },
  // 23 Zapdos
  'basep-23': { attacks: { 'Lightning Burn': { effect: (ctx) => {
    ctx.damage(30);
    if (ctx.flip()) { if (ctx.opp.bench.length) { const k = ctx.chooseMon('Lightning Burn: 30 damage to which Benched Pokémon?', ctx.opp.bench, { id: 'lburn' })[0]; ctx.benchDamageOne(k, 30); } }
    else ctx.selfDamage(30);
  } } } },
  // 24 _____'s Pikachu
  'basep-24': { attacks: { 'Birthday Surprise': { effect: (ctx) => {
    const b = ctx.choose({ id: 'birthday', title: 'Is it your birthday today?', options: [{ key: 'no', label: 'No' }, { key: 'yes', label: 'Yes, it is!' }] })[0];
    ctx.damage(b === 'yes' && ctx.flip() ? 80 : 30);
  } } } },
  // 25 Flying Pikachu
  'basep-25': { attacks: { Thundershock: thundershock(10), Fly: { effect: (ctx, m) => { if (!ctx.flip()) { ctx.log('Fly: the attack does nothing'); return; } protectSelf(ctx, m); ctx.damage(30); } } } },
  // 26 Pikachu
  'basep-26': { attacks: { Scratch: plain(10), Thunderbolt: thunderboltAll(40) } },
  // 27 Pikachu
  'basep-27': { attacks: { Thundershock: thundershock(10), Agility: { effect: (ctx, m) => { ctx.damage(20); if (ctx.flip()) protectSelf(ctx, m); } } } },
  // 28 Surfing Pikachu
  'basep-28': { attacks: { Surf: plain(30) } },
  // 29 Marill: +10 for each Energy beyond the 2 the attack needs, at most +20
  'basep-29': { attacks: { 'Water Gun': { effect: (ctx, m) => ctx.damage(20 + 10 * Math.min(2, Math.max(0, energyUnits(ctx.db, m) - 2))) } } },
  // 30 Togepi
  'basep-30': { attacks: { Snivel: reduceNext(20), 'Mini-Metronome': { effect: (ctx, m) => {
    if (!ctx.flip()) { ctx.log('Mini-Metronome: the attack does nothing'); return; }
    const d = ctx.opp.active; if (!d) return; const atks = ctx.cardFor(d).atk || []; if (!atks.length) { ctx.log('Nothing to copy'); return; }
    const k = ctx.choose({ id: 'minimetronome', title: 'Copy which attack?', options: atks.map((a) => ({ key: a.n, label: `${a.n} ${a.d || ''}` })) })[0];
    const atk = atks.find((a) => a.n === k); ctx.log(`Mini-Metronome copies ${atk.n}`); ctx.runAttack(m, atk, ctx.cardFor(d).id);
  } } } },
  // 31 Cleffa (Baby)
  'basep-31': { attacks: { Eek: { effect: (ctx) => ctx.draw(ctx.seat, 2) } } },
  // 32 Smeargle
  'basep-32': { attacks: { Paint: { effect: (ctx) => {
    const d = ctx.opp.active; if (!d || !ctx.flip()) { ctx.log('Paint: the attack does nothing'); return; }
    const t = ctx.choose({ id: 'paint', title: 'Paint the Defending Pokémon which type?', options: TYPES6.concat(['Darkness', 'Metal']).map((x) => ({ key: x, label: x })) })[0];
    d.flags.typeOverride = t; ctx.log(`Paint: ${nameOf(ctx.db, d.c)} is now ${t}`);
  } } } },
  // 33 Scizor
  'basep-33': { attacks: { Leer: noAttackNext(true), 'Metal Pincer': { effect: (ctx) => ctx.damage(30 + 10 * untilTails(ctx)) } } },
  // 34 Entei
  'basep-34': {
    passive: { onDamaged: ({ ctx, target }) => { if (target.dmg >= monHP(ctx.db, target, ctx.g)) return; if (ctx.flip('Bolt')) shuffleIntoDeck(ctx, target, 'Bolt'); } },
    attacks: { 'Protective Flame': { effect: (ctx) => { ctx.damage(50); ctx.addPlayerFx(ctx.seat, { k: 'benchShield', until: T(ctx) + 1 }); ctx.log("Protective Flame: your Bench is protected during your opponent's next turn"); } } } },
  // 35 Pichu (Baby)
  'basep-35': { attacks: { "Let's Play!": {
    canUse: ({ g, seat }) => (P(g, seat).bench.length < g.rules.benchSize ? null : 'Bench is full'),
    effect: (ctx) => { const got = ctx.searchDeck(ctx.seat, "Let's Play!: put a Baby Pokémon on your Bench", (c) => c.st === 'Pokémon' && c.sub === 'Baby', { min: 0, max: 1 }); for (const c of got) { ctx.me.bench.push(toMon(c, ctx.g.turnNo)); ctx.log(`${nameOf(ctx.db, c.c)} joins the bench`); } ctx.shuffle(ctx.seat); } } } },
  // 36 Igglybuff (Baby)
  'basep-36': { attacks: { 'Good Night Song': sureStatus(0, 'SLP') } },
  // 37 Hitmontop
  'basep-37': { attacks: {
    'Repeating Kick': { effect: (ctx) => { const h = untilTails(ctx); if (h) ctx.damage(20 * h); } },
    'Rapid Spin': { effect: (ctx) => {
      ctx.damage(30);
      if (ctx.opp.bench.length && ctx.opp.active) { const k = ctx.chooseMon('Rapid Spin: switch in which of your Benched Pokémon?', ctx.opp.bench, { seat: ctx.oppSeat, id: 'spinTheirs' })[0]; ctx.switchActive(ctx.oppSeat, k, 'Rapid Spin'); }
      if (ctx.me.bench.length && ctx.me.active) { const k = ctx.chooseMon('Rapid Spin: switch in which of your Benched Pokémon?', ctx.me.bench, { id: 'spinMine' })[0]; ctx.switchActive(ctx.seat, k, 'Rapid Spin'); }
    } } } },
  // 38 Unown [J]: needs Unown [O], [I] and Unown Dragon on your Bench (none of those are in these sets yet)
  'basep-38': { powers: { '[Join]': oncePerTurn('unownJoin', {
    canUse: ({ g, db, seat }) => { const names = P(g, seat).bench.map((m) => db[m.c].name); return ['Unown [J]', 'Unown [O]', 'Unown [I]'].every((n) => names.includes(n)) && names.some((n) => /^Unown Dragon/.test(n)) ? true : 'Needs Unown [J], [O], [I] and Unown Dragon on your Bench'; },
    use: (ctx) => { const got = ctx.searchDeck(ctx.seat, '[Join]: take a Basic Pokémon or Evolution card', (c) => c.st === 'Pokémon', { min: 0, max: 1 }); got.forEach((c) => ctx.toHand(ctx.seat, c)); ctx.shuffle(ctx.seat); } }) }, attacks: { 'Hidden Power': plain(10) } },
  // 39 Misdreavus
  'basep-39': { attacks: { 'Pain Split': { effect: (ctx, m) => {
    const d = ctx.opp.active; const n = countersOn(m); if (!d || !n) { ctx.log('Pain Split: no damage counters to copy'); return; }
    d.dmg += 10 * n; ctx.event({ t: 'damage', target: d.id, amount: 10 * n }); ctx.log(`Pain Split: ${n} damage counter${n === 1 ? '' : 's'} on ${nameOf(ctx.db, d.c)} (now ${d.dmg})`);
  } }, 'Confuse Ray': flipStatus(10, 'CNF') } },
  // 41 Lucky Stadium
  'basep-41': { stadium: {
    canUse: (g, db, seat) => (P(g, seat).luckyTurn === g.turnNo ? 'Already used this turn' : g.attacked ? 'Only before attacking' : true),
    use: (ctx) => { ctx.me.luckyTurn = ctx.g.turnNo; if (ctx.flip('Lucky Stadium')) ctx.draw(ctx.seat, 1); },
  }, trainer: () => {} },
  // 42 Pokémon Tower
  'basep-42': { stadium: { towerLock: true }, trainer: () => {} },
  // 43 Machamp
  'basep-43': { attacks: { 'Seething Anger': { effect: (ctx, m) => { const h = ctx.flips(countersOn(m)); ctx.log(`${h} heads`); ctx.damage(20 + 10 * h); } }, Fling: oppSwitches(50, 'Fling') } },
  // 44 Magmar
  'basep-44': { attacks: { 'Burning Fire': { effect: (ctx) => {
    let n = 0;
    if (!ctx.copying) {
      const pool = []; for (const m of ownPokemon(ctx)) for (const e of m.en) if (hasType(ctx, e, 'Fire')) pool.push({ e, m });
      if (pool.length) { const k = ctx.chooseCards('Burning Fire: discard any number of Fire Energy from your Pokémon', pool.map((x) => x.e), { min: 0, max: pool.length, id: 'burningFire' }); for (const x of pool) if (k.includes(x.e.id)) { ctx.discardEnergy(x.m, [x.e]); n++; } }
    }
    ctx.damage(10 + 10 * n);
  } }, 'Magma Punch': plain(40) } },
  // 45 Scyther
  'basep-45': { attacks: { 'Slashing Strike': {
    canUse: ({ g, m }) => (m.flags.slashLock === g.turnNo ? "Scyther can't use Slashing Strike this turn" : null),
    effect: (ctx, m) => { ctx.damage(40); m.flags.slashLock = ctx.g.turnNo + 2; } } } },
  // 46 Electabuzz
  'basep-46': { attacks: {
    'Lightning Rod': { effect: (ctx) => { const k = ctx.chooseMon('Put a Lightning Rod marker on which Pokémon?', mons(ctx.opp), { id: 'lrod' })[0]; const f = findMon(ctx.g, k); if (f) { f.m.flags.lightningRod = true; ctx.log(`Lightning Rod marker on ${nameOf(ctx.db, f.m.c)}`); } } },
    'Lightning Bolt': { effect: (ctx) => {
      const d = ctx.opp.active; if (d) ctx.damage(d.flags.lightningRod ? 20 : 10);
      for (const m of ctx.opp.bench.slice()) if (m.flags.lightningRod) ctx.damage(20, { target: m });
    } } } },
  // 47 Mew
  'basep-47': { passive: { shieldFrom: (g, db, src) => isEvolved(db, src) }, attacks: { Psyshock: flipStatus(10, 'CNF') } },
  // 48 Articuno
  'basep-48': { passive: { benchVeil: true }, attacks: { 'Ice Beam': flipStatus(30, 'PAR') } },
  // 49 Snorlax
  'basep-49': { passive: { blockRetreat: true }, attacks: { 'Roll Over': { effect: (ctx, m) => { ctx.damage(30); ctx.status('SLP', m); if (ctx.flip()) ctx.status('SLP'); } } } },
  // 50 Celebi
  'basep-50': { attacks: { 'Leaf Slice': flipTimes(20, 2) } },
  // 51 Rapidash
  'basep-51': { attacks: {
    'Jump Over': { effect: (ctx) => { if (!ctx.opp.bench.length) return; const k = ctx.chooseMon('Jump Over: which Benched Pokémon?', ctx.opp.bench, { id: 'jumpover' })[0]; if (ctx.flip()) ctx.benchDamageOne(k, 20); } },
    'Super Singe': flipStatus(30, 'BRN') } },
  // 52 Ho-oh
  'basep-52': { attacks: { 'Sacred Wing': { effect: (ctx) => ctx.damage(ctx.flip() ? 60 : 20) } } },
  // 53 Suicune: Pure Body (Poké-Body) — attaching a Water Energy from hand makes you discard an Energy from it
  'basep-53': {
    passive: { onEnergyAttached: (ctx, m, c) => { if (!/Water/.test(nameOf(ctx.db, c.c)) || !m.en.length) return; const k = ctx.chooseCards('Pure Body: discard an Energy from Suicune', m.en, { id: 'pureBody' })[0]; const e = m.en.find((x) => x.id === k); if (e) ctx.discardEnergy(m, [e]); } },
    attacks: { 'Hypno Wave': { effect: (ctx) => { if (ctx.flip()) ctx.damage(50); else { ctx.damage(30); ctx.status('SLP'); } } } } },
};

/** Promo scripts, plus the cards that share a script with a main-set printing. `base` is the main-set registry. */
export function promoScripts(base) {
  const out = { ...S };
  out['basep-19'] = { attacks: { ...S['basep-19'].attacks, Synchronize: base['gym2-93'].attacks.Synchronize } };
  out['basep-40'] = base['base1-85']; // Pokémon Center
  return out;
}
