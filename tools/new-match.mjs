// Creates Claude's new deck and a fresh automated table against George on the live site.
// Usage: node tools/new-match.mjs
import { readFileSync } from 'node:fs';
import { DEFAULT_RULES, validateDeck } from '../public/js/engine/rules.js';

const API = 'https://cousinpoke.pages.dev/api'; const H = { 'content-type': 'application/json', 'user-agent': 'claude-player' };
const ME = 'p_claude0000000001', GEORGE = 'p_7cbwwbkljgj9dvsp';
const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const id = (name, set) => { const c = DATA.cards.find((x) => x.name === name && x.set === set); if (!c) throw new Error('no card ' + name + ' in ' + set); return c.id; };

const LIST = [
  [4, 'Hitmonchan', 'base1'], [3, 'Electabuzz', 'base1'], [3, 'Scyther', 'base2'], [3, "Rocket's Zapdos", 'gym2'], [2, 'Mr. Mime', 'base2'], [2, 'Jigglypuff', 'base2'], [2, 'Wigglytuff', 'base2'],
  [4, 'Bill', 'base1'], [3, 'Professor Oak', 'base1'], [2, 'Computer Search', 'base1'], [2, 'Energy Removal', 'base1'], [2, 'Super Energy Removal', 'base1'], [3, 'PlusPower', 'base1'], [2, 'Switch', 'base1'], [1, 'Item Finder', 'base1'], [1, 'Defender', 'base1'],
  [4, 'Double Colorless Energy', 'base1'], [9, 'Fighting Energy', 'base1'], [8, 'Psychic Energy', 'base1'],
];
const cards = {}; for (const [n, name, set] of LIST) cards[id(name, set)] = (cards[id(name, set)] || 0) + n;
const count = Object.values(cards).reduce((a, b) => a + b, 0);
const problems = validateDeck({ cards }, DEFAULT_RULES, DB).filter((x) => x.bad);
console.log('deck size', count, 'problems:', problems.length ? problems.map((p) => p.m).join('; ') : 'none');
if (count !== 60 || problems.length) process.exit(1);

const put = (path, data, ifVersion) => fetch(`${API}/${path}`, { method: 'PUT', headers: H, body: JSON.stringify({ data, ifVersion }) }).then((r) => r.json());
const deckId = 'claude-haymaker-wave';
console.log('deck:', await put('decks/' + deckId, { owner: ME, name: 'Claude: Haymaker Wave', cards, count, updatedAt: Date.now() }));
const gid = 'vsclaude4';
console.log('table:', await put('games/' + gid, { name: 'George vs Claude: round 2', mode: 'auto', host: ME, createdAt: Date.now(), updatedAt: Date.now(), status: 'lobby', rules: { ...DEFAULT_RULES }, seats: { a: { uid: GEORGE, deckId: null, deckName: null }, b: { uid: ME, deckId, deckName: 'Claude: Haymaker Wave' } }, state: null, log: [{ t: Date.now(), m: 'Claude set up round 2. George: pick your deck and press Start.' }], v: 0 }));
