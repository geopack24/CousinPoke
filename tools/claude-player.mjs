#!/usr/bin/env node
// Claude's seat at an automated table. Talks to the live API and runs the same engine as the page.
//   node tools/claude-player.mjs start <gid>
//   node tools/claude-player.mjs view <gid>
//   node tools/claude-player.mjs act <gid> '<action json>' [--seed N] [--answers '<json array>']
//   node tools/claude-player.mjs answer <gid> '<answer json>'     (reply to a prompt parked for me)
// The opponent's hand and deck order are never printed.
import { readFileSync } from 'node:fs';
import { apply, legalActions, canAttack, STATUS_NAMES } from '../public/js/engine/engine.js';
import { newGame, other, mons } from '../public/js/engine/state.js';
import { randomSeed } from '../public/js/engine/rng.js';

const BASE = process.env.PT_BASE || 'https://cousinpoke.pages.dev/api/';
const ME = process.env.PT_PID || 'p_claude0000000001';
const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const nm = (x) => (DB[typeof x === 'string' ? x : x.c] || {}).name || '?';

async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'User-Agent': 'Mozilla/5.0 PokeTable-Claude' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const seatOf = (doc) => (doc.seats.a.uid === ME ? 'a' : doc.seats.b.uid === ME ? 'b' : null);

async function save(doc) {
  const { id, version, ...data } = doc; data.updatedAt = Date.now(); data.v = (data.v || 0) + 1;
  const r = await api('PUT', 'games/' + id, { data, ifVersion: version });
  if (r.conflict) { console.log('CONFLICT: the table changed; re-run view'); return false; }
  console.log('saved v' + r.version); return true;
}

function monStr(m) { const c = DB[m.c]; return `${nm(m)}#${m.id} ${c.hp - m.dmg}/${c.hp}hp st=${m.st.join(',') || '-'} en=[${[...m.en, ...m.tools].map(nm).join(', ')}]${m.un.length ? ' under=' + m.un.map(nm).join('>') : ''}${m.fx.length ? ' fx=' + m.fx.map((f) => f.k).join(',') : ''}`; }
function view(doc) {
  const g = doc.state; const me = seatOf(doc); const op = other(me);
  if (!g) { console.log(`== ${doc.name} | not started. seats:`, JSON.stringify(doc.seats)); return; }
  console.log(`== ${doc.name} | phase=${g.phase} turn ${g.turnNo} (${g.turn === me ? 'ME' : 'GEORGE'}) winner=${g.winner || '-'} pending=${JSON.stringify(g.pending)} inflight=${doc.inflight ? doc.inflight.prompt.seat + ':' + doc.inflight.prompt.title : '-'}`);
  for (const s of [op, me]) {
    const p = g.p[s]; console.log(`-- ${g.seats[s].name}${s === me ? ' (me)' : ''}: hand ${p.hand.length} deck ${p.deck.length} prizes ${p.prizes.length} discard[${p.discard.slice(-5).map(nm).join(', ')}]`);
    console.log('   active:', p.active ? monStr(p.active) : '-'); for (const m of p.bench) console.log('   bench :', monStr(m));
    if (s === me) console.log('   hand  :', p.hand.map((c) => `${nm(c)}#${c.id}`).join(', '));
  }
  console.log('-- log:'); for (const e of g.log.slice(-8)) console.log('  ', e.m);
  if (me) { const la = legalActions(g, me, DB); console.log('-- legal:', la.map((a) => a.type + (a.card ? ':' + nm(g.p[me].hand.find((c) => c.id === a.card) || { c: '' }) + '#' + a.card : '') + (a.target ? '->' + a.target : '') + (a.name ? ':' + a.name : '') + (a.power ? ':' + a.power : '')).join(' | ')); }
}

async function main() {
  const [cmd, gid, arg] = process.argv.slice(2);
  const doc = await api('GET', 'games/' + gid); if (doc.missing) { console.log('no such game'); return; }
  if (cmd === 'start') {
    const decks = {}; for (const s of ['a', 'b']) decks[s] = await api('GET', 'decks/' + doc.seats[s].deckId);
    const seats = {}; for (const s of ['a', 'b']) seats[s] = { uid: doc.seats[s].uid, name: s === 'b' ? 'Claude' : 'George', cards: decks[s].cards };
    doc.state = newGame({ rules: doc.rules, seats, seed: randomSeed() }); doc.status = 'playing'; doc.inflight = null; doc.log = [];
    await save(doc); return view(await api('GET', 'games/' + gid));
  }
  if (cmd === 'view') return view(doc);
  if (cmd === 'act' || cmd === 'answer') {
    const me = seatOf(doc); let action, answers = [];
    const flags = process.argv.slice(5); const seedIdx = flags.indexOf('--seed'); const ansIdx = flags.indexOf('--answers');
    if (cmd === 'answer') { if (!doc.inflight) { console.log('nothing to answer'); return; } action = { ...doc.inflight.action, answers: [...(doc.inflight.action.answers || []), JSON.parse(arg)] }; }
    else { action = { ...JSON.parse(arg), seat: me, seed: seedIdx >= 0 ? +flags[seedIdx + 1] : randomSeed(), answers: ansIdx >= 0 ? JSON.parse(flags[ansIdx + 1]) : [] }; }
    const r = apply(doc.state, action, DB);
    if (r.error) { console.log('RULE:', r.error); return; }
    if (r.prompt) {
      if (r.prompt.seat === me) { console.log(`PROMPT (re-run with --seed ${action.seed} --answers '${JSON.stringify([...action.answers, '<pick>'])}'):`, r.prompt.title, `min ${r.prompt.min} max ${r.prompt.max}`); for (const o of r.prompt.options) console.log('   ', o.key, '=', o.label); return; }
      doc.inflight = { action, prompt: r.prompt }; console.log('prompt parked for', r.prompt.seat, ':', r.prompt.title); await save(doc); return;
    }
    doc.prev = null; doc.state = r.state; doc.inflight = null; doc.status = r.state.status; if (r.state.winner) doc.winner = r.state.winner;
    console.log('events:', r.events.map((e) => e.t + (e.amount ? ':' + e.amount : '') + (e.heads != null ? ':' + (e.heads ? 'H' : 'T') : '')).join(' '));
    await save(doc); return view(doc);
  }
  console.log('commands: start | view | act | answer');
}
main().catch((e) => { console.error(e); process.exit(1); });
