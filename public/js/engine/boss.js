// Colossal Pokémon: the Arena's bosses. One giant Pokémon with a huge HP pool sits in the opponent's seat; it has no
// deck, hand or Prizes, and wins by Knocking Out enough of the player's Pokémon. It gains Energy every turn; the
// Energy sits on its Bench (each one a target with a little HP) and its attacks use it up, in the order of a fixed pattern.
// The data (which Pokémon, HP, attacks) comes from arena-bosses.js, which is generated from a spreadsheet.
import { BOSSES, BOSS_RULES } from '../arena-bosses.js';
import { newGame, toMon, instId, P } from './state.js';
import { mulberry32 } from './rng.js';

export { BOSSES, BOSS_RULES };
export const bossId = (n) => 'boss-' + n;
export const partId = (n) => 'boss-' + n + '-part';
const STATUS = { PSN: 'Poisoned', BRN: 'Burned', PAR: 'Paralyzed', SLP: 'Asleep', CNF: 'Confused' };

/** What one of its attacks does, in a sentence (shown on the table and in the card text). */
export function attackText(a) {
  const out = [];
  if (a.flips) out.push(`Flip ${a.flips} coin${a.flips === 1 ? '' : 's'}: ${a.dmg} damage for each heads.`);
  if (a.bench) out.push(`Also does ${a.bench} damage to each of your Benched Pokémon.`);
  const maybe = a.chance === 'flip' ? 'Flip a coin. If heads, ' : '';
  const cap = (s) => (maybe ? maybe + s : s.charAt(0).toUpperCase() + s.slice(1));
  if (STATUS[a.effect]) out.push(cap(`your Active Pokémon is now ${STATUS[a.effect]}.`));
  else if (a.effect === 'energy') out.push(cap('discard an Energy card from your Active Pokémon.'));
  else if (a.effect === 'heal') out.push(cap(`it heals ${a.amount || 0} damage from itself.`));
  else if (a.effect === 'switch') out.push(cap('you must switch your Active Pokémon with one from your Bench.'));
  return out.join(' ');
}
const costOf = (a) => Math.max(0, a.cost == null ? 1 : a.cost);
const rule = (r, k, d) => (r && r[k] != null ? r[k] : d);
const dmgLabel = (a) => (a.flips ? `${a.dmg}×` : a.dmg ? String(a.dmg) : '');

/** The rules every Colossal Pokémon follows, as card text. */
export function colossalText(b, r = BOSS_RULES) {
  const lasts = Object.entries(r.conditions).filter(([, t]) => t > 0).map(([k]) => STATUS[k]);
  const never = Object.entries(r.conditions).filter(([, t]) => !t).map(([k]) => STATUS[k]);
  const out = [`Knock it Out to win. It wins when it has Knocked Out ${r.kos} of your Pokémon.`];
  if (!r.wr) out.push(`Weakness and Resistance don't count in this fight, for either side.`);
  out.push(`Each time it loses a sixth of its HP you take a Prize.`);
  out.push(`Energy: it starts with ${rule(r, 'energyStart', 0) || 'none'} and gains ${rule(r, 'energyPerTurn', 1)} at the start of each of its turns (up to ${rule(r, 'energyMax', 5)}). Its Energy sits on its Bench with ${rule(r, 'energyHP', 20)} HP each, and each attack uses up its Energy cost. While it is charging it uses its basic attack, which costs nothing. Destroy or discard its Energy to hold its big attacks back.`);
  if (lasts.length) out.push(`${lasts.join(', ')}: wears off after ${[...new Set(Object.values(r.conditions).filter(Boolean))].join(' or ')} of its turns.`);
  if (never.length) out.push(`It can't be ${never.join(' or ')}, moved, copied, or stopped from attacking.`);
  if (b.armor) out.push(`Armor: takes ${b.armor} less damage from each attack.`);
  if (b.thorns) out.push(`Strikes back: ${b.thorns} damage to any Pokémon that damages it with an attack.`);
  if (b.enrage) out.push(`Enraged at half HP: its attacks do ${b.enrage} more damage.`);
  return out.join(' ');
}

/** Adds the Colossal Pokémon (and their Energy) to a card database. They live in the set "boss", so nothing that
 *  lists real cards (deck builder, drafts, gold cards) ever picks them up. Their picture is the real card's. */
export function bossCards(db) {
  for (const b of BOSSES) {
    const src = db[b.card] || {};
    const art = { set: src.set, i: src.i }; const type = b.type || (src.types || ['Colorless'])[0];
    // its Energy looks like the basic Energy of its type (a Double Colorless for a Colorless boss)
    const all = Object.values(db); const ec = all.find((c) => c.st === 'Energy' && c.set === 'base1' && c.name === type + ' Energy') || all.find((c) => c.st === 'Energy' && c.name === 'Double Colorless Energy') || {};
    db[bossId(b.n)] = {
      id: bossId(b.n), set: 'boss', art, name: 'Colossal ' + b.name, st: 'Pokémon', sub: 'Basic', hp: b.hp, types: [type], part: partId(b.n),
      atk: b.attacks.map((a) => ({ n: a.name, c: Array(costOf(a)).fill('Colorless'), d: dmgLabel(a), t: `${costOf(a) ? `Uses up ${costOf(a)} Energy.` : 'Costs no Energy: it uses this on every turn it is still charging.'} ${attackText(a)}`.trim() })), pw: [{ n: 'Colossal', t: colossalText(b) }],
      wk: BOSS_RULES.wr && b.wk ? [b.wk] : null, rs: BOSS_RULES.wr && b.rs ? [b.rs] : null, rc: 0, rar: 'Colossal', boss: b,
    };
    db[partId(b.n)] = { id: partId(b.n), set: 'boss', art: { set: ec.set, i: ec.i }, name: `Colossal ${b.name}'s Energy`, st: 'Pokémon', sub: 'Basic', hp: rule(BOSS_RULES, 'energyHP', 20), types: ['Colorless'], atk: [], pw: null, wk: null, rs: null, rc: 0, rar: 'Colossal', bossPart: b.n, en: ec.id,
      txt: `One of Colossal ${b.name}'s Energy. Knock it Out or discard it and the Energy is gone.` };
  }
  return db;
}

/** One attack of a Colossal Pokémon. ctx is the engine context of the attack action. */
function bossAttack(ctx, m, a, b) {
  const { g, db } = ctx; const hp = db[m.c].hp;
  const rage = b.enrage && m.dmg * 2 >= hp ? b.enrage : 0;
  let hit = a.dmg || 0;
  if (a.flips) { const h = ctx.flips(a.flips, a.name); ctx.log(`${h} heads`); hit *= h; }
  if (hit) ctx.damage(hit + rage);
  if (a.bench) ctx.benchDamage(ctx.oppSeat, a.bench);
  if (!a.effect || (a.chance === 'flip' && !ctx.flip(a.name))) return;
  const d = ctx.opp.active;
  if (STATUS[a.effect]) { if (d) ctx.status(a.effect); return; }
  if (a.effect === 'energy') { if (d && d.en.length) ctx.discardEnergy(d, [d.en[d.en.length - 1]]); return; }
  if (a.effect === 'heal') { ctx.heal(m, a.amount || 0); return; }
  if (a.effect === 'switch') {
    const op = ctx.opp; if (!op.bench.length || !op.active || op.active.dmg >= (db[op.active.c].hp || 0)) return;
    const k = ctx.chooseMon(`${a.name}: choose the Pokémon to switch in`, op.bench, { seat: ctx.oppSeat, id: 'oppswitch' });
    ctx.switchActive(ctx.oppSeat, k[0], a.name);
  }
}
/** Card scripts for the Colossal Pokémon (merged into the engine's script registry). */
export function bossScript(b) { const attacks = {}; for (const a of b.attacks) attacks[a.name] = { effect: (ctx, m) => bossAttack(ctx, m, a, b) }; return { attacks }; }
export function bossScripts() { const out = {}; for (const b of BOSSES) out[bossId(b.n)] = bossScript(b); return out; }

/** A game against Colossal Pokémon number n: the player in seat a (who goes first), the boss already in play in seat b. */
export function newBossGame({ rules, player, n, seed, uid, rulesOverride }) {
  const b = BOSSES.find((x) => x.n === n); if (!b) throw new Error('no such boss ' + n);
  const name = 'Colossal ' + b.name; const r = { ...BOSS_RULES, ...(rulesOverride || {}) };
  const g = newGame({ rules, seed, first: 'a', seats: { a: player, b: { uid, name, cards: {} } } });
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const p = g.p.b; const m = toMon({ id: instId(rng), c: bossId(n) }, 0);
  p.active = m; p.bench = []; p.setupDone = true;
  g.boss = { seat: 'b', n, id: m.id, cid: bossId(n), step: 0, kos: 0, given: 0, seen: 0, r };
  addEnergy(g, null, rng, rule(r, 'energyStart', 0));
  g.log = [{ t: Date.now(), m: `${name} appears! ${b.hp} HP. Knock it Out before it Knocks Out ${r.kos} of your Pokémon. You go first: place your Basic Pokémon.` }];
  return g;
}
/** The next attack of its pattern, and whether it has the Energy for it. `soon` = it will have it on its next turn. */
export function nextBossAttack(g, db) {
  if (!g.boss) return null; const b = db[g.boss.cid].boss; const idx = (b.pattern[g.boss.step % b.pattern.length] || 0) - 1; // 0 in the pattern is a turn it sits out
  const atk = idx >= 0 ? b.attacks[idx] : null; const have = g.p[g.boss.seat].bench.length; const cost = atk ? costOf(atk) : 0;
  const max = rule(g.boss.r, 'energyMax', 5); const gain = rule(g.boss.r, 'energyPerTurn', 1);
  // its basic attack: the strongest one that costs no Energy. It uses it on every turn it is still charging, so it never sits idle.
  let ji = -1; b.attacks.forEach((a, i) => { if (costOf(a) === 0 && (ji < 0 || (a.dmg || 0) > (b.attacks[ji].dmg || 0))) ji = i; });
  const ready = !!atk && have >= cost;
  return { idx, atk, card: idx >= 0 ? db[g.boss.cid].atk[idx] : null, have, cost, max, ready, soon: !!atk && Math.min(max, have + gain) >= cost,
    jab: ji >= 0 && ji !== idx ? { idx: ji, atk: b.attacks[ji], card: db[g.boss.cid].atk[ji] } : null, use: atk ? (ready ? idx : ji) : -1 };
}

/* ---------- its Energy ----------
   Each Energy is two things kept in step: a Pokémon-like card on its Bench (so attacks that hit the Bench can destroy
   it) and an Energy card attached to the Colossal Pokémon (so Energy Removal and attacks that discard Energy work). */
function addEnergy(g, db, rng, n) {
  const b = g.boss; const p = P(g, b.seat); const m = p.active; if (!m || m.id !== b.id) return 0;
  const max = Math.min(rule(b.r, 'energyMax', 5), g.rules.benchSize || 5); const pc = partId(b.n); let k = 0;
  for (; k < n && p.bench.length < max; k++) { const id = instId(rng); p.bench.push(toMon({ id, c: pc }, g.turnNo)); m.en.push({ id: id + 'e', c: (db && db[pc] && db[pc].en) || 'base1-96' }); }
  return k;
}
/** The start of its turn: it gains Energy. */
export function bossCharge(ctx) {
  const { g, db } = ctx; const k = addEnergy(g, db, ctx.rng, rule(g.boss.r, 'energyPerTurn', 1));
  if (k) { ctx.log(`${ctx.name(g.boss.seat)} gains ${k === 1 ? 'an Energy' : k + ' Energy'} (${P(g, g.boss.seat).bench.length})`); ctx.event({ t: 'bossenergy', n: P(g, g.boss.seat).bench.length }); }
}
/** Using an attack uses up its Energy cost: the most damaged Energy goes first. */
export function bossSpend(ctx, n) {
  const { g } = ctx; const p = P(g, g.boss.seat); const m = p.active; if (!m || n <= 0) return;
  const gone = p.bench.slice().sort((a, b) => b.dmg - a.dmg).slice(0, n).map((x) => x.id);
  p.bench = p.bench.filter((x) => !gone.includes(x.id)); m.en.length = Math.min(m.en.length, p.bench.length);
}
/** Keeps the two halves in step after anything happened: Energy discarded from it leaves its Bench (most damaged first),
 *  and an Energy Knocked Out on its Bench comes off it. */
export function bossEnergySync(ctx) {
  const { g } = ctx; const p = P(g, g.boss.seat); const m = p.active; if (!m || m.id !== g.boss.id) return;
  for (const x of p.bench) { x.st = []; x.fx = []; }
  if (m.en.length < p.bench.length) {
    const n = p.bench.length - m.en.length; const gone = p.bench.slice().sort((a, b) => b.dmg - a.dmg).slice(0, n).map((x) => x.id);
    p.bench = p.bench.filter((x) => !gone.includes(x.id)); ctx.log(`${ctx.name(g.boss.seat)} loses ${n === 1 ? 'an Energy' : n + ' Energy'} (${p.bench.length} left)`);
  } else if (m.en.length > p.bench.length) m.en.length = p.bench.length;
}
