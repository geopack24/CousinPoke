// Game state: a plain JSON object. Everything the engine needs lives here.
import { R } from './rules.js';
import { mulberry32, shuffleWith } from './rng.js';

let counter = 0;
export function instId(rng) {
  const n = Math.floor((rng ? rng() : Math.random()) * 0xFFFFFFF).toString(36);
  return n + (counter++).toString(36);
}

export const other = (s) => (s === 'a' ? 'b' : 'a');
export const P = (g, s) => g.p[s];
export const mons = (p) => [p.active, ...p.bench].filter(Boolean);
export const allMons = (g) => [...mons(g.p.a), ...mons(g.p.b)];
export function findMon(g, pid) {
  for (const s of ['a', 'b']) for (const m of mons(g.p[s])) if (m.id === pid) return { m, seat: s, p: g.p[s] };
  return null;
}
export function ownerOf(g, pid) { const f = findMon(g, pid); return f ? f.seat : null; }
export function toMon(card, turnNo) {
  return { id: card.id, c: card.c, dmg: 0, st: [], en: [], tools: [], un: [], fx: [], playedTurn: turnNo, evolvedTurn: -1, flags: {} };
}
export const monCards = (m) => [{ id: m.id, c: m.c }, ...m.un, ...m.en, ...m.tools];

/** Remove a card instance from wherever it is (hand/deck/discard/prizes/attached). Returns the card or null. */
export function pullCard(g, iid) {
  for (const s of ['a', 'b']) {
    const p = g.p[s];
    for (const z of ['hand', 'deck', 'discard', 'prizes']) {
      const i = p[z].findIndex((c) => c.id === iid); if (i >= 0) return p[z].splice(i, 1)[0];
    }
    for (const m of mons(p)) for (const z of ['en', 'tools', 'un']) {
      const i = m[z].findIndex((c) => c.id === iid); if (i >= 0) return m[z].splice(i, 1)[0];
    }
  }
  if (g.stadium && g.stadium.id === iid) { const c = g.stadium; g.stadium = null; return c; }
  return null;
}
export function locateCard(g, iid) {
  for (const s of ['a', 'b']) {
    const p = g.p[s];
    for (const z of ['hand', 'deck', 'discard', 'prizes']) { const c = p[z].find((c) => c.id === iid); if (c) return { seat: s, zone: z, card: c }; }
    for (const m of mons(p)) for (const z of ['en', 'tools', 'un']) { const c = m[z].find((c) => c.id === iid); if (c) return { seat: s, zone: z, card: c, mon: m }; }
  }
  return null;
}
export function removeMon(g, pid) {
  const f = findMon(g, pid); if (!f) return null;
  if (f.p.active && f.p.active.id === pid) f.p.active = null; else f.p.bench = f.p.bench.filter((x) => x.id !== pid);
  return f;
}
export function replaceMon(g, f, nm) {
  if (f.p.active && f.p.active.id === f.m.id) f.p.active = nm;
  else { const i = f.p.bench.findIndex((x) => x.id === f.m.id); if (i >= 0) f.p.bench[i] = nm; }
}

export function buildDeck(cards, rng) {
  const arr = [];
  for (const [cid, k] of Object.entries(cards || {})) for (let i = 0; i < k; i++) arr.push({ id: instId(rng), c: cid });
  return shuffleWith(rng, arr);
}

/** Create a fresh game. seats: {a:{uid,name,cards}, b:{...}} where cards is {cardId: count}. */
export function newGame({ rules, seats, seed, first }) {
  const r = R(rules); const rng = mulberry32(seed >>> 0);
  const g = {
    v: 2, rules: r, seed, status: 'setup', phase: 'setup', turn: null, turnNo: 0, first: null,
    seats: { a: { uid: seats.a.uid, name: seats.a.name }, b: { uid: seats.b.uid, name: seats.b.name } },
    p: {}, stadium: null, pending: [], log: [], winner: null, attacked: false, lastAttack: null, overrides: 0,
  };
  for (const s of ['a', 'b']) {
    const deck = buildDeck(seats[s].cards, rng);
    g.p[s] = {
      deck, hand: deck.splice(0, Math.min(r.handSize, deck.length)), prizes: deck.splice(0, Math.min(r.prizes, deck.length)),
      discard: [], active: null, bench: [], setupDone: false, mulligans: 0, mulliganCredits: 0,
      attachedThisTurn: false, retreatedThisTurn: false, prizesTaken: 0,
    };
  }
  g.first = first || (rng() < 0.5 ? 'a' : 'b');
  g.turn = g.first;
  g.log.push({ t: Date.now(), m: `Game on. Decks shuffled, ${r.handSize} cards dealt, ${r.prizes} prizes set aside. Coin flip: ${g.seats[g.first].name} goes first. Place your Basic Pokémon.` });
  return g;
}
