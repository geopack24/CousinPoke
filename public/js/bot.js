// A practice opponent that plays a seat with the rules engine's own list of legal actions.
// The human opponent's browser runs it: botAction() picks the next move, botAnswer() answers the engine's prompts.
import { apply, legalActions, energyUnits, effectiveCard, canPay, monHP, scriptOf, evolutionNameMatches } from './engine/engine.js';
import { R } from './engine/rules.js';
import { P, other, mons } from './engine/state.js';

export const BOT_UID = 'p_bot000000000001';
export const BOT_NAME = 'Computer';

// Built-in decks the computer can play (count, card name, set). Created as deck documents when first used.
export const BOT_DECKS = {
  'bot-haymaker': { name: 'Computer: Haymaker', list: [[4, 'Hitmonchan', 'base1'], [4, 'Electabuzz', 'base1'], [3, 'Scyther', 'base2'], [3, 'Magmar', 'base3'], [2, 'Mr. Mime', 'base2'], [4, 'Bill', 'base1'], [3, 'Professor Oak', 'base1'], [2, 'Computer Search', 'base1'], [2, 'Energy Removal', 'base1'], [2, 'Super Energy Removal', 'base1'], [4, 'PlusPower', 'base1'], [2, 'Switch', 'base1'], [2, 'Defender', 'base1'], [4, 'Double Colorless Energy', 'base1'], [19, 'Fighting Energy', 'base1']] },
  'bot-rain-dance': { name: 'Computer: Rain Dance', list: [[4, 'Squirtle', 'base1'], [2, 'Wartortle', 'base1'], [3, 'Blastoise', 'base1'], [2, 'Lapras', 'base3'], [2, 'Articuno', 'base3'], [4, 'Bill', 'base1'], [3, 'Professor Oak', 'base1'], [2, 'Computer Search', 'base1'], [3, 'Pokémon Breeder', 'base1'], [2, 'Energy Removal', 'base1'], [2, 'Super Energy Removal', 'base1'], [2, 'Switch', 'base1'], [2, 'Energy Retrieval', 'base1'], [1, 'Item Finder', 'base1'], [26, 'Water Energy', 'base1']] },
  'bot-zard': { name: 'Computer: Charizard', list: [[4, 'Charmander', 'base1'], [2, 'Charmeleon', 'base1'], [3, 'Charizard', 'base1'], [3, 'Growlithe', 'base1'], [2, 'Arcanine', 'base1'], [3, 'Pokémon Breeder', 'base1'], [4, 'Bill', 'base1'], [3, 'Professor Oak', 'base1'], [2, 'Computer Search', 'base1'], [2, 'Energy Retrieval', 'base1'], [2, 'Switch', 'base1'], [2, 'PlusPower', 'base1'], [24, 'Fire Energy', 'base1'], [4, 'Double Colorless Energy', 'base1']] },
};
export function botDeckCards(db, key) {
  const d = BOT_DECKS[key]; if (!d) return null; const cards = {};
  for (const [n, name, set] of d.list) { const c = Object.values(db).find((x) => x.name === name && x.set === set); if (!c) throw new Error('bot deck: no ' + name); cards[c.id] = (cards[c.id] || 0) + n; }
  return cards;
}

/* ---------- helpers ---------- */
const card = (db, x) => db[typeof x === 'string' ? x : x.c] || {};
const isBasic = (c) => c.st === 'Pokémon' && c.sub === 'Basic';
const isEvo = (c) => c.st === 'Pokémon' && c.sub !== 'Basic';
const isEnergy = (c) => c.st === 'Energy';
const hpLeft = (db, m) => (card(db, m).hp || 0) - m.dmg;
/** Rough damage of an attack from its printed number: 30 -> 30, '30+' -> 40, '20×' -> 30, text only -> 10. */
export function attackValue(atk) { const n = parseInt(atk.d, 10); if (isNaN(n)) return atk.n === 'Scrunch' || atk.n === 'Withdraw' || atk.n === 'Barrier' ? 5 : 10; if (/\+/.test(atk.d)) return n + 10; if (/×|x/.test(atk.d)) return Math.round(n * 1.5); if (/-/.test(atk.d)) return Math.round(n * 0.75); return n; }
const bestAttackValue = (c) => Math.max(0, ...(c.atk || []).map(attackValue));
const costOf = (atk) => (atk.c || []).length;
/** How good a Pokémon is to have in front: its best attack, HP, and how close it is to affording the attack. */
function fighterScore(db, m) { const c = card(db, m); return bestAttackValue(c) * 2 + hpLeft(db, m) / 2 + Math.min(energyUnits(db, m), 4) * 8; }
/** Energy still needed for a Pokémon's best attack (0 if any attack is paid for). */
function energyGap(db, m) { const c = card(db, m); const have = energyUnits(db, m); const atks = (c.atk || []).slice().sort((a, b) => attackValue(b) - attackValue(a)); if (!atks.length) return 0; return Math.max(0, costOf(atks[0]) - have); }
/* ---------- choosing a move ----------
   Main phase: try each move on a copy of the game (coin flips use the bot's own practice seeds, never the real one),
   then score the position after the best way to finish the turn (attack or pass). Take the move if it beats finishing now.
   The score only looks at the board, prize counts and hand/deck sizes, never at hidden cards. */
const SEEDS = [11, 2027, 90001];
const term = (t) => t === 'attack' || t === 'endTurn';
let turnBudget = { turn: -1, seat: null, n: 0 };
/** Run an action (answering any prompts the way the bot would) on a copy; null if the engine refuses it. */
function sim(g, a, seat, db, seed) {
  let action = { ...a, seat, seed, answers: [] }; delete action.name;
  for (let k = 0; k < 16; k++) {
    const r = apply(g, action, db);
    if (r.error) return null;
    if (r.prompt) { const ps = r.prompt.seat || seat; action = { ...action, answers: [...action.answers, botAnswer(r.prompt, g, ps, db)] }; continue; }
    return r.state;
  }
  return null;
}
const lite = (g) => ({ ...g, log: [] }); // the copies don't need the game log
const randomish = (a) => a.type === 'attack' || a.type === 'usePower' || a.type === 'useStadium' || a.type === 'playTrainer';
function avgSim(g, a, seat, db, n) {
  let tot = 0;
  for (let i = 0; i < n; i++) { const s = sim(g, a, seat, db, SEEDS[i]); if (!s) return null; tot += evalPos(s, seat, db); }
  return tot / n;
}
/** The best way to finish the turn from here: attack (each one, averaged over coin flips) or pass. */
function finishValue(g, seat, db, legal) {
  legal = legal || legalActions(g, seat, db);
  let best = -Infinity, act = null;
  for (const a of legal) {
    if (!term(a.type)) continue;
    const v = avgSim(g, a, seat, db, a.type === 'attack' ? 3 : 1); if (v == null) continue;
    if (v > best) { best = v; act = a; }
  }
  if (act == null) best = evalPos(g, seat, db);
  return { v: best, a: act };
}
/** Collapse moves that do the same thing (two Fire Energy onto the same Pokémon, two copies of Bill). */
function dedupe(g, seat, db, legal) {
  const p = P(g, seat); const nm = (id) => { const c = p.hand.find((x) => x.id === id); return c ? card(db, c).name : id; };
  const seen = new Set(); const out = [];
  for (const a of legal) { const k = JSON.stringify([a.type, a.card ? nm(a.card) : null, a.target || a.pokemon || null, a.power || null, a.index ?? null]); if (seen.has(k)) continue; seen.add(k); out.push(a); }
  return out;
}

export function botAction(g, seat, db, skip = new Set()) {
  const legal = legalActions(g, seat, db).filter((a) => !skip.has(key(a)));
  if (!legal.length) return null;
  const p = P(g, seat);
  const has = (t) => legal.filter((a) => a.type === t);
  const handCard = (id) => card(db, p.hand.find((c) => c.id === id));
  // setup: the best fighter in front, other Basics on the bench
  if (g.phase === 'setup') {
    const place = has('placeActive'); if (place.length) return place.sort((a, b) => setupScore(db, handCard(b.card)) - setupScore(db, handCard(a.card)))[0];
    const bench = has('placeBench'); if (bench.length && p.bench.length < 4) return bench[0];
    const done = has('setupDone'); if (done.length) return done[0];
    const mull = has('mulligan'); if (mull.length) return mull[0];
    return null;
  }
  // forced steps
  const prize = has('takePrize'); if (prize.length) return prize[0];
  const promote = has('promote');
  if (promote.length) {
    const lg = lite(g);
    return promote.map((a) => { const s = sim(lg, a, seat, db, 1); return { a, v: s ? evalPos(s, seat, db) : -1e9 }; }).sort((x, y) => y.v - x.v)[0].a;
  }
  const md = has('mulliganDraw'); if (md.length) return md.sort((a, b) => (b.n || 0) - (a.n || 0))[0];
  if (g.turn !== seat) return null;
  // main phase
  const lg = lite(g);
  if (turnBudget.turn !== g.turnNo || turnBudget.seat !== seat) turnBudget = { turn: g.turnNo, seat, n: 0 };
  const fin = finishValue(lg, seat, db, legal);
  if (turnBudget.n < 25) {
    let best = null, bestV = fin.v + 2;
    for (const a of dedupe(lg, seat, db, legal)) {
      if (term(a.type) || a.type === 'pickup') continue;
      const n = randomish(a) ? 2 : 1; let tot = 0, ok = true;
      for (let i = 0; i < n; i++) { const s = sim(lg, a, seat, db, SEEDS[i]); if (!s) { ok = false; break; } tot += s.winner ? evalPos(s, seat, db) : finishValue(s, seat, db).v; }
      if (!ok) continue; const v = tot / n;
      if (v > bestV) { bestV = v; best = a; }
    }
    if (best) { turnBudget.n++; return best; }
  }
  return fin.a || has('endTurn')[0] || null;
}
const setupScore = (db, c) => bestAttackValue(c) * 1.5 + (c.hp || 0) - ((c.atk || []).reduce((m, a) => Math.min(m, costOf(a)), 9) * 8);

/* ---------- scoring a position (for `seat`) ---------- */
export const W = { hand: 9, hEnergy: 12, hBasic: 14, hEvo: 30, hDraw: 12, hTrainer: 8, useful: 24, prize: 700, thrMe: 50, thrOp: 50, bench2: 90, bench3: 40, s1: 30, s2: 60, hp: 1.1, ...(globalThis.BOTW || {}) };
const STATUS_COST = { SLP: 25, PAR: 45, CNF: 25, PSN: 18, BRN: 18 };
/** Best damage `m` could do to `def` with the energy it has (+extra). */
function hitFor(g, db, m, def, extra) {
  if (!m || !def) return 0; const c = effectiveCard(g, db, m); const dc = db[def.c] || {}; const rr = R(g.rules); let best = 0;
  const have = energyUnits(db, m) + (extra || 0);
  for (const a of c.atk || []) {
    if (costOf(a) > have || (!extra && !canPay(db, g.rules, m, a.c))) continue;
    let d = attackValue(a); if (!d) continue;
    const t = (c.types || [])[0];
    if (t && (dc.wk || []).includes(t)) d = rr.weaknessBonus ? d + rr.weaknessBonus : d * 2;
    if (t && (dc.rs || []).includes(t)) d = Math.max(0, d - rr.resistanceAmount);
    best = Math.max(best, d);
  }
  return best;
}
const leftOf = (g, db, m) => monHP(db, m, g) - m.dmg;
/** KO threats between the Actives (with one more Energy each). Positive favours `seat`. */
function finishThreat(g, seat, db) {
  const me = P(g, seat), op = P(g, other(seat)); let v = 0;
  if (op.active && me.active && hitFor(g, db, op.active, me.active, 1) >= leftOf(g, db, me.active)) v -= W.thrMe;
  if (me.active && op.active && hitFor(g, db, me.active, op.active, 1) >= leftOf(g, db, op.active)) v += W.thrOp;
  return v;
}
function monValue(g, db, m, isActive) {
  const c = effectiveCard(g, db, m); const base = db[m.c] || {};
  if (base.st !== 'Pokémon') return 20; // a Trainer played as a Pokémon
  const left = Math.max(0, leftOf(g, db, m));
  const costs = (c.atk || []).map(costOf); const need = costs.length ? Math.max(...costs) : 0;
  const units = energyUnits(db, m); const useful = Math.min(units, need + (isActive ? 1 : 0));
  let v = 70 + left * W.hp + useful * W.useful + (units - useful) * 5 + (base.sub === 'Stage 2' ? W.s2 : base.sub === 'Stage 1' ? W.s1 : 0) + (scriptOf(m.c).powers ? 25 : 0) + bestAttackValue(c) * 0.5;
  if (isActive) { for (const s of m.st) v -= STATUS_COST[s] || 0; }
  return v;
}
function sideValue(g, db, p, mine) {
  let v = 0; mons(p).forEach((m) => { v += monValue(g, db, m, !!(p.active && m.id === p.active.id)); });
  const n = mons(p).length; v += n >= 2 ? W.bench2 : 0; v += n >= 3 ? W.bench3 : 0;
  v += mine ? handValue(g, db, p) : Math.min(p.hand.length, 8) * W.hand; if (p.deck.length < 6) v -= (6 - p.deck.length) * 45;
  return v;
}
/** What the cards in our own hand are worth (the bot knows its own hand, never the opponent's). */
function handValue(g, db, p) {
  let v = 0, en = 0; const inPlay = mons(p).map((m) => card(db, m).name); const room = p.bench.length < 5;
  for (const x of p.hand) {
    const c = card(db, x);
    if (isEnergy(c)) { en++; v += en <= 2 ? W.hEnergy : 4; }
    else if (isBasic(c)) v += room ? W.hBasic : 4;
    else if (isEvo(c)) v += inPlay.some((n) => evolutionNameMatches(g.rules, c.ev, n)) ? W.hEvo : 8;
    else v += /^(Bill|Professor Oak|Computer Search|Professor Elm)$/.test(c.name) ? W.hDraw : W.hTrainer;
  }
  return Math.min(v, 140);
}
export function evalPos(g, seat, db) {
  if (g.winner) return g.winner === seat ? 1e6 : -1e6;
  const me = P(g, seat), op = P(g, other(seat));
  const pend = (s) => g.pending.filter((t) => t.t === 'prize' && t.seat === s).reduce((n, t) => n + (t.n || 1), 0);
  const tMe = me.prizesTaken + pend(seat), tOp = op.prizesTaken + pend(other(seat));
  let v = (tMe - tOp) * W.prize;
  if (tMe >= 5) v += 300; if (tOp >= 5) v -= 300;
  v += sideValue(g, db, me, true) - sideValue(g, db, op, false);
  if (!op.active && !op.bench.length) v += 5000; if (!me.active && !me.bench.length) v -= 5000;
  v += finishThreat(g, seat, db);
  return v;
}
function findM(g, id) { for (const s of ['a', 'b']) for (const m of mons(P(g, s))) if (m.id === id) return m; return null; }
export const key = (a) => JSON.stringify({ ...a, seed: undefined, answers: undefined });

/* ---------- answering prompts ---------- */
export function botAnswer(prompt, g, seat, db) {
  const opts = prompt.options || []; if (!opts.length) return [];
  const min = prompt.min == null ? 1 : prompt.min, max = prompt.max == null ? 1 : prompt.max;
  const want = Math.max(min, Math.min(max, 1));
  const title = (prompt.title || '').toLowerCase(); const p = P(g, seat), opp = P(g, other(seat));
  const monOf = (k) => findM(g, k);
  const score = (o) => {
    const m = monOf(o.key); const c = o.cid ? card(db, o.cid) : null;
    if (m) {
      const mine = mons(p).some((x) => x.id === m.id);
      if (!mine) return 100 - hpLeft(db, m); // hit the weakest opposing Pokémon
      if (/switch|retreat|promote|new active|lure|pull|put in/.test(title)) return fighterScore(db, m);
      if (/attach|energy|rain dance|charge/.test(title)) return (p.active && m.id === p.active.id ? 50 : 0) + energyGap(db, m) * 10 + fighterScore(db, m) / 10;
      if (/heal|remove|cure|counter/.test(title)) return m.dmg;
      if (/damage|hit|discard|return|shuffle|knock/.test(title)) return -fighterScore(db, m); // sacrifice the weakest
      return fighterScore(db, m);
    }
    if (c) {
      const inHandOrDeck = /discard|trade|put .* on top|set aside|shuffle/.test(title) && !/take|choose|search|attach/.test(title);
      if (inHandOrDeck || /discard/.test(title)) { // throw away the least useful card
        if (isEnergy(c)) return 10 - Math.min(5, p.hand.filter((x) => isEnergy(card(db, x))).length);
        if (c.st === 'Trainer') return 4;
        if (isBasic(c)) return p.bench.length >= 3 ? 6 : 2;
        return 1;
      }
      // picking something to take or attach: what the board needs
      if (isEnergy(c)) return 5 + (p.active && energyGap(db, p.active) > 0 ? 6 : 0);
      if (isBasic(c)) return p.bench.length < 3 ? 9 : 3;
      if (isEvo(c)) return mons(p).some((m) => card(db, m).name === c.ev || (c.ev || '').endsWith(card(db, m).name)) ? 12 : 2;
      if (c.st === 'Trainer') return /Bill|Oak|Search|Breeder/.test(c.name) ? 7 : 4;
      return 3;
    }
    if (o.key === 'yes') return 5; if (o.key === 'no') return 1;
    const n = parseInt(o.key, 10); if (!isNaN(n)) return n; // draw-count style prompts: more is better
    return 0;
  };
  const sorted = opts.slice().sort((a, b) => score(b) - score(a));
  return sorted.slice(0, want).map((o) => o.key);
}
