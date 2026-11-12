// Colossal Pokémon: the Arena's bosses. One giant Pokémon with a huge HP pool sits in the opponent's seat; it has no
// deck, hand or Prizes, attacks on a fixed pattern, and wins by Knocking Out enough of the player's Pokémon.
// The data (which Pokémon, HP, attacks) comes from arena-bosses.js, which is generated from a spreadsheet.
import { BOSSES, BOSS_RULES } from '../arena-bosses.js';
import { newGame, toMon, instId } from './state.js';
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
const dmgLabel = (a) => (a.flips ? `${a.dmg}×` : a.dmg ? String(a.dmg) : '');

/** The rules every Colossal Pokémon follows, as card text. */
export function colossalText(b, r = BOSS_RULES) {
  const lasts = Object.entries(r.conditions).filter(([, t]) => t > 0).map(([k]) => STATUS[k]);
  const never = Object.entries(r.conditions).filter(([, t]) => !t).map(([k]) => STATUS[k]);
  const out = [`Knock it Out to win. It wins when it has Knocked Out ${r.kos} of your Pokémon.`];
  out.push(`Each time it loses a sixth of its HP you take a Prize.`);
  if (r.parts) out.push(`Its Bench holds ${r.parts} weak points: any damage done to one is done to it${r.partBonus ? ` (plus ${r.partBonus})` : ''}, ignoring ${b.armor ? 'Weakness, Resistance and its armor' : 'Weakness and Resistance'}.`);
  if (lasts.length) out.push(`${lasts.join(', ')}: wears off after ${[...new Set(Object.values(r.conditions).filter(Boolean))].join(' or ')} of its turns.`);
  if (never.length) out.push(`It can't be ${never.join(' or ')}, moved, copied, or stopped from attacking.`);
  if (b.armor) out.push(`Armor: takes ${b.armor} less damage from each attack.`);
  if (b.thorns) out.push(`Strikes back: ${b.thorns} damage to any Pokémon that damages it with an attack.`);
  if (b.enrage) out.push(`Enraged at half HP: its attacks do ${b.enrage} more damage.`);
  return out.join(' ');
}

/** Adds the Colossal Pokémon (and their weak points) to a card database. They live in the set "boss", so nothing that
 *  lists real cards (deck builder, drafts, gold cards) ever picks them up. Their picture is the real card's. */
export function bossCards(db) {
  for (const b of BOSSES) {
    const src = db[b.card] || {};
    const art = { set: src.set, i: src.i };
    db[bossId(b.n)] = {
      id: bossId(b.n), set: 'boss', art, name: 'Colossal ' + b.name, st: 'Pokémon', sub: 'Basic', hp: b.hp, types: [b.type || (src.types || ['Colorless'])[0]],
      atk: b.attacks.map((a) => ({ n: a.name, c: [], d: dmgLabel(a), t: attackText(a) })), pw: [{ n: 'Colossal', t: colossalText(b) }],
      wk: b.wk ? [b.wk] : null, rs: b.rs ? [b.rs] : null, rc: 0, rar: 'Colossal', boss: b,
    };
    db[partId(b.n)] = { id: partId(b.n), set: 'boss', art, name: `Colossal ${b.name}'s weak point`, st: 'Pokémon', sub: 'Basic', hp: 0, types: ['Colorless'], atk: [], pw: null, wk: null, rs: null, rc: 0, rar: 'Colossal', bossPart: b.n,
      txt: `Damage done here is done to Colossal ${b.name} instead.` };
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
  p.active = m; p.bench = []; for (let i = 0; i < (r.parts || 0); i++) p.bench.push(toMon({ id: instId(rng), c: partId(n) }, 0));
  p.setupDone = true;
  g.boss = { seat: 'b', n, id: m.id, cid: bossId(n), step: 0, kos: 0, given: 0, seen: 0, r };
  g.log = [{ t: Date.now(), m: `${name} appears! ${b.hp} HP. Knock it Out before it Knocks Out ${r.kos} of your Pokémon. You go first: place your Basic Pokémon.` }];
  return g;
}
/** The attack it will use on its next turn. */
export function nextBossAttack(g, db) {
  if (!g.boss) return null; const b = db[g.boss.cid].boss; const idx = (b.pattern[g.boss.step % b.pattern.length] || 0) - 1; // 0 in the pattern is a turn spent gathering strength
  return { idx, atk: idx >= 0 ? b.attacks[idx] : null, card: idx >= 0 ? db[g.boss.cid].atk[idx] : null };
}
