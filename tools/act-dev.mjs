// Apply one engine action to a table on the local dev server, as a given seat (for testing the other player's screen).
// Usage: node tools/act-dev.mjs <gameId> <seat a|b> '<action json>' [apiBase]
import { readFileSync } from 'node:fs';
import { apply } from '../public/js/engine/engine.js';
import { randomSeed } from '../public/js/engine/rng.js';

const [gid, seat, actionJson, apiBase] = process.argv.slice(2);
const API = apiBase || 'http://localhost:8766/api';
const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const H = { 'content-type': 'application/json', 'user-agent': 'act-dev' };
const doc = await fetch(`${API}/games/${gid}`, { headers: H }).then((r) => r.json());
const action = { answers: [], ...JSON.parse(actionJson), seat, seed: randomSeed() }; // answers may be passed in the action JSON
const r = apply(doc.state, action, DB);
if (r.error) { console.log('error:', r.error); process.exit(1); }
if (r.prompt) { console.log('prompt:', r.prompt.title, r.prompt.options.map((o) => o.key)); process.exit(1); }
const { id, version, ...data } = doc;
data.prev = null; data.state = r.state; data.inflight = null; data.status = r.state.status; if (r.state.winner) data.winner = r.state.winner;
data.fx = { id: Date.now().toString(36), events: r.events.filter((e) => ['attack', 'damage', 'heal', 'ko', 'flip', 'status', 'confused'].includes(e.t)) };
data.updatedAt = Date.now(); data.v = (data.v || 0) + 1;
const res = await fetch(`${API}/games/${gid}`, { method: 'PUT', headers: H, body: JSON.stringify({ data, ifVersion: version }) }).then((x) => x.json());
console.log('events:', r.events.map((e) => e.t + (e.amount ? ':' + e.amount : '')).join(' '), '| saved', JSON.stringify(res));
