// Arena draft: pick 1 of 3 until the deck has 42 cards, then 18 basic Energy fill it to 60.
// Every card has a rarity tier (arena-tiers.js, from the spreadsheet); rarer tiers are offered less often.
// Only the top of each evolution line is offered; drafting an evolved Pokémon brings 2 copies of every card in its line.
// Pure functions (no page state) so the page, the tests and the simulator share them.
import { mulberry32 } from './engine/rng.js';
import { R } from './engine/rules.js';
import { TIERS, TIER_WEIGHTS } from './arena-tiers.js';

export const ARENA = { picksTo: 42, energy: 18, wins: 7, losses: 3, lineCopies: 2 };
/** Prize for a finished run, by wins: Tokens (index = wins). A perfect run also wins a gold card. */
export const ARENA_REWARDS = [0, 15, 30, 50, 75, 100, 150, 250];
const SETS = ['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2']; // no promos
const BASIC_TYPES = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting'];
// Not offered in the draft. Rainbow Energy: under the house rules any Energy already pays any cost.
const NOT_IN_DRAFT = new Set(['Rainbow Energy']);

/** Card signature: reprints (same name, HP, attacks, powers) count as one card. */
const sig = (c) => JSON.stringify([c.name, c.hp, c.sub, (c.atk || []).map((a) => [a.n, a.d, (a.c || []).length]), c.pw ? c.pw.n : null]);
const ord = (c) => SETS.indexOf(c.set) * 1000 + (parseInt(c.n, 10) || 0);

let CACHE = null;
/** The draftable pool: [{ key, cid, kind: 'line'|'basic'|'trainer'|'energy', cards: {cid: n}, size, names: {name: n} }] */
export function arenaPool(db, rules) {
  if (CACHE && CACHE.db === db) return CACHE.pool;
  const r = R(rules); const banned = new Set(r.banned || []);
  const all = Object.values(db).filter((c) => SETS.includes(c.set)).sort((a, b) => ord(a) - ord(b));
  // one printing per distinct card
  const uniq = []; const seen = new Set();
  for (const c of all) { const k = sig(c); if (seen.has(k)) continue; seen.add(k); uniq.push(c); }
  const mon = uniq.filter((c) => c.st === 'Pokémon');
  const evolvesInto = new Set(mon.filter((c) => c.ev).map((c) => c.ev));
  const byName = new Map(); for (const c of mon) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  /** The printing of a pre-evolution to use: same set if there is one, else the earliest. */
  const pre = (name, set) => { const l = byName.get(name); if (!l) return null; return l.find((c) => c.set === set) || l[0]; };
  const pool = [];
  for (const c of mon) {
    if (evolvesInto.has(c.name)) continue; // not the top of its line
    if (c.sub === 'Basic' || c.sub === 'Baby' || !c.ev) { pool.push(entry(c, 'basic', [c], 1)); continue; }
    const line = [c]; let cur = c; let ok = true;
    while (cur.ev) { const p = pre(cur.ev, cur.set); if (!p) { ok = false; break; } line.unshift(p); cur = p; if (line.length > 3) { ok = false; break; } }
    if (!ok || !(line[0].sub === 'Basic' || line[0].sub === 'Baby')) continue;
    pool.push(entry(c, 'line', line, ARENA.lineCopies));
  }
  for (const c of uniq) {
    if (c.st === 'Trainer' && !banned.has(c.name) && !/Stadium/.test(c.sub || '')) pool.push(entry(c, 'trainer', [c], 1));
    if (c.st === 'Energy' && c.sub !== 'Basic' && !banned.has(c.name) && !NOT_IN_DRAFT.has(c.name)) pool.push(entry(c, 'energy', [c], 1));
  }
  CACHE = { db, pool };
  return pool;
}
function entry(top, kind, line, copies) {
  const cards = {}; const names = {};
  for (const c of line) { cards[c.id] = (cards[c.id] || 0) + copies; names[c.name] = (names[c.name] || 0) + copies; }
  return { key: top.id, cid: top.id, kind, tier: TIERS[top.id] || 'C', cards, names, size: line.length * copies, line: line.map((c) => c.id) };
}

/** Copies of each name already in the drafted cards (basic Energy doesn't count). */
function nameCounts(cards, db) { const o = {}; for (const [cid, k] of Object.entries(cards || {})) { const c = db[cid]; if (c && !(c.st === 'Energy' && c.sub === 'Basic')) o[c.name] = (o[c.name] || 0) + k; } return o; }
export const draftedCount = (cards) => Object.values(cards || {}).reduce((a, b) => a + b, 0);
function fits(e, cards, db, rules) {
  const r = R(rules); const left = ARENA.picksTo - draftedCount(cards); if (e.size > left) return false;
  const have = nameCounts(cards, db);
  for (const [n, k] of Object.entries(e.names)) { const max = r.limits && r.limits[n] != null ? Math.min(r.limits[n], r.maxCopies) : r.maxCopies; if ((have[n] || 0) + k > max) return false; }
  return true;
}
const trainerCards = (cards, db) => Object.entries(cards || {}).reduce((n, [cid, k]) => n + ((db[cid] || {}).st === 'Pokémon' ? 0 : k), 0);
export function basicsIn(cards, db) { let n = 0; for (const [cid, k] of Object.entries(cards || {})) { const c = db[cid]; if (c && c.st === 'Pokémon' && (c.sub === 'Basic' || c.sub === 'Baby')) n += k; } return n; }

/**
 * The 3 choices for a round. Deterministic from (seed, round) so reloading never rerolls.
 * Each choice is a Pokémon about 60% of the time; the deck is steered toward enough Basics to play.
 */
export function makeOffer(db, seed, round, cards, rules) {
  const rng = mulberry32(((seed >>> 0) ^ Math.imul(round + 1, 2654435761)) >>> 0);
  const pool = arenaPool(db, rules).filter((e) => fits(e, cards, db, rules));
  const mons = pool.filter((e) => e.kind === 'line' || e.kind === 'basic');
  const left = ARENA.picksTo - draftedCount(cards); const basics = basicsIn(cards, db);
  const needMons = basics < 8 && left <= (8 - basics) * 3;
  // steer toward roughly 24 Pokémon and 18 Trainers: the more Pokémon cards drafted, the fewer Pokémon offered
  const drafted = draftedCount(cards); const monCards = drafted - trainerCards(cards, db);
  const pMon = drafted ? Math.max(0.15, Math.min(0.85, 0.5 + (24 / 42 - monCards / drafted) * 2.5)) : 0.6;
  const out = []; const used = new Set();
  const isMon = (e) => e.kind === 'line' || e.kind === 'basic';
  /**
   * One slot. The tier is rolled FIRST, by its weight alone (how many cards a tier holds never changes how often it
   * comes up); then a card is picked at random from that tier, a Pokémon or a Trainer as the deck needs when the
   * tier has both. `only` restricts the slot to Pokémon when the deck is short of Basics.
   */
  const take = (wantMon, only) => {
    const l = (only || pool).filter((e) => !used.has(e.key)); if (!l.length) return null;
    const by = {}; for (const e of l) (by[e.tier] = by[e.tier] || []).push(e);
    const tiers = Object.keys(by).filter((t) => (TIER_WEIGHTS[t] || 0) > 0).sort(); if (!tiers.length) return null;
    let roll = rng() * tiers.reduce((a, t) => a + TIER_WEIGHTS[t], 0); let tier = tiers[tiers.length - 1];
    for (const t of tiers) { roll -= TIER_WEIGHTS[t]; if (roll < 0) { tier = t; break; } }
    const kind = by[tier].filter((e) => isMon(e) === wantMon); const from = kind.length ? kind : by[tier];
    const e = from[Math.floor(rng() * from.length)]; used.add(e.key); return e;
  };
  for (let i = 0; i < 3; i++) {
    const wantMon = needMons || (i === 0 && monCards < 18) || rng() < pMon;
    const e = (needMons && take(true, mons)) || take(wantMon); if (e) out.push(e);
  }
  return out.map((e) => e.key);
}
export const poolEntry = (db, key, rules) => arenaPool(db, rules).find((e) => e.key === key) || null;
/** A card's tier letter: C, U, R, E or L. */
export const tierOf = (cid) => TIERS[cid] || 'C';

/** Add a pick to the drafted cards (returns a new object). */
export function addPick(db, cards, key, rules) {
  const e = poolEntry(db, key, rules); if (!e) throw new Error('not in the arena pool: ' + key);
  const out = { ...(cards || {}) }; for (const [cid, k] of Object.entries(e.cards)) out[cid] = (out[cid] || 0) + k; return out;
}

/** Split the 18 basic Energy between the types the drafted Pokémon use (by the coloured symbols in their attack costs). */
export function energySplit(db, cards) {
  const w = {};
  for (const [cid, k] of Object.entries(cards || {})) {
    const c = db[cid]; if (!c || c.st !== 'Pokémon') continue;
    for (const a of c.atk || []) for (const t of a.c || []) if (BASIC_TYPES.includes(t)) w[t] = (w[t] || 0) + k;
    if (!(c.atk || []).some((a) => (a.c || []).some((t) => BASIC_TYPES.includes(t)))) for (const t of c.types || []) if (BASIC_TYPES.includes(t)) w[t] = (w[t] || 0) + k;
  }
  let types = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!types.length) types = [['Fighting', 1]];
  const tot = types.reduce((a, [, v]) => a + v, 0);
  const out = {}; let given = 0;
  for (const [t, v] of types) { out[t] = Math.floor((ARENA.energy * v) / tot); given += out[t]; }
  for (let i = 0; given < ARENA.energy; i++, given++) out[types[i % types.length][0]]++;
  for (const t of Object.keys(out)) if (!out[t]) delete out[t];
  return out;
}
/** The basic Energy card id for a type (Base Set printing). */
export function energyId(db, type) { const c = Object.values(db).find((x) => x.st === 'Energy' && x.sub === 'Basic' && x.name === type + ' Energy' && x.set === 'base1') || Object.values(db).find((x) => x.st === 'Energy' && x.sub === 'Basic' && x.name === type + ' Energy'); return c && c.id; }
/** The finished 60-card deck: drafted cards plus the Energy. */
export function finalDeck(db, cards, split) {
  const out = { ...(cards || {}) }; for (const [t, k] of Object.entries(split || energySplit(db, cards))) { const id = energyId(db, t); if (id) out[id] = (out[id] || 0) + k; } return out;
}

/* ---------- the computer's draft ---------- */
const atkVal = (a) => { const n = parseInt(a.d, 10); if (isNaN(n)) return 10; if (/\+/.test(a.d)) return n + 15; if (/×|x/.test(a.d)) return Math.round(n * 1.4); return n; };
/** A rough value for a pick, used by the computer when it drafts. */
export function pickValue(db, e, cards) {
  const c = db[e.cid];
  if (e.kind === 'trainer') { const TOP = { 'Bill': 30, 'Professor Oak': 36, 'Computer Search': 30, 'Energy Removal': 34, 'Super Energy Removal': 34, 'Pokémon Breeder': 22, 'PlusPower': 24, 'Switch': 20, 'Item Finder': 16, 'Energy Retrieval': 18, 'Pokémon Trader': 18, 'Defender': 16, 'Potion': 12, 'Super Potion': 20, 'Pokémon Center': 18, 'Full Heal': 8, 'Rocket\'s Sneak Attack': 22, 'Nightly Garbage Run': 18, 'Challenge!': 12, 'The Boss\'s Way': 18, 'Professor Elm': 30, 'Erika': 16, 'Misty\'s Wish': 10 }; const draws = Object.entries(cards || {}).filter(([cid]) => /Bill|Oak|Computer Search|Elm/.test((db[cid] || {}).name || '')).reduce((a, [, k]) => a + k, 0); return (TOP[c.name] ?? 10) - (/Bill|Oak|Search|Elm/.test(c.name) ? draws * 2 : 0); }
  if (e.kind === 'energy') return c.name === 'Double Colorless Energy' ? 32 : 14;
  const best = Math.max(0, ...(c.atk || []).map(atkVal)); const pw = c.pw ? 18 : 0;
  const basics = basicsIn(cards, db);
  let v = best * 0.6 + (c.hp || 0) * 0.25 + pw + ({ L: 14, E: 9, R: 4 }[e.tier] || 0);
  if (e.kind === 'line') v -= (e.line.length - 1) * 6; // slower to set up
  if (e.kind === 'basic' && basics < 10) v += 10; // a deck needs Basics
  return v;
}
/** The computer drafts a whole deck. skill 0..1: how often it takes the best choice instead of a random one. */
export function botDraft(db, seed, skill, rules) {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0); let cards = {}; let round = 0;
  while (draftedCount(cards) < ARENA.picksTo && round < 80) {
    const offer = makeOffer(db, seed, round, cards, rules); if (!offer.length) break;
    const es = offer.map((k) => poolEntry(db, k, rules));
    const pick = rng() < skill ? es.slice().sort((a, b) => pickValue(db, b, cards) - pickValue(db, a, cards))[0] : es[Math.floor(rng() * es.length)];
    cards = addPick(db, cards, pick.key, rules); round++;
  }
  return finalDeck(db, cards);
}

/** Every card that can come in gold: each distinct Pokémon in the six sets (one printing of each). */
export function goldPool(db) {
  const seen = new Set(); const out = [];
  for (const c of Object.values(db).filter((x) => SETS.includes(x.set) && x.st === 'Pokémon').sort((a, b) => ord(a) - ord(b))) { const k = sig(c); if (seen.has(k)) continue; seen.add(k); out.push(c.id); }
  return out;
}
/** A random gold card the player doesn't own yet (null once they own them all). */
export function pickGold(db, owned, rnd = Math.random) {
  const have = new Set(owned || []); const left = goldPool(db).filter((id) => !have.has(id));
  return left.length ? left[Math.floor(rnd() * left.length)] : null;
}

/** Opponent titles by how many wins the run has. */
export const OPPONENTS = ['Youngster', 'Bug Catcher', 'Lass', 'Hiker', 'Ace Trainer', 'Gym Leader', 'Elite Trainer', 'Champion'];
/** How well the computer drafts against a run with this many wins. */
export const oppSkill = (wins) => Math.min(1, 0.25 + wins * 0.12);
