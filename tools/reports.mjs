#!/usr/bin/env node
// Problem reports sent from the site's "Report a problem" button.
//   node tools/reports.mjs list [--all]        open reports, newest first (--all includes closed ones)
//   node tools/reports.mjs show <id>           the note, device, browser errors and the game log
//   node tools/reports.mjs close <id> [note]   mark it fixed / looked at
// `show` also saves the whole report as JSON (path printed) for replaying the game state.
// If the report comes from a table Claude is seated at and that game is still going, the other player's hidden
// cards (hand, deck, prizes) are left out, same as Claude's own player view.
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.API || 'https://cousinpoke.pages.dev/api';
const H = { 'content-type': 'application/json', 'user-agent': 'claude-reports' };
const ME = 'p_claude0000000001';
const [cmd, id, ...rest] = process.argv.slice(2);
const get = (p) => fetch(`${API}/${p}`, { headers: H }).then((r) => r.json());
const when = (t) => (t ? new Date(t).toLocaleString() : '?');

if (cmd === 'list' || !cmd) {
  const all = rest.includes('--all') || id === '--all';
  const rows = (await get('reports')).filter((r) => all || r.status !== 'closed');
  if (!rows.length) console.log(all ? 'No reports.' : 'No open reports.');
  for (const r of rows) console.log(`${r.id}  ${when(r.at)}  ${r.byName || '?'}${r.gameName ? ` @ ${r.gameName}` : ''}  [${r.status || 'open'}]\n    ${String(r.note || '').replace(/\s+/g, ' ').slice(0, 160)}`);
} else if (cmd === 'show' && id) {
  const r = await get(`reports/${id}`);
  if (!r || r.missing) { console.log('no such report'); process.exit(1); }
  let redacted = false;
  const g = r.game;
  if (g && g.state && g.seats && [g.seats.a, g.seats.b].some((s) => s && s.uid === ME)) {
    const live = g.id ? await get(`games/${g.id}`) : null;
    if (live && !live.missing && live.status !== 'done' && !(live.state && live.state.winner)) {
      const opp = g.seats.a.uid === ME ? 'b' : 'a'; const p = g.state.p && g.state.p[opp];
      if (p) { for (const z of ['hand', 'deck', 'prizes']) if (Array.isArray(p[z])) p[z] = `(${p[z].length} hidden)`; }
      g.fx = null; g.inflight = null; redacted = true;
    }
  }
  console.log(`== report ${r.id}  ${when(r.at)}  by ${r.byName || '?'} (${r.by})  [${r.status || 'open'}]`);
  console.log(`screen: ${r.screen}${r.gameName ? `  table: ${r.gameName} (${r.gameId})` : ''}`);
  console.log(`device: ${r.client ? `${r.client.w}x${r.client.h} @${r.client.dpr}x touch=${r.client.touch}  ${r.client.ua}` : '?'}`);
  console.log(`\nNOTE:\n${r.note}\n`);
  const errs = r.errors || [];
  console.log(`-- browser errors / toasts (${errs.length}):`);
  for (const e of errs) console.log(`  ${new Date(e.t).toLocaleTimeString()} [${e.kind}] ${e.msg.replace(/\n/g, '\n      ')}`);
  if (g) {
    const s = g.state;
    console.log(`\n-- table: mode=${g.mode} status=${g.status} winner=${g.winner || '-'}${s ? ` phase=${s.phase} turn=${s.turnNo} (${s.turn})` : ''}${redacted ? '  [opponent hidden cards left out: game still in progress]' : ''}`);
    const log = (s && s.log) || g.log || [];
    console.log(`-- last ${Math.min(60, log.length)} of ${log.length} log lines:`);
    for (const l of log.slice(-60)) console.log(`  T${l.turn ?? '?'} ${l.m}`);
  }
  if (r.deck) console.log(`\n-- deck open in the builder: ${r.deck.name} (${Object.values(r.deck.cards || {}).reduce((a, b) => a + b, 0)} cards)`);
  const dir = join(tmpdir(), 'poke-reports'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.id}.json`); writeFileSync(file, JSON.stringify(r, null, 1));
  console.log(`\nfull report saved: ${file}`);
} else if (cmd === 'close' && id) {
  const r = await get(`reports/${id}`);
  if (!r || r.missing) { console.log('no such report'); process.exit(1); }
  const { id: _i, version, ...data } = r;
  data.status = 'closed'; data.closedAt = Date.now(); if (rest.length) data.resolution = rest.join(' ');
  const out = await fetch(`${API}/reports/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ data, ifVersion: version }) }).then((x) => x.json());
  console.log(out.conflict ? 'changed meanwhile; try again' : `closed ${id}`);
} else {
  console.log('usage: node tools/reports.mjs list [--all] | show <id> | close <id> [note]');
}
