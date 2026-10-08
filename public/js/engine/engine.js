// The rules engine. Pure functions over a JSON game state.
//
//   apply(state, action, db) -> { state, events, prompt? , error? }
//
// Actions carry a `seed` and an `answers` array. Card effects ask questions through
// ctx.choose(); when an answer is missing the engine stops, returns the prompt, and the
// caller re-submits the same action with the answer appended. Because every coin flip
// comes from the seeded RNG, the replay reproduces the same flips.
import { R, isBasicLike } from './rules.js';
import { mulberry32, shuffleWith } from './rng.js';
import { P, other, mons, allMons, findMon, toMon, monCards, pullCard, removeMon, replaceMon, instId } from './state.js';
import { CARD_SCRIPTS } from './cards/index.js';

export const STATUS_NAMES = { SLP: 'Asleep', CNF: 'Confused', PAR: 'Paralyzed', PSN: 'Poisoned' };
const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless'];

class NeedInput { constructor(prompt) { this.prompt = prompt; } }
class RuleError extends Error {}

const clone = (o) => JSON.parse(JSON.stringify(o));
export const nameOf = (db, cid) => (db[cid] ? db[cid].name : cid);

/* ---------- energy ---------- */
export function energyTypesOf(db, card) {
  const c = db[card.c];
  if (card.asEnergy) return [card.asEnergy.type, card.asEnergy.type]; // Buzzap Electrode
  if (!c || c.st !== 'Energy') return [];
  const s = CARD_SCRIPTS[c.id];
  if (s && s.energy) return s.energy;
  if (c.sub === 'Basic') { const t = TYPES.find((t) => c.name.startsWith(t)); return [t || 'Colorless']; }
  if (/Double Colorless/.test(c.name)) return ['Colorless', 'Colorless'];
  return ['Colorless'];
}
export function energyUnits(db, m) { return m.en.reduce((n, e) => n + energyTypesOf(db, e).length, 0); }
export function canPay(db, rules, m, cost) {
  cost = cost || [];
  if (!cost.length) return true;
  if (R(rules).colorlessCosts) return energyUnits(db, m) >= cost.length;
  const pool = []; for (const e of m.en) pool.push(...energyTypesOf(db, e));
  const need = cost.filter((t) => t !== 'Colorless'); let free = cost.length - need.length;
  for (const t of need) { const i = pool.indexOf(t); if (i < 0) return false; pool.splice(i, 1); }
  return pool.length >= free;
}

/* ---------- card helpers ---------- */
export function scriptOf(cid) { return CARD_SCRIPTS[cid] || {}; }
export function attackScript(cid, name) { const s = scriptOf(cid); return s.attacks && s.attacks[name]; }
export function powersActive(g, db) {
  // Muk's Toxic Gas and friends: any passive 'disablePowers' in play that is not asleep/confused/paralyzed.
  for (const m of allMons(g)) { const s = scriptOf(m.c); if (s.passive && s.passive.disablePowers && !conditioned(m)) return false; }
  return true;
}
export const conditioned = (m) => m.st.some((x) => x === 'SLP' || x === 'CNF' || x === 'PAR');
export function monHP(db, m) { const c = db[m.c]; return c && c.hp ? c.hp : 0; }
export function isDollLike(db, m) { return db[m.c] && db[m.c].st === 'Trainer'; }
export function stageOf(db, m) { const c = db[m.c]; return c.st === 'Pokémon' ? c.sub : 'Basic'; }
export function hasFx(m, k) { return m.fx.some((f) => f.k === k); }
export function fxOf(m, k) { return m.fx.filter((f) => f.k === k); }

/* ---------- legality ---------- */
function myTurn(g, seat) { return g.phase === 'main' && g.turn === seat && !g.pending.length && !g.winner; }
function canEvolveTarget(g, m, rules) {
  if (m.playedTurn >= g.turnNo) return false; // must have been in play since last turn (setup placements are turn 0)
  if (!R(rules).multiEvolve && m.evolvedTurn === g.turnNo) return false;
  return true;
}
export function evolvesFromName(db, cid) { return db[cid] && db[cid].ev; }
export function matchesEvolution(db, cardId, m) {
  const c = db[cardId]; const t = db[m.c];
  return !!(c && t && c.st === 'Pokémon' && c.ev && c.ev === t.name);
}
export function canAttack(g, seat, idx, db) {
  const r = R(g.rules); const p = P(g, seat); const m = p.active; if (!m) return { ok: false, why: 'No Active Pokémon' };
  if (!myTurn(g, seat)) return { ok: false, why: 'Not your turn' };
  if (g.attacked) return { ok: false, why: 'Already attacked this turn' };
  if (r.noAttackAfterRetreat && p.retreatedThisTurn) return { ok: false, why: 'You retreated this turn' };
  if (!r.firstTurnAttack && g.turnNo === 1 && g.turn === g.first) return { ok: false, why: 'No attacking on the first turn' };
  if (isDollLike(db, m)) return { ok: false, why: 'This card cannot attack' };
  if (m.st.includes('SLP')) return { ok: false, why: 'Asleep' };
  if (m.st.includes('PAR')) return { ok: false, why: 'Paralyzed' };
  const c = db[m.c]; const atk = (c.atk || [])[idx]; if (!atk) return { ok: false, why: 'No such attack' };
  if (!canPay(db, g.rules, m, atk.c)) return { ok: false, why: 'Not enough energy' };
  if (fxOf(m, 'noAttack').some((f) => f.attack === atk.n || !f.attack)) return { ok: false, why: `Can't use ${atk.n} this turn` };
  if (m.flags['used:' + atk.n] && attackScript(m.c, atk.n) && attackScript(m.c, atk.n).oncePerLife) return { ok: false, why: 'Already used' };
  const s = attackScript(m.c, atk.n);
  if (s && s.canUse) { const why = s.canUse({ g, db, seat, m, atk }); if (why) return { ok: false, why }; }
  return { ok: true };
}

/** Everything `seat` may do right now, as action templates. */
export function legalActions(g, seat, db) {
  const out = []; const r = R(g.rules); const p = P(g, seat); const op = P(g, other(seat));
  if (g.winner) return out;
  if (g.pending.length) {
    const t = g.pending[0];
    if (t.seat !== seat) return out;
    if (t.t === 'prize') { p.prizes.forEach((c, i) => out.push({ type: 'takePrize', index: i })); return out; }
    if (t.t === 'promote') { p.bench.forEach((m) => out.push({ type: 'promote', target: m.id })); return out; }
    if (t.t === 'mulliganDraw') { out.push({ type: 'mulliganDraw', n: 1 }); out.push({ type: 'mulliganDraw', n: 0 }); return out; }
    return out;
  }
  if (g.phase === 'setup') {
    if (p.setupDone) return out;
    const basics = p.hand.filter((c) => isBasicLike(db[c.c]));
    if (!basics.length && !p.active) { out.push({ type: 'mulligan' }); return out; }
    for (const c of basics) { if (!p.active) out.push({ type: 'placeActive', card: c.id }); else if (p.bench.length < r.benchSize) out.push({ type: 'placeBench', card: c.id }); }
    if (p.active) out.push({ type: 'setupDone' });
    return out;
  }
  if (!myTurn(g, seat)) return out;
  // hand cards
  for (const c of p.hand) {
    const card = db[c.c]; if (!card) continue;
    if (card.st === 'Energy' && !p.attachedThisTurn) for (const m of mons(p)) if (!isDollLike(db, m)) out.push({ type: 'attach', card: c.id, target: m.id });
    if (isBasicLike(card) && p.bench.length < r.benchSize) out.push({ type: 'playBasic', card: c.id });
    if (card.st === 'Pokémon' && card.sub !== 'Basic') for (const m of mons(p)) if (matchesEvolution(db, c.c, m) && canEvolveTarget(g, m, r)) out.push({ type: 'evolve', card: c.id, target: m.id });
    if (card.st === 'Trainer' && !isBasicLike(card)) {
      const s = scriptOf(c.c);
      if (!s.trainer) continue; // unscripted: use an override
      if (r.banned && r.banned.includes(card.name)) continue;
      if (s.canPlay && s.canPlay({ g, db, seat, card: c }) !== true) continue;
      out.push({ type: 'playTrainer', card: c.id });
    }
  }
  // powers
  if (powersActive(g, db)) for (const m of mons(p)) {
    const s = scriptOf(m.c); if (!s.powers) continue;
    for (const [name, pw] of Object.entries(s.powers)) {
      if (conditioned(m) && !pw.ignoreConditions) continue;
      if (pw.canUse && pw.canUse({ g, db, seat, m }) !== true) continue;
      out.push({ type: 'usePower', pokemon: m.id, power: name });
    }
  }
  if (p.active && isDollLike(db, p.active) && scriptOf(p.active.c).asPokemon && scriptOf(p.active.c).asPokemon.canDiscard) out.push({ type: 'discardDoll', pokemon: p.active.id });
  for (const m of p.bench) if (isDollLike(db, m) && scriptOf(m.c).asPokemon && scriptOf(m.c).asPokemon.canDiscard) out.push({ type: 'discardDoll', pokemon: m.id });
  // retreat
  if (p.active && p.bench.length && !p.retreatedThisTurn && !isDollLike(db, p.active) && !p.active.st.includes('SLP') && !p.active.st.includes('PAR')) {
    const rc = db[p.active.c].rc || 0;
    if (energyUnits(db, p.active) >= rc && !hasFx(p.active, 'noRetreat')) for (const m of p.bench) out.push({ type: 'retreat', target: m.id });
  }
  // attacks
  if (p.active) (db[p.active.c].atk || []).forEach((a, i) => { if (canAttack(g, seat, i, db).ok) out.push({ type: 'attack', index: i, name: a.n }); });
  out.push({ type: 'endTurn' });
  return out;
}

/* ---------- the action runner ---------- */
export function apply(state, action, db) {
  const g = clone(state); const rng = mulberry32((action.seed || 1) >>> 0);
  const events = []; let ai = 0; const answers = action.answers || [];
  const seat = action.seat;
  const ctx = makeCtx(g, db, rng, events, seat, () => (ai < answers.length ? answers[ai++] : undefined), action);
  try {
    runAction(ctx, action);
    return { state: g, events };
  } catch (e) {
    if (e instanceof NeedInput) return { state, events: [], prompt: e.prompt };
    if (e instanceof RuleError) return { state, events: [], error: e.message };
    throw e;
  }
}

function makeCtx(g, db, rng, events, seat, nextAnswer, action) {
  const ctx = {
    g, db, rng, events, seat, action, copying: false,
    get me() { return P(g, seat); }, get opp() { return P(g, other(seat)); }, get oppSeat() { return other(seat); },
    name: (s) => g.seats[s].name,
    log(m) { g.log.push({ t: Date.now(), turn: g.turnNo, m }); if (g.log.length > 300) g.log = g.log.slice(-300); },
    event(e) { events.push(e); },
    flip(label) { const h = rng() < 0.5; events.push({ t: 'flip', heads: h, label }); ctx.log(`Coin flip${label ? ' (' + label + ')' : ''}: ${h ? 'Heads' : 'Tails'}`); return h; },
    flips(n, label) { let k = 0; for (let i = 0; i < n; i++) if (ctx.flip(label)) k++; return k; },
    fail(msg) { throw new RuleError(msg); },
    /** Ask the acting player (or `forSeat`) to choose. Returns array of keys. */
    choose(prompt) {
      const min = prompt.min == null ? 1 : prompt.min, max = prompt.max == null ? 1 : prompt.max;
      if (prompt.options.length === 0) return [];
      if (prompt.options.length <= min && !prompt.ordered) return prompt.options.map((o) => o.key); // forced: never consumes an answer
      const a = nextAnswer();
      if (a === undefined) throw new NeedInput({ ...prompt, min, max, seat: prompt.seat || seat });
      const arr = Array.isArray(a) ? a : [a];
      const keys = new Set(prompt.options.map((o) => o.key));
      if (arr.some((k) => !keys.has(k)) || arr.length < min || arr.length > max) throw new RuleError('Invalid choice');
      return arr;
    },
    chooseOne(prompt) { return ctx.choose({ ...prompt, min: 1, max: 1 })[0]; },
    chooseMon(title, list, opts = {}) {
      const options = list.map((m) => ({ key: m.id, cid: m.c, label: `${nameOf(db, m.c)}${m.dmg ? ' · ' + m.dmg + ' dmg' : ''}` }));
      return ctx.choose({ id: opts.id || 'mon', title, options, min: opts.min == null ? 1 : opts.min, max: opts.max == null ? 1 : opts.max, seat: opts.seat });
    },
    chooseCards(title, cards, opts = {}) {
      const options = cards.map((c) => ({ key: c.id, cid: c.c, label: nameOf(db, c.c) }));
      return ctx.choose({ id: opts.id || 'cards', title, options, min: opts.min == null ? 1 : opts.min, max: opts.max == null ? 1 : opts.max, seat: opts.seat, hidden: opts.hidden, ordered: opts.ordered });
    },
    /* --- zones --- */
    draw(s, n) { const p = P(g, s); let k = 0; for (let i = 0; i < n; i++) { const c = p.deck.shift(); if (!c) break; p.hand.push(c); k++; } events.push({ t: 'draw', seat: s, n: k }); ctx.log(`${ctx.name(s)} drew ${k} card${k === 1 ? '' : 's'}`); return k; },
    shuffle(s) { shuffleWith(rng, P(g, s).deck); events.push({ t: 'shuffle', seat: s }); },
    discardFromHand(s, iid) { const c = pullCard(g, iid); P(g, s).discard.push(c); events.push({ t: 'discard', seat: s, card: c }); return c; },
    discardHand(s) { const p = P(g, s); const n = p.hand.length; p.discard.push(...p.hand); p.hand = []; ctx.log(`${ctx.name(s)} discarded ${n} card${n === 1 ? '' : 's'}`); },
    toHand(s, c) { P(g, s).hand.push(c); },
    /* --- damage & status --- */
    damage(amount, opts = {}) { const tgt = opts.target || ctx.opp.active; if (!tgt) return 0; return dealDamage(ctx, tgt, amount, { source: ctx.attacker, ...opts }); },
    selfDamage(amount) { return dealDamage(ctx, ctx.attacker, amount, { source: ctx.attacker, noWR: true, self: true }); },
    benchDamage(s, amount) { for (const m of P(g, s).bench) dealDamage(ctx, m, amount, { source: ctx.attacker, noWR: true, bench: true }); },
    status(code, target) { const tgt = target || ctx.opp.active; if (!tgt) return false; return applyStatus(ctx, tgt, code); },
    cure(m, codes) { m.st = m.st.filter((x) => codes ? !codes.includes(x) : false); delete m.flags.toxic; },
    heal(m, n) { const before = m.dmg; m.dmg = Math.max(0, m.dmg - (n == null ? m.dmg : n)); if (before !== m.dmg) { events.push({ t: 'heal', target: m.id, amount: before - m.dmg }); ctx.log(`${nameOf(db, m.c)} healed ${before - m.dmg}`); } },
    addFx(m, fx) { m.fx.push(fx); },
    /* --- attached cards --- */
    discardEnergy(m, cards) { const owner = findMon(g, m.id).seat; for (const c of cards) { pullCard(g, c.id); P(g, owner).discard.push(c); } events.push({ t: 'discardEnergy', target: m.id, n: cards.length }); ctx.log(`Discarded ${cards.map((c) => nameOf(db, c.c)).join(', ')} from ${nameOf(db, m.c)}`); },
    /** Player `s` picks `n` energy cards attached to m (optionally filtered) and discards them. Skipped when copying (Metronome). */
    requireDiscardEnergy(m, n, filter, label) {
      if (ctx.copying) return [];
      const pool = m.en.filter((e) => !filter || filter(e)); if (pool.length < n) ctx.fail('Not enough energy to discard');
      const keys = ctx.chooseCards(label || `Discard ${n} energy from ${nameOf(db, m.c)}`, pool, { min: n, max: n, id: 'discardEnergy' });
      const cards = pool.filter((e) => keys.includes(e.id)); ctx.discardEnergy(m, cards); return cards;
    },
    /* --- switching --- */
    switchActive(s, benchId, why) {
      const p = P(g, s); const i = p.bench.findIndex((x) => x.id === benchId); if (i < 0 || !p.active) return;
      const old = p.active; p.active = p.bench[i]; p.bench[i] = old;
      if (!R(g.rules).conditionsPersist) { old.st = []; delete old.flags.toxic; }
      events.push({ t: 'switch', seat: s, out: old.id, in: p.active.id });
      ctx.log(`${why || 'Switch'}: ${ctx.name(s)}'s ${nameOf(db, old.c)} to the bench, ${nameOf(db, p.active.c)} is now Active`);
    },
    searchDeck(s, title, filter, opts = {}) {
      const p = P(g, s); const pool = p.deck.filter((c) => !filter || filter(db[c.c], c)).sort((x, y) => nameOf(db, x.c).localeCompare(nameOf(db, y.c)));
      const keys = ctx.chooseCards(title, pool, { min: opts.min == null ? 0 : opts.min, max: opts.max == null ? 1 : opts.max, id: 'search' });
      const got = keys.map((k) => pullCard(g, k)); return got;
    },
    attacker: null, defender: null,
  };
  return ctx;
}

/* ---------- damage pipeline ---------- */
function dealDamage(ctx, target, amount, opts = {}) {
  const { g, db, events } = ctx; const src = opts.source; let dmg = amount;
  if (dmg <= 0) return 0;
  const tCard = db[target.c]; const sCard = src ? db[src.c] : null;
  const info = { target, source: src, base: amount, wr: false };
  if (!opts.noWR && sCard && sCard.types && !opts.bench && !opts.self) {
    const type = sCard.types[0];
    const wk = target.flags.wkOverride ? [target.flags.wkOverride] : (tCard.wk || []);
    const rs = target.flags.rsOverride ? [target.flags.rsOverride] : (tCard.rs || []);
    if (wk.includes(type)) { dmg *= 2; info.wr = 'weak'; }
    if (rs.includes(type)) { dmg = Math.max(0, dmg - 30); info.wr = 'resist'; }
  }
  if (src && !opts.self && !opts.bench && target === ctx.opp.active) dmg += 10 * fxOf(src, 'plusPower').length;
  if (!opts.self) dmg = Math.max(0, dmg - 20 * fxOf(target, 'defender').length);
  // prevention effects on the target
  if (!opts.self) {
    if (hasFx(target, 'preventAll') || hasFx(target, 'preventDamage')) { ctx.log(`${nameOf(db, target.c)}: damage prevented`); return 0; }
    if (hasFx(target, 'preventSmall') && dmg <= 30) { ctx.log(`${nameOf(db, target.c)}: damage prevented (Harden)`); return 0; }
    const ps = scriptOf(target.c).passive;
    if (ps && ps.preventDamage && powersActive(g, db) && !conditioned(target) && ps.preventDamage({ ctx, target, amount: dmg, info })) { ctx.log(`${nameOf(db, target.c)}: damage prevented`); return 0; }
  }
  if (dmg <= 0) return 0;
  target.dmg += dmg; target.flags.lastHit = { amount: dmg, turn: g.turnNo };
  events.push({ t: 'damage', target: target.id, amount: dmg, wr: info.wr, self: !!opts.self });
  const owner = findMon(g, target.id); ctx.log(`${dmg} damage to ${owner ? ctx.name(owner.seat) + "'s " : ''}${nameOf(db, target.c)}${info.wr === 'weak' ? ' (weakness)' : info.wr === 'resist' ? ' (resistance)' : ''} (now ${target.dmg})`);
  // Machamp-style counter damage
  const ps = scriptOf(target.c).passive;
  if (ps && ps.onDamaged && src && !opts.self && !opts.bench && powersActive(g, db) && !conditioned(target)) ps.onDamaged({ ctx, target, source: src, amount: dmg });
  return dmg;
}
function applyStatus(ctx, target, code) {
  const { db } = ctx;
  if (isDollLike(db, target) && scriptOf(target.c).asPokemon && scriptOf(target.c).asPokemon.noConditions) return false;
  if (hasFx(target, 'preventAll')) return false;
  if (code !== 'PSN') target.st = target.st.filter((x) => x === 'PSN');
  if (!target.st.includes(code)) target.st.push(code);
  ctx.events.push({ t: 'status', target: target.id, code });
  ctx.log(`${nameOf(db, target.c)} is now ${STATUS_NAMES[code]}`);
  return true;
}

/* ---------- actions ---------- */
function runAction(ctx, a) {
  const { g, db, seat } = ctx; const r = R(g.rules); const p = P(g, seat);
  if (g.winner && a.type !== 'override') ctx.fail('The game is over');
  const must = (cond, msg) => { if (!cond) ctx.fail(msg); };
  const handCard = (iid) => { const c = p.hand.find((c) => c.id === iid); must(c, 'That card is not in your hand'); return c; };
  switch (a.type) {
    case 'override': return runOverride(ctx, a);
    case 'concede': g.winner = other(seat); g.status = 'done'; ctx.log(`${ctx.name(seat)} conceded. ${ctx.name(other(seat))} wins.`); return;
    case 'chat': ctx.log(a.text); g.log[g.log.length - 1].k = 'chat'; g.log[g.log.length - 1].n = ctx.name(seat); return;
  }
  // pending obligations first
  if (g.pending.length) {
    const t = g.pending[0]; must(t.seat === seat, `Waiting for ${ctx.name(t.seat)}`);
    if (t.t === 'prize') { must(a.type === 'takePrize', 'Take a prize first'); const c = p.prizes.splice(a.index, 1)[0]; must(c, 'No such prize'); p.hand.push(c); p.prizesTaken++; ctx.log(`${ctx.name(seat)} took a prize (${p.prizes.length} left)`); ctx.event({ t: 'prize', seat, left: p.prizes.length }); if (--t.n <= 0) g.pending.shift(); checkWin(ctx); afterPending(ctx); return; }
    if (t.t === 'promote') { must(a.type === 'promote', 'Promote a Pokémon first'); const i = p.bench.findIndex((m) => m.id === a.target); must(i >= 0, 'Not on your bench'); p.active = p.bench.splice(i, 1)[0]; ctx.log(`${ctx.name(seat)} moved ${nameOf(db, p.active.c)} to Active`); ctx.event({ t: 'promote', seat, id: p.active.id }); g.pending.shift(); afterPending(ctx); return; }
    if (t.t === 'mulliganDraw') { must(a.type === 'mulliganDraw', 'Decide on the mulligan draw'); if (a.n > 0) ctx.draw(seat, Math.min(a.n, t.n)); g.pending.shift(); return; }
    ctx.fail('Unknown pending step');
  }
  if (g.phase === 'setup') return runSetup(ctx, a);
  must(g.phase === 'main' && g.turn === seat, 'Not your turn');
  switch (a.type) {
    case 'attach': {
      must(!p.attachedThisTurn, 'Already attached energy this turn'); const c = handCard(a.card); must(db[c.c].st === 'Energy', 'Not an energy card');
      const f = findMon(g, a.target); must(f && f.seat === seat, 'Not your Pokémon'); must(!isDollLike(db, f.m), "Can't attach to that");
      pullCard(g, c.id); f.m.en.push(c); p.attachedThisTurn = true; ctx.log(`${ctx.name(seat)} attached ${nameOf(db, c.c)} to ${nameOf(db, f.m.c)}`); ctx.event({ t: 'attach', card: c, target: f.m.id }); return;
    }
    case 'playBasic': {
      const c = handCard(a.card); must(isBasicLike(db[c.c]), 'Not a Basic Pokémon'); must(p.bench.length < r.benchSize, 'Bench is full');
      pullCard(g, c.id); const m = toMon(c, g.turnNo); if (!p.active) p.active = m; else p.bench.push(m); ctx.log(`${ctx.name(seat)} played ${nameOf(db, c.c)}${p.active === m ? ' as Active' : ' to the bench'}`); ctx.event({ t: 'play', id: m.id, seat }); return;
    }
    case 'evolve': {
      const c = handCard(a.card); const f = findMon(g, a.target); must(f && f.seat === seat, 'Not your Pokémon');
      must(matchesEvolution(db, c.c, f.m), `${nameOf(db, c.c)} doesn't evolve from ${nameOf(db, f.m.c)}`); must(canEvolveTarget(g, f.m, r), "That Pokémon can't evolve yet");
      doEvolve(ctx, f, c); return;
    }
    case 'playTrainer': {
      const c = handCard(a.card); const card = db[c.c]; must(card.st === 'Trainer' && !isBasicLike(card), 'Not a Trainer'); must(!(r.banned || []).includes(card.name), `${card.name} is banned`);
      const s = scriptOf(c.c); must(s.trainer, `${card.name} isn't automated yet; use an override`);
      if (s.canPlay) { const ok = s.canPlay({ g, db, seat, card: c }); must(ok === true, typeof ok === 'string' ? ok : `Can't play ${card.name} now`); }
      pullCard(g, c.id); ctx.log(`${ctx.name(seat)} played ${card.name}`); ctx.event({ t: 'trainer', card: c, seat });
      ctx.card = c; const keep = s.trainer(ctx); if (!keep) p.discard.push(c); checkKOs(ctx); return;
    }
    case 'usePower': {
      must(powersActive(g, db), 'Pokémon Powers are switched off'); const f = findMon(g, a.pokemon); must(f && f.seat === seat, 'Not your Pokémon');
      const s = scriptOf(f.m.c); const pw = s.powers && s.powers[a.power]; must(pw, 'No such power'); must(!conditioned(f.m) || pw.ignoreConditions, `${nameOf(db, f.m.c)} is ${f.m.st.map((x) => STATUS_NAMES[x]).join(', ')}`);
      if (pw.canUse) { const ok = pw.canUse({ g, db, seat, m: f.m }); must(ok === true, typeof ok === 'string' ? ok : "Can't use that now"); }
      ctx.log(`${ctx.name(seat)} used ${a.power} (${nameOf(db, f.m.c)})`); pw.use(ctx, f.m); checkKOs(ctx); return;
    }
    case 'discardDoll': { const f = findMon(g, a.pokemon); must(f && f.seat === seat && isDollLike(db, f.m), 'Not a doll'); removeMon(g, f.m.id); p.discard.push(...monCards(f.m)); ctx.log(`${ctx.name(seat)} discarded ${nameOf(db, f.m.c)}`); if (!p.active) g.pending.push({ t: 'promote', seat }); return; }
    case 'retreat': {
      const m = p.active; must(m, 'No Active Pokémon'); must(!p.retreatedThisTurn, 'Already retreated this turn'); must(!m.st.includes('SLP') && !m.st.includes('PAR'), "Can't retreat while Asleep or Paralyzed"); must(!hasFx(m, 'noRetreat') && !isDollLike(db, m), "Can't retreat");
      const i = p.bench.findIndex((x) => x.id === a.target); must(i >= 0, 'Not on your bench');
      const rc = db[m.c].rc || 0; must(energyUnits(db, m) >= rc, 'Not enough energy to retreat');
      if (m.st.includes('CNF') && r.confusedRetreatFlip) { if (!ctx.flip('confused retreat')) { p.retreatedThisTurn = true; ctx.log(`${nameOf(db, m.c)} is Confused and failed to retreat`); dealDamage(ctx, m, r.confusionSelfDamage, { noWR: true, self: true }); checkKOs(ctx); return; } }
      if (rc > 0) {
        // pick energy worth at least rc units
        let chosen = []; const pool = m.en.slice();
        if (energyUnits(db, m) === rc || pool.length === 1) chosen = pool;
        else { const keys = ctx.chooseCards(`Discard energy worth ${rc} to retreat`, pool, { min: 1, max: pool.length, id: 'retreatCost' }); chosen = pool.filter((e) => keys.includes(e.id)); must(chosen.reduce((n, e) => n + energyTypesOf(db, e).length, 0) >= rc, 'Not enough energy chosen'); }
        ctx.discardEnergy(m, chosen);
      }
      ctx.switchActive(seat, a.target, 'Retreat'); p.retreatedThisTurn = true; return;
    }
    case 'attack': {
      const chk = canAttack(g, seat, a.index, db); must(chk.ok, chk.why);
      const m = p.active; const atk = db[m.c].atk[a.index]; ctx.attacker = m; ctx.defender = ctx.opp.active; ctx.attackName = atk.n;
      ctx.log(`${ctx.name(seat)}'s ${nameOf(db, m.c)} used ${atk.n}`); ctx.event({ t: 'attack', attacker: m.id, name: atk.n, type: (db[m.c].types || ['Colorless'])[0] });
      g.attacked = true; g.lastAttack = { seat, attacker: m.id, name: atk.n, turn: g.turnNo };
      let proceed = true;
      if (m.st.includes('CNF')) { if (!ctx.flip('confusion')) { ctx.log(`${nameOf(db, m.c)} is Confused and hurt itself`); dealDamage(ctx, m, R(g.rules).confusionSelfDamage, { noWR: true, self: true }); proceed = false; } }
      if (proceed && hasFx(m, 'sandAttack')) { if (!ctx.flip('Sand-attack')) { ctx.log('The attack does nothing (Sand-attack)'); proceed = false; } }
      if (proceed) runAttack(ctx, m, atk);
      checkKOs(ctx); finishTurnIfClear(ctx); return;
    }
    case 'endTurn': { ctx.log(`${ctx.name(seat)} ended the turn`); finishTurnIfClear(ctx, true); return; }
    default: ctx.fail(`Unknown action ${a.type}`);
  }
}

export function runAttack(ctx, m, atk, srcCid) {
  const { db } = ctx; const s = attackScript(srcCid || m.c, atk.n);
  if (s && s.oncePerLife) m.flags['used:' + atk.n] = true;
  if (s && s.effect) { s.effect(ctx, m, atk); return; }
  const n = parseInt(atk.d, 10);
  if (atk.d && /^\d+$/.test(atk.d)) ctx.damage(n);
  else if (atk.d && !isNaN(n)) { ctx.damage(n); ctx.log(`(${atk.n}'s extra effect isn't automated; apply it with an override if needed)`); }
  else ctx.log(`(${atk.n} isn't automated yet; apply its effect with an override)`);
}

function doEvolve(ctx, f, c) {
  const { g, db, seat } = ctx; const m = f.m;
  const nm = { ...m, id: c.id, c: c.c, st: [], fx: m.fx.filter((x) => x.k === 'defender' || x.k === 'plusPower'), un: [{ id: m.id, c: m.c }, ...m.un], evolvedTurn: g.turnNo, flags: {} };
  pullCard(g, c.id); replaceMon(g, f, nm); ctx.log(`${ctx.name(seat)} evolved ${nameOf(db, m.c)} into ${nameOf(db, c.c)}`); ctx.event({ t: 'evolve', id: nm.id, from: m.id });
  return nm;
}
export { doEvolve };

function runSetup(ctx, a) {
  const { g, db, seat } = ctx; const r = R(g.rules); const p = P(g, seat); const must = (c, m) => { if (!c) ctx.fail(m); };
  must(!p.setupDone, 'Setup already done');
  if (a.type === 'mulligan') {
    must(!p.hand.some((c) => isBasicLike(db[c.c])) && !p.active, 'You have a Basic Pokémon');
    p.deck.push(...p.hand, ...p.prizes); p.hand = []; p.prizes = []; ctx.shuffle(seat);
    p.hand = p.deck.splice(0, r.handSize); p.prizes = p.deck.splice(0, r.prizes); p.mulligans++;
    ctx.log(`${ctx.name(seat)} had no Basic Pokémon: mulligan (${p.mulligans}). ${ctx.name(other(seat))} may draw ${r.mulliganDraw} extra card${r.mulliganDraw === 1 ? '' : 's'}.`);
    if (r.mulliganDraw > 0) P(g, other(seat)).mulliganCredits += r.mulliganDraw; return;
  }
  if (a.type === 'placeActive' || a.type === 'placeBench') {
    const c = p.hand.find((x) => x.id === a.card); must(c && isBasicLike(db[c.c]), 'Not a Basic Pokémon');
    if (a.type === 'placeActive') must(!p.active, 'Active already placed'); else { must(p.active, 'Place your Active first'); must(p.bench.length < r.benchSize, 'Bench is full'); }
    pullCard(g, c.id); const m = toMon(c, 0); if (a.type === 'placeActive') p.active = m; else p.bench.push(m);
    ctx.log(`${ctx.name(seat)} placed a Pokémon ${a.type === 'placeActive' ? 'as Active' : 'on the bench'}`); return;
  }
  if (a.type === 'setupDone') {
    must(p.active, 'Place an Active Pokémon first'); p.setupDone = true; ctx.log(`${ctx.name(seat)} is ready`);
    if (g.p.a.setupDone && g.p.b.setupDone) startMain(ctx); return;
  }
  ctx.fail('Finish setup first');
}
function startMain(ctx) {
  const { g, db } = ctx; g.phase = 'main'; g.status = 'playing'; g.turnNo = 1; g.turn = g.first;
  for (const s of ['a', 'b']) { const p = P(g, s); ctx.log(`${ctx.name(s)} reveals: ${mons(p).map((m) => nameOf(db, m.c)).join(', ')}`); }
  for (const s of ['a', 'b']) { const p = P(g, s); if (p.mulliganCredits > 0) { g.pending.push({ t: 'mulliganDraw', seat: s, n: p.mulliganCredits }); p.mulliganCredits = 0; } }
  beginTurn(ctx, g.first);
}
function beginTurn(ctx, seat) {
  const { g, db } = ctx; const r = R(g.rules); const p = P(g, seat);
  g.turn = seat; g.attacked = false; p.attachedThisTurn = false; p.retreatedThisTurn = false;
  ctx.log(`Turn ${g.turnNo}: ${ctx.name(seat)}`); ctx.event({ t: 'turn', seat, turnNo: g.turnNo });
  if (r.autoDraw) {
    if (p.deck.length) ctx.draw(seat, 1);
    else if (r.deckOutDamage) { if (p.active) { p.active.dmg += 10; ctx.log(`${ctx.name(seat)} has no cards to draw: 10 damage on ${nameOf(db, p.active.c)} (now ${p.active.dmg})`); ctx.event({ t: 'damage', target: p.active.id, amount: 10 }); checkKOs(ctx); } }
    else { g.winner = other(seat); g.status = 'done'; ctx.log(`${ctx.name(seat)} cannot draw a card. ${ctx.name(other(seat))} wins.`); }
  }
}
/** Ends the turn once no prizes/promotions are pending. */
function finishTurnIfClear(ctx) {
  const { g } = ctx; if (g.winner) return;
  if (g.pending.length) { g.turnEnding = 'pre'; return; }
  endTurn(ctx);
}
function afterPending(ctx) {
  const { g } = ctx; if (g.pending.length || g.winner || !g.turnEnding) return;
  const stage = g.turnEnding; g.turnEnding = null;
  if (stage === 'pre') endTurn(ctx); else nextTurn(ctx);
}
function nextTurn(ctx) { const { g } = ctx; if (g.winner) return; g.turnNo++; beginTurn(ctx, other(g.turn)); }
function endTurn(ctx) {
  const { g, db } = ctx; const r = R(g.rules); const seat = g.turn; const T = g.turnNo;
  // end-of-turn: PlusPower discards, paralysis of the ending player's Pokémon clears
  for (const m of mons(P(g, seat))) {
    for (const f of fxOf(m, 'plusPower')) { const c = m.tools.find((x) => x.id === f.card); if (c) { pullCard(g, c.id); P(g, seat).discard.push(c); } }
    m.fx = m.fx.filter((f) => f.k !== 'plusPower');
    m.st = m.st.filter((x) => x !== 'PAR');
  }
  // between turns: poison, sleep checks (Active only)
  for (const s of ['a', 'b']) {
    const m = P(g, s).active; if (!m) continue;
    if (m.st.includes('PSN')) { const n = m.flags.toxic ? 20 : 10; m.dmg += n; ctx.log(`${ctx.name(s)}'s ${nameOf(db, m.c)} takes ${n} poison damage (now ${m.dmg})`); ctx.event({ t: 'damage', target: m.id, amount: n, poison: true }); }
    if (m.st.includes('SLP')) { if (ctx.flip('sleep')) { m.st = m.st.filter((x) => x !== 'SLP'); ctx.log(`${nameOf(db, m.c)} woke up`); } }
  }
  // expire effects
  for (const m of allMons(g)) {
    const expiring = m.fx.filter((f) => f.until != null && f.until <= T);
    for (const f of expiring) if (f.k === 'defender') { const c = m.tools.find((x) => x.id === f.card); if (c) { pullCard(g, c.id); P(g, findMon(g, m.id).seat).discard.push(c); } }
    m.fx = m.fx.filter((f) => !(f.until != null && f.until <= T));
  }
  checkKOs(ctx);
  if (g.pending.length) { g.turnEnding = 'post'; return; }
  nextTurn(ctx);
}

/* ---------- knockouts, prizes, win ---------- */
function checkKOs(ctx) {
  const { g, db } = ctx;
  for (const s of ['a', 'b']) {
    const p = P(g, s);
    for (const m of mons(p)) {
      if (m.dmg >= monHP(db, m) && monHP(db, m) > 0) {
        const doll = isDollLike(db, m) && scriptOf(m.c).asPokemon && scriptOf(m.c).asPokemon.noPrize;
        removeMon(g, m.id); p.discard.push(...monCards(m));
        ctx.log(`${ctx.name(s)}'s ${nameOf(db, m.c)} was Knocked Out`); ctx.event({ t: 'ko', id: m.id, seat: s });
        if (!doll) g.pending.push({ t: 'prize', seat: other(s), n: 1 });
        // Destiny Bond
        if (hasFx(m, 'destinyBond') && g.lastAttack && g.lastAttack.seat === other(s)) { const att = findMon(g, g.lastAttack.attacker); if (att && att.m.dmg < monHP(db, att.m)) { att.m.dmg = monHP(db, att.m); ctx.log(`Destiny Bond: ${nameOf(db, att.m.c)} is Knocked Out too`); } }
      }
    }
    if (!p.active && !g.pending.some((t) => t.t === 'promote' && t.seat === s)) g.pending.push({ t: 'promote', seat: s });
  }
  // keep prizes before promotions
  g.pending.sort((x, y) => (x.t === 'prize' ? 0 : 1) - (y.t === 'prize' ? 0 : 1));
  // merge prize entries per seat
  const merged = []; for (const t of g.pending) { const prev = merged.find((x) => x.t === 'prize' && t.t === 'prize' && x.seat === t.seat); if (prev) prev.n += t.n; else merged.push(t); } g.pending = merged;
  checkWin(ctx);
  // a second KO pass in case Destiny Bond chained
  if (allMons(g).some((m) => m.dmg >= monHP(db, m) && monHP(db, m) > 0)) checkKOs(ctx);
}
function checkWin(ctx) {
  const { g } = ctx; if (g.winner) return;
  for (const s of ['a', 'b']) {
    const p = P(g, s);
    if (p.prizes.length === 0 && p.prizesTaken >= R(g.rules).prizes && !g.pending.some((t) => t.t === 'prize' && t.seat === s)) { g.winner = s; g.status = 'done'; ctx.log(`${ctx.name(s)} took the last prize and wins!`); ctx.event({ t: 'win', seat: s }); g.pending = []; return; }
    if (!p.active && !p.bench.length && g.phase === 'main') { g.winner = other(s); g.status = 'done'; ctx.log(`${ctx.name(s)} has no Pokémon left. ${ctx.name(other(s))} wins!`); ctx.event({ t: 'win', seat: other(s) }); g.pending = []; return; }
  }
}

/* ---------- overrides (manual corrections, logged) ---------- */
function runOverride(ctx, a) {
  const { g, db, seat } = ctx; g.overrides = (g.overrides || 0) + 1; const who = ctx.name(seat);
  const tag = (m) => ctx.log(`[override] ${who}: ${m}`);
  switch (a.op) {
    case 'damage': { const f = findMon(g, a.target); if (!f) ctx.fail('No such Pokémon'); f.m.dmg = Math.max(0, f.m.dmg + a.delta); tag(`${a.delta > 0 ? '+' : ''}${a.delta} damage on ${nameOf(db, f.m.c)} (now ${f.m.dmg})`); checkKOs(ctx); return; }
    case 'status': { const f = findMon(g, a.target); if (!f) ctx.fail('No such Pokémon'); if (a.code === 'clear') { f.m.st = []; delete f.m.flags.toxic; tag(`cleared conditions on ${nameOf(db, f.m.c)}`); } else if (f.m.st.includes(a.code)) { f.m.st = f.m.st.filter((x) => x !== a.code); tag(`${nameOf(db, f.m.c)} no longer ${STATUS_NAMES[a.code]}`); } else applyStatus(ctx, f.m, a.code); return; }
    case 'move': { // card -> zone
      const c = pullCard(g, a.card); if (!c) ctx.fail('No such card'); const p = P(g, a.toSeat || seat);
      if (a.to === 'hand') p.hand.push(c); else if (a.to === 'discard') p.discard.push(c); else if (a.to === 'deckTop') p.deck.unshift(c); else if (a.to === 'deckBottom') p.deck.push(c); else if (a.to === 'deckShuffle') { p.deck.push(c); ctx.shuffle(a.toSeat || seat); }
      else if (a.to === 'attach') { const f = findMon(g, a.target); if (!f) ctx.fail('No target'); (db[c.c].st === 'Energy' ? f.m.en : f.m.tools).push(c); }
      else if (a.to === 'bench') { if (p.bench.length >= R(g.rules).benchSize) ctx.fail('Bench full'); p.bench.push(toMon(c, g.turnNo)); } else if (a.to === 'active') { if (p.active) ctx.fail('Active occupied'); p.active = toMon(c, g.turnNo); } else ctx.fail('Bad zone');
      tag(`moved ${nameOf(db, c.c)} to ${a.to}`); return;
    }
    case 'ko': { const f = findMon(g, a.target); if (!f) ctx.fail('No such Pokémon'); f.m.dmg = Math.max(f.m.dmg, monHP(db, f.m)); tag(`knocked out ${nameOf(db, f.m.c)}`); checkKOs(ctx); return; }
    case 'draw': { ctx.draw(a.target || seat, a.n || 1); tag(`drew ${a.n || 1}`); return; }
    case 'shuffle': { ctx.shuffle(seat); tag('shuffled deck'); return; }
    case 'switch': { ctx.switchActive(seat, a.target, 'Override switch'); return; }
    case 'turn': { g.turn = a.seat || seat; g.attacked = false; tag(`set turn to ${ctx.name(g.turn)}`); return; }
    case 'endTurn': { g.pending = []; g.turnEnding = null; endTurn(ctx); tag('forced end of turn'); return; }
    case 'clearPending': { g.pending = []; g.turnEnding = null; tag('cleared pending steps'); return; }
    case 'flag': { const f = findMon(g, a.target); if (!f) ctx.fail('No such Pokémon'); f.m.fx = f.m.fx.filter((x) => x.k !== a.k); if (a.on !== false) f.m.fx.push({ k: a.k, until: a.until }); tag(`${a.on === false ? 'removed' : 'set'} ${a.k} on ${nameOf(db, f.m.c)}`); return; }
    case 'attachedThisTurn': { P(g, seat).attachedThisTurn = !!a.value; tag(`attached-this-turn = ${!!a.value}`); return; }
    case 'winner': { g.winner = a.seat; g.status = 'done'; tag(`declared ${ctx.name(a.seat)} the winner`); return; }
    default: ctx.fail('Unknown override');
  }
}
