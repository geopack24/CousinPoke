// Creates (or replaces) Claude's deck for a table on the live site without printing the list.
// Usage: node tools/new-match.mjs <gameId> <deckId> <deck name> < deck-list.json
// stdin: JSON array of [count, cardName, setId]. Only the size and validation result are printed.
import { readFileSync } from 'node:fs';
import { DEFAULT_RULES, validateDeck } from '../public/js/engine/rules.js';

const API = 'https://cousinpoke.pages.dev/api'; const H = { 'content-type': 'application/json', 'user-agent': 'claude-player' };
const ME = 'p_claude0000000001';
const [gid, deckId, deckName] = process.argv.slice(2);
const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const id = (name, set) => { const c = DATA.cards.find((x) => x.name === name && x.set === set); if (!c) throw new Error('no card ' + name + ' in ' + set); return c.id; };
const LIST = JSON.parse(readFileSync(0, 'utf8'));
const cards = {}; for (const [n, name, set] of LIST) cards[id(name, set)] = (cards[id(name, set)] || 0) + n;
const count = Object.values(cards).reduce((a, b) => a + b, 0);
const problems = validateDeck({ cards }, DEFAULT_RULES, DB).filter((x) => x.bad);
console.log('deck size', count, 'problems:', problems.length ? problems.map((p) => p.m).join('; ') : 'none');
if (count !== 60 || problems.length) process.exit(1);
const put = (path, data, ifVersion) => fetch(`${API}/${path}`, { method: 'PUT', headers: H, body: JSON.stringify({ data, ifVersion }) }).then((r) => r.json());
console.log('deck saved:', await put('decks/' + deckId, { owner: ME, name: deckName, cards, count, updatedAt: Date.now() }));
const g = await fetch(`${API}/games/${gid}`, { headers: H }).then((r) => r.json());
const { id: _i, version, ...data } = g; data.seats.b = { uid: ME, deckId, deckName }; data.updatedAt = Date.now();
console.log('table updated:', await put('games/' + gid, data, version));
