// Computer against computer, to measure a change to the bot or to its decks.
//   node tools/bot-match.mjs [--games 40] [--a path/to/bot.js] [--b path/to/other-bot.js] [--decka key] [--deckb key] [--log] [--seed 1]
// Seat A is played by --a (default: public/js/bot.js) and seat B by --b (default: the same file). Each pair of games uses
// the same shuffle with the decks swapped between the seats, so who goes first and deck luck even out.
// With no decks given, every game picks two of the built-in decks at random. --log prints the first game's log.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { newGame } from '../public/js/engine/state.js';
import { apply } from '../public/js/engine/engine.js';
import { mulberry32 } from '../public/js/engine/rng.js';
import { DEFAULT_RULES } from '../public/js/engine/rules.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const flag = (k) => process.argv.includes('--' + k);
const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const load = (p) => import(p ? pathToFileURL(resolve(p)).href : new URL('../public/js/bot.js', import.meta.url).href);
const BOTS = { a: await load(arg('a')), b: await load(arg('b')) };
const DECKS = BOTS.a.BOT_DECKS; const KEYS = Object.keys(DECKS);

/** One game. who: which bot module plays seat a / b. Returns { winner, turns, ms, steps, log }. */
export function play({ who, decks, seed, first }) {
  const rng = mulberry32(seed);
  let g = newGame({ rules: DEFAULT_RULES, seats: { a: { uid: 'ua', name: 'A', cards: decks.a }, b: { uid: 'ub', name: 'B', cards: decks.b } }, seed, first });
  const skip = new Set(); let skipTurn = -1; let ms = 0, steps = 0, stuck = 0;
  const actor = () => { if (g.phase === 'setup') return !g.p.a.setupDone ? 'a' : 'b'; if (g.pending.length) return g.pending[0].seat; return g.turn; };
  while (!g.winner && g.turnNo < 300 && steps < 6000) {
    if (skipTurn !== g.turnNo) { skip.clear(); skipTurn = g.turnNo; }
    const s = actor(); const bot = who[s]; steps++;
    const t0 = performance.now(); let a = bot.botAction(g, s, DB, skip); ms += performance.now() - t0;
    if (!a) { if (g.phase === 'main' && g.turn === s && !g.pending.length) a = { type: 'endTurn' }; else if (++stuck > 20) break; else continue; }
    const { name, ...rest } = a; let action = { ...rest, seat: s, seed: (rng() * 0xFFFFFFFF) >>> 0 || 1, answers: [] }; let done = false;
    for (let i = 0; i < 20 && !done; i++) {
      const r = apply(g, action, DB);
      if (r.error) { skip.add(bot.key(action)); done = true; break; }
      if (r.prompt) { const ps = r.prompt.seat || s; const t1 = performance.now(); const ans = who[ps].botAnswer(r.prompt, g, ps, DB, action); ms += performance.now() - t1; action = { ...action, answers: [...action.answers, ans] }; continue; }
      g = r.state; done = true;
    }
    if (!done) skip.add(bot.key(action));
  }
  return { winner: g.winner, turns: g.turnNo, ms, steps, log: g.log.map((l) => l.m), prizes: [g.p.a.prizesTaken, g.p.b.prizesTaken] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const games = +arg('games', 40); const seed0 = +arg('seed', 1); const pick = mulberry32(seed0 * 7919);
  const tally = { a: 0, b: 0, draw: 0 }; const byDeck = {}; let ms = 0, steps = 0, turns = 0; const how = {};
  for (let i = 0; i < games; i += 2) {
    const ka = arg('decka') || KEYS[Math.floor(pick() * KEYS.length)], kb = arg('deckb') || KEYS[Math.floor(pick() * KEYS.length)];
    for (let leg = 0; leg < 2 && i + leg < games; leg++) {
      // second leg: the bots swap seats (and so decks and who goes first), same shuffle
      const who = leg ? { a: BOTS.b, b: BOTS.a } : { a: BOTS.a, b: BOTS.b };
      const r = play({ who, decks: { a: BOTS.a.botDeckCards(DB, ka), b: BOTS.a.botDeckCards(DB, kb) }, seed: seed0 * 1000 + i + 1 });
      const w = !r.winner ? 'draw' : (r.winner === 'a') === !leg ? 'a' : 'b'; tally[w]++; ms += r.ms; steps += r.steps; turns += r.turns;
      if (r.winner) { const wk = r.winner === 'a' ? ka : kb, lk = r.winner === 'a' ? kb : ka; (byDeck[wk] = byDeck[wk] || { w: 0, l: 0 }).w++; (byDeck[lk] = byDeck[lk] || { w: 0, l: 0 }).l++; }
      { const last = r.log[r.log.length - 1] || ''; const k = /last prize/.test(last) ? 'prizes' : /no Pokémon left/.test(last) ? 'no Pokémon left' : r.winner ? 'other' : 'unfinished'; how[k] = (how[k] || 0) + 1; }
      if (flag('log') && i === 0 && leg === 0) console.log(`--- ${ka} (A) v ${kb} (B)\n` + r.log.join('\n') + '\n---');
    }
  }
  console.log(`bot A ${tally.a} · bot B ${tally.b} · unfinished ${tally.draw}   (${games} games, ${(turns / games).toFixed(0)} turns a game, ${(ms / steps).toFixed(1)} ms a decision)`);
  console.log('games ended by: ' + Object.entries(how).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log(Object.entries(byDeck).sort((x, y) => y[1].w / (y[1].w + y[1].l) - x[1].w / (x[1].w + x[1].l)).map(([k, v]) => `${k} ${v.w}-${v.l}`).join('  '));
}
