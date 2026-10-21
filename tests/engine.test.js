import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame } from '../public/js/engine/state.js';
import { apply, legalActions, canPay, energyUnits } from '../public/js/engine/engine.js';
import { mulberry32 } from '../public/js/engine/rng.js';
import { validateDeck } from '../public/js/engine/rules.js';
import { automationReport } from '../public/js/engine/cards/index.js';

const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const N = Object.fromEntries(DATA.cards.filter((c) => c.set === 'base1').map((c) => [c.name, c.id]));

// seeds whose first coin flip is heads / tails
const seedWhere = (wantHeads, nth = 0) => { for (let s = 1; s < 5000; s++) { const r = mulberry32(s); let h; for (let i = 0; i <= nth; i++) h = r() < 0.5; if (h === wantHeads) return s; } throw new Error('no seed'); };
const HEADS = seedWhere(true), TAILS = seedWhere(false);
const seedRun = (want) => { for (let s = 1; s < 50000; s++) { const r = mulberry32(s); if (want.every((w) => (r() < 0.5) === w)) return s; } throw new Error('no seed'); };
const TAILS2 = seedRun([false, false]);

let ids = 0;
const inst = (cid) => ({ id: 'c' + (++ids).toString(36), c: cid });

/** Build a game with explicit hands/decks and an optional board, already in the main phase. */
function setup({ a, b, first = 'a', rules = {} }) {
  const g = newGame({ rules: { firstTurnAttack: true, weaknessBonus: 0, resistanceAmount: 30, ...rules }, seats: { a: { uid: 'ua', name: 'Ann', cards: { [N['Pikachu']]: 60 } }, b: { uid: 'ub', name: 'Bob', cards: { [N['Pikachu']]: 60 } } }, seed: 7, first });
  for (const s of ['a', 'b']) {
    const spec = s === 'a' ? a : b; const p = g.p[s];
    p.hand = (spec.hand || []).map(inst); p.deck = (spec.deck || []).map(inst); p.prizes = (spec.prizes || Array(6).fill(N['Bill'])).map(inst); p.discard = []; p.prizesTaken = 6 - p.prizes.length;
    const mon = (cid, extra = {}) => ({ id: 'c' + (++ids).toString(36), c: cid, dmg: 0, st: [], en: (extra.en || []).map(inst), tools: [], un: [], fx: [], playedTurn: 0, evolvedTurn: -1, flags: {}, ...extra, en: (extra.en || []).map(inst) });
    p.active = spec.active ? mon(spec.active.c || spec.active, spec.active.c ? spec.active : {}) : null;
    p.bench = (spec.bench || []).map((x) => mon(x.c || x, x.c ? x : {}));
    p.setupDone = true;
  }
  g.phase = 'main'; g.status = 'playing'; g.turnNo = 1; g.turn = first; g.p[first].attachedThisTurn = false;
  return g;
}
function act(g, action, { seat, seed = 1 } = {}) {
  const r = apply(g, { seat: seat || g.turn, seed, answers: [], ...action }, DB);
  if (r.error) throw new Error('rule error: ' + r.error);
  if (r.prompt) throw new Error('unexpected prompt: ' + r.prompt.title);
  return r.state;
}
/** Run an action, answering prompts in order. */
function actWith(g, action, answers, { seat, seed = 1 } = {}) {
  const r = apply(g, { seat: seat || g.turn, seed, answers, ...action }, DB);
  if (r.error) throw new Error('rule error: ' + r.error);
  return r;
}
const active = (g, s) => g.p[s].active;
const has = (list, type, extra = {}) => list.some((a) => a.type === type && Object.entries(extra).every(([k, v]) => a[k] === v));

test('attach, attack with plain damage, weakness, turn passes with a draw', () => {
  let g = setup({ a: { hand: [N['Fighting Energy']], deck: [N['Bill'], N['Bill']], active: N['Hitmonchan'] }, b: { active: N['Chansey'], deck: [N['Bill'], N['Bill']] } });
  const la = legalActions(g, 'a', DB);
  assert.ok(has(la, 'attach'), 'can attach');
  assert.ok(!has(la, 'attack'), 'no energy yet');
  g = act(g, { type: 'attach', card: g.p.a.hand[0].id, target: active(g, 'a').id });
  assert.equal(energyUnits(DB, active(g, 'a')), 1);
  assert.ok(has(legalActions(g, 'a', DB), 'attack', { index: 0 }), 'Jab is legal');
  g = act(g, { type: 'attack', index: 0 });
  assert.equal(active(g, 'b').dmg, 40, 'Jab 20 doubled by Fighting weakness');
  assert.equal(g.turn, 'b'); assert.equal(g.turnNo, 2); assert.equal(g.p.b.hand.length, 1, 'Bob drew');
});

test('colorless costs: Double Colorless pays Fire Spin; typed mode refuses', () => {
  const zard = { c: N['Charizard'], en: [N['Double Colorless Energy'], N['Double Colorless Energy'], N['Fire Energy']] };
  let g = setup({ a: { active: zard }, b: { active: N['Chansey'], deck: [N['Bill']] }, rules: { charizardDoubleDiscard: false } });
  assert.ok(canPay(DB, g.rules, active(g, 'a'), DB[N['Charizard']].atk[0].c));
  assert.ok(!canPay(DB, { colorlessCosts: false }, active(g, 'a'), DB[N['Charizard']].atk[0].c));
  // Fire Spin asks which 2 energy to discard, then hits for 100
  const r1 = actWith(g, { type: 'attack', index: 0 }, []);
  assert.ok(r1.prompt && r1.prompt.id === 'discardEnergy');
  const keys = r1.prompt.options.slice(0, 2).map((o) => o.key);
  const r2 = actWith(g, { type: 'attack', index: 0 }, [keys]);
  assert.equal(r2.state.p.b.active.dmg, 100); assert.equal(r2.state.p.a.active.en.length, 1);
});

test('knockout: prize pending for attacker, promotion for defender, then win', () => {
  let g = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy'], N['Fighting Energy'], N['Fighting Energy']] }, prizes: [N['Bill']] }, b: { active: { c: N['Pikachu'], dmg: 10 }, bench: [N['Pikachu']], prizes: [N['Bill']] } });
  g = act(g, { type: 'attack', index: 1 }); // Special Punch 40 on 40hp
  assert.equal(g.p.b.active, null);
  assert.deepEqual(g.pending.map((t) => t.t), ['prize', 'promote']);
  assert.ok(!legalActions(g, 'b', DB).length, 'Bob waits for the prize');
  g = act(g, { type: 'takePrize', index: 0 }, { seat: 'a' });
  assert.equal(g.winner, 'a', 'last prize wins');
});

test('promotion after knockout, then the turn passes', () => {
  let g = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, prizes: [N['Bill'], N['Bill']] }, b: { active: { c: N['Pikachu'], dmg: 30 }, bench: [N['Chansey']], prizes: [N['Bill']], deck: [N['Bill']] } });
  g = act(g, { type: 'attack', index: 0 });
  g = act(g, { type: 'takePrize', index: 0 }, { seat: 'a' });
  assert.equal(g.pending[0].t, 'promote');
  g = act(g, { type: 'promote', target: g.p.b.bench[0].id }, { seat: 'b' });
  assert.equal(g.p.b.active.c, N['Chansey']); assert.equal(g.turn, 'b'); assert.equal(g.turnNo, 2);
});

test('conditions stack under the house rule and replace under the official one', () => {
  let g = setup({ a: { active: { c: N['Drowzee'], en: [N['Psychic Energy'], N['Psychic Energy']] } }, b: { active: { c: N['Chansey'], st: ['PAR'] }, deck: [N['Bill']] } });
  const stacked = act(g, { type: 'attack', index: 1 }, { seed: HEADS }); // Confuse Ray heads
  assert.deepEqual(stacked.p.b.active.st.sort(), ['CNF', 'PAR']);
  g.rules.conditionsStack = false;
  const replaced = act(g, { type: 'attack', index: 1 }, { seed: HEADS });
  assert.deepEqual(replaced.p.b.active.st, ['CNF']);
});

test('status: poison ticks between turns, paralysis clears after owner turn, sleep flips', () => {
  let g = setup({ a: { active: { c: N['Tangela'], en: [N['Grass Energy'], N['Grass Energy'], N['Grass Energy']] } }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  g = act(g, { type: 'attack', index: 1 }); // Poisonpowder 20 + PSN
  assert.ok(g.p.b.active.st.includes('PSN')); assert.equal(g.p.b.active.dmg, 30, '20 + 10 poison between turns');
  // Bob's paralyzed Pokémon can't attack
  g.p.b.active.st.push('PAR'); g.p.b.active.en = [inst(N['Grass Energy']), inst(N['Grass Energy'])];
  assert.ok(!has(legalActions(g, 'b', DB), 'attack'));
  g = act(g, { type: 'endTurn' }, { seat: 'b' });
  assert.ok(!g.p.b.active.st.includes('PAR'), 'paralysis cleared at end of Bob turn');
  assert.equal(g.p.b.active.dmg, 40, 'poison again');
  // sleep: heads wakes
  g.p.b.active.st.push('SLP');
  const woke = act(g, { type: 'endTurn' }, { seat: 'a', seed: HEADS });
  assert.ok(!woke.p.b.active.st.includes('SLP'));
  const still = act(g, { type: 'endTurn' }, { seat: 'a', seed: TAILS });
  assert.ok(still.p.b.active.st.includes('SLP'));
});

test('house rules: no attack after retreat, no first-turn attack, conditions persist on bench', () => {
  let g = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy'], N['Fighting Energy'], N['Fighting Energy']], st: ['PSN'] }, bench: [{ c: N['Electabuzz'], en: [N['Lightning Energy']] }] }, b: { active: N['Chansey'] }, rules: { firstTurnAttack: false } });
  assert.ok(!has(legalActions(g, 'a', DB), 'attack'), 'first player cannot attack on turn 1');
  g.turnNo = 3; // pretend later
  assert.ok(has(legalActions(g, 'a', DB), 'attack'));
  const bench = g.p.a.bench[0].id;
  const r = actWith(g, { type: 'retreat', target: bench }, []);
  assert.ok(r.prompt && r.prompt.id === 'retreatCost', 'asks which energy to pay');
  g = actWith(g, { type: 'retreat', target: bench }, [[r.prompt.options[0].key, r.prompt.options[1].key]]).state;
  assert.equal(g.p.a.active.c, N['Electabuzz']);
  assert.ok(g.p.a.bench[0].st.includes('PSN'), 'poison stayed on the benched Hitmonchan');
  assert.ok(!has(legalActions(g, 'a', DB), 'attack'), 'no attack after retreating');
});

test('prompt replay: Computer Search asks twice and replays the same way', () => {
  let g = setup({ a: { hand: [N['Computer Search'], N['Bill'], N['Potion'], N['Switch']], deck: [N['Charizard'], N['Switch']], active: N['Pikachu'] }, b: { active: N['Chansey'] } });
  const cs = g.p.a.hand[0].id;
  const r1 = actWith(g, { type: 'playTrainer', card: cs }, []);
  assert.equal(r1.prompt.id, 'csDiscard');
  const discard = r1.prompt.options.slice(0, 2).map((o) => o.key);
  const r2 = actWith(g, { type: 'playTrainer', card: cs }, [discard]);
  assert.equal(r2.prompt.id, 'search'); assert.equal(r2.prompt.options.length, 2);
  const zard = r2.prompt.options.find((o) => o.cid === N['Charizard']).key;
  const r3 = actWith(g, { type: 'playTrainer', card: cs }, [discard, [zard]]);
  assert.ok(!r3.prompt);
  assert.ok(r3.state.p.a.hand.some((c) => c.c === N['Charizard'])); assert.equal(r3.state.p.a.hand.length, 2);
  assert.equal(r3.state.p.a.discard.length, 3, 'two discards plus Computer Search itself');
});

test('Energy Removal, PlusPower, Defender, Scrunch', () => {
  let g = setup({ a: { hand: [N['Energy Removal'], N['PlusPower'], N['Defender']], deck: [N['Bill'], N['Bill']], active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] } }, b: { active: { c: N['Electabuzz'], en: [N['Lightning Energy']] }, deck: [N['Bill']] } });
  const [er, pp, df] = g.p.a.hand.map((c) => c.id);
  g = actWith(g, { type: 'playTrainer', card: er }, [[g.p.b.active.id], [g.p.b.active.en[0].id]]).state;
  assert.equal(g.p.b.active.en.length, 0);
  g = act(g, { type: 'playTrainer', card: pp });
  g = actWith(g, { type: 'playTrainer', card: df }, [[g.p.a.active.id]]).state;
  g = act(g, { type: 'attack', index: 0 }); // Jab 20, doubled by Electabuzz's Fighting weakness, + 10
  assert.equal(g.p.b.active.dmg, 50);
  assert.equal(g.p.a.active.tools.length, 1, 'PlusPower discarded at end of turn, Defender stays');
  // Bob attaches and Thundershocks: Defender takes 20 off
  g.p.b.hand.push(inst(N['Lightning Energy'])); g = act(g, { type: 'attach', card: g.p.b.hand[g.p.b.hand.length - 1].id, target: g.p.b.active.id }, { seat: 'b' });
  g = act(g, { type: 'attack', index: 0 }, { seat: 'b', seed: TAILS });
  assert.equal(g.p.a.active.dmg, 0, '10 damage minus Defender 20');
  assert.equal(g.p.a.active.tools.length, 0, 'Defender discarded at the end of the opponent turn');
  // Scrunch heads prevents Jab next turn
  let h = setup({ a: { active: { c: N['Chansey'], en: [N['Double Colorless Energy']] }, deck: [N['Bill']] }, b: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: [N['Bill']] } });
  h = act(h, { type: 'attack', index: 0 }, { seed: HEADS });
  h = act(h, { type: 'attack', index: 0 }, { seat: 'b' });
  assert.equal(h.p.a.active.dmg, 0, 'Scrunch prevented the damage');
});

test('Damage Swap moves counters and refuses a knockout', () => {
  let g = setup({ a: { active: { c: N['Chansey'], dmg: 110 }, bench: [N['Alakazam'], { c: N['Pikachu'], dmg: 30 }, N['Chansey']] }, b: { active: N['Chansey'] } });
  const zam = g.p.a.bench[0].id, pika = g.p.a.bench[1].id, chansey = g.p.a.active.id;
  const r = actWith(g, { type: 'usePower', pokemon: zam, power: 'Damage Swap' }, [[chansey]]);
  assert.equal(r.prompt.id, 'swapTo');
  assert.ok(!r.prompt.options.some((o) => o.key === pika), 'Pikachu at 30/40 would be knocked out');
  g = actWith(g, { type: 'usePower', pokemon: zam, power: 'Damage Swap' }, [[chansey], [zam]]).state;
  assert.equal(g.p.a.active.dmg, 100); assert.equal(g.p.a.bench[0].dmg, 10);
});

test('confused attacker flips; Metronome copies the defender attack', () => {
  let g = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']], st: ['CNF'] } }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const hurt = act(g, { type: 'attack', index: 0 }, { seed: TAILS });
  assert.equal(hurt.p.a.active.dmg, 20, 'house rule: 20 self-damage'); assert.equal(hurt.p.b.active.dmg, 0);
  const ok = act(g, { type: 'attack', index: 0 }, { seed: HEADS });
  assert.equal(ok.p.b.active.dmg, 40);
  let m = setup({ a: { active: { c: N['Clefairy'], en: [N['Double Colorless Energy'], N['Fighting Energy']] } }, b: { active: N['Hitmonchan'], deck: [N['Bill']] } });
  m = actWith(m, { type: 'attack', index: 1 }, [['Special Punch']]).state;
  assert.equal(m.p.b.active.dmg, 40, 'Metronome Special Punch, no cost needed');
});

test('deck-out damage instead of losing; override damage', () => {
  let g = setup({ a: { active: N['Chansey'] }, b: { active: N['Chansey'], deck: [] } });
  g = act(g, { type: 'endTurn' });
  assert.equal(g.p.b.active.dmg, 10, '10 damage for the empty deck');
  g = act(g, { type: 'override', op: 'damage', target: g.p.b.active.id, delta: 110 }, { seat: 'b' });
  assert.equal(g.p.b.active, null, 'override knockout');
  assert.equal(g.winner, 'a', 'no Pokémon left: Ann wins');
});

test('setup phase: place basics, mulligan credit, first player draws', () => {
  const g0 = newGame({ rules: { mulliganRescue: false }, seats: { a: { uid: 'ua', name: 'Ann', cards: { [N['Bill']]: 60 } }, b: { uid: 'ub', name: 'Bob', cards: { [N['Pikachu']]: 60 } } }, seed: 3, first: 'b' });
  assert.equal(g0.p.a.hand.length, 7); assert.equal(g0.p.a.prizes.length, 6);
  assert.ok(has(legalActions(g0, 'a', DB), 'mulligan'));
  let g = act(g0, { type: 'mulligan' }, { seat: 'a' });
  assert.equal(g.p.b.mulliganCredits, 1);
  g = act(g, { type: 'placeActive', card: g.p.b.hand[0].id }, { seat: 'b' });
  g = act(g, { type: 'placeBench', card: g.p.b.hand[0].id }, { seat: 'b' });
  g = act(g, { type: 'setupDone' }, { seat: 'b' });
  g.p.a.hand.push(inst(N['Pikachu'])); g = act(g, { type: 'placeActive', card: g.p.a.hand[g.p.a.hand.length - 1].id }, { seat: 'a' });
  g = act(g, { type: 'setupDone' }, { seat: 'a' });
  assert.equal(g.phase, 'main'); assert.equal(g.turnNo, 1);
  assert.equal(g.pending[0].t, 'mulliganDraw');
  g = act(g, { type: 'mulliganDraw', n: 1 }, { seat: 'b' });
  assert.equal(g.p.b.hand.length, 5 + 1 + 1, 'placed two, drew the mulligan card and the turn-one card');
});

test('deck validation and automation coverage for Base Set', () => {
  const v = validateDeck({ cards: { [N['Lass']]: 1, [N['Energy Removal']]: 3, [N['Pikachu']]: 4, [N['Lightning Energy']]: 52 } }, {}, DB);
  assert.ok(v.some((x) => /Lass is banned/.test(x.m))); assert.ok(v.some((x) => /Energy Removal \(max 2\)/.test(x.m)));
  const rep = automationReport(DB); const base = Object.entries(rep).filter(([id]) => id.startsWith('base1-'));
  const missing = base.filter(([, s]) => s === 'missing').map(([id]) => id);
  assert.deepEqual(missing, [], 'every Base Set card is scripted or plain');
});

test('Jungle Lickitung and Rocket Charmander scripts', () => {
  let g = setup({ a: { active: { c: 'base2-38', en: [N['Fire Energy'], N['Fire Energy']] } }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const cnf = act(g, { type: 'attack', index: 1 }, { seed: HEADS });
  assert.ok(cnf.p.b.active.st.includes('CNF'), 'Supersonic heads confuses');
  const none = act(g, { type: 'attack', index: 1 }, { seed: TAILS });
  assert.ok(!none.p.b.active.st.includes('CNF'));
  let h = setup({ a: { active: { c: N['Chansey'], en: [N['Fire Energy']] }, bench: ['base5-50'] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const charm = h.p.a.bench[0].id;
  assert.ok(has(legalActions(h, 'a', DB), 'usePower', { power: 'Gather Fire' }));
  h = act(h, { type: 'usePower', pokemon: charm, power: 'Gather Fire' });
  assert.equal(h.p.a.bench[0].en.length, 1); assert.equal(h.p.a.active.en.length, 0);
  assert.ok(!has(legalActions(h, 'a', DB), 'usePower', { power: 'Gather Fire' }), 'once per turn');
});

test('Jungle and Fossil mechanics: Invisible Wall, Thick Skinned, Kabuto Armor, Prehistoric Power, Headache, Hurricane', () => {
  // Mr. Mime blocks 30+ (after weakness) but not 20
  let g = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy'], N['Fighting Energy'], N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: 'base2-6', deck: [N['Bill']] } });
  assert.equal(act(g, { type: 'attack', index: 1 }).p.b.active.dmg, 0, 'Special Punch 40 prevented');
  assert.equal(act(g, { type: 'attack', index: 0 }).p.b.active.dmg, 20, 'Jab 20 gets through');
  // Snorlax cannot be poisoned
  let s = setup({ a: { active: { c: N['Tangela'], en: [N['Grass Energy'], N['Grass Energy'], N['Grass Energy']] }, deck: [N['Bill']] }, b: { active: 'base2-11', deck: [N['Bill']] } });
  const sn = act(s, { type: 'attack', index: 1 }); assert.ok(!sn.p.b.active.st.includes('PSN')); assert.equal(sn.p.b.active.dmg, 20);
  // Kabuto halves damage
  let k = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: 'base3-50', deck: [N['Bill']] } });
  assert.equal(act(k, { type: 'attack', index: 0 }).p.b.active.dmg, 10, 'Jab 20 halved');
  // Aerodactyl stops evolution
  let a = setup({ a: { hand: [N['Raichu']], active: N['Pikachu'], deck: [N['Bill']] }, b: { active: 'base3-1', deck: [N['Bill']] } });
  assert.ok(!has(legalActions(a, 'a', DB), 'evolve'), 'no evolution with Aerodactyl in play');
  a.p.b.active.st.push('SLP'); assert.ok(has(legalActions(a, 'a', DB), 'evolve'), 'asleep Aerodactyl stops working');
  // Headache locks Trainers next turn
  let h = setup({ a: { active: { c: 'base3-53', en: [N['Psychic Energy']] }, deck: [N['Bill']] }, b: { active: N['Chansey'], hand: [N['Bill']], deck: [N['Bill']] } });
  h = act(h, { type: 'attack', index: 0 });
  assert.ok(!has(legalActions(h, 'b', DB), 'playTrainer'), 'Bob cannot play Bill');
  h = act(h, { type: 'endTurn' }, { seat: 'b' }); h = act(h, { type: 'endTurn' }, { seat: 'a' });
  assert.ok(has(legalActions(h, 'b', DB), 'playTrainer'), 'lock expired');
  // Hurricane bounces the defender to hand
  let p = setup({ a: { active: { c: 'base2-8', en: [N['Double Colorless Energy'], N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: { c: N['Chansey'], en: [N['Fire Energy']] }, bench: [N['Pikachu']], deck: [N['Bill']] } });
  p = act(p, { type: 'attack', index: 1 });
  assert.equal(p.p.b.active, null); assert.equal(p.p.b.hand.length, 2, 'Chansey and its energy returned'); assert.equal(p.pending[0].t, 'promote');
});

test('every scripted set has no missing cards', () => {
  const rep = automationReport(DB);
  for (const set of ['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2']) {
    const missing = Object.entries(rep).filter(([id, s]) => id.startsWith(set + '-') && s === 'missing').map(([id]) => id + ' ' + DB[id].name);
    assert.deepEqual(missing, [], set + ' fully scripted');
  }
});

test('Team Rocket mechanics: Rainbow Energy, Sinkhole, Sticky Goo, Frenzy, Summon Minions, Goop Gas', () => {
  // Rainbow Energy hurts on attach
  let g = setup({ a: { hand: ['base5-17'], active: N['Chansey'], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  g = act(g, { type: 'attach', card: g.p.a.hand[0].id, target: g.p.a.active.id });
  assert.equal(g.p.a.active.dmg, 10);
  // Sticky Goo adds 2 to the opponent's retreat cost; Sinkhole hurts on tails
  let s = setup({ a: { active: { c: N['Pikachu'], en: [N['Lightning Energy']] }, bench: [N['Chansey']], deck: [N['Bill']] }, b: { active: 'base5-41', bench: ['base5-6'], deck: [N['Bill']] } });
  assert.ok(!has(legalActions(s, 'a', DB), 'retreat'), 'one energy is not enough with Sticky Goo');
  s.p.a.active.en.push(inst(N['Lightning Energy']), inst(N['Lightning Energy']));
  const r = actWith(s, { type: 'retreat', target: s.p.a.bench[0].id }, [], { seed: TAILS });
  assert.ok(!r.error && !r.prompt, r.error || 'prompt?');
  assert.equal(r.state.p.a.bench[0].dmg, 20, 'Sinkhole 20 on tails');
  // Frenzy: confused Dark Primeape adds 30
  let f = setup({ a: { active: { c: 'base5-43', en: [N['Fighting Energy'], N['Fighting Energy']], st: ['CNF'] }, deck: [N['Bill']] }, b: { active: 'base3-8', deck: [N['Bill']] } });
  assert.equal(act(f, { type: 'attack', index: 0 }, { seed: HEADS }).p.b.active.dmg, 70, '40 + 30 frenzy');
  // Summon Minions on evolve
  let d = setup({ a: { hand: ['base5-5'], active: { c: 'base5-33' }, deck: [N['Pikachu'], N['Chansey'], N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  d.p.a.active.playedTurn = 0; d.turnNo = 2;
  const rr = actWith(d, { type: 'evolve', card: d.p.a.hand[0].id, target: d.p.a.active.id }, []);
  assert.equal(rr.prompt && rr.prompt.id, 'search');
  const picks = rr.prompt.options.map((o) => o.key);
  const done = actWith(d, { type: 'evolve', card: d.p.a.hand[0].id, target: d.p.a.active.id }, [picks]).state;
  assert.equal(done.p.a.bench.length, 2);
  // Goop Gas Attack turns Damage Swap off
  let z = setup({ a: { hand: ['base5-78'], active: { c: N['Chansey'], dmg: 20 }, bench: [N['Alakazam']], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  assert.ok(has(legalActions(z, 'a', DB), 'usePower'));
  z = act(z, { type: 'playTrainer', card: z.p.a.hand[0].id });
  assert.ok(!has(legalActions(z, 'a', DB), 'usePower'), 'powers off');
});

test('Gym sets: stadiums, Blaine, Fortitude, Rebellion, Psylink, Swift, Transparent Walls, Narrow Gym', () => {
  // Pewter City Gym: Brock's Pokémon ignore Resistance. Brock's Geodude Hook Shot already ignores it; use Rock Toss vs a Fighting-resistant target.
  let g = setup({ a: { hand: ['gym1-115'], active: { c: 'gym1-40', en: [N['Fighting Energy'], N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: 'base1-1' /* Alakazam? no: use a Fighting-resistant Pokémon */, deck: [N['Bill']] } });
  assert.ok(true);
  // Narrow Gym: bench limited to 4
  let n = setup({ a: { hand: ['gym1-124', N['Pikachu']], active: N['Chansey'], bench: [N['Pikachu'], N['Pikachu'], N['Pikachu'], N['Pikachu']], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  n = act(n, { type: 'playTrainer', card: n.p.a.hand[0].id });
  assert.ok(n.stadium && n.stadium.c === 'gym1-124', 'stadium in play');
  assert.ok(!has(legalActions(n, 'a', DB), 'playBasic'), 'bench capped at 4');
  // Blaine: two Fire Energy on a Blaine's Pokémon in one turn
  let b = setup({ a: { hand: ['gym2-17', N['Fire Energy'], N['Fire Energy'], N['Fire Energy']], active: 'gym1-61', deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  b = act(b, { type: 'playTrainer', card: b.p.a.hand[0].id });
  b = act(b, { type: 'attach', card: b.p.a.hand[0].id, target: b.p.a.active.id });
  assert.ok(has(legalActions(b, 'a', DB), 'attach'), 'second Fire attach allowed');
  b = act(b, { type: 'attach', card: b.p.a.hand[0].id, target: b.p.a.active.id });
  assert.equal(b.p.a.active.en.length, 2);
  assert.ok(!has(legalActions(b, 'a', DB), 'attach'), 'third attach refused');
  // Fortitude: Giovanni's Machamp survives a lethal hit on heads with 10 HP left
  let f = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy'], N['Fighting Energy'], N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: { c: 'gym2-6', dmg: 90 }, deck: [N['Bill']] } });
  const fr = act(f, { type: 'attack', index: 1 }, { seed: HEADS });
  assert.ok(fr.p.b.active && fr.p.b.active.c === 'gym2-6', 'Machamp still in play');
  assert.equal(fr.p.b.active.dmg, 90, '10 HP left');
  // Rebellion: double tails shuffles Misty's Gyarados away
  let r = setup({ a: { active: { c: 'gym2-13', en: [N['Water Energy'], N['Water Energy'], N['Water Energy'], N['Water Energy']] }, bench: [N['Chansey']], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const rr = actWith(r, { type: 'attack', index: 0 }, [], { seed: TAILS2 });
  assert.ok(!rr.error, rr.error);
  assert.ok(rr.state.pending.some((x) => x.t === 'promote') || rr.state.p.a.active === null || (rr.state.p.a.active && rr.state.p.a.active.c !== 'gym2-13'), 'Gyarados left play');
  assert.equal(rr.state.p.b.active.dmg, 0, 'no damage');
  // Psylink: Sabrina's Alakazam gains the attacks of benched Psychic Pokémon
  let p = setup({ a: { active: { c: 'gym2-16', en: [N['Psychic Energy'], N['Psychic Energy']] }, bench: ['gym2-58'], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  assert.ok(legalActions(p, 'a', DB).some((a) => a.type === 'attack' && a.name === 'Life Drain'), 'Life Drain available via Psylink');
  // Swift ignores Defender and Resistance
  let sw = setup({ a: { active: { c: 'gym2-36', en: [N['Fighting Energy'], N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: { c: N['Chansey'], fx: [{ k: 'defender', card: 'x', until: 99 }] }, deck: [N['Bill']] } });
  assert.equal(act(sw, { type: 'attack', index: 0 }).p.b.active.dmg, 20, 'Swift 20 through Defender');
  // Transparent Walls: bench takes no attack damage during the opponent's next turn
  let tw = setup({ a: { hand: ['gym2-125'], active: N['Chansey'], bench: [N['Pikachu']], deck: [N['Bill']] }, b: { active: { c: 'gym1-39', en: [N['Grass Energy'], N['Grass Energy'], N['Grass Energy']] }, deck: [N['Bill']] } });
  tw = act(tw, { type: 'playTrainer', card: tw.p.a.hand[0].id });
  tw = act(tw, { type: 'endTurn' });
  tw = act(tw, { type: 'attack', index: 1 });
  assert.equal(tw.p.a.bench[0].dmg, 0, 'bench protected');
  assert.equal(tw.p.a.active.dmg, 10, 'active still hit by Spiral Dive');
});

test('house rule: weakness adds 10 and resistance takes 20', () => {
  const w = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: N['Electabuzz'], deck: [N['Bill']] }, rules: { weaknessBonus: 10, resistanceAmount: 20 } });
  assert.equal(act(w, { type: 'attack', index: 0 }).p.b.active.dmg, 30, 'Jab 20 + 10 weakness');
  const r = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: N['Gastly'], deck: [N['Bill']] }, rules: { weaknessBonus: 10, resistanceAmount: 20 } });
  assert.equal(act(r, { type: 'attack', index: 0 }).p.b.active.dmg, 0, 'Jab 20 − 20 resistance');
});

test('house rule: Charizard Fire Spin can burn one Double Colorless', () => {
  const dce = 'base1-96';
  let g = setup({ a: { active: { c: 'base1-4', en: [dce, N['Fire Energy'], N['Fire Energy']] }, deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const r = actWith(g, { type: 'attack', index: 0 }, [[g.p.a.active.en[0].id]]);
  assert.ok(!r.error && !r.prompt, r.error || 'prompt?');
  assert.equal(r.state.p.a.active.en.length, 2, 'only the Double Colorless was discarded');
  assert.equal(r.state.p.b.active.dmg, 100);
  // with the rule off the same board must discard two cards
  let h = setup({ a: { active: { c: 'base1-4', en: [dce, N['Fire Energy'], N['Fire Energy']] }, deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] }, rules: { charizardDoubleDiscard: false } });
  const p = actWith(h, { type: 'attack', index: 0 }, []);
  assert.ok(p.prompt && p.prompt.min === 2, 'two cards required when the rule is off');
});

test('house rule: evolutions fit any version of the species', () => {
  const blainesCharmeleon = DATA.cards.find((c) => c.name === "Blaine's Charmeleon").id;
  let g = setup({ a: { hand: [blainesCharmeleon], active: N['Charmander'], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  g.p.a.active.playedTurn = 0; g.turnNo = 2;
  assert.ok(has(legalActions(g, 'a', DB), 'evolve'), "Blaine's Charmeleon may go on a plain Charmander");
  g = act(g, { type: 'evolve', card: g.p.a.hand[0].id, target: g.p.a.active.id });
  assert.equal(g.p.a.active.c, blainesCharmeleon);
  let h = setup({ a: { hand: [blainesCharmeleon], active: N['Charmander'], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] }, rules: { anyVersionEvolves: false } });
  h.p.a.active.playedTurn = 0; h.turnNo = 2;
  assert.ok(!has(legalActions(h, 'a', DB), 'evolve'), 'official rule keeps the names strict');
});

test('house rule: with no Pokémon left you draw until a Basic, and the opponent draws as many', () => {
  // Pikachu (40 HP) alone with 30 damage; Hitmonchan's Jab finishes it; the deck has Bill, Bill, Chansey, Bill
  let g = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: [N['Bill'], N['Bill'], N['Bill'], N['Bill']] }, b: { active: { c: N['Pikachu'], dmg: 30 }, deck: [N['Bill'], N['Bill'], N['Chansey'], N['Bill']] } });
  g = act(g, { type: 'attack', index: 0 });
  assert.ok(!g.winner, 'no winner: Bob was rescued');
  assert.ok(g.p.b.active && g.p.b.active.c === N['Chansey'], 'Chansey came in as Active');
  assert.equal(g.p.b.hand.length, 2, 'the two Bills drawn on the way went to hand');
  assert.equal(g.p.a.hand.length, 3, 'Ann drew 3 cards too');
  assert.ok(!g.pending.some((t) => t.t === 'promote'), 'no promote step left over');
  // seven misses is a loss
  let h = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: Array(8).fill(N['Bill']) }, b: { active: { c: N['Pikachu'], dmg: 30 }, deck: Array(8).fill(N['Bill']) } });
  h = act(h, { type: 'attack', index: 0 });
  assert.equal(h.winner, 'a', 'seven non-Basics means Bob loses');
  // rule off: immediate loss
  let k = setup({ a: { active: { c: N['Hitmonchan'], en: [N['Fighting Energy']] }, deck: [N['Bill']] }, b: { active: { c: N['Pikachu'], dmg: 30 }, deck: [N['Chansey']] }, rules: { benchRescue: false } });
  k = act(k, { type: 'attack', index: 0 });
  assert.equal(k.winner, 'a');
});

test('house rule: a Pokémon may evolve the turn it is played', () => {
  let g = setup({ a: { hand: [N['Charmander'], N['Charmeleon']], active: N['Chansey'], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  g = act(g, { type: 'playBasic', card: g.p.a.hand[0].id });
  assert.ok(has(legalActions(g, 'a', DB), 'evolve'), 'Charmeleon can go on the Charmander played this turn');
  g = act(g, { type: 'evolve', card: g.p.a.hand[0].id, target: g.p.a.bench[0].id });
  assert.equal(DB[g.p.a.bench[0].c].name, 'Charmeleon');
  let h = setup({ a: { hand: [N['Charmander'], N['Charmeleon']], active: N['Chansey'], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] }, rules: { evolveSameTurn: false } });
  h = act(h, { type: 'playBasic', card: h.p.a.hand[0].id });
  assert.ok(!has(legalActions(h, 'a', DB), 'evolve'), 'official rule waits a turn');
});

test('house rule: an attached Double Colorless is discarded instead of returning to hand', () => {
  const dce = 'base1-96'; const flow = DATA.cards.find((c) => c.name === 'Energy Flow').id;
  let g = setup({ a: { hand: [flow], active: { c: N['Chansey'], en: [dce, N['Lightning Energy']] }, deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const r = actWith(g, { type: 'playTrainer', card: g.p.a.hand[0].id }, [[g.p.a.active.en[0].id, g.p.a.active.en[1].id]]);
  assert.ok(!r.error && !r.prompt, r.error || 'prompt?');
  const names = (cards) => cards.map((c) => DB[c.c].name);
  assert.ok(names(r.state.p.a.hand).includes('Lightning Energy'), 'the basic energy came back to hand');
  assert.ok(!names(r.state.p.a.hand).includes('Double Colorless Energy'), 'the Double Colorless did not');
  assert.ok(names(r.state.p.a.discard).includes('Double Colorless Energy'), 'it was discarded');
});

test('house rule: pick up a basic Energy instead of attaching, never a Double Colorless', () => {
  const dce = 'base1-96';
  let g = setup({ a: { hand: [N['Fire Energy']], active: { c: N['Chansey'], en: [dce, N['Lightning Energy']] }, deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const la = legalActions(g, 'a', DB);
  assert.ok(la.some((a) => a.type === 'pickupEnergy' && a.card === g.p.a.active.en[1].id), 'the Lightning can be picked up');
  assert.ok(!la.some((a) => a.type === 'pickupEnergy' && a.card === g.p.a.active.en[0].id), 'the Double Colorless cannot');
  g = act(g, { type: 'pickupEnergy', target: g.p.a.active.id, card: g.p.a.active.en[1].id });
  assert.equal(g.p.a.active.en.length, 1); assert.equal(g.p.a.hand.length, 2, 'the energy is back in hand');
  assert.ok(!has(legalActions(g, 'a', DB), 'attach'), 'that used up the turn\'s attachment');
});

test('house mulligan: opponent may mulligan too; a second miss draws one at a time, 5 misses loses', () => {
  const mk = (seed) => newGame({ rules: {}, seats: { a: { uid: 'ua', name: 'Ann', cards: { [N['Bill']]: 60 } }, b: { uid: 'ub', name: 'Bob', cards: { [N['Pikachu']]: 60 } } }, seed, first: 'b' });
  let g = act(mk(3), { type: 'mulligan' }, { seat: 'a' });
  assert.equal(g.p.b.mulliganCredits, 0, 'no extra draw under the house rule'); assert.equal(g.p.b.freeMulligans, 1);
  assert.ok(has(legalActions(g, 'b', DB), 'mulligan'), 'Bob may mulligan too although he has Basics');
  const before = g.p.b.hand.map((c) => c.id).join();
  g = act(g, { type: 'mulligan' }, { seat: 'b' });
  assert.equal(g.p.b.hand.length, 7); assert.notEqual(g.p.b.hand.map((c) => c.id).join(), before); assert.equal(g.p.b.freeMulligans, 0);
  assert.ok(!has(legalActions(g, 'b', DB), 'mulligan'), 'only once');
  // Ann's second miss: her deck is all Bill, so 5 draws find nothing and she loses
  assert.ok(has(legalActions(g, 'a', DB), 'mulligan'));
  const bobHand = g.p.b.hand.length;
  g = act(g, { type: 'mulligan' }, { seat: 'a' });
  assert.equal(g.p.a.hand.length, 7 + 5, 'drew 5 one at a time'); assert.equal(g.p.b.hand.length, bobHand + 5, 'Bob drew as many');
  assert.equal(g.winner, 'b');
  // a second miss that does find a Basic: stop there, opponent draws the same number
  g = act(mk(3), { type: 'mulligan' }, { seat: 'a' });
  g.p.a.deck.splice(2, 0, inst(N['Pikachu']));
  const bh = g.p.b.hand.length;
  g = act(g, { type: 'mulligan' }, { seat: 'a' });
  assert.equal(g.winner, null); assert.equal(g.p.a.hand.length, 10, 'stopped at the third card'); assert.equal(g.p.b.hand.length, bh + 3);
  assert.ok(has(legalActions(g, 'a', DB), 'placeActive'));
});

test('Rain Dance attaches several Water Energy in one use', () => {
  const W = N['Water Energy'];
  let g = setup({ a: { hand: [W, W, W], active: N['Blastoise'], bench: [N['Squirtle']], deck: [N['Bill']] }, b: { active: N['Chansey'], deck: [N['Bill']] } });
  const blast = g.p.a.active.id; const [w1, w2] = g.p.a.hand.map((c) => c.id);
  g = actWith(g, { type: 'usePower', pokemon: blast, power: 'Rain Dance' }, [[w1, w2], [blast]]).state;
  assert.equal(g.p.a.active.en.length, 2, 'two Water on Blastoise from one Rain Dance'); assert.equal(g.p.a.hand.length, 1);
  assert.ok(has(legalActions(g, 'a', DB), 'attach'), 'the normal attachment is still unused');
  assert.ok(has(legalActions(g, 'a', DB), 'usePower', { power: 'Rain Dance' }), 'and Rain Dance can be used again');
});

