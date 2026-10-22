#!/usr/bin/env node
// Waits until Claude has something to do at a table, then exits (so a background run wakes Claude up).
//   node tools/wait-turn.mjs <gameId> [maxMinutes=60]
// "Something to do" = it's Claude's turn with nothing pending, a pending step is Claude's (prize, promote),
// a parked prompt is waiting for Claude's answer, the game is still in setup and Claude isn't ready, or the game ended.
// Prints one line about why it stopped. Polls every 5 seconds.
const API = 'https://cousinpoke.pages.dev/api';
const H = { 'user-agent': 'claude-player' };
const ME = 'p_claude0000000001';
const [gid, maxMin = '60'] = process.argv.slice(2);
if (!gid) { console.log('usage: node tools/wait-turn.mjs <gameId> [maxMinutes]'); process.exit(2); }
const until = Date.now() + Number(maxMin) * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reason(doc) {
  if (!doc || doc.missing) return 'table is gone';
  const seat = doc.seats.a.uid === ME ? 'a' : doc.seats.b.uid === ME ? 'b' : null;
  if (!seat) return null;
  const g = doc.state;
  if (!g) return doc.status === 'lobby' ? null : 'no game state';
  if (g.winner || doc.status === 'done') return `game over (winner ${g.winner || doc.winner})`;
  if (doc.inflight && doc.inflight.prompt && doc.inflight.prompt.seat === seat) return `prompt for me: ${doc.inflight.prompt.title}`;
  if (doc.inflight) return null; // the other player is answering something
  if (g.phase === 'setup') return g.p[seat].setupDone ? null : 'setup: my Pokémon to place';
  if (g.pending && g.pending.length) return g.pending[0].seat === seat ? `pending for me: ${g.pending[0].t}` : null;
  return g.turn === seat ? `my turn (turn ${g.turnNo})` : null;
}

while (Date.now() < until) {
  try {
    const doc = await fetch(`${API}/games/${gid}`, { headers: H }).then((r) => r.json());
    const why = reason(doc);
    if (why) { console.log(`READY ${gid}: ${why}`); process.exit(0); }
  } catch (e) { /* network blip: keep waiting */ }
  await sleep(5000);
}
console.log(`TIMEOUT ${gid}: still waiting after ${maxMin} minutes`);
