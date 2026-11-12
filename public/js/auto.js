// Automated-rules table: renders an engine game and turns clicks into engine actions.
// The page exposes a small bridge (window.PT) with shared helpers; this module owns everything on the board.
import { apply, legalActions, STATUS_NAMES, energyUnits, canAttack, scriptOf, seesOpponentHand } from './engine/engine.js';
import { newGame, other, mons, findMon } from './engine/state.js';
import { randomSeed } from './engine/rng.js';
import { R } from './engine/rules.js';
import { automationReport } from './engine/cards/index.js';
import { playAttack, playKO, playHeal, playSelfHit, playCoins, playWin, playTurnChime, playConfused, attachLayer, isEnabled as fxEnabled, setEnabled as setFxEnabled, soundOn, setSoundVolume } from './fx.js';
import { playBattleIntro, playPokemonMusic, playEventMusic, warmMusic } from './music.js';
import * as sfx from './sfx.js';
import { BOT_UID, BOT_DECKS, botDeckCards, botAction, botAnswer, key as botKey } from './bot.js';
import { nextBossAttack } from './engine/boss.js';

let PT = null;           // bridge from index.html
let promptOpen = null;   // id of the prompt modal currently shown
let seenFxId = null;     // id of the last doc.fx payload this client animated
let pendingFx = null;
let pendingScene = null; // scene captured from the board on screen before a remote update re-renders it
/** Prefer positions from before the re-render (the knocked-out card was still there), fill gaps from after. */
function mergeScene(before, after) {
  if (!before) return after; if (!after) return before;
  return { ...after, from: after.from || before.from, rects: { ...after.rects, ...before.rects }, targets: before.targets && before.targets.length ? before.targets : after.targets, ghosts: before.ghosts };
}
let pendingWin = null;
let pendingTurn = false;
let logOpen = false;      // compact mode: whether the log is expanded
const chatSeen = {};       // doc id -> how many chat messages this client has seen (new ones from others get a toast)
let chatUnread = 0;        // compact mode: chat messages that arrived while the log was closed
let suppressClick = false; // a drag just finished: swallow the click that follows
const isCompact = () => window.innerWidth < 700;
let wasCompact = null;
if (typeof window !== 'undefined') window.addEventListener('resize', () => { const c = isCompact(); if (wasCompact !== null && c !== wasCompact && PT) PT.render(); wasCompact = c; });
const phaseSeen = {};     // doc id -> last phase this client saw (battle music plays when setup turns into main)
const activeSeen = {};
const handSeen = {}, freshHand = {}, drawFlying = new Set(); // my hand's card ids at the last render / the ones new since (for the draw animation)
const winSeen = {};
const turnSeen = {};      // doc id -> last 'waiting on me' state, to announce when the turn passes to me       // doc id -> winner seen (the win celebration plays when a winner first appears)    // doc id -> { seat: active mon id } (a Pokémon's own music plays when it becomes Active)

export function install(bridge) { PT = bridge; return { render, startGame, submit, automationReport, BOT_UID, BOT_DECKS, botDeckCards }; }

const esc = (s) => PT.esc(s);
const C = (cid) => PT.CARDS[cid] || { name: '?', st: '', atk: [] };
const nm = (x) => C(typeof x === 'string' ? x : x.c).name;

/* ---------- game start ---------- */
export function startGame(doc, decks) {
  const seats = {};
  for (const s of ['a', 'b']) seats[s] = { uid: doc.seats[s].uid, name: PT.nameOf(doc.seats[s].uid), cards: decks[s].cards };
  const g = newGame({ rules: doc.rules, seats, seed: randomSeed() });
  return g;
}

/* ---------- actions ---------- */
function mySeat(doc) { const uid = PT.uid(); if (doc.seats.a.uid === uid) return 'a'; if (doc.seats.b.uid === uid) return 'b'; return null; }

export async function submit(action, answers = [], opts = {}) {
  const doc = PT.S.game; if (!doc || !doc.state) return;
  const seat = action.seat || mySeat(doc); if (!seat) { PT.toast("You're watching this table"); return; }
  action = { ...action, seat, seed: action.seed || randomSeed(), answers };
  const r = apply(doc.state, action, PT.CARDS);
  if (r.error) { PT.toast(r.error); return; }
  if (r.prompt) {
    if (r.prompt.seat === mySeat(doc)) {
      if (opts.autoAnswer) { const auto = opts.autoAnswer(r.prompt); if (auto !== undefined) return submit(action, [...answers, auto], opts); }
      const ans = await promptModal(r.prompt); if (ans == null) return; return submit(action, [...answers, ans], opts);
    }
    doc.inflight = { action, prompt: r.prompt }; await PT.saveGame(doc); PT.render(); return;
  }
  const scene = captureScene(r.events, doc.state);
  const flips = r.events.filter((e) => e.t === 'flip');
  const me0 = mySeat(doc);
  const plain = flips.filter((f) => !isCheck(f));
  const clicked = plain.length > 0 && fxEnabled();
  if (clicked) await clickCoins(plain);
  for (const f of flips.filter(isCheck)) await clickCoins([f], { title: checkTitle(f, me0), outcome: checkOutcome(f), auto: f.seat !== me0 });
  recordUndo(doc, action, r.events, seat);
  doc.state = r.state; doc.inflight = null; doc.status = r.state.status; if (r.state.winner) doc.winner = r.state.winner;
  publishFx(doc, r.events); PT.render(); playEvents(r.events, doc, scene, { coinsDone: clicked }); await PT.saveGame(doc);
}

/* ---------- click-to-flip coins ----------
   Your own coin flips show a big coin you click to flip (one click per coin; "Flip the rest" for long runs).
   The result is already decided by the move's random seed; clicking just reveals it. The board only shows the
   outcome after the last coin lands. The other player's flips (and the computer's) animate on their own: their
   wake-up and burn checks show the same coin, but it can't be tapped and flips itself. */
const FLIP_LABELS = { confusion: 'Confusion check', sleep: 'Asleep: wake-up check', burn: 'Burn check', 'Sand-attack': 'Sand-attack', 'Baby Rule': 'Baby Rule', 'confused retreat': 'Confused retreat' };
const isCheck = (f) => !!(f && f.seat && (f.label === 'sleep' || f.label === 'burn'));
function checkTitle(f, me) { const whose = f.seat === me ? 'Your' : 'Opponent\u2019s'; return f.label === 'sleep' ? `💤 ${whose} ${f.name} is Asleep — wake-up flip` : `🔥 ${whose} ${f.name} is Burned — burn flip`; }
function checkOutcome(f) { return f.label === 'sleep' ? (f.heads ? `HEADS — ${f.name} woke up!` : `TAILS — ${f.name} is still Asleep`) : (f.heads ? `HEADS — no burn damage` : `TAILS — ${f.name} takes 20 burn damage`); }
/* House rule bench rescue: show the draw-for-a-Basic card by card, so a loss doesn't just appear out of nowhere.
   The drawing player sees their cards; the other player sees backs, plus the Basic if one turned up. */
let rescuePlaying = null;
function showRescue(e, me) {
  const mine = e.seat === me; const wrap = document.createElement('div'); wrap.className = 'coinflip rescue';
  const who = mine ? 'You have' : `${esc(e.name)} has`;
  wrap.innerHTML = `<div class="cf-box"><div class="cf-title">${who} no Pokémon left!</div>
    <div class="cf-hint">Drawing until a Basic Pokémon turns up (up to 7)…</div>
    <div class="rs-row"></div><div class="cf-hint rs-end"></div></div>`;
  document.body.appendChild(wrap);
  const row = wrap.querySelector('.rs-row'); let i = 0;
  return new Promise((resolve) => {
    const close = () => { if (wrap.isConnected) { wrap.remove(); resolve(); } };
    const step = () => {
      if (i < e.cards.length) {
        const cid = e.cards[i]; const hit = e.found && i === e.cards.length - 1;
        const slot = document.createElement('div'); slot.className = 'rs-card' + (hit ? ' hit' : '');
        slot.innerHTML = mine || hit ? PT.cardHTML(cid, .26) : PT.backHTML(.26);
        row.appendChild(slot); sfx.play('coin', 0, !!hit); i++; setTimeout(step, 600); return;
      }
      const end = wrap.querySelector('.rs-end');
      end.textContent = e.found ? `Found ${C(e.found).name}! It comes in as the Active Pokémon.` : `No Basic Pokémon in ${e.cards.length} card${e.cards.length === 1 ? '' : 's'} — ${mine ? 'you lose' : e.name + ' loses'}.`;
      end.classList.add('cf-outcome', e.found ? (mine ? 'good' : 'bad') : (mine ? 'bad' : 'good'));
      wrap.onclick = close; setTimeout(close, 3200);
    };
    setTimeout(step, 700);
  });
}
function clickCoins(flips, opts = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div'); wrap.className = 'coinflip';
    let i = 0, heads = 0; const results = [];
    const render = () => {
      const f = flips[i]; const label = opts.title || (f && f.label ? (FLIP_LABELS[f.label] || f.label) : 'Coin flip');
      wrap.innerHTML = `<div class="cf-box"><div class="cf-title">${esc(label)}${flips.length > 1 ? ` · coin ${Math.min(i + 1, flips.length)} of ${flips.length}` : ''}</div>
        <button type="button" class="cf-coin${opts.auto ? ' auto' : ''}" aria-label="${opts.auto ? 'The coin flips on its own' : 'Flip the coin'}"${opts.auto ? ' tabindex="-1"' : ''}><span class="cf-face">?</span></button>
        <div class="cf-hint">${opts.auto ? 'Your opponent’s flip. It flips on its own.' : 'Tap the coin to flip'}</div>
        <div class="cf-results">${results.map((h) => `<span class="${h ? 'h' : 't'}">${h ? 'H' : 'T'}</span>`).join('')}</div>
        ${flips.length - i > 2 ? '<button type="button" class="sm cf-all">Flip the rest</button>' : ''}</div>`;
      if (!opts.auto) wrap.querySelector('.cf-coin').onclick = flipOne;
      const all = wrap.querySelector('.cf-all'); if (all) all.onclick = (e) => { e.stopPropagation(); flipAll(); };
    };
    let busy = false;
    const land = (h) => { results.push(h); if (h) heads++; i++; };
    const finish = () => { const sum = wrap.querySelector('.cf-hint'); if (sum) { sum.textContent = opts.outcome ? opts.outcome : flips.length > 1 ? `${heads} heads, ${flips.length - heads} tails` : (results[0] ? 'Heads!' : 'Tails'); if (opts.outcome) sum.classList.add('cf-outcome', results[0] ? 'good' : 'bad'); } setTimeout(() => { wrap.remove(); resolve(); }, opts.outcome ? 2200 : 900); };
    const flipOne = () => {
      if (busy || i >= flips.length) return; busy = true;
      const h = !!flips[i].heads; const coin = wrap.querySelector('.cf-coin'); const face = coin.querySelector('.cf-face');
      sfx.play('coin', 0, h); coin.classList.add('spin'); face.textContent = '';
      setTimeout(() => {
        coin.classList.remove('spin'); coin.classList.add(h ? 'heads' : 'tails'); face.textContent = h ? 'HEADS' : 'TAILS'; land(h);
        const res = wrap.querySelector('.cf-results'); if (res) res.innerHTML = results.map((x) => `<span class="${x ? 'h' : 't'}">${x ? 'H' : 'T'}</span>`).join('');
        busy = false;
        if (i >= flips.length) finish(); else setTimeout(render, 650);
      }, 700);
    };
    const flipAll = () => { if (busy) return; while (i < flips.length) land(!!flips[i].heads); sfx.play('coin', 0, results[results.length - 1]); const res = wrap.querySelector('.cf-results'); if (res) res.innerHTML = results.map((x) => `<span class="${x ? 'h' : 't'}">${x ? 'H' : 'T'}</span>`).join(''); const all = wrap.querySelector('.cf-all'); if (all) all.remove(); finish(); };
    document.body.appendChild(wrap); render();
    if (opts.auto) setTimeout(flipOne, 350);
  });
}
/** A move can be undone only if it revealed nothing: no flip, draw, search, prize, and it didn't hand the turn over. */
function undoable(action, events) {
  if (['chat', 'endTurn', 'attack', 'takePrize', 'mulligan', 'mulliganDraw', 'concede', 'override', 'setupDone'].includes(action.type)) return false;
  return !events.some((e) => ['flip', 'draw', 'shuffle', 'prize', 'turn', 'ko', 'win'].includes(e.t));
}
/* Undo history: every move that revealed nothing is snapshotted (state without its log, ~6 KB), so a player can step
   back through several of them in a row. Anything that reveals information (or another player's move, or a new turn)
   clears the history. */
const UNDO_MAX = 20;
function recordUndo(doc, action, events, seat) {
  if (action.type === 'chat') return; // chatting doesn't touch the undo history
  doc.prev = null; // the old single-step undo
  if (!undoable(action, events)) { doc.undo = []; return; }
  const st = doc.undo || [];
  const keep = st.length && st[st.length - 1].seat === seat && st[st.length - 1].turnNo === doc.state.turnNo ? st : [];
  const { log, ...rest } = doc.state;
  keep.push({ state: rest, logLen: (log || []).length, seat, label: action.type, turnNo: doc.state.turnNo });
  doc.undo = keep.slice(-UNDO_MAX);
}
function undoDepth(doc, me) { const st = doc.undo || []; if (st.length && st[st.length - 1].seat === me) return st.length; return doc.prev && doc.prev.seat === me ? 1 : 0; }
async function undo(doc) {
  const me = mySeat(doc); if (!undoDepth(doc, me)) { PT.toast('Nothing to undo'); return; }
  // a move saved by the older single-step undo (doc.prev) still works
  const snap = (doc.undo || []).length ? doc.undo.pop() : { state: doc.prev.state, logLen: doc.prev.state.log ? doc.prev.state.log.length : (doc.state.log || []).length, seat: doc.prev.seat, label: doc.prev.label };
  const g = { ...snap.state, log: (doc.state.log || []).slice(0, snap.logLen) };
  g.log.push({ t: Date.now(), turn: g.turnNo, m: `${g.seats[snap.seat].name} undid a move (${snap.label})` });
  doc.state = g; doc.prev = null; doc.inflight = null; await PT.saveGame(doc); PT.render();
}

/* ---------- prompts ---------- */
/* ---------- pick a Pokémon on the board ----------
   When a choice is "one of these Pokémon in play", the board lights them up and you click the one you mean
   (no more guessing which of two Hitmonchan a list item is). A bar at the top of the board says what you're
   picking and has Cancel (and None when allowed). The mode survives re-renders. */
let boardPickState = null;
function boardHasMons(ids) { const b = boardEl(); return !!b && ids.length > 0 && ids.every((id) => b.querySelector(`[data-mon="${id}"]`)); }
function applyBoardPick() {
  const b = boardEl(); if (!b || !boardPickState) return;
  for (const id of boardPickState.ids) { const el = b.querySelector(`[data-mon="${id}"]`); if (el) el.classList.add('pickable'); }
  b.classList.add('picking');
  if (!b.querySelector('.pickbar')) {
    const bar = document.createElement('div'); bar.className = 'pickbar';
    bar.innerHTML = `<span class="grow">${esc(boardPickState.title)}<span class="small muted"> · click a highlighted Pokémon</span></span>${boardPickState.allowNone ? '<button type="button" class="sm" data-pick="none">None</button>' : ''}<button type="button" class="sm" data-pick="cancel">Cancel</button>`;
    b.appendChild(bar);
  }
}
function endBoardPick(result) {
  const st = boardPickState; boardPickState = null; const b = boardEl();
  if (b) { b.classList.remove('picking'); b.querySelectorAll('.pickable').forEach((el) => el.classList.remove('pickable')); const bar = b.querySelector('.pickbar'); if (bar) bar.remove(); }
  if (st) st.resolve(result);
}
/** Resolves with the chosen Pokémon id, 'none' or null (cancelled). */
function boardPick(title, ids, opts = {}) {
  if (boardPickState) endBoardPick(null);
  return new Promise((resolve) => { boardPickState = { title, ids, allowNone: !!opts.allowNone, resolve }; applyBoardPick(); });
}
function boardPickClick(t) {
  if (!boardPickState) return false;
  const pb = t.closest('[data-pick]'); if (pb) { endBoardPick(pb.dataset.pick === 'none' ? 'none' : null); return true; }
  const mon = t.closest('[data-mon]'); if (mon && boardPickState.ids.includes(mon.dataset.mon)) { endBoardPick(mon.dataset.mon); return true; }
  return true; // swallow other clicks on the board while picking
}

function promptModal(prompt) {
  if (prompt.max === 1 && !prompt.ordered && boardHasMons(prompt.options.map((o) => o.key))) {
    return boardPick(prompt.title, prompt.options.map((o) => o.key), { allowNone: prompt.min === 0 }).then((k) => (k === null ? null : k === 'none' ? [] : [k]));
  }
  return new Promise((resolve) => {
    promptOpen = prompt.id + ':' + prompt.title;
    const picked = []; const multi = prompt.max > 1 || prompt.ordered;
    const body = `<p class="small muted">${prompt.min === prompt.max ? `Choose ${prompt.min}` : `Choose ${prompt.min} to ${prompt.max}`}${prompt.ordered ? ' (in order)' : ''}.</p>
      <div class="pickgrid">${prompt.options.map((o) => `<div class="pk" data-key="${esc(o.key)}">${o.cid ? `<div class="cd" style="${PT.cardStyle(o.cid)}" data-cid="${esc(o.cid)}"></div>` : ''}<div class="nm">${esc(o.label)}</div><div class="ord small muted"></div></div>`).join('')}</div>`;
    PT.showModal(prompt.title, body, `<button class="pri" id="pok" type="button">OK</button>${prompt.min === 0 ? '<button id="pnone" type="button">None</button>' : ''}<button id="pcancel" type="button">Cancel</button>`, (m) => {
      const refresh = () => { m.querySelectorAll('.pk').forEach((el) => { const i = picked.indexOf(el.dataset.key); el.classList.toggle('sel', i >= 0); el.querySelector('.ord').textContent = prompt.ordered && i >= 0 ? `#${i + 1}` : ''; }); m.querySelector('#pok').disabled = picked.length < prompt.min || picked.length > prompt.max; };
      m.querySelectorAll('.pk').forEach((el) => (el.onclick = () => { const k = el.dataset.key; const i = picked.indexOf(k); if (i >= 0) picked.splice(i, 1); else { if (!multi) picked.length = 0; if (picked.length < prompt.max) picked.push(k); } refresh(); }));
      m.querySelector('#pok').onclick = () => { PT.closeModal(); promptOpen = null; resolve(picked.slice()); };
      const none = m.querySelector('#pnone'); if (none) none.onclick = () => { PT.closeModal(); promptOpen = null; resolve([]); };
      m.querySelector('#pcancel').onclick = () => { PT.closeModal(); promptOpen = null; resolve(null); };
      refresh();
    }, { noBackdropClose: true });
  });
}

/* ---------- events -> animations ---------- */
const FX_EVENTS = ['rescue', 'attack', 'damage', 'heal', 'ko', 'flip', 'status', 'draw', 'confused', 'trainer', 'play', 'evolve', 'attach'];
/** Store the interesting events on the doc so the other player's screen animates them too. */
function publishFx(doc, events) {
  const ev = events.filter((e) => FX_EVENTS.includes(e.t)); if (!ev.length) { return; }
  doc.fx = { id: Math.random().toString(36).slice(2, 10), events: ev }; seenFxId = doc.fx.id;
}
const boardEl = () => document.querySelector('.board.auto');
function rectIn(b, el) { if (!b || !el) return null; const br = b.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height, cx: r.left - br.left + r.width / 2, cy: r.top - br.top + r.height / 2, el: el.closest('.mon') }; }
const rectOf = (id) => { const b = boardEl(); return rectIn(b, b && b.querySelector(`[data-mon="${id}"] .poke`)); };
const slotRect = (seat) => { const b = boardEl(); return rectIn(b, b && b.querySelector(`[data-active-slot="${seat}"]`)); };
/** Where things are on screen right now, for the attack in `events`. Call before re-rendering when you can. */
function captureScene(events, g) {
  const b0 = boardEl(); const ghosts = [];
  for (const e of events) if (e.t === 'ko') { const el = b0 && b0.querySelector(`[data-mon="${e.id}"] .poke`); const r = rectIn(b0, el); if (el && r) ghosts.push({ id: e.id, html: el.outerHTML, rect: r }); }
  const atk = events.find((e) => e.t === 'attack'); if (!atk) return ghosts.length ? { ghosts, rects: Object.fromEntries(ghosts.map((x) => [x.id, x.rect])), targets: [] } : null;
  const f = findMon(g, atk.attacker); const seat = f ? f.seat : (g.lastAttack && g.lastAttack.attacker === atk.attacker ? g.lastAttack.seat : null);
  const from = rectOf(atk.attacker) || (seat && slotRect(seat));
  const ids = [...new Set(events.filter((e) => e.t === 'damage' && !e.self && e.target !== atk.attacker).map((e) => e.target))];
  const rects = {}; for (const id of ids) rects[id] = rectOf(id);
  const targets = ids.map((id) => rects[id] || (seat && slotRect(other(seat)))).filter(Boolean);
  if (!targets.length && seat) { const r = slotRect(other(seat)); if (r) targets.push(r); }
  rects[atk.attacker] = from;
  for (const x of ghosts) if (!rects[x.id]) rects[x.id] = x.rect;
  return { type: atk.type, name: atk.name, cardId: f ? f.m.c : null, attacker: atk.attacker, from, targets, rects, ghosts };
}
/** Card backs fly from a seat's deck to its hand; the player's own new cards flip face up when they land. */
/* ---------- drawing cards ----------
   Every drawn card gets its own little trip: it pops off the deck, flips face up over your hand for a moment
   (card backs for the other player), then drops into its spot. A counter on the deck ticks up +1, +2, ...
   Your new cards are found by id (the hand is sorted, so they aren't always at the end). */
const DRAW_STEP = 170;
function animateDraws(events, doc) {
  if (!fxEnabled()) return;
  const b = boardEl(); if (!b) return; const me = mySeat(doc);
  const draws = events.filter((e) => e.t === 'draw' && e.n > 0); if (!draws.length) return;
  const ownTotal = draws.filter((e) => e.seat === me).reduce((k, e) => k + e.n, 0);
  const queue = (freshHand[doc.id] || []).slice(-ownTotal); // the cards that just arrived, in the order they were drawn
  let delay = 0;
  for (const e of draws) {
    const deck = b.querySelector(`[data-pile="deck"][data-seat="${e.seat}"]`); const zone = b.querySelector(`[data-handzone="${e.seat}"]`); if (!deck || !zone) continue;
    const own = e.seat === me; const n = Math.min(e.n, 12);
    const ids = own ? queue.splice(0, e.n).slice(-n) : [];
    const targets = ids.map((id) => zone.querySelector(`[data-hand="${id}"]`));
    targets.forEach((t) => t && t.classList.add('incoming')); ids.forEach((id) => { drawFlying.add(id); setTimeout(() => drawFlying.delete(id), 6000); }); // (safety net so a card never stays hidden)
    const counter = document.createElement('div'); counter.className = 'drawcount'; counter.style.opacity = '0';
    setTimeout(() => { const r = deck.getBoundingClientRect(); counter.style.left = r.right - 4 + 'px'; counter.style.top = r.top + 4 + 'px'; document.body.appendChild(counter); }, delay);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        counter.textContent = `+${i + 1}`; counter.style.opacity = '1'; counter.classList.remove('bump'); void counter.offsetWidth; counter.classList.add('bump');
        flyDrawnCard(deck, zone, targets[i], own && ids[i] ? (doc.state.p[e.seat].hand.find((c) => c.id === ids[i]) || {}).c : null, ids[i]);
      }, delay + i * DRAW_STEP);
    }
    setTimeout(() => { counter.style.opacity = '0'; setTimeout(() => counter.remove(), 350); }, delay + (n - 1) * DRAW_STEP + 900);
    delay += n * DRAW_STEP + 250;
  }
}
function flyDrawnCard(deck, zone, target, cid, id) {
  const fr = deck.getBoundingClientRect(); const zr = zone.getBoundingClientRect();
  let tr = target && target.isConnected ? target.getBoundingClientRect() : zr;
  if (tr.right < 0 || tr.left > innerWidth) tr = zr; // scrolled out of a phone's hand strip
  const own = !!cid; const sc = own ? Math.max(0.34, Math.min(0.62, (tr.height / 330) * 1.5)) : Math.max(0.16, fr.height / 330);
  const w = 240 * sc, h = 330 * sc;
  const at = (x, y, s, r = 0) => `translate(${x - w / 2}px,${y - h / 2}px) scale(${s}) rotate(${r}deg)`;
  const el = document.createElement('div'); el.className = 'drawcard'; el.style.width = w + 'px'; el.style.height = h + 'px';
  el.innerHTML = `<div class="dc-in"><div class="dc-f">${PT.backHTML(sc)}</div>${own ? `<div class="dc-f dc-front">${PT.cardHTML(cid, sc)}</div>` : ''}</div>`;
  el.style.transform = at(fr.left + fr.width / 2, fr.top + fr.height / 2, fr.height / h);
  document.body.appendChild(el); void el.offsetWidth;
  sfx.play('draw');
  // the hand may have been redrawn meanwhile: land on whatever element has this card now
  const land = () => { el.remove(); if (id) drawFlying.delete(id); const t = id ? document.querySelector(`.side.mine [data-hand="${id}"]`) : null; if (t) { t.classList.remove('incoming'); t.classList.add('landed'); setTimeout(() => t.classList.remove('landed'), 400); } };
  if (own) {
    // up over the hand, face up...
    const rx = Math.min(innerWidth - w / 2 - 8, Math.max(w / 2 + 8, tr.left + tr.width / 2)), ry = Math.max(h / 2 + 8, zr.top - h * 0.3);
    el.style.transform = at(rx, ry, 1); el.firstElementChild.classList.add('up');
    // ...then into its spot
    setTimeout(() => { el.style.transform = at(tr.left + tr.width / 2, tr.top + tr.height / 2, tr.height / h); }, 500);
    setTimeout(land, 790);
  } else {
    el.style.transform = at(zr.left + zr.width / 2, zr.top + zr.height / 2, Math.min(1.2, Math.max(0.6, zr.height / h)), (Math.random() - 0.5) * 16);
    setTimeout(() => { el.style.opacity = '0'; }, 220);
    setTimeout(land, 520);
  }
}
/** A knocked-out card stays where it was (as a stand-in) until the attack lands, then breaks apart. */
function placeGhosts(scene) {
  const b = boardEl(); const out = {}; if (!b || !scene || !scene.ghosts) return out;
  for (const x of scene.ghosts) {
    if (b.querySelector(`[data-mon="${x.id}"]`)) continue; // still on the board (it wasn't removed)
    const el = document.createElement('div'); el.className = 'koghost'; el.innerHTML = x.html;
    el.style.cssText = `left:${x.rect.x}px;top:${x.rect.y}px;width:${x.rect.w}px;height:${x.rect.h}px`;
    b.appendChild(el); out[x.id] = el;
  }
  return out;
}
/* ---------- played cards ----------
   Every card that's played (Trainer, Stadium, Basic to the bench, evolution, attached Energy) is shown big in the
   middle of the screen for a moment, then flies to where it went. The opponent's plays hold a bit longer. */
function playedCards(events, doc) {
  const g = doc.state; const items = [];
  for (const e of events) {
    let it = null;
    if (e.t === 'trainer' && e.card) it = { cid: e.card.c, seat: e.seat, dest: () => (g.stadium && g.stadium.id === e.card.id ? document.querySelector('.board.auto .midbar') : document.querySelector(`.board.auto [data-pile="discard"][data-seat="${e.seat}"]`)) };
    else if (e.t === 'attach' && e.card) { const f = findMon(g, e.target); it = { cid: e.card.c, seat: f ? f.seat : null, key: `a:${e.card.c}:${e.target}`, dest: () => document.querySelector(`.board.auto [data-mon="${e.target}"]`) }; }
    else if ((e.t === 'evolve' || e.t === 'play') && e.id) { const f = findMon(g, e.id); if (f) it = { cid: f.m.c, seat: f.seat, dest: () => document.querySelector(`.board.auto [data-mon="${e.id}"]`) }; }
    if (!it) continue;
    const last = items[items.length - 1];
    if (it.key && last && last.key === it.key) last.n++; else items.push({ ...it, n: 1 });
  }
  return items.slice(0, 6);
}
async function revealPlayed(items, doc) {
  if (!items.length || !fxEnabled()) return;
  const me = mySeat(doc); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vw = window.innerWidth, vh = window.innerHeight; const sc = Math.max(0.42, Math.min(0.9, (Math.min(vw, vh) * 0.62) / 330));
  for (const it of items) {
    const own = it.seat && it.seat === me; const hold = own ? 380 : 850;
    const el = document.createElement('div'); el.className = 'playcard'; el.innerHTML = PT.cardHTML(it.cid, sc) + (it.n > 1 ? `<span class="pc-n">×${it.n}</span>` : '');
    const w = 240 * sc, h = 330 * sc; const fromY = own ? vh + 20 : -h - 20;
    el.style.cssText = `left:${vw / 2 - w / 2}px;top:${vh / 2 - h / 2}px;width:${w}px;height:${h}px;transform:translateY(${fromY - (vh / 2 - h / 2)}px) scale(.7);opacity:0`;
    document.body.appendChild(el);
    await wait(20); el.style.transform = 'translateY(0) scale(1)'; el.style.opacity = '1';
    await wait(320 + hold);
    const d = it.dest && it.dest(); const r = d && d.getBoundingClientRect();
    if (r && r.width) { const dx = r.left + r.width / 2 - vw / 2, dy = r.top + r.height / 2 - vh / 2; el.style.transform = `translate(${dx}px,${dy}px) scale(.25)`; }
    el.style.opacity = '0';
    await wait(380); el.remove();
  }
}

/** Animate one move's events. A Confused attacker goes: ??? swirl, its confusion coin, then the attack (heads) or the self-hit (tails). */
async function playEvents(events, doc, scene, opts = {}) {
  const b = boardEl(); const ghosts = placeGhosts(scene);
  setTimeout(() => { for (const el of Object.values(ghosts)) if (el.isConnected) el.remove(); }, 8000); // safety net
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = (id) => (scene && scene.rects && scene.rects[id]) || rectOf(id);
  setTimeout(() => animateDraws(events, doc), 20);
  const atk = events.find((e) => e.t === 'attack');
  const confFlip = atk ? events.find((e) => e.t === 'flip' && e.label === 'confusion') : null;
  const flips = events.filter((e) => e.t === 'flip' && e !== confFlip && !isCheck(e));
  const checks = events.filter((e) => e.t === 'flip' && isCheck(e));
  const rescues = events.filter((e) => e.t === 'rescue');
  if (rescues.length) { const me = mySeat(doc); rescuePlaying = new Promise((res) => setTimeout(async () => { for (const e of rescues) await showRescue(e, me); res(); }, 1400)).finally(() => { rescuePlaying = null; }); }
  if (checks.length && !opts.coinsDone) { const me = mySeat(doc); setTimeout(async () => { for (const f of checks) await clickCoins([f], { title: checkTitle(f, me), outcome: checkOutcome(f), auto: f.seat !== me }); }, 900); }
  const landHits = () => {
    const board = boardEl();
    for (const e of events) {
      if (e.t === 'damage') { const el = document.querySelector(`[data-mon="${e.target}"]`) || ghosts[e.target]; if (el) { el.classList.add('hit'); const f = document.createElement('div'); f.className = 'float-dmg'; f.textContent = '-' + e.amount; el.appendChild(f); setTimeout(() => { el.classList.remove('hit'); f.remove(); }, 900); } if (e.self) playSelfHit(board, rect(e.target)); }
      if (e.t === 'heal') { const el = document.querySelector(`[data-mon="${e.target}"]`); if (el) { const f = document.createElement('div'); f.className = 'float-dmg heal'; f.textContent = '+' + e.amount; el.appendChild(f); setTimeout(() => f.remove(), 900); } playHeal(board, rect(e.target)); }
      if (e.t === 'ko') setTimeout(() => { playKO(board, rect(e.id)); const gh = ghosts[e.id]; if (gh) { gh.classList.add('gone'); setTimeout(() => gh.remove(), 650); } }, 250);
    }
    if (events.some((e) => e.t === 'status' && e.code === 'CNF')) playEventMusic('confusion');
  };
  await wait(30);
  await revealPlayed(playedCards(events, doc), doc);
  if (confFlip) {
    // 1. the ??? around the Confused Pokémon  2. its coin  3. tails: the self-hit and nothing else
    if (b) await wait(playConfused(boardEl() || b, rect(atk.attacker)));
    if (!opts.coinsDone) { PT.toast(`Confusion: ${confFlip.heads ? 'Heads' : 'Tails'}`); const cb = boardEl(); if (cb) await wait(Math.round(playCoins(cb, [confFlip.heads]) * 0.8)); }
    if (!confFlip.heads) { landHits(); return; }
  }
  if (flips.length && !opts.coinsDone) { PT.toast(flips.map((e) => (e.heads ? 'Heads' : 'Tails')).join(', ')); const fb = boardEl(); if (fb) await wait(Math.round(playCoins(fb, flips.map((e) => e.heads)) * 0.7)); }
  let impact = 0; const board = boardEl();
  if (atk && scene && board) { scene.fromEl = board.querySelector(`[data-mon="${atk.attacker}"]`); impact = playAttack(board, scene).impact; }
  else if (atk) { const el = board && board.querySelector(`[data-mon="${atk.attacker}"]`); if (el) { el.classList.add('lunge'); setTimeout(() => el.classList.remove('lunge'), 500); } }
  await wait(impact);
  landHits();
}

/* ---------- rendering ---------- */
export function render(main, doc) {
  const g = doc.state; const me = mySeat(doc); const bottom = me || 'a'; const top = other(bottom); const r = R(g.rules);
  const compact = isCompact(); wasCompact = compact;
  const SC = compact ? { active: .3, bench: .22, hand: .36, pile: .22, opp: .26 } : { active: .42, bench: .34, hand: .42, pile: .34, opp: .34 };
  warmMusic(); // cheap after the first call: reads the start-time list once and pre-loads those tracks
  const battleStart = phaseSeen[doc.id] === 'setup' && g.phase === 'main';
  if (battleStart) { playBattleIntro(10); if (fxEnabled()) PT.toast('Battle start!'); }
  phaseSeen[doc.id] = g.phase;
  if (doc.id in winSeen && !winSeen[doc.id] && g.winner) { pendingWin = g.seats[g.winner].name; } winSeen[doc.id] = g.winner || null;
  { const mine = !!(me && !g.winner && g.phase === 'main' && !g.pending.length && g.turn === me); if (doc.id in turnSeen && !turnSeen[doc.id] && mine) pendingTurn = true; turnSeen[doc.id] = mine; }
  if (me) { const ids = g.p[me].hand.map((c) => c.id); const prev = handSeen[doc.id];
    if (!prev || prev.size !== ids.length || ids.some((id) => !prev.has(id))) { if (prev) freshHand[doc.id] = ids.filter((id) => !prev.has(id)); handSeen[doc.id] = new Set(ids); } }
  { const prev = activeSeen[doc.id]; const now = { a: g.p.a.active ? g.p.a.active.id : null, b: g.p.b.active ? g.p.b.active.id : null, cards: {} };
    for (const s of ['a', 'b']) for (const m of mons(g.p[s])) now.cards[m.id] = m.c;
    activeSeen[doc.id] = now;
    if (prev && !battleStart && g.phase === 'main') {
      // a Pokémon in play evolved (active or benched): the evolution is a new id with the old Pokémon right under it
      const evolved = Object.keys(now.cards).filter((id) => { if (!prev.cards || prev.cards[id]) return false; const f = findMon(g, id); const u = f && f.m.un[0]; return !!(u && prev.cards[u.id] === u.c); });
      if (evolved.length) playPokemonMusic(C(now.cards[evolved[evolved.length - 1]]).name);
      else for (const s of [other(bottom), bottom]) { const m = g.p[s].active; if (m && now[s] !== prev[s]) playPokemonMusic(C(m.c).name); }
    } }
  if (seenFxId === null) seenFxId = doc.fx ? doc.fx.id : '';
  else if (doc.fx && doc.fx.id !== seenFxId) { seenFxId = doc.fx.id; pendingFx = doc.fx.events; pendingScene = captureScene(pendingFx, g); }
  const legal = me ? legalActions(g, me, PT.CARDS) : [];
  const pending = g.pending[0];
  const myTurn = me && g.phase === 'main' && g.turn === me && !g.pending.length && !g.winner;
  const chatEl = main.querySelector('#chatin'); const chatPrev = chatEl ? chatEl.value : ''; const chatFocus = chatEl && document.activeElement === chatEl;

  const pileHTML = (seat, z, label, count, faceUp) => `<div class="z"><span class="zlbl">${label}</span><div class="pile" data-pile="${z}" data-seat="${seat}">${count ? (faceUp ? PT.cardHTML(faceUp, SC.pile) : PT.backHTML(SC.pile)) : `<div class="slot">empty</div>`}${count ? `<span class="n">${count}</span>` : ''}</div></div>`;
  const sideHTML = (seat, isTop) => {
    const p = g.p[seat]; const own = seat === me;
    if (g.boss && seat === g.boss.seat) return bossSideHTML(g, seat, compact, SC);
    const prizeClick = pending && pending.t === 'prize' && pending.seat === seat && own;
    const promoteClick = pending && pending.t === 'promote' && pending.seat === seat && own;
    const scB = compact && !own ? SC.opp * 0.85 : SC.bench; const scA = compact && !own ? SC.opp : SC.active;
    const benchSlots = []; for (let i = 0; i < Math.max(r.benchSize, p.bench.length); i++) benchSlots.push(p.bench[i] ? monHTML(p.bench[i], seat, false, promoteClick, scB) : `<div class="slot" style="--s:${scB}">bench</div>`);
    const active = p.active ? monHTML(p.active, seat, true, false, scA) : `<div class="slot big" style="--s:${scA}">${promoteClick ? 'promote from bench' : 'active'}</div>`;
    const counters = `<div class="counters">
      <span class="ctr pile" data-pile="deck" data-seat="${seat}">Deck <b>${p.deck.length}</b></span>
      <span class="ctr pile" data-pile="discard" data-seat="${seat}">Discard <b>${p.discard.length}</b></span>
      ${prizeClick ? `<span class="ctr">Prizes ${p.prizes.map((c, i) => `<span class="pile glow" data-prize="${i}" data-seat="${seat}" style="--s:.14;display:inline-block;vertical-align:middle">${PT.backHTML(.14)}</span>`).join('')}</span>` : `<span class="ctr">Prizes <b>${p.prizes.length}</b></span>`}
      ${own ? '' : `<span class="ctr" data-handzone="${seat}">Hand <b>${p.hand.length}</b></span>`}
    </div>`;
    const rail = compact ? counters : `<div class="zone-row">
      ${pileHTML(seat, 'deck', 'Deck', p.deck.length, null)}
      ${pileHTML(seat, 'discard', 'Discard', p.discard.length, p.discard.length ? p.discard[p.discard.length - 1].c : null)}
      <div class="z"><span class="zlbl">Prizes${prizeClick ? ' · take one' : ''}</span><div class="row" style="gap:3px;flex-wrap:nowrap">${p.prizes.map((c, i) => `<div class="pile ${prizeClick ? 'glow' : ''}" data-prize="${i}" data-seat="${seat}" style="--s:.2">${PT.backHTML(.2)}</div>`).join('') || '<span class="small">none left</span>'}</div><span class="cnt">${p.prizes.length} left</span></div>
      ${own ? '' : (me && seesOpponentHand(g, PT.CARDS, me)) ? `<div class="z" style="align-items:stretch"><span class="zlbl">Their hand (Clairvoyance) · ${p.hand.length}</span><div class="hand">${p.hand.map((c) => PT.cardHTML(c.c, .3)).join('') || '<span class="small">empty</span>'}</div></div>` : `<div class="z" data-handzone="${seat}"><span class="zlbl">Hand</span><div class="row" style="gap:0">${p.hand.slice(0, 12).map((c, i) => `<div style="margin-left:${i ? '-14px' : 0}">${PT.backHTML(.2)}</div>`).join('') || '<span class="small">empty</span>'}</div><span class="cnt">${p.hand.length} cards</span></div>`}
    </div>`;
    const activeZ = `<div class="z" data-active-slot="${seat}"><span class="zlbl">Active</span>${active}</div>`;
    const benchZ = `<div class="z benchz"><span class="zlbl">Bench</span><div class="bench">${benchSlots.join('')}</div></div>`;
    // bench sits along the player's edge, the Active Pokémon in front of it toward the middle of the table
    const field = `<div class="field">${isTop ? benchZ + activeZ : activeZ + benchZ}</div>`;
    const name = `<div class="pname"><span>${esc(g.seats[seat].name)}${own ? ' (you)' : ''}</span>${g.phase === 'main' && g.turn === seat && !g.winner ? `<span class="chip">${own ? 'Your turn' : 'Their turn'}</span>` : ''}${g.phase === 'setup' ? `<span class="chip">${p.setupDone ? 'Ready' : 'Setting up'}</span>` : ''}${g.winner === seat ? '<span class="chip">Winner</span>' : ''}</div>`;
    const HORD = { 'Pokémon': 0, 'Trainer': 1, 'Energy': 2 };
    const handCards = own ? p.hand.slice().sort((x, y) => (HORD[C(x.c).st] ?? 1) - (HORD[C(y.c).st] ?? 1) || C(x.c).name.localeCompare(C(y.c).name)) : p.hand;
    const hand = own ? `<div class="z handz" style="align-items:stretch"><span class="zlbl">${compact ? `Hand · ${p.hand.length} · drag to play` : `Your hand · ${p.hand.length} · drag a card onto a Pokémon or the bench, or tap it for options`}</span><div class="hand ${compact ? 'strip' : ''}" data-handzone="${seat}">${handCards.map((c) => PT.cardHTML(c.c, SC.hand, `data-hand="${c.id}"`, (legal.some((a) => a.card === c.id) ? 'click can' : 'click') + (drawFlying.has(c.id) ? ' incoming' : ''))).join('') || '<span class="small muted">empty</span>'}</div></div>` : '';
    const live = g.phase === 'main' && !g.winner && ((pending && pending.seat === seat) || (!pending && g.turn === seat));
    const cls = `side ${own ? 'mine' : ''} ${live ? 'live' : (g.phase === 'main' && !g.winner ? 'idle' : '')}`;
    return isTop ? `<div class="${cls}">${name}${rail}${field}</div>` : `<div class="${cls}">${name}${field}${rail}${hand}</div>`;
  };
  const statusLine = g.winner ? `${esc(g.seats[g.winner].name)} wins` : g.phase === 'setup' ? 'Setup: place your Basic Pokémon' : pending ? `${pending.seat === me ? 'YOU' : esc(g.seats[pending.seat].name)}: ${pending.t === 'prize' ? 'take a prize' : pending.t === 'promote' ? 'promote a Pokémon' : 'mulligan draw'}` : g.turn === me ? `YOUR TURN · turn ${g.turnNo}` : `${esc(g.seats[g.turn].name)}'s turn · ${g.turnNo}`;
  const waitingOnMe = me && !g.winner && g.phase === 'main' && ((pending && pending.seat === me) || (!pending && g.turn === me));
  const inflightMine = doc.inflight && doc.inflight.prompt && doc.inflight.prompt.seat === me;
  const buttons = me ? `
    ${g.phase === 'setup' && legal.some((a) => a.type === 'mulligan') ? `<button type="button" data-act="mulligan">${legal.some((a) => a.type === 'placeActive') ? 'Mulligan too (optional)' : 'Mulligan (no Basic)'}</button>` : ''}
    ${g.phase === 'setup' && legal.some((a) => a.type === 'setupDone') ? '<button type="button" class="pri" data-act="setupDone">Ready</button>' : ''}
    ${pending && pending.t === 'mulliganDraw' && pending.seat === me ? `<button type="button" class="pri" data-act="mulliganDraw1">Draw ${pending.n} extra</button><button type="button" data-act="mulliganDraw0">Skip</button>` : ''}
    ${undoDepth(doc, me) && !g.winner ? `<button type="button" data-act="undo" title="Undo your last move. You can keep going back through moves that revealed nothing.">Undo${undoDepth(doc, me) > 1 ? ` (${undoDepth(doc, me)})` : ''}</button>` : ''}
    ${legal.some((a) => a.type === 'useStadium') ? `<button type="button" data-act="useStadium">Use ${esc(C(g.stadium.c).name)}</button>` : ''}
    ${myTurn ? '<button type="button" class="pri" data-act="end">End turn</button>' : ''}
    ${g.winner && (me || doc.host === PT.uid()) ? '<button type="button" class="dng" data-act="closeTable" title="Remove this finished table for everyone">Close table</button>' : ''}
    ${inflightMine ? '<button type="button" class="pri" data-act="answer">Answer the prompt</button>' : ''}
    <button type="button" data-act="sound" class="icon" title="${soundOn() ? 'Sound is on (click to mute)' : 'Sound is off (click to unmute)'}">${soundOn() ? '🔊' : '🔇'}</button>
    <button type="button" data-act="more">${compact ? '⋯' : 'More…'}</button>` : '<span class="small">Watching</span>';
  { // surface chat: a message from the other player pops up as a toast, and counts as unread while the compact log is closed
    const chats = (g.log || []).filter((e) => e.k === 'chat');
    if (!(doc.id in chatSeen)) chatSeen[doc.id] = chats.length;
    const fresh = chats.slice(chatSeen[doc.id]); chatSeen[doc.id] = chats.length;
    const myName = me && g.seats[me] ? g.seats[me].name : null;
    for (const e of fresh) if (e.n !== myName) { PT.toast(`💬 ${e.n}: ${e.m}`); if (compact && !logOpen) chatUnread++; }
    if (!compact || logOpen) chatUnread = 0;
  }
  main.innerHTML = `<div class="tablewrap"><div class="board auto">${sideHTML(top, true)}
    <div class="midbar ${waitingOnMe ? 'mine' : ''}"><span class="turn ${waitingOnMe ? 'mine' : ''}">${statusLine}</span>${g.stadium ? `<span class="chip click" data-stadium="${g.stadium.c}" title="Stadium in play (click to read)">Stadium: ${esc(C(g.stadium.c).name)}</span>` : ''}${doc.inflight && !inflightMine ? `<span class="chip">Waiting for ${esc(g.seats[doc.inflight.prompt.seat].name)}…</span>` : ''}<span class="grow"></span>${buttons}</div>
    ${sideHTML(bottom, false)}
    ${compact ? '' : `<div class="legend small"><span class="SLP">Zz Asleep</span><span class="CNF">?! Confused</span><span class="PAR">⚡ Paralyzed</span><span class="PSN">☠ Poisoned</span><span class="BRN">🔥 Burned</span><span class="FX">Effect tags</span><span class="muted">An effect tag names the attack or Trainer affecting that Pokémon. Hover or tap it to see what it does.</span></div>`}</div>
    <aside class="logpane panel ${compact ? 'compact' : ''} ${logOpen ? 'open' : ''}"><div class="row"><h3 class="grow">${esc(doc.name)}</h3>${compact ? `<button class="sm" type="button" data-act="toggleLog">${logOpen ? 'Hide log' : `Log${chatUnread ? ' · ' + chatUnread + ' 💬' : ''}`}</button>` : '<span class="chip">Auto rules</span>'}<button class="sm" type="button" data-act="rules">Rules</button></div>
    <div class="entries" id="logentries">${g.log.slice().reverse().map((e) => `<div class="e ${e.k === 'chat' ? 'chat' : ''}">${e.k === 'chat' ? `<b>${esc(e.n)}:</b> ${esc(e.m)}` : esc(e.m)}<span class="t">${e.turn != null ? 'T' + e.turn : ''}</span></div>`).join('')}</div>
    ${me ? `<form id="chat"><input type="text" id="chatin" placeholder="Say something" maxlength="200" class="grow" autocomplete="off"><button class="sm" type="submit">Send</button></form>` : ''}</aside></div>`;
  const chatNew = main.querySelector('#chatin'); if (chatNew && chatPrev) { chatNew.value = chatPrev; if (chatFocus) chatNew.focus(); }
  attachLayer(main.querySelector('.board.auto'));
  if (boardPickState) { if (boardHasMons(boardPickState.ids)) applyBoardPick(); else endBoardPick(null); }
  if (pendingWin) { const n = pendingWin; pendingWin = null; setTimeout(async () => { if (rescuePlaying) await rescuePlaying; const bd = main.querySelector('.board.auto'); playEventMusic('victory', 30).then((ok) => playWin(bd, n, { quiet: ok }), () => playWin(bd, n)); }, 400); }
  if (pendingTurn) { pendingTurn = false; const b = main.querySelector('.board.auto'); if (b) { const el = document.createElement('div'); el.className = 'turnbanner'; el.textContent = 'YOUR TURN'; b.appendChild(el); setTimeout(() => el.remove(), 1600); } playTurnChime();
    if (document.hidden) { const t0 = document.title; document.title = '🔔 Your turn! · ' + t0.replace(/^🔔 Your turn! · /, ''); const back = () => { if (!document.hidden) { document.title = t0.replace(/^🔔 Your turn! · /, ''); document.removeEventListener('visibilitychange', back); } }; document.addEventListener('visibilitychange', back); } }
  if (pendingFx) { const ev = pendingFx; pendingFx = null; const sc = pendingScene; pendingScene = null; playEvents(ev, doc, mergeScene(sc, captureScene(ev, g))); }
  maybeRunBot(doc);
  const chat = main.querySelector('#chat'); if (chat) chat.onsubmit = (e) => { e.preventDefault(); const i = chat.querySelector('#chatin'); const v = i.value.trim(); if (!v) return; i.value = ''; if (isCompact() && !logOpen) { logOpen = true; chatUnread = 0; } submit({ type: 'chat', text: v }); };

  if (me) setupDrag(main, doc, legal, me);
  if (me) setupArrange(main, doc, legal, me); else arrangeState = null;
  main.onclick = (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const t = e.target; if (boardPickClick(t)) return; const btn = t.closest('button');
    if (btn && btn.dataset.act) return onButton(btn.dataset.act, btn, doc, legal, me);
    const stEl = t.closest('[data-stadium]'); if (stEl) return PT.viewCard(stEl.dataset.stadium);
    const chip = t.closest('.FX[data-desc]'); if (chip) return PT.toast(chip.dataset.desc);
    const hand = t.closest('[data-hand]'); if (hand && me) return handMenu(doc, legal, hand.dataset.hand, hand);
    const mon = t.closest('[data-mon]');
    if (mon && arrangeState && arrangeTapSel && mon.classList.contains('drop-ok')) { const sel = arrangeTapSel; arrangeTapSel = null; clearTapClasses(main.querySelector('.board.auto')); arrangeMove(sel.from, mon.dataset.mon, sel.card); return; }
    if (mon) return monMenu(doc, legal, mon.dataset.mon, mon, me);
    const prize = t.closest('[data-prize]'); if (prize && me && prize.dataset.seat === me && pending && pending.t === 'prize' && pending.seat === me) return submit({ type: 'takePrize', index: +prize.dataset.prize });
    const pile = t.closest('[data-pile]'); if (pile) { if (pile.dataset.pile === 'discard') return viewPile(doc, pile.dataset.seat, 'discard'); if (pile.dataset.pile === 'deck' && me === pile.dataset.seat) return deckMenu(doc, pile); }
  };
  // if an inflight prompt is for me and no modal is open, open it
  if (inflightMine && !promptOpen && !document.querySelector('#modal-bg')) answerInflight(doc);
}

/* ---------- effect tags ---------- */
const FX_INFO = {
  preventDamage: ['Shield', 'Prevents all damage done to it by attacks'],
  preventAll: ['Barrier', 'Prevents all effects of attacks, including damage, done to it'],
  preventSmall: ['Harden', 'Prevents damage of 30 or less done to it by attacks'],
  reduce: ['Guard', (f) => `Damage done to it by attacks is reduced by ${f.amount}`],
  halveNext: ['Deflect', 'Damage done to it by attacks is halved'],
  defender: ['Defender', 'Damage done to it by attacks is reduced by 20'],
  plusPower: ['PlusPower', 'Its attacks do 10 more damage this turn'],
  destinyBond: ['Destiny Bond', 'If an attack Knocks it Out, the attacking Pokémon is Knocked Out too'],
  sandAttack: ['Smokescreen', 'It must flip a coin before attacking; on tails the attack does nothing'],
  noAttack: ['No attack', (f) => (f.attack ? `It can't use ${f.attack}` : "It can't attack")],
  noRetreat: ['No retreat', "It can't retreat"],
  noAttach: ['No energy', "Energy can't be attached to it"],
  mirrorShell: ['Mirror', 'Damage done to it by attacks is also done to the attacker'],
  focus: ['Focus', (f) => `Its ${f.attack} does double damage`],
  swordsDance: ['Swords Dance', 'Its next Slash does double damage'],
  shadowImages: ['Shadow Images', 'Attacks against it need a coin flip; on tails they do no damage'],
  crosscounter: ['Crosscounter', 'If an attack damages it, flip a coin; heads deals double that damage back'],
  firewall: ['Fire Wall', 'Any Pokémon that damages it takes 10 damage'],
  charity: ['Charity', 'Its attack damage is reduced by the amount chosen'],
  bonus: ['Boost', (f) => `Its attacks do ${f.amount} more damage`],
  powerOff: ['Power off', 'Its Pokémon Power stops working'],
};
function describeFx(f, g) {
  const info = FX_INFO[f.k] || [f.k, 'An effect from ' + (f.src || 'an attack')];
  const what = typeof info[1] === 'function' ? info[1](f) : info[1];
  let when = '';
  if (f.until == null) when = f.benchClears ? ' until it is benched or evolves' : '';
  else if (f.until <= g.turnNo) when = ' until the end of this turn';
  else if (f.until === g.turnNo + 1) when = ' until the end of the next turn';
  else when = ` for ${f.until - g.turnNo} more turns`;
  const label = f.src || info[0];
  return { label, desc: `${label}: ${what}${when}.` };
}

const BOOSTS = {
  plusPower: { cls: 'pp', icon: '⚔', sign: '+', amt: 10, label: 'PlusPower', what: 'its attack does more damage this turn' },
  defender: { cls: 'df', icon: '🛡', sign: '−', amt: 20, label: 'Defender', what: 'attacks do less damage to it until the end of the opponent’s next turn' },
};
/* A Colossal Pokémon's side of the table: the giant itself, its HP bar (marked where each Prize is earned), what it
   will do next, the Knock Outs it has, and its weak points. It has no deck, hand or Prizes to show. */
function bossSideHTML(g, seat, compact, SC) {
  const b = g.boss; const p = g.p[seat]; const m = p.active && p.active.id === b.id ? p.active : null; const c = C(b.cid); const def = c.boss || {};
  const hp = c.hp || 1; const left = m ? Math.max(0, hp - m.dmg) : 0; const frac = left / hp;
  const turnNow = g.phase === 'main' && !g.winner && !g.pending.length && g.turn === seat;
  const live = g.phase === 'main' && !g.winner && ((g.pending[0] && g.pending[0].seat === seat) || (!g.pending.length && g.turn === seat));
  const nx = nextBossAttack(g, PT.CARDS); const rage = def.enrage && m && m.dmg * 2 >= hp ? def.enrage : 0;
  const nextHTML = !m ? '' : nx.atk
    ? `<b>${esc(nx.atk.name)}</b>${nx.atk.dmg ? `<span class="bn-d">${nx.atk.flips ? nx.atk.dmg + rage + '×' : nx.atk.dmg + rage}</span>` : ''}<span class="bn-t">${esc(nx.card.t || '')}</span>`
    : `<b>Gathering strength</b><span class="bn-t">No attack ${turnNow ? 'this' : 'on its next'} turn.</span>`;
  const pips = Array.from({ length: b.r.kos }, (_, i) => `<i class="${i < b.kos ? 'on' : ''}"></i>`).join('');
  const ticks = [1, 2, 3, 4, 5].map((i) => `<s class="${i <= b.given ? 'got' : ''}" style="left:${(100 - i / 6 * 100).toFixed(2)}%"></s>`).join('');
  const traits = [def.armor ? [`🛡 Armor ${def.armor}`, `Takes ${def.armor} less damage from each attack. Hits on a weak point ignore it.`] : null,
    def.thorns ? [`✊ Strikes back ${def.thorns}`, `Any Pokémon that damages it with an attack takes ${def.thorns}.`] : null,
    def.enrage ? [`${rage ? '🔥 Enraged' : '🔥 Enrages at half HP'} +${def.enrage}`, `At half HP or less its attacks do ${def.enrage} more damage.`] : null]
    .filter(Boolean).map(([t, d]) => `<span class="btrait${/Enraged/.test(t) ? ' hot' : ''}" title="${esc(d)}">${esc(t)}</span>`).join('');
  const scBoss = compact ? .36 : .6; const scPart = compact ? .13 : .17;
  const fig = m ? monHTML(m, seat, true, false, scBoss) : `<div class="bossdown">${PT.cardHTML(b.cid, scBoss)}<span>Defeated</span></div>`;
  const parts = p.bench.length ? `<div class="bossparts"><span class="k" title="Damage done to a weak point is done to ${esc(c.name)}. Attacks that hit the Bench hit these.">Weak points</span><div class="bp-row">${p.bench.map((x) => monHTML(x, seat, false, false, scPart)).join('')}</div></div>` : '';
  return `<div class="side boss ${live ? 'live' : (g.phase === 'main' && !g.winner ? 'idle' : '')}${rage ? ' raging' : ''}">
    <div class="pname"><span>${esc(g.seats[seat].name)}</span>${turnNow ? '<span class="chip">Its turn</span>' : ''}${g.winner === seat ? '<span class="chip">Winner</span>' : ''}</div>
    <div class="bossrow"><div class="bossfig" data-active-slot="${seat}">${fig}</div>
      <div class="bossinfo">
        <div class="bosshp"><div class="bossbar ${frac <= .25 ? 'crit' : frac <= .5 ? 'hurt' : ''}" title="Each mark is a Prize for you."><i style="width:${(frac * 100).toFixed(1)}%"></i>${ticks}</div><div class="bosshpn"><b>${left}</b> / ${hp} HP</div></div>
        ${m ? `<div class="bossnext${nx.atk ? '' : ' rest'}"><span class="k">${turnNow ? 'This turn' : 'Next turn'}</span>${nextHTML}</div>` : ''}
        <div class="bosskos" title="It wins when it has Knocked Out ${b.r.kos} of your Pokémon."><span class="k">Knock Outs</span><span class="pips">${pips}</span><b>${b.kos} / ${b.r.kos}</b></div>
        ${traits ? `<div class="bosstraits">${traits}</div>` : ''}${parts}
      </div></div></div>`;
}
function monHTML(m, seat, active, promoteClick, scale) {
  const c = C(m.c); const hp = c.hp; const sc = scale || (active ? .42 : .34); const compact = isCompact(); const step = Math.round(330 * sc * (compact ? 0.12 : 0.13));
  // PlusPower and Defender sit beside the Pokémon (a rail next to the Active, badges on the bench) instead of in the attached stack
  const boostFx = m.fx.filter((f) => BOOSTS[f.k] && f.card); const boostIds = new Set(boostFx.map((f) => f.card));
  const groups = Object.keys(BOOSTS).map((k) => ({ k, b: BOOSTS[k], cards: m.tools.filter((t) => boostFx.some((f) => f.k === k && f.card === t.id)) })).filter((x) => x.cards.length);
  const tip = (x) => esc(`${x.cards.length > 1 ? x.cards.length + ' × ' : ''}${x.b.label}: ${x.b.what}`);
  const bsc = sc * 0.6;
  const boosts = !groups.length ? '' : active
    ? `<div class="boosts">${groups.map((x) => `<div class="boost ${x.b.cls}" title="${tip(x)}"><div class="bc">${x.cards.map((t, i) => `<div style="margin-top:${i ? -Math.round(bsc * 330 * 0.8) : 0}px">${PT.cardHTML(t.c, bsc)}</div>`).join('')}</div><span class="bv">${x.b.icon} ${x.b.sign}${x.b.amt * x.cards.length}</span></div>`).join('')}</div>`
    : `<div class="boostchips">${groups.map((x) => `<span class="${x.b.cls}" title="${tip(x)}">${x.b.icon} ${x.b.sign}${x.b.amt * x.cards.length}</span>`).join('')}</div>`;
  const att = [...m.en, ...m.tools.filter((t) => !boostIds.has(t.id))]; const n = att.length;
  const stack = att.map((x, i) => `<div class="attc" data-att="${x.id}" data-owner="${m.id}" style="top:${i * step}px;z-index:${i + 1}">${PT.cardHTML(x.c, sc)}</div>`).join('');
  const GL = { SLP: 'Zz', CNF: '?!', PAR: '⚡', PSN: '☠', BRN: '🔥' }; const stChips = m.st.map((s) => `<span class="${s}" title="${STATUS_NAMES[s]}">${GL[s]} ${active ? STATUS_NAMES[s] : s}</span>`).join('');
  const fxChips = m.fx.filter((f) => !(BOOSTS[f.k] && f.card)).map((f) => { const d = describeFx(f, PT.S.game.state); return `<span class="FX" title="${esc(d.desc)}" data-desc="${esc(d.desc)}">${esc(d.label)}</span>`; }).join('');
  const left = hp ? (hp - m.dmg) / hp : 1; const hurt = left <= 0.25 ? 'critical' : left <= 0.5 ? 'hurt' : '';
  return `<div class="mon ${active ? 'active' : ''} ${promoteClick ? 'glow' : ''} ${hurt}" data-mon="${m.id}" tabindex="0"><div class="cdwrap" style="padding-top:${n * step}px">${stack}<div class="poke" style="z-index:${n + 1}">${PT.cardHTML(m.c, sc)}${hp ? `<span class="hp" style="--hpf:${Math.max(0, left).toFixed(2)};--hpc:${left > 0.5 ? '#4cd07d' : left > 0.25 ? '#ffcb05' : '#ff5a4e'}">${Math.max(0, hp - m.dmg)}/${hp}</span>` : ''}${m.dmg ? `<span class="dmg" data-dmg-of="${m.id}">${m.dmg}</span>` : ''}${m.st.length || fxChips ? `<div class="sts">${stChips}${fxChips}</div>` : ''}${m.un.length ? `<span class="stk">+${m.un.length} under</span>` : ''}${boosts}</div></div>${n ? `<div class="attn">${n} attached</div>` : ''}</div>`;
}

/* ---------- the computer opponent ----------
   When a seat belongs to the computer, the human opponent's browser makes its moves: one action per step with a short
   pause so the table animates, prompts answered by the bot module, parked prompts for the bot answered the same way. */
const botSeat = (doc) => (doc.seats.a.uid === BOT_UID ? 'a' : doc.seats.b.uid === BOT_UID ? 'b' : null);
let botTimer = null; const botSkip = new Set(); let botSkipTurn = -1;
function botNeedsToAct(doc, bs) {
  const g = doc.state; if (!g || g.winner) return false;
  if (doc.inflight) return doc.inflight.prompt && doc.inflight.prompt.seat === bs;
  if (g.phase === 'setup') return !g.p[bs].setupDone;
  if (g.pending.length) return g.pending[0].seat === bs;
  return g.turn === bs;
}
function maybeRunBot(doc) {
  const bs = botSeat(doc); if (!bs || !doc.state) return;
  if (mySeat(doc) !== other(bs)) return;
  if (!botNeedsToAct(doc, bs) || botTimer) return;
  botTimer = setTimeout(() => { botTimer = null; botStep().catch((e) => console.warn('bot step failed', e)); }, doc.state.phase === 'setup' ? 400 : 900);
}
async function botStep() {
  const doc = PT.S.game; if (!doc || !doc.state) return; const bs = botSeat(doc); if (!bs || !botNeedsToAct(doc, bs)) return;
  const g = doc.state; if (botSkipTurn !== g.turnNo) { botSkip.clear(); botSkipTurn = g.turnNo; }
  let action;
  if (doc.inflight) { const inf = doc.inflight; action = { ...inf.action, answers: [...(inf.action.answers || []), botAnswer(inf.prompt, g, bs, PT.CARDS)] }; }
  else {
    const a = botAction(g, bs, PT.CARDS, botSkip);
    if (!a) { if (g.turn === bs && g.phase === 'main' && !g.pending.length) action = { type: 'endTurn', seat: bs, seed: randomSeed(), answers: [] }; else return; }
    else { const { name, ...rest } = a; action = { ...rest, seat: bs, seed: randomSeed(), answers: [] }; }
  }
  for (let i = 0; i < 16; i++) {
    const r = apply(doc.state, action, PT.CARDS);
    if (r.error) { console.warn('computer: refused', r.error, action); botSkip.add(botKey(action)); maybeRunBot(doc); return; }
    if (r.prompt) {
      if (r.prompt.seat === bs) { action = { ...action, answers: [...action.answers, botAnswer(r.prompt, doc.state, bs, PT.CARDS)] }; continue; }
      doc.inflight = { action, prompt: r.prompt }; await PT.saveGame(doc); PT.render(); return; // the human has to answer
    }
    const scene = captureScene(r.events, doc.state);
    doc.prev = null; doc.undo = []; doc.state = r.state; doc.inflight = null; doc.status = r.state.status; if (r.state.winner) doc.winner = r.state.winner;
    publishFx(doc, r.events); PT.render(); playEvents(r.events, doc, scene); await PT.saveGame(doc); return;
  }
  console.warn('computer: gave up on a prompt loop', action); botSkip.add(botKey(action)); maybeRunBot(doc);
}

/* ---------- drag and drop ----------
   Drag a hand card onto one of your Pokémon (attach energy / evolve), a Basic onto your bench (play it), a Trainer onto the
   field of play (either side, or the middle bar) to play it, or a benched Pokémon onto your Active spot (retreat / promote). Taps still open the menus. */
/* ---------- arrange mode: Energy Trans, Damage Swap ----------
   Instead of answering "from which Pokémon / which card / to which Pokémon" every time, you drag: an attached Energy
   (Energy Trans) or the damage badge (Damage Swap, one counter per drag) from one of your Pokémon onto another.
   Each drop is one use of the power. A bar at the top of the board has Done. */
const ARRANGE = {
  'Energy Trans': { kind: 'energy', hint: 'drag an Energy from one of your Pokémon onto another — or tap it, then tap the target' },
  'Damage Swap': { kind: 'damage', hint: 'drag a damage counter (the red badge) onto another of your Pokémon — or tap it, then tap the target' },
};
let arrangeState = null;
let arrangeTapSel = null; // tap-to-move (phones): a picked-up Energy / damage counter waiting for a target tap
function clearTapClasses(b) { if (!b) return; b.querySelectorAll('.arrange-src.picked').forEach((el) => el.classList.remove('picked')); b.querySelectorAll('.mon.drop-ok').forEach((el) => el.classList.remove('drop-ok', 'drop-hover')); }
function startArrange(pid, power) { arrangeState = { pid, power, ...ARRANGE[power] }; arrangeTapSel = null; PT.render(); }
function stopArrange() { arrangeState = null; arrangeTapSel = null; PT.render(); }
function arrangeMove(from, to, card) {
  const st = arrangeState; if (!st) return;
  const answers = st.kind === 'energy' ? { transFrom: from, transCard: card, transTo: to } : { swapFrom: from, swapTo: to };
  return submit({ type: 'usePower', pokemon: st.pid, power: st.power }, [], { autoAnswer: (p) => (p.id in answers && p.options.some((o) => o.key === answers[p.id]) ? [answers[p.id]] : undefined) });
}
function setupArrange(main, doc, legal, me) {
  const b = main.querySelector('.board.auto'); if (!b) return;
  if (!arrangeState) return;
  const g = doc.state; const mine = mons(g.p[me]); const still = legal.some((a) => a.type === 'usePower' && a.pokemon === arrangeState.pid && a.power === arrangeState.power);
  if (!mine.some((m) => m.id === arrangeState.pid) || !still) { arrangeState = null; return; }
  b.classList.add('arranging');
  const bar = document.createElement('div'); bar.className = 'pickbar';
  bar.innerHTML = `<span class="grow"><b>${esc(arrangeState.power)}</b><span class="small muted"> · ${esc(arrangeState.hint)}</span></span><button type="button" class="sm pri" data-arrange="done">Done</button>`;
  b.appendChild(bar); bar.querySelector('[data-arrange="done"]').onclick = (e) => { e.stopPropagation(); stopArrange(); };
  const ownIds = new Set(mine.map((m) => m.id));
  const sources = arrangeState.kind === 'energy'
    ? [...b.querySelectorAll('.attc[data-att]')].filter((el) => ownIds.has(el.dataset.owner) && (g.p[me].active && g.p[me].active.id === el.dataset.owner ? g.p[me].active : g.p[me].bench.find((m) => m.id === el.dataset.owner)).en.some((e) => e.id === el.dataset.att))
    : [...b.querySelectorAll('.dmg[data-dmg-of]')].filter((el) => ownIds.has(el.dataset.dmgOf));
  const applyTapSel = () => {
    if (!arrangeTapSel) return;
    const src = sources.find((s) => (s.dataset.att || s.dataset.dmgOf) === arrangeTapSel.key);
    if (!src) { arrangeTapSel = null; return; }
    src.classList.add('picked');
    [...b.querySelectorAll('.mon[data-mon]')].filter((t) => ownIds.has(t.dataset.mon) && t.dataset.mon !== arrangeTapSel.from).forEach((t) => t.classList.add('drop-ok'));
  };
  for (const el of sources) {
    el.classList.add('arrange-src');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const from = el.dataset.owner || el.dataset.dmgOf; const card = el.dataset.att || null;
      const targets = [...b.querySelectorAll('.mon[data-mon]')].filter((t) => ownIds.has(t.dataset.mon) && t.dataset.mon !== from);
      const sx = e.clientX, sy = e.clientY; let ghost = null, hover = null;
      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return; // not a drag yet — a plain tap picks the chip up instead
          targets.forEach((t) => t.classList.add('drop-ok'));
          ghost = (el.querySelector('.cd') || el).cloneNode(true); ghost.classList.add('dragghost'); if (!card) ghost.textContent = '10';
          document.body.appendChild(ghost);
        }
        moveGhost(ghost, ev.clientX, ev.clientY);
        const u = document.elementFromPoint(ev.clientX, ev.clientY); const hit = u && targets.find((t) => t.contains(u));
        if (hover && hover !== hit) hover.classList.remove('drop-hover'); hover = hit || null; if (hover) hover.classList.add('drop-hover');
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 300);
        if (ghost) { // a real drag ended
          ghost.remove(); targets.forEach((t) => t.classList.remove('drop-ok', 'drop-hover'));
          arrangeTapSel = null; clearTapClasses(b);
          if (ev.type === 'pointercancel') return;
          const u = document.elementFromPoint(ev.clientX, ev.clientY); const hit = u && targets.find((t) => t.contains(u));
          if (hit) arrangeMove(from, hit.dataset.mon, card);
          return;
        }
        if (ev.type === 'pointercancel') return;
        // a plain tap: pick the chip up, drop onto a tapped target's chip, or tap again to put it back down
        if (arrangeTapSel) {
          const sel = arrangeTapSel;
          if (sel.key === (card || from)) { arrangeTapSel = null; clearTapClasses(b); return; }
          if (from !== sel.from) { arrangeTapSel = null; clearTapClasses(b); arrangeMove(sel.from, from, sel.card); return; }
        }
        arrangeTapSel = { from, card, key: card || from };
        clearTapClasses(b); applyTapSel();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  }
  applyTapSel(); // a tap selection survives re-renders
}
/** Drag ghosts move by transform, so following the pointer doesn't repaint the table under them. */
function moveGhost(ghost, x, y) { ghost.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(1.08)`; }
function setupDrag(main, doc, legal, me) {
  const g = doc.state; const board = main.querySelector('.board.auto'); if (!board) return;
  const myActiveSlot = board.querySelector(`[data-active-slot="${me}"]`); const myBench = board.querySelector('.side.mine .benchz');
  const playArea = [...board.querySelectorAll('.field, .midbar')]; // anywhere on the table (not the hand) plays a Trainer
  const monEl = (id) => board.querySelector(`[data-mon="${id}"]`);
  /** What a source can be dropped on: [{el, action}] */
  const targetsFor = (src) => {
    const out = [];
    if (src.kind === 'hand') {
      for (const a of legal) {
        if (a.card !== src.id) continue;
        if ((a.type === 'attach' || a.type === 'evolve') && monEl(a.target)) out.push({ el: monEl(a.target), action: a });
        if (a.type === 'playBasic' && myBench) out.push({ el: myBench, action: a });
        if (a.type === 'playTrainer') for (const el of playArea) out.push({ el, action: a });
        if ((a.type === 'placeActive' || a.type === 'placeBench') && (a.type === 'placeActive' ? myActiveSlot : myBench)) out.push({ el: a.type === 'placeActive' ? myActiveSlot : myBench, action: a });
      }
    } else {
      for (const a of legal) if ((a.type === 'retreat' || a.type === 'promote') && a.target === src.id && myActiveSlot) out.push({ el: myActiveSlot, action: a });
    }
    return out;
  };
  const sources = [...main.querySelectorAll('.side.mine [data-hand], .side.mine .benchz [data-mon]')];
  for (const el of sources) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      const src = el.dataset.hand ? { kind: 'hand', id: el.dataset.hand } : { kind: 'mon', id: el.dataset.mon };
      const targets = targetsFor(src); if (!targets.length) return;
      const sx = e.clientX, sy = e.clientY; let dragging = false, ghost = null, hover = null;
      const strip = el.closest('.hand.strip');
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!dragging) {
          if (Math.hypot(dx, dy) < 10) return;
          if (strip && Math.abs(dx) > Math.abs(dy) * 1.5) { cleanup(); return; } // horizontal swipe on the hand strip: let it scroll
          dragging = true; try { el.setPointerCapture(ev.pointerId); } catch (x) { /* ignore */ }
          const cd = el.classList.contains('cd') ? el : el.querySelector('.poke .cd') || el;
          ghost = cd.cloneNode(true); ghost.className = 'cd dragghost'; ghost.style.cssText += `;--s:${getComputedStyle(cd).getPropertyValue('--s') || .4}`; document.body.appendChild(ghost);
          for (const t of targets) t.el.classList.add('drop-ok'); el.classList.add('dragging');
        }
        moveGhost(ghost, ev.clientX, ev.clientY);
        const under = document.elementFromPoint(ev.clientX, ev.clientY); const hit = under && targets.find((t) => t.el === under || t.el.contains(under));
        if (hover && hover !== (hit && hit.el)) hover.classList.remove('drop-hover'); hover = hit ? hit.el : null; if (hover) hover.classList.add('drop-hover');
        ev.preventDefault();
      };
      const up = (ev) => {
        const was = dragging; let hit = null;
        if (was) { ghost.remove(); const under = document.elementFromPoint(ev.clientX, ev.clientY); hit = under && targets.find((t) => t.el === under || t.el.contains(under)); }
        cleanup();
        if (!was) return;
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 400);
        if (hit) { const a = { ...hit.action }; delete a.name; submit(a); }
      };
      const cleanup = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); for (const t of targets) { t.el.classList.remove('drop-ok'); t.el.classList.remove('drop-hover'); } el.classList.remove('dragging'); if (ghost && ghost.isConnected) ghost.remove(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  }
}

/* ---------- menus ---------- */
function onButton(act, btn, doc, legal, me) {
  const g = doc.state;
  if (act === 'end') return submit({ type: 'endTurn' });
  if (act === 'closeTable') return PT.confirmDeleteGame(doc.id);
  if (act === 'undo') return undo(doc);
  if (act === 'setupDone') return submit({ type: 'setupDone' });
  if (act === 'mulligan') return submit({ type: 'mulligan' });
  if (act === 'mulliganDraw1') return submit({ type: 'mulliganDraw', n: g.pending[0].n });
  if (act === 'mulliganDraw0') return submit({ type: 'mulliganDraw', n: 0 });
  if (act === 'answer') return answerInflight(doc);
  if (act === 'useStadium') return submit({ type: 'useStadium' });
  if (act === 'toggleLog') { logOpen = !logOpen; if (logOpen) chatUnread = 0; return PT.render(); }
  if (act === 'sound') { setSoundVolume(soundOn() ? 0 : 0.6); PT.toast(soundOn() ? 'Sound on' : 'Sound off'); return PT.render(); }
  if (act === 'rules') return PT.showModal('Rules at this table', `<p>${esc(PT.rulesSummary(g.rules))}</p>${g.rules.notes ? `<div class="notice info" style="white-space:pre-wrap">${esc(g.rules.notes)}</div>` : ''}<p class="small muted">Automated rules: the table enforces costs, timing, damage, conditions and prizes.</p>`);
  if (act === 'more') {
    const items = [];
    if (me) items.push({ label: 'I concede', danger: true, fn: () => submit({ type: 'concede' }) }, { sep: true });
    items.push({ label: fxEnabled() ? 'Attack animations: on' : 'Attack animations: off', fn: () => { setFxEnabled(!fxEnabled()); PT.toast(fxEnabled() ? 'Animations on' : 'Animations off'); } });
    items.push({ label: soundOn() ? 'Sound effects: on' : 'Sound effects: off', fn: () => { setSoundVolume(soundOn() ? 0 : 0.6); PT.toast(soundOn() ? 'Sound on' : 'Sound off'); } });
    items.push({ label: 'Report a problem…', fn: () => PT.report() });
    items.push({ label: 'Back to lobby', fn: () => PT.go('lobby') });
    return PT.showMenu(items, btn, 'More');
  }
}
async function answerInflight(doc) {
  const inf = doc.inflight; if (!inf) return;
  const ans = await promptModal(inf.prompt); if (ans == null) return;
  const action = { ...inf.action, answers: [...(inf.action.answers || []), ans] };
  // re-run as the original actor; the engine state is unchanged since the action was parked
  const r = apply(doc.state, action, PT.CARDS);
  if (r.error) { PT.toast(r.error); return; }
  if (r.prompt) { if (r.prompt.seat === mySeat(doc)) { doc.inflight = { action, prompt: r.prompt }; return answerInflight(doc); } doc.inflight = { action, prompt: r.prompt }; await PT.saveGame(doc); PT.render(); return; }
  const scene = captureScene(r.events, doc.state);
  doc.prev = null; doc.undo = []; doc.state = r.state; doc.inflight = null; doc.status = r.state.status; if (r.state.winner) doc.winner = r.state.winner;
  publishFx(doc, r.events); PT.render(); playEvents(r.events, doc, scene); await PT.saveGame(doc);
}
function handMenu(doc, legal, iid, anchor) {
  const g = doc.state; const me = mySeat(doc); const card = g.p[me].hand.find((c) => c.id === iid); if (!card) return; const c = C(card.c);
  const acts = legal.filter((a) => a.card === iid); const items = [{ label: 'View card', fn: () => PT.viewCard(card.c) }];
  if (acts.length) items.push({ sep: true });
  const targets = (type) => acts.filter((a) => a.type === type).map((a) => ({ label: `${type === 'attach' ? 'Attach to' : 'Evolve'} ${nm(findMon(g, a.target).m)}${findMon(g, a.target).m === g.p[me].active ? ' (Active)' : ''}`, fn: () => submit({ type, card: iid, target: a.target }) }));
  items.push(...targets('attach'), ...targets('evolve'));
  if (acts.some((a) => a.type === 'playBasic')) items.push({ label: g.p[me].active ? 'Put on Bench' : 'Play as Active', fn: () => submit({ type: 'playBasic', card: iid }) });
  if (acts.some((a) => a.type === 'placeActive')) items.push({ label: 'Place as Active', fn: () => submit({ type: 'placeActive', card: iid }) });
  if (acts.some((a) => a.type === 'placeBench')) items.push({ label: 'Place on Bench', fn: () => submit({ type: 'placeBench', card: iid }) });
  if (acts.some((a) => a.type === 'playTrainer')) items.push({ label: `Play ${c.name}`, fn: () => submit({ type: 'playTrainer', card: iid }) });
  if (!acts.length && c.st === 'Trainer' && !scriptOf(card.c).trainer) items.push({ label: `${c.name} isn't automated yet`, fn: () => PT.toast(`${c.name} can't be played yet`) });
  PT.showMenu(items, anchor, c.name);
}
function monMenu(doc, legal, pid, anchor, me) {
  const g = doc.state; const f = findMon(g, pid); if (!f) return; const m = f.m; const own = f.seat === me; const c = C(m.c);
  let items = [{ label: 'View card', fn: () => PT.viewCard(m.c) }];
  if (own && me) {
    const atks = (c.atk || []).map((a, i) => ({ a, i, chk: canAttack(g, me, i, PT.CARDS) }));
    if (f.p.active && f.p.active.id === pid && atks.length) { items.push({ sep: true }); for (const { a, i, chk } of atks) items.push({ label: `${a.n} ${a.d || ''} (${a.c.length} energy)${chk.ok ? '' : ' — ' + chk.why}`, disabled: !chk.ok, fn: () => chk.ok && submit({ type: 'attack', index: i }) }); }
    const pws = legal.filter((a) => a.type === 'usePower' && a.pokemon === pid); for (const a of pws) items.push({ label: `Use ${a.power}${ARRANGE[a.power] ? ' (drag to move)' : ''}`, fn: () => (ARRANGE[a.power] ? startArrange(pid, a.power) : submit({ type: 'usePower', pokemon: pid, power: a.power })) });
    const rts = legal.filter((a) => a.type === 'retreat'); if (f.p.active && f.p.active.id === pid && rts.length) items.push({ label: 'Retreat…', fn: () => boardPick('Retreat: which Pokémon comes in?', rts.map((a) => a.target)).then((k) => { if (k && k !== 'none') submit({ type: 'retreat', target: k }); }) });
    const pks = legal.filter((a) => a.type === 'pickupEnergy' && a.target === pid); if (pks.length) items.push({ label: 'Pick up an Energy… (instead of attaching)', fn: () => PT.showMenu(pks.map((a) => ({ label: `Take ${nm(m.en.find((e) => e.id === a.card))} to hand`, fn: () => submit({ type: 'pickupEnergy', target: pid, card: a.card }) })), anchor, 'Pick up') });
    if (legal.some((a) => a.type === 'promote' && a.target === pid)) items.push({ label: 'Promote to Active', fn: () => submit({ type: 'promote', target: pid }) });
    if (legal.some((a) => a.type === 'discardDoll' && a.pokemon === pid)) items.push({ label: 'Discard', fn: () => submit({ type: 'discardDoll', pokemon: pid }) });
  }
  PT.showMenu(items, anchor, `${g.seats[f.seat].name}'s ${c.name}`);
}
function deckMenu(doc, anchor) { const g = doc.state; const me = mySeat(doc); if (me) PT.toast(`${g.p[me].deck.length} cards left in your deck`); }
function viewPile(doc, seat, zone) {
  const g = doc.state; const me = mySeat(doc); const cards = g.p[seat][zone].slice().reverse();
  PT.showModal(`${g.seats[seat].name}'s ${zone} · ${cards.length}`, `<div class="pickgrid">${cards.map((c) => `<div class="pk" data-card="${c.id}"><div class="cd" style="${PT.cardStyle(c.c)}" data-cid="${c.c}"></div><div class="nm">${esc(nm(c))}</div></div>`).join('') || '<p class="muted">Empty.</p>'}</div>`, me === seat ? '<span class="small muted">Click a card to move it (fix).</span>' : '', (m) => {
  });
}
