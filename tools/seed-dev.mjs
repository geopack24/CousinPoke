// Seeds a ready-to-attack automated table on the local dev server for trying animations.
// Usage: node tools/seed-dev.mjs [apiBase]   (default http://localhost:8766/api)
import { readFileSync } from 'node:fs';
import { newGame } from '../public/js/engine/state.js';

const API = process.argv[2] || 'http://localhost:8766/api';
const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const byName = (n, set = 'base1') => DATA.cards.find((c) => c.name === n && c.set === set).id;
const A = 'p_testaaaa0001', B = 'p_testbbbb0002';
async function put(path, data) { const r = await fetch(`${API}/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'user-agent': 'seed' }, body: JSON.stringify({ data }) }); return r.json(); }

let ids = 0; const inst = (cid) => ({ id: 'c' + (++ids).toString(36), c: cid });
const mon = (cid, en = [], extra = {}) => ({ id: 'c' + (++ids).toString(36), c: cid, dmg: 0, st: [], en: en.map(inst), tools: [], un: [], fx: [], playedTurn: 0, evolvedTurn: -1, flags: {}, ...extra });
const deck = { [byName('Charmander')]: 4, [byName('Charmeleon')]: 3, [byName('Charizard')]: 2, [byName('Fire Energy')]: 20, [byName('Bill')]: 4, [byName('Pikachu')]: 4, [byName('Raichu')]: 2, [byName('Lightning Energy')]: 12, [byName('Electabuzz')]: 4, [byName('Potion')]: 5 };
const rules = { weaknessBonus: 10, resistanceAmount: 20 };
const g = newGame({ rules, seats: { a: { uid: A, name: 'Ann', cards: deck }, b: { uid: B, name: 'Bob', cards: deck } }, seed: 5, first: 'a' });
for (const s of ['a', 'b']) { const p = g.p[s]; p.setupDone = true; }
g.p.a.active = mon(byName('Charmander'), [byName('Fire Energy'), byName('Fire Energy'), byName('Fire Energy')]);
g.p.a.bench = [mon(byName('Electabuzz'), [byName('Lightning Energy'), byName('Lightning Energy')]), mon(byName('Pikachu'), [byName('Lightning Energy')])];
g.p.b.active = mon(byName('Pikachu'), [byName('Lightning Energy')], { dmg: 10 });
g.p.b.bench = [mon(byName('Electabuzz'), [byName('Lightning Energy')]), mon(byName('Charmander'), [byName('Fire Energy')])];
g.phase = 'main'; g.status = 'playing'; g.turnNo = 3; g.turn = 'a'; g.p.a.attachedThisTurn = false;

await put('players/' + A, { name: 'Ann', updatedAt: Date.now() });
await put('players/' + B, { name: 'Bob', updatedAt: Date.now() });
const doc = { name: 'FX test', mode: 'auto', rules, seats: { a: { uid: A, deckId: null, deckName: 'Fire' }, b: { uid: B, deckId: null, deckName: 'Fire' } }, state: g, status: 'playing', inflight: null, log: [], createdAt: Date.now(), updatedAt: Date.now(), v: 1 };
const r = await put('games/fxtest', doc);
console.log('seeded game fxtest', r, `\nopen http://localhost:8766/?pid=${A} (Ann) or ?pid=${B} (Bob)`);
