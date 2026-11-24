// A practice opponent that plays a seat with the rules engine's own list of legal actions.
// The human opponent's browser runs it: botAction() picks the next move, botAnswer() answers the engine's prompts.
// How it thinks: every move it could make is tried on a copy of the game, the turn is finished the best way from there
// (each attack, or passing), the other player is given their best attack back, and the position that leaves is scored:
// prizes, damage as progress towards a prize, Energy where it is useful, and who Knocks Out whom next. Its own choices
// inside a move (which Pokémon to hit, which Energy to remove) are tried out the same way.
import { apply, legalActions, energyUnits, effectiveCard, canPay, monHP, scriptOf, evolutionNameMatches } from './engine/engine.js';
import { R } from './engine/rules.js';
import { P, other, mons } from './engine/state.js';

export const BOT_UID = 'p_bot000000000001';
export const BOT_NAME = 'Computer';

// Built-in decks the computer can play (count, card name, set). Created as deck documents when first used.
// They are built for the house rules: any Energy pays any cost (so Double Colorless everywhere), same-turn evolution,
// plenty of draw, and enough Basic Pokémon (11 or more) that the deck rarely runs out of Pokémon.
export const BOT_DECKS = {
  'bot-zard': { name: 'Computer: Charizard', list: [[4, 'Charmander', 'base1'], [3, 'Charmeleon', 'base1'], [4, 'Charizard', 'base1'], [3, 'Jigglypuff', 'base2'], [2, 'Wigglytuff', 'base2'], [2, 'Chansey', 'base1'], [2, 'Magmar', 'base3'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [2, 'Energy Retrieval', 'base1'], [2, 'Switch', 'base1'], [2, 'PlusPower', 'base1'], [4, 'Double Colorless Energy', 'base1'], [17, 'Fire Energy', 'base1']] },
  'bot-rain-dance': { name: 'Computer: Rain Dance', list: [[4, 'Squirtle', 'base1'], [3, 'Wartortle', 'base1'], [4, 'Blastoise', 'base1'], [2, 'Articuno', 'base3'], [2, 'Lapras', 'base3'], [3, 'Magikarp', 'base1'], [2, 'Gyarados', 'base1'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [2, 'Energy Retrieval', 'base1'], [2, 'Switch', 'base1'], [2, 'Energy Removal', 'base1'], [21, 'Water Energy', 'base1']] },
  'bot-haymaker': { name: 'Computer: Haymaker', list: [[4, 'Hitmonchan', 'base1'], [4, 'Electabuzz', 'base1'], [3, 'Scyther', 'base2'], [2, "Rocket's Zapdos", 'gym2'], [2, 'Chansey', 'base1'], [3, 'Jigglypuff', 'base2'], [2, 'Wigglytuff', 'base2'], [4, 'Bill', 'base1'], [3, 'Professor Oak', 'base1'], [2, 'Computer Search', 'base1'], [4, 'PlusPower', 'base1'], [2, 'Energy Removal', 'base1'], [2, 'Super Energy Removal', 'base1'], [2, 'Switch', 'base1'], [2, 'Defender', 'base1'], [4, 'Double Colorless Energy', 'base1'], [15, 'Fighting Energy', 'base1']] },
  'bot-thunder': { name: 'Computer: Thunderstorm', list: [[4, 'Zapdos', 'base1'], [2, "Rocket's Zapdos", 'gym2'], [4, 'Electabuzz', 'base1'], [3, 'Voltorb', 'base1'], [2, 'Electrode', 'base1'], [2, 'Chansey', 'base1'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [2, 'Energy Retrieval', 'base1'], [3, 'PlusPower', 'base1'], [2, 'Switch', 'base1'], [2, 'Energy Removal', 'base1'], [4, 'Double Colorless Energy', 'base1'], [17, 'Lightning Energy', 'base1']] },
  'bot-wave': { name: 'Computer: Do the Wave', list: [[4, 'Jigglypuff', 'base2'], [4, 'Wigglytuff', 'base2'], [3, 'Chansey', 'base1'], [3, 'Kangaskhan', 'base2'], [2, 'Lickitung', 'base2'], [2, 'Scyther', 'base2'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [4, 'PlusPower', 'base1'], [2, 'Switch', 'base1'], [2, 'Energy Removal', 'base1'], [2, 'Super Energy Removal', 'base1'], [4, 'Double Colorless Energy', 'base1'], [15, 'Grass Energy', 'base1']] },
  'bot-machamp': { name: 'Computer: Machamp', list: [[4, 'Machop', 'base1'], [3, 'Machoke', 'base1'], [3, 'Machamp', 'base1'], [4, 'Hitmonchan', 'base1'], [3, 'Diglett', 'base1'], [2, 'Dugtrio', 'base1'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [3, 'PlusPower', 'base1'], [2, 'Switch', 'base1'], [2, 'Energy Removal', 'base1'], [4, 'Double Colorless Energy', 'base1'], [17, 'Fighting Energy', 'base1']] },
  'bot-blaze': { name: "Computer: Blaine's Arcanine", list: [[4, "Blaine's Growlithe", 'gym1'], [4, "Blaine's Arcanine", 'gym2'], [3, 'Vulpix', 'base1'], [3, 'Ninetales', 'base1'], [3, 'Magmar', 'base3'], [2, 'Chansey', 'base1'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [3, 'Energy Retrieval', 'base1'], [2, 'Switch', 'base1'], [2, 'PlusPower', 'base1'], [4, 'Double Colorless Energy', 'base1'], [17, 'Fire Energy', 'base1']] },
  'bot-psychic': { name: 'Computer: Mewtwo and Gengar', list: [[4, 'Mewtwo', 'basep'], [3, "Rocket's Mewtwo", 'gym2'], [4, 'Gastly', 'base3'], [3, 'Haunter', 'base3'], [3, 'Gengar', 'base3'], [2, 'Mr. Mime', 'base2'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [2, 'Energy Retrieval', 'base1'], [2, 'Switch', 'base1'], [2, 'PlusPower', 'base1'], [2, 'Energy Removal', 'base1'], [4, 'Double Colorless Energy', 'base1'], [16, 'Psychic Energy', 'base1']] },
  'bot-garden': { name: 'Computer: Venusaur and Nidoking', list: [[4, 'Bulbasaur', 'base1'], [2, 'Ivysaur', 'base1'], [3, 'Venusaur', 'base1'], [4, 'Scyther', 'base2'], [3, 'Nidoran ♂', 'base1'], [2, 'Nidorino', 'base1'], [2, 'Nidoking', 'base1'], [4, 'Bill', 'base1'], [4, 'Professor Oak', 'base1'], [3, 'Computer Search', 'base1'], [2, 'Item Finder', 'base1'], [2, 'Switch', 'base1'], [2, 'PlusPower', 'base1'], [2, 'Energy Removal', 'base1'], [4, 'Double Colorless Energy', 'base1'], [17, 'Grass Energy', 'base1']] },
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
const COINS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
export function attackValue(atk) {
  const n = parseInt(atk.d, 10); const t = atk.t || '';
  if (isNaN(n)) return atk.n === 'Scrunch' || atk.n === 'Withdraw' || atk.n === 'Barrier' ? 5 : 10;
  if (/×|x/.test(atk.d)) { const m = /flip (\d+|a|one|two|three|four|five) coins?\b(?! until)/i.exec(t); return m ? Math.round(n * (COINS[m[1].toLowerCase()] || +m[1]) / 2) : Math.round(n * 1.5); }
  if (/\+/.test(atk.d)) return n + 10;
  if (/-/.test(atk.d)) return Math.round(n * 0.75);
  if (/if tails, this attack does nothing/i.test(t)) return Math.round(n / 2);
  return n;
}
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
let turnBudget = { turn: -1, seat: null, n: 0, used: {} };
/** What is on the table and in the piles, to tell whether a move changed anything. */
const print = (g) => ['a', 'b'].map((s) => { const p = P(g, s); return [p.hand.length, p.deck.length, p.discard.length, p.prizes.length, ...mons(p).map((m) => `${m.c}:${m.dmg}:${m.en.length}:${m.st.join('')}:${(m.tools || []).length}`)].join(','); }).join('|');
/** Run an action (answering any prompts the way the bot would) on a copy; null if the engine refuses it. */
function sim(g, a, seat, db, seed, think = 0) {
  const action = { ...a, seat, seed, answers: [] }; delete action.name;
  return complete(g, action, seat, db, think);
}
/** Carry an action through its prompts. `think` prompts deep, the acting player's own choices are tried each way and the
 *  one that leaves the best position is kept (which Pokémon to hit, which Energy to remove, what to search for); past
 *  that, and for the other player's choices, the first sensible answer the engine accepts is used. */
function complete(g, action, seat, db, think) {
  let alts = null; // other ways to answer the last prompt, for when the engine refuses the first (Fire Spin wants Energy worth 2)
  for (let k = 0; k < 30; k++) {
    const r = apply(g, action, db);
    if (r.error) { if (alts && alts.length) { action = { ...action, answers: [...action.answers.slice(0, -1), alts.shift()] }; continue; } return null; }
    if (!r.prompt) return r.state;
    const ps = r.prompt.seat || action.seat;
    if (think > 0 && ps === seat) {
      const wide = answerChoices(r.prompt, g, ps, db, true);
      if (wide.length > 1) {
        let best = null, bv = -Infinity;
        for (const ans of wide.slice(0, 8)) { const s = complete(g, { ...action, answers: [...action.answers, ans] }, seat, db, think - 1); if (!s) continue; const v = evalPos(s, seat, db); if (v > bv) { bv = v; best = s; } }
        if (best) return best; // (none worked: the prompt wants a combination, so answer it the plain way below)
      }
    }
    const c = answerChoices(r.prompt, g, ps, db, false);
    action = { ...action, answers: [...action.answers, c[0]] }; alts = c.slice(1);
  }
  return null;
}
const lite = (g) => ({ ...g, log: [] }); // the copies don't need the game log
const randomish = (a) => a.type === 'attack' || a.type === 'usePower' || a.type === 'useStadium' || a.type === 'playTrainer';
/** A basic Energy card id of the Pokémon's own type (any basic Energy if there is none), for guessing at an opponent's attachment. */
const ENERGY_ID = new Map();
function energyFor(db, m) {
  const t = (card(db, m).types || [])[0] || ''; if (ENERGY_ID.has(t)) return ENERGY_ID.get(t);
  const basics = Object.values(db).filter((c) => c.st === 'Energy' && c.sub === 'Basic');
  const hit = basics.find((c) => c.name === t + ' Energy') || basics[0]; ENERGY_ID.set(t, hit ? hit.id : null); return ENERGY_ID.get(t);
}
/** What a position is worth once the other player has answered it: they are given one more Energy on their Active (if they
 *  hold any cards) and take whichever attack is worst for us, or none. Their hand is never looked at. */
function replyValue(s, seat, db) {
  const opp = other(seat);
  if (s.winner || s.pending.length || s.turn !== opp || s.phase !== 'main') return evalPos(s, seat, db);
  let gv = s; const o = P(s, opp);
  if (o.active && o.hand.length && !o.attachedThisTurn) { const e = energyFor(db, o.active); if (e) gv = { ...s, p: { ...s.p, [opp]: { ...o, active: { ...o.active, en: [...o.active.en, { id: 'bot-guess', c: e }] } } } }; }
  let worst = evalPos(gv, seat, db, seat); // they do nothing, and it is our move again
  for (const a of legalActions(gv, opp, db)) {
    if (a.type !== 'attack') continue;
    let tot = 0, n = 0;
    for (let i = 0; i < 2; i++) { const r = sim(gv, a, opp, db, SEEDS[i]); if (r) { tot += evalPos(r, seat, db); n++; } }
    if (n && tot / n < worst) worst = tot / n;
  }
  return worst;
}
/** The best way to finish the turn from here: attack (each one, averaged over coin flips) or pass, each judged after the other player's answer. */
function finishValue(g, seat, db, legal, think) {
  legal = legal || legalActions(g, seat, db);
  let best = -Infinity, act = null;
  for (const a of legal) {
    if (!term(a.type)) continue;
    const n = a.type === 'attack' ? 3 : 1; let tot = 0, ok = true;
    const vals = [];
    for (let i = 0; i < n; i++) { const r = sim(g, a, seat, db, SEEDS[i], think || 0); if (!r) { ok = false; vals.push(null); break; } const rv = replyValue(r, seat, db); vals.push(rv); tot += rv; }
    if (globalThis.BOTFIN) globalThis.BOTFIN(a, vals);
    if (!ok) continue; const v = tot / n;
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
  // (tuning hooks: globalThis.BOTW overrides the weights below, BOTLOG / BOTFIN receive each move's score; see tools/bot-match.mjs)
  // a Colossal Pokémon doesn't think: it uses the next attack of its pattern
  if (g.boss && seat === g.boss.seat) return legal.find((a) => a.type === 'attack') || legal.find((a) => a.type === 'endTurn') || legal[0];
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
  if (turnBudget.turn !== g.turnNo || turnBudget.seat !== seat) turnBudget = { turn: g.turnNo, seat, n: 0, used: {} };
  const fin = finishValue(lg, seat, db, legal, 1);
  if (turnBudget.n < 25) {
    let best = null, bestV = fin.v + 2; const before = print(lg);
    for (const a of dedupe(lg, seat, db, legal)) {
      if (term(a.type) || a.type === 'pickupEnergy') continue;
      if (a.type === 'usePower' && (turnBudget.used[key(a)] || 0) >= 8) continue;
      const n = randomish(a) ? 2 : 1; let tot = 0, ok = true;
      for (let i = 0; i < n; i++) { const s = sim(lg, a, seat, db, SEEDS[i], 2); if (!s || (a.type === 'usePower' && print(s) === before)) { ok = false; break; } tot += (s.winner ? evalPos(s, seat, db) : finishValue(s, seat, db, null, 1).v) - (a.type === 'playTrainer' ? Math.max(0, P(s, seat).discard.length - p.discard.length - 1) * W.toss : 0); }
      if (!ok) continue; const v = tot / n;
      if (globalThis.BOTLOG) globalThis.BOTLOG(a, v, fin.v);
      if (v > bestV) { bestV = v; best = a; }
    }
    if (best) { turnBudget.n++; if (best.type === 'usePower') turnBudget.used[key(best)] = (turnBudget.used[key(best)] || 0) + 1; return best; }
  }
  return fin.a || has('endTurn')[0] || null;
}
const setupScore = (db, c) => bestAttackValue(c) * 1.5 + (c.hp || 0) - ((c.atk || []).reduce((m, a) => Math.min(m, costOf(a)), 9) * 8);

/* ---------- scoring a position (for `seat`) ---------- */
export const W = { hand: 9, hEnergy: 12, hBasic: 14, hEvo: 30, hDraw: 12, hTrainer: 8, useful: 24, ready: 0.5, prog: 250, toss: 9, prize: 700, ko: 0.8, dmg: 0.9, counter: 0.45, bench2: 90, bench3: 40, s1: 30, s2: 60, hp: 1.1, ...(globalThis.BOTW || {}) };
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
  if (m.st.includes('PAR')) return 0;
  if (m.st.includes('SLP') || m.st.includes('CNF')) best = Math.round(best / 2);
  return best;
}
const leftOf = (g, db, m) => monHP(db, m, g) - m.dmg;
/** The attack a Pokémon is in play for (its strongest; the cheaper of two equals) and what it costs. */
function mainAttack(c) { let q = 0, need = 0; for (const a of c.atk || []) { const v = attackValue(a); if (v > q || (v === q && costOf(a) < need)) { q = v; need = costOf(a); } } return { q, need }; }
function monValue(g, db, m, isActive) {
  const c = effectiveCard(g, db, m); const base = db[m.c] || {};
  if (base.st !== 'Pokémon') return 20; // a Trainer played as a Pokémon
  const left = Math.max(0, leftOf(g, db, m));
  const { q, need } = mainAttack(c); const units = energyUnits(db, m); const paid = Math.min(units, need);
  let v = 60 + left * W.hp + paid * W.useful + Math.max(0, units - need) * 5 + (base.sub === 'Stage 2' ? W.s2 : base.sub === 'Stage 1' ? W.s1 : 0) + (scriptOf(m.c).powers ? 25 : 0);
  v += q * (need ? paid / need : 1) * W.ready; // a charged attacker is worth more than the same Energy spread about
  const full = monHP(db, m, g) || 1; v -= W.prog * (isActive ? 1 : 0.55) * Math.min(1, m.dmg / full); // damage is progress towards a prize, most of all on the Active
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
/** Who moves next: the turn player, or the other one once this turn's attack (or its end) is only waiting on prizes and new Actives. */
const nextMover = (g) => (g.pending.length && (g.attacked || g.turnEnding) ? other(g.turn) : g.turn);
/** Energy the player to move can add to an attacker this turn: we know our own hand, and guess one for the opponent. */
function attachGuess(g, db, s, seat) {
  const p = P(g, s); if (p.attachedThisTurn && g.turn === s && !g.pending.length) return 0;
  if (s !== seat) return p.hand.length ? 1 : 0;
  let u = 0; for (const x of p.hand) { const c = card(db, x); if (isEnergy(c)) u = Math.max(u, /Double Colorless/.test(c.name) ? 2 : 1); } return u;
}
const bestOf = (g, db, p, def, extra) => { let b = null, bh = -1; for (const m of p.bench) { const h = def ? hitFor(g, db, m, def, extra) : fighterScore(db, m); if (h > bh) { bh = h; b = m; } } return b; };
/** The race between the Actives: what the player to move can do to the other side now, and what comes back. Positive favours `seat`. */
function race(g, seat, db, mover) {
  const M = P(g, mover), O = P(g, other(mover)); const sign = mover === seat ? 1 : -1;
  const def = O.active || bestOf(g, db, O, null, 0); if (!def) return 0;
  const exM = attachGuess(g, db, mover, seat); const att = M.active || bestOf(g, db, M, def, exM); if (!att) return 0;
  const hit = hitFor(g, db, att, def, exM); const left = leftOf(g, db, def); let v = 0, back = def;
  if (hit >= left) { v += W.ko * (W.prize + 0.5 * monValue(g, db, def, true)); back = bestOf(g, db, O, att, 1); }
  else v += hit * W.dmg;
  if (back) {
    const h2 = hitFor(g, db, back, att, back === def ? attachGuess(g, db, other(mover), seat) || 1 : 1);
    v -= W.counter * (h2 >= leftOf(g, db, att) ? W.ko * (W.prize + 0.5 * monValue(g, db, att, true)) : h2 * W.dmg);
  }
  return sign * v;
}
/** `mover`: who is to move in this position, when the caller knows better than the state does. */
export function evalPos(g, seat, db, mover) {
  if (g.winner) return g.winner === seat ? 1e6 : -1e6;
  const me = P(g, seat), op = P(g, other(seat));
  const pend = (s) => g.pending.filter((t) => t.t === 'prize' && t.seat === s).reduce((n, t) => n + (t.n || 1), 0);
  const tMe = me.prizesTaken + pend(seat), tOp = op.prizesTaken + pend(other(seat));
  let v = (tMe - tOp) * W.prize;
  if (tMe >= 5) v += 300; if (tOp >= 5) v -= 300;
  v += sideValue(g, db, me, true) - sideValue(g, db, op, false);
  if (!op.active && !op.bench.length) v += 300; if (!me.active && !me.bench.length) v -= 300;
  if (g.boss) { const bm = P(g, g.boss.seat).active; v += (seat === g.boss.seat ? -1 : 1) * ((bm ? bm.dmg : 0) * 3 - g.boss.kos * W.prize); } // against a Colossal Pokémon: damage on it, and the Knock Outs it has
  else if (g.phase === 'main') v += race(g, seat, db, mover || nextMover(g));
  return v;
}
function findM(g, id) { for (const s of ['a', 'b']) for (const m of mons(P(g, s))) if (m.id === id) return m; return null; }
export const key = (a) => JSON.stringify({ ...a, seed: undefined, answers: undefined });

/* ---------- answering prompts ---------- */
/** The answer to a prompt. Given the action being answered, the first choice the engine accepts is used: some prompts
 *  only take certain combinations (Fire Spin wants Energy worth 2, which one card may not be). */
export function botAnswer(prompt, g, seat, db, action) {
  const plain = answerChoices(prompt, g, seat, db, false);
  if (!action) return plain[0];
  let c = answerChoices(prompt, g, seat, db, true);
  if (c.length > 1) {
    // try each answer on a copy (with a practice coin, not the real one) and prefer the one that leaves the best position
    const rated = c.slice(0, 8).map((ans, i) => { let s = null; try { s = complete(lite(g), { ...action, seed: SEEDS[0], answers: [...(action.answers || []), ans] }, seat, db, 1); } catch (e) { s = null; } return { ans, i, v: s ? evalPos(s, seat, db) : null }; });
  if (rated.some((x) => x.v != null)) c = rated.filter((x) => x.v != null).sort((x, y) => y.v - x.v || x.i - y.i).map((x) => x.ans).concat(rated.filter((x) => x.v == null).map((x) => x.ans), c.slice(8));
  }
  for (const ans of c.concat(plain)) { let r; try { r = apply(g, { ...action, answers: [...(action.answers || []), ans] }, db); } catch (e) { r = { error: 'x' }; } if (!r.error) return ans; }
  return plain[0];
}
/** Ways to answer a prompt, best guess first: the options in order of preference, taken a likely number at a time, then
 *  other numbers. `wide`: for a single pick, list every different option (the caller will try them out). */
function answerChoices(prompt, g, seat, db, wide) {
  const opts = prompt.options || []; if (!opts.length) return [[]];
  const min = prompt.min == null ? 1 : prompt.min, max = Math.min(prompt.max == null ? 1 : prompt.max, opts.length);
  const title = (prompt.title || '').toLowerCase(); const p = P(g, seat), opp = P(g, other(seat));
  // giving something up: as little as allowed. Taking something: as much as allowed.
  const theirs = new Set(); for (const m of mons(opp)) { theirs.add(m.id); for (const e of m.en) theirs.add(e.id); for (const t of m.tools || []) theirs.add(t.id); }
  const cost = /discard|shuffle|return|put .* on top|lose/.test(title) && !/opponent|defending|draw/.test(title) && !opts.some((o) => theirs.has(o.key));
  const want = Math.min(max, Math.max(min, cost || max > 6 || /as many as you like|any number/.test(title) ? 1 : max));
  const monOf = (k) => findM(g, k);
  const score = (o) => {
    const m = monOf(o.key); const c = o.cid ? card(db, o.cid) : null;
    if (m) {
      const mine = mons(p).some((x) => x.id === m.id);
      if (!mine) return /energy/.test(title) ? energyUnits(db, m) * 20 + (opp.active && m.id === opp.active.id ? 30 : 0) : 100 - hpLeft(db, m); // Energy effects: the best-charged attacker. Otherwise the weakest
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
  const ranked = opts.slice().sort((a, b) => score(b) - score(a));
  const sorted = ranked.map((o) => o.key);
  if (wide && want === 1 && max >= 1) { // one pick: every different option, in order of preference (and "none", where that is allowed)
    const seenOpt = new Set(); const out = [];
    for (const o of ranked) { const k = findM(g, o.key) ? o.key : o.cid || o.label || o.key; if (seenOpt.has(k)) continue; seenOpt.add(k); out.push([o.key]); }
    if (min === 0) out.push([]);
    return out;
  }
  const out = [sorted.slice(0, want)]; const seen = new Set([want]);
  for (let n = want + 1; n <= max; n++) if (!seen.has(n)) { seen.add(n); out.push(sorted.slice(0, n)); }
  for (let n = want - 1; n >= min; n--) if (!seen.has(n)) { seen.add(n); out.push(sorted.slice(0, n)); }
  return out;
}
