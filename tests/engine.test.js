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

let ids = 0;
const inst = (cid) => ({ id: 'c' + (++ids).toString(36), c: cid });

/** Build a game with explicit hands/decks and an optional board, already in the main phase. */
function setup({ a, b, first = 'a', rules = {} }) {
  const g = newGame({ rules: { firstTurnAttack: true, ...rules }, seats: { a: { uid: 'ua', name: 'Ann', cards: { [N['Pikachu']]: 60 } }, b: { uid: 'ub', name: 'Bob', cards: { [N['Pikachu']]: 60 } } }, seed: 7, first });
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
  let g = setup({ a: { active: zard }, b: { active: N['Chansey'], deck: [N['Bill']] } });
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
  const g0 = newGame({ rules: {}, seats: { a: { uid: 'ua', name: 'Ann', cards: { [N['Bill']]: 60 } }, b: { uid: 'ub', name: 'Bob', cards: { [N['Pikachu']]: 60 } } }, seed: 3, first: 'b' });
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

