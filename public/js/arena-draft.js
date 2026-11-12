// Arena draft: 40 picks, each 1 of 3 cards or a basic Energy instead; every deck also gets 4 Bills, 1 Professor Oak and 15 basic Energy (60 in all).
// Every card has a rarity tier (arena-tiers.js, from the spreadsheet); rarer tiers are offered less often.
// Only the top of each evolution line is offered; drafting an evolved Pokémon brings 2 copies of every card in its line.
// Pure functions (no page state) so the page, the tests and the simulator share them.
import { mulberry32 } from './engine/rng.js';
import { R } from './engine/rules.js';
import { baseSpecies } from './engine/engine.js';
import { TIERS, TIER_WEIGHTS } from './arena-tiers.js';

export const ARENA = { picksTo: 40, bills: 4, oaks: 1, energy: 15, deck: 60, wins: 7, losses: 1, lineCopies: 2 }; // no lives: the first loss ends the run
/** The pick key for "take a basic Energy instead of one of the three cards". */
export const ENERGY_PICK = 'energy';
/** Prize for a finished run, by wins: Cousin Tokens (index = wins). A perfect run also wins a gold card. */
export const ARENA_REWARDS = [0, 15, 30, 50, 75, 100, 150, 250];
const SETS = ['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2']; // no promos
const BASIC_TYPES = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting'];
// Not offered in the draft. Rainbow Energy: under the house rules any Energy already pays any cost.
// Bill: every Arena deck is given 4 of them, so nobody has to spend picks on card draw.
const NOT_IN_DRAFT = new Set(['Rainbow Energy', 'Bill',
  // cards that do nothing against a Colossal Pokémon (it has no hand, deck or discard pile, and can't be put to sleep or moved)
  'Pokémon Flute', "Rocket's Sneak Attack", "The Rocket's Trap", 'Sleep!', "Erika's Perfume", 'Minion of Team Rocket', 'Tickling Machine', "Sabrina's Psychic Control",
  // cards that have the opponent draw cards: a Colossal Pokémon has no deck or hand
  'Erika', "Blaine's Quiz #1", "Blaine's Quiz #2", "Blaine's Quiz #3", "Misty's Duel", "Sabrina's Gaze",
  // Pokémon George took out as too strong against one huge Pokémon (Clefable takes its Clefairy with it)
  'Mr. Mime', 'Clefable', "Sabrina's Jynx"]);

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
  // species that evolve, whoever owns them: Blaine's Mankey has no "Blaine's Primeape", but a Mankey is still a pre-evolution
  const speciesEvolves = new Set(mon.filter((c) => c.ev).map((c) => baseSpecies(c.ev)));
  const byName = new Map(); for (const c of mon) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  /** The printing of a pre-evolution to use: same set if there is one, else the earliest. */
  const pre = (name, set) => { const l = byName.get(name); if (!l) return null; return l.find((c) => c.set === set) || l[0]; };
  const pool = [];
  for (const c of mon) {
    if (evolvesInto.has(c.name)) continue; // not the top of its line
    if (NOT_IN_DRAFT.has(c.name)) continue;
    if (c.sub === 'Basic' || c.sub === 'Baby' || !c.ev) { if (speciesEvolves.has(baseSpecies(c.name))) continue; pool.push(entry(c, 'basic', [c], 1)); continue; }
    const line = [c]; let cur = c; let ok = true;
    while (cur.ev) { const p = pre(cur.ev, cur.set); if (!p) { ok = false; break; } line.unshift(p); cur = p; if (line.length > 3) { ok = false; break; } }
    if (!ok || !(line[0].sub === 'Basic' || line[0].sub === 'Baby')) continue;
    pool.push(entry(c, 'line', line, ARENA.lineCopies));
  }
  for (const c of uniq) {
    if (c.st === 'Trainer' && !banned.has(c.name) && !NOT_IN_DRAFT.has(c.name) && !/Stadium/.test(c.sub || '')) pool.push(entry(c, 'trainer', [c], 1));
    if (c.st === 'Energy' && c.sub !== 'Basic' && !banned.has(c.name) && !NOT_IN_DRAFT.has(c.name)) pool.push(entry(c, 'energy', [c], 1));
  }
  CACHE = { db, pool };
  return pool;
}
/** Names a Trainer depends on: "…with Brock in its name" -> ['Brock']. Such a card is only offered once the deck has a matching Pokémon. */
const NEEDS = /(?:with|has|have|had|having)\s+"?((?:Lt\. Surge|[A-Z][a-z]+)(?:'s)?)"?\s+in\s+(?:its|their)\s+names?/g;
function needsOf(c) { if (c.st !== 'Trainer') return null; const w = [...new Set([...(c.txt || '').replace(/\s+/g, ' ').matchAll(NEEDS)].map((m) => m[1].replace(/'s$/, '')))]; return w.length ? w : null; }
function entry(top, kind, line, copies) {
  const cards = {}; const names = {};
  for (const c of line) { cards[c.id] = (cards[c.id] || 0) + copies; names[c.name] = (names[c.name] || 0) + copies; }
  return { key: top.id, cid: top.id, kind, tier: TIERS[top.id] || 'C', needs: needsOf(top), cards, names, size: line.length * copies, line: line.map((c) => c.id) };
}

/** Copies of each name already in the drafted cards (basic Energy doesn't count). */
function nameCounts(cards, db) { const o = {}; for (const [cid, k] of Object.entries(cards || {})) { const c = db[cid]; if (c && !(c.st === 'Energy' && c.sub === 'Basic')) o[c.name] = (o[c.name] || 0) + k; } return o; }
export const draftedCount = (cards) => Object.values(cards || {}).reduce((a, b) => a + b, 0);
function fits(e, cards, db, rules) {
  const r = R(rules); const left = ARENA.picksTo - draftedCount(cards); if (e.size > left) return false;
  // a Trainer that only works with "X's" Pokémon is no use until the deck has one
  if (e.needs && !Object.keys(cards || {}).some((cid) => { const c = db[cid]; return c && c.st === 'Pokémon' && e.needs.some((w) => c.name.includes(w)); })) return false;
  const have = nameCounts(cards, db); have['Professor Oak'] = (have['Professor Oak'] || 0) + ARENA.oaks; // the free Oak counts toward the 4-copy limit
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
  // steer toward roughly 24 Pokémon, the rest Trainers and any Energy taken (plus the 4 Bills): the more Pokémon cards drafted, the fewer Pokémon offered
  const drafted = draftedCount(cards); const monCards = drafted - trainerCards(cards, db);
  const pMon = drafted ? Math.max(0.15, Math.min(0.85, 0.5 + (24 / ARENA.picksTo - monCards / drafted) * 2.5)) : 0.6;
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
/** Can this pool entry be offered to a deck with these drafted cards? */
export const canOffer = (db, key, cards, rules) => { const e = arenaPool(db, rules).find((x) => x.key === key); return !!e && fits(e, cards, db, rules); };
export const poolEntry = (db, key, rules) => arenaPool(db, rules).find((e) => e.key === key) || null;
/** A card's tier letter: C, U, R, E or L. */
export const tierOf = (cid) => TIERS[cid] || 'C';

/** Add a pick to the drafted cards (returns a new object). */
export function addPick(db, cards, key, rules) {
  const e = poolEntry(db, key, rules); if (!e) throw new Error('not in the arena pool: ' + key);
  const out = { ...(cards || {}) }; for (const [cid, k] of Object.entries(e.cards)) out[cid] = (out[cid] || 0) + k; return out;
}

/* ---------- the reward for a win: swap one pick ----------
   After each boss the player is shown 3 cards and may swap one into the deck. It has to take the place of a pick of
   the same size: an evolution line for an evolution line of the same length (2 copies of each card), a single card
   for a single card. What leaves the deck is gone for good. */
/** The drafted cards taken apart into picks: evolution lines first (longest first), then every other card on its own.
 *  Each is { id, cid, size, cards }: id is the line's top card for a line, the card itself otherwise. */
export function deckUnits(db, cards, rules) {
  const left = { ...(cards || {}) }; const out = [];
  const lines = arenaPool(db, rules).filter((e) => e.kind === 'line').sort((a, b) => b.size - a.size);
  for (const e of lines) while (Object.entries(e.cards).every(([cid, k]) => (left[cid] || 0) >= k)) { for (const [cid, k] of Object.entries(e.cards)) left[cid] -= k; out.push({ id: e.key, cid: e.cid, size: e.size, cards: e.cards }); }
  for (const [cid, k] of Object.entries(left)) for (let i = 0; i < k; i++) out.push({ id: cid, cid, size: 1, cards: { [cid]: 1 } });
  return out;
}
function swapped(cards, e, u) {
  const out = { ...(cards || {}) };
  for (const [cid, k] of Object.entries(u.cards)) { out[cid] = (out[cid] || 0) - k; if (out[cid] <= 0) delete out[cid]; }
  for (const [cid, k] of Object.entries(e.cards)) out[cid] = (out[cid] || 0) + k;
  return out;
}
function swapLegal(db, next, e, rules) {
  const r = R(rules); if (basicsIn(next, db) < 1) return false;
  if (e.needs && !Object.keys(next).some((cid) => { const c = db[cid]; return c && c.st === 'Pokémon' && !e.cards[cid] && e.needs.some((w) => c.name.includes(w)); })) return false;
  const have = nameCounts(next, db); have['Professor Oak'] = (have['Professor Oak'] || 0) + ARENA.oaks;
  for (const n of Object.keys(e.names)) { const max = r.limits && r.limits[n] != null ? Math.min(r.limits[n], r.maxCopies) : r.maxCopies; if ((have[n] || 0) > max) return false; }
  return true;
}
/** What a card on offer could take the place of: the picks of the same size whose removal leaves a legal deck (one entry per distinct pick). */
export function swapOuts(db, cards, inKey, rules, units) {
  const e = poolEntry(db, inKey, rules); if (!e) return [];
  const seen = new Set(); const out = [];
  for (const u of units || deckUnits(db, cards, rules)) {
    if (u.size !== e.size || u.id === e.key || seen.has(u.id)) continue; seen.add(u.id);
    if (swapLegal(db, swapped(cards, e, u), e, rules)) out.push(u);
  }
  return out;
}
/** The 3 cards offered after win number n. Deterministic from (seed, n). Only cards that have something of their size
 *  to replace are in the pool: no Stage 2 line is offered to a deck without one. The tier is rolled first, as in the draft. */
export function makeSwapOffer(db, seed, n, cards, rules) {
  const rng = mulberry32(((seed >>> 0) ^ Math.imul(n + 101, 2246822519)) >>> 0);
  const units = deckUnits(db, cards, rules); const sizes = new Set(units.map((u) => u.size));
  const pool = arenaPool(db, rules).filter((e) => sizes.has(e.size) && swapOuts(db, cards, e.key, rules, units).length);
  const out = []; const used = new Set();
  for (let i = 0; i < 3; i++) {
    const l = pool.filter((e) => !used.has(e.key)); if (!l.length) break;
    const by = {}; for (const e of l) (by[e.tier] = by[e.tier] || []).push(e);
    const tiers = Object.keys(by).filter((t) => (TIER_WEIGHTS[t] || 0) > 0).sort(); if (!tiers.length) break;
    let roll = rng() * tiers.reduce((a, t) => a + TIER_WEIGHTS[t], 0); let tier = tiers[tiers.length - 1];
    for (const t of tiers) { roll -= TIER_WEIGHTS[t]; if (roll < 0) { tier = t; break; } }
    const e = by[tier][Math.floor(rng() * by[tier].length)]; used.add(e.key); out.push(e.key);
  }
  return out;
}
/** Swap `inKey` in for the pick `outId` (returns the new drafted cards). */
export function applySwap(db, cards, inKey, outId, rules) {
  const e = poolEntry(db, inKey, rules); const u = swapOuts(db, cards, inKey, rules).find((x) => x.id === outId);
  if (!e || !u) throw new Error("That swap isn't allowed");
  return swapped(cards, e, u);
}

/** Split the 18 basic Energy between the types the drafted Pokémon use (by the coloured symbols in their attack costs). */
export function energySplit(db, cards, total = ARENA.energy) {
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
  for (const [t, v] of types) { out[t] = Math.floor((total * v) / tot); given += out[t]; }
  for (let i = 0; given < total; i++, given++) out[types[i % types.length][0]]++;
  for (const t of Object.keys(out)) if (!out[t]) delete out[t];
  return out;
}
/** The basic Energy card id for a type (Base Set printing). */
export function energyId(db, type) { const c = Object.values(db).find((x) => x.st === 'Energy' && x.sub === 'Basic' && x.name === type + ' Energy' && x.set === 'base1') || Object.values(db).find((x) => x.st === 'Energy' && x.sub === 'Basic' && x.name === type + ' Energy'); return c && c.id; }
/** How many basic Energy have been drafted on top of the ones every deck is given. */
export function energyTaken(db, cards) { let n = 0; for (const [cid, k] of Object.entries(cards || {})) { const c = db[cid]; if (c && c.st === 'Energy' && c.sub === 'Basic') n += k; } return n; }
/** Take a basic Energy as this pick: one more of the type the deck's Pokémon use most. */
export function addEnergyPick(db, cards) {
  if (draftedCount(cards) >= ARENA.picksTo) throw new Error('The draft is over');
  const id = energyId(db, Object.keys(energySplit(db, cards))[0]); const out = { ...(cards || {}) }; out[id] = (out[id] || 0) + 1; return out;
}
/** Bill (Base Set): 4 come with every Arena deck. */
export function billId(db) { const c = Object.values(db).find((x) => x.name === 'Bill' && x.set === 'base1') || Object.values(db).find((x) => x.name === 'Bill'); return c && c.id; }
/** Professor Oak (Base Set): 1 comes with every Arena deck. */
export function oakId(db) { const c = Object.values(db).find((x) => x.name === 'Professor Oak' && x.set === 'base1') || Object.values(db).find((x) => x.name === 'Professor Oak'); return c && c.id; }
/**
 * The finished 60-card deck: drafted cards, the 4 Bills, the Energy, and the free Professor Oak
 * (pass {} as `split` for the deck without Energy yet). The Oak only goes in while there is room, so a run
 * drafted under an earlier, longer draft still comes to exactly 60.
 */
export function finalDeck(db, cards, split) {
  const out = { ...(cards || {}) }; const bill = billId(db); if (bill) out[bill] = (out[bill] || 0) + ARENA.bills;
  const energy = Object.values(split || energySplit(db, cards)).reduce((a, b) => a + b, 0);
  const oak = oakId(db); if (oak && draftedCount(out) + energy + ARENA.oaks <= ARENA.deck) out[oak] = (out[oak] || 0) + ARENA.oaks;
  for (const [t, k] of Object.entries(split || energySplit(db, cards))) { const id = energyId(db, t); if (id) out[id] = (out[id] || 0) + k; } return out;
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
    if (energyTaken(db, cards) < 4 && draftedCount(cards) >= 6 && rng() < 0.2) { cards = addEnergyPick(db, cards); round++; continue; }
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
