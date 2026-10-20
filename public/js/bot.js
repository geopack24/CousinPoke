// A practice opponent that plays a seat with the rules engine's own list of legal actions.
// The human opponent's browser runs it: botAction() picks the next move, botAnswer() answers the engine's prompts.
import { legalActions, energyUnits } from './engine/engine.js';
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
/** Trainers the computer knows when to play; anything else is played whenever it is legal. */
function wantsTrainer(db, g, seat, c, p, opp) {
  const n = c.name; const hand = p.hand; const active = p.active;
  if (n === 'Bill') return p.deck.length >= 3;
  if (n === 'Professor Oak') return hand.length <= 3 && p.deck.length >= 10;
  if (n === 'Computer Search') return hand.length >= 4 && p.deck.length >= 4;
  if (n === 'Item Finder') return false;
  if (n === 'PlusPower') return !!(active && legalActions(g, seat, db).some((a) => a.type === 'attack'));
  if (n === 'Defender') return !!(active && energyUnits(db, active) > 0);
  if (n === 'Energy Removal') return !!(opp.active && opp.active.en.length >= 1);
  if (n === 'Super Energy Removal') return !!(opp.active && opp.active.en.length >= 2 && mons(p).some((m) => m.en.length >= 2));
  if (n === 'Potion') return !!(active && active.dmg >= 20);
  if (n === 'Full Heal') return !!(active && active.st.length);
  if (n === 'Switch') return !!(active && active.st.some((s) => s === 'SLP' || s === 'PAR' || s === 'CNF') && p.bench.some((m) => energyUnits(db, m) >= 1));
  if (n === 'Pokémon Center') return mons(p).reduce((a, m) => a + m.dmg, 0) >= 60 && mons(p).reduce((a, m) => a + (m.dmg ? m.en.length : 0), 0) <= 2;
  if (n === 'Energy Retrieval') return p.discard.filter((x) => isEnergy(card(db, x))).length >= 2 && hand.length >= 2;
  if (n === 'Pokémon Breeder' || n === 'Pokémon Trader' || n === 'Pokémon Flute' || n === 'Maintenance') return true;
  if (/Stadium/.test(c.sub || '')) return !g.stadium;
  return true;
}

/* ---------- choosing a move ---------- */
export function botAction(g, seat, db, skip = new Set()) {
  const legal = legalActions(g, seat, db).filter((a) => !skip.has(key(a)));
  if (!legal.length) return null;
  const p = P(g, seat), opp = P(g, other(seat));
  const has = (t) => legal.filter((a) => a.type === t);
  const pick = (a) => a;
  // setup
  if (g.phase === 'setup') {
    const place = has('placeActive'); if (place.length) return pick(place.sort((a, b) => (card(db, p.hand.find((c) => c.id === b.card)).hp || 0) - (card(db, p.hand.find((c) => c.id === a.card)).hp || 0))[0]);
    const bench = has('placeBench'); if (bench.length) return pick(bench[0]);
    const done = has('setupDone'); if (done.length) return pick(done[0]);
    const mull = has('mulligan'); if (mull.length) return pick(mull[0]);
    return null;
  }
  // forced steps
  const prize = has('takePrize'); if (prize.length) return pick(prize[0]);
  const promote = has('promote'); if (promote.length) return pick(promote.sort((a, b) => fighterScore(db, findM(g, b.target)) - fighterScore(db, findM(g, a.target)))[0]);
  const md = has('mulliganDraw'); if (md.length) return pick(md.sort((a, b) => (b.n || 0) - (a.n || 0))[0]);
  if (g.turn !== seat) return null;
  // trainers worth playing now (draw first, then the rest)
  const trainers = has('playTrainer').map((a) => ({ a, c: card(db, p.hand.find((x) => x.id === a.card)) })).filter((t) => t.c.name !== 'PlusPower' && wantsTrainer(db, g, seat, t.c, p, opp));
  const draw = trainers.find((t) => /^(Bill|Professor Oak|Computer Search)$/.test(t.c.name)); if (draw) return pick(draw.a);
  // basics to the bench
  const basics = has('playBasic'); if (basics.length && p.bench.length < 4) return pick(basics.sort((a, b) => (card(db, p.hand.find((c) => c.id === b.card)).hp || 0) - (card(db, p.hand.find((c) => c.id === a.card)).hp || 0))[0]);
  // evolve (the Active first)
  const evos = has('evolve'); if (evos.length) return pick(evos.sort((a, b) => (p.active && b.target === p.active.id ? 1 : 0) - (p.active && a.target === p.active.id ? 1 : 0))[0]);
  // the other useful trainers
  if (trainers.length) return pick(trainers[0].a);
  // energy: the Active if it still needs some, else the strongest benched Pokémon that needs some
  const attaches = has('attach');
  if (attaches.length) {
    const targets = [...new Set(attaches.map((a) => a.target))].map((id) => findM(g, id)).filter(Boolean);
    const needy = targets.filter((m) => energyGap(db, m) > 0 || (p.active && m.id === p.active.id && !legal.some((a) => a.type === 'attack')));
    const order = (list) => list.sort((a, b) => (p.active && b.id === p.active.id ? 1000 : 0) + fighterScore(db, b) - ((p.active && a.id === p.active.id ? 1000 : 0) + fighterScore(db, a)));
    const tgt = order(needy.length ? needy : targets)[0];
    const energies = attaches.filter((a) => a.target === tgt.id);
    // prefer a Double Colorless where it helps most
    energies.sort((a, b) => (card(db, p.hand.find((c) => c.id === b.card)).name === 'Double Colorless Energy' ? 1 : 0) - (card(db, p.hand.find((c) => c.id === a.card)).name === 'Double Colorless Energy' ? 1 : 0));
    return pick(energies[0]);
  }
  // powers the computer understands
  const powers = has('usePower').filter((a) => /Rain Dance|Energy Trans|Energy Burn/.test(a.power)); if (powers.length) return pick(powers[0]);
  // retreat when the Active can't fight and a benched Pokémon can
  const attacks = has('attack');
  const retreats = has('retreat');
  if (!attacks.length && retreats.length && p.active) {
    const better = retreats.map((a) => findM(g, a.target)).filter((m) => m && energyGap(db, m) === 0 && hpLeft(db, m) > 20).sort((a, b) => fighterScore(db, b) - fighterScore(db, a))[0];
    if (better && fighterScore(db, better) > fighterScore(db, p.active) + 10) return pick(retreats.find((a) => a.target === better.id));
  }
  // PlusPower right before an attack that benefits
  if (attacks.length) {
    const pp = has('playTrainer').find((a) => card(db, p.hand.find((x) => x.id === a.card)).name === 'PlusPower');
    if (pp && opp.active) { const best = Math.max(...attacks.map((a) => attackValue(card(db, p.active).atk[a.index]))); if (best + 10 >= hpLeft(db, opp.active) || best >= 30) return pick(pp); }
    const c = card(db, p.active);
    const scored = attacks.map((a) => { const atk = c.atk[a.index]; let v = attackValue(atk); if (opp.active && v >= hpLeft(db, opp.active)) v += 50; if (/Self|itself/i.test(atk.t || '') && hpLeft(db, p.active) <= 30) v -= 20; return { a, v }; }).sort((x, y) => y.v - x.v);
    return pick(scored[0].a);
  }
  const end = has('endTurn'); if (end.length) return pick(end[0]);
  return null;
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
