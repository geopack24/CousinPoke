// Smoke test: run every scripted attack, power and trainer of the given sets with auto-answered prompts.
// Usage: node tools/smoke.mjs gym1 gym2
import { readFileSync } from 'node:fs';
import { newGame } from '../public/js/engine/state.js';
import { apply, legalActions } from '../public/js/engine/engine.js';
import { CARD_SCRIPTS } from '../public/js/engine/cards/index.js';

const DATA = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'));
const DB = Object.fromEntries(DATA.cards.map((c) => [c.id, c]));
const byName = (n, set = 'base1') => DATA.cards.find((c) => c.name === n && c.set === set).id;
const sets = process.argv.slice(2).length ? process.argv.slice(2) : ['gym1', 'gym2'];
let ids = 0; const inst = (cid) => ({ id: 'c' + (++ids).toString(36), c: cid });
const mon = (cid, en = [], extra = {}) => ({ id: 'c' + (++ids).toString(36), c: cid, dmg: 0, st: [], en: en.map(inst), tools: [], un: [], fx: [], playedTurn: 0, evolvedTurn: -1, flags: {}, ...extra });

function game(cid, opts = {}) {
  const g = newGame({ rules: { firstTurnAttack: true }, seats: { a: { uid: 'ua', name: 'Ann', cards: { [byName('Pikachu')]: 60 } }, b: { uid: 'ub', name: 'Bob', cards: { [byName('Pikachu')]: 60 } } }, seed: 7, first: 'a' });
  const filler = [byName('Bill'), byName('Fire Energy'), byName('Water Energy'), byName('Psychic Energy'), byName('Grass Energy'), byName('Lightning Energy'), byName('Chansey'), byName('Pikachu'), byName('Raichu'), byName('Potion')];
  for (const s of ['a', 'b']) { const p = g.p[s]; p.hand = []; p.deck = filler.concat(filler).map(inst); p.prizes = Array(6).fill(byName('Bill')).map(inst); p.discard = [byName('Fire Energy'), byName('Lightning Energy'), byName('Pikachu'), byName('Bill'), byName('Energy Removal')].map(inst); p.prizesTaken = 0; p.setupDone = true; }
  const c = DB[cid];
  if (c.st === 'Pokémon') {
    g.p.a.active = mon(cid, Array(5).fill(byName('Fire Energy')).concat(Array(2).fill(byName('Psychic Energy')), Array(2).fill(byName('Grass Energy')), Array(2).fill(byName('Water Energy')), Array(2).fill(byName('Lightning Energy'))), { dmg: 20 });
    g.p.a.bench = [mon(byName('Pikachu'), [byName('Lightning Energy')], { dmg: 10 }), mon(cid, [byName('Fire Energy')])];
    g.p.a.hand = [inst(byName('Grass Energy')), inst(byName('Fire Energy')), inst(byName('Raichu')), inst(byName('Bill'))];
  } else {
    g.p.a.active = mon(opts.active || byName('Chansey'), [byName('Fire Energy'), byName('Psychic Energy')], { dmg: 20 });
    g.p.a.bench = [mon(byName('Pikachu'), [byName('Lightning Energy')], { dmg: 10 }), mon(opts.bench || byName('Chansey'), [byName('Psychic Energy')])];
    g.p.a.hand = [inst(cid), inst(byName('Grass Energy')), inst(byName('Fire Energy')), inst(byName('Raichu')), inst(byName('Bill')), inst(byName('Water Energy'))];
  }
  g.p.b.active = mon(byName('Chansey'), [byName('Fire Energy'), byName('Water Energy')], { dmg: 30 });
  g.p.b.bench = [mon(byName('Pikachu'), [byName('Lightning Energy')], { dmg: 10 }), mon(byName('Raichu'), [], { dmg: 0 })];
  g.p.b.hand = [inst(byName('Bill')), inst(byName('Pikachu')), inst(byName('Fire Energy'))];
  g.phase = 'main'; g.status = 'playing'; g.turnNo = 3; g.turn = 'a'; g.p.a.attachedThisTurn = false;
  return g;
}

function runWithAutoAnswers(g, action, seed) {
  const answers = []; let r;
  for (let i = 0; i < 25; i++) {
    r = apply(g, { seat: 'a', seed, answers, ...action }, DB);
    if (!r.prompt) return r;
    const p = r.prompt; const min = p.min == null ? 1 : p.min; const pick = p.options.slice(0, Math.max(min, Math.min(1, p.max == null ? 1 : p.max))).map((o) => o.key);
    answers.push(pick);
  }
  return { error: 'prompt loop' };
}

let crashes = 0, ruleErrors = 0, runs = 0; const errs = {}; let ok = 0;
for (const c of DATA.cards.filter((c) => sets.includes(c.set) && CARD_SCRIPTS[c.id])) {
  const s = CARD_SCRIPTS[c.id];
  const actions = [];
  if (c.st === 'Pokémon') {
    (c.atk || []).forEach((a, i) => actions.push({ type: 'attack', index: i, name: a.n }));
    for (const pw of Object.keys(s.powers || {})) actions.push({ type: 'usePower', pokemon: 'ACTIVE', power: pw });
  } else if (c.st === 'Trainer') actions.push({ type: 'playTrainer', card: 'HAND0' });
  else if (c.st === 'Energy') actions.push({ type: 'attach', card: 'HAND0', target: 'ACTIVE' });
  for (const a of actions) for (const seed of [1, 2, 3, 5, 8]) {
    const g = game(c.id);
    const act = { ...a }; if (act.pokemon === 'ACTIVE') act.pokemon = g.p.a.active.id; if (act.target === 'ACTIVE') act.target = g.p.a.active.id; if (act.card === 'HAND0') act.card = g.p.a.hand[0].id;
    runs++;
    try {
      const r = runWithAutoAnswers(g, act, seed);
      if (r.error) errs[r.error] = (errs[r.error] || 0) + 1; else ok++;
      if (r.error && !/Already|Needs|can't|No |not enough|Not |must|Bench is full|Energy counts|Must be|You have|isn't|Already used|empty|Active isn't|Your Active/i.test(r.error)) { ruleErrors++; console.log(`RULE  ${c.id} ${c.name} / ${a.name || a.power || a.type} seed ${seed}: ${r.error}`); }
      else if (r.state) { JSON.stringify(r.state); legalActions(r.state, 'a', DB); legalActions(r.state, 'b', DB); }
    } catch (e) { crashes++; console.log(`CRASH ${c.id} ${c.name} / ${a.name || a.power || a.type} seed ${seed}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
  }
}
for (const [k, v] of Object.entries(errs).sort((x, y) => y[1] - x[1])) console.log(`  ${v}x ${k}`);
console.log(`${ok} ok, ${runs} runs, ${crashes} crashes, ${ruleErrors} unexpected rule errors`);
