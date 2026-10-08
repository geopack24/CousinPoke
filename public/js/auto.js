// Automated-rules table: renders an engine game and turns clicks into engine actions.
// The page exposes a small bridge (window.PT) with shared helpers; this module owns everything on the board.
import { apply, legalActions, STATUS_NAMES, energyUnits, canAttack, scriptOf } from './engine/engine.js';
import { newGame, other, mons, findMon } from './engine/state.js';
import { randomSeed } from './engine/rng.js';
import { R } from './engine/rules.js';
import { automationReport } from './engine/cards/index.js';

let PT = null;           // bridge from index.html
let promptOpen = null;   // id of the prompt modal currently shown
let lastEventsKey = '';

export function install(bridge) { PT = bridge; return { render, startGame, submit, automationReport }; }

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

export async function submit(action, answers = []) {
  const doc = PT.S.game; if (!doc || !doc.state) return;
  const seat = action.seat || mySeat(doc); if (!seat) { PT.toast("You're watching this table"); return; }
  action = { ...action, seat, seed: action.seed || randomSeed(), answers };
  const r = apply(doc.state, action, PT.CARDS);
  if (r.error) { PT.toast(r.error); return; }
  if (r.prompt) {
    if (r.prompt.seat === mySeat(doc)) { const ans = await promptModal(r.prompt); if (ans == null) return; return submit(action, [...answers, ans]); }
    doc.inflight = { action, prompt: r.prompt }; await PT.saveGame(doc); PT.render(); return;
  }
  doc.state = r.state; doc.inflight = null; doc.status = r.state.status; if (r.state.winner) doc.winner = r.state.winner;
  playEvents(r.events, doc); await PT.saveGame(doc); PT.render();
}

/* ---------- prompts ---------- */
function promptModal(prompt) {
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

/* ---------- events -> small animations ---------- */
function playEvents(events, doc) {
  const flips = events.filter((e) => e.t === 'flip');
  if (flips.length) PT.toast(flips.map((e) => (e.heads ? 'Heads' : 'Tails')).join(', '));
  lastEventsKey = JSON.stringify(events.slice(-6));
  setTimeout(() => {
    for (const e of events) {
      if (e.t === 'damage') { const el = document.querySelector(`[data-mon="${e.target}"]`); if (el) { el.classList.add('hit'); const f = document.createElement('div'); f.className = 'float-dmg'; f.textContent = '-' + e.amount; el.appendChild(f); setTimeout(() => { el.classList.remove('hit'); f.remove(); }, 900); } }
      if (e.t === 'heal') { const el = document.querySelector(`[data-mon="${e.target}"]`); if (el) { const f = document.createElement('div'); f.className = 'float-dmg heal'; f.textContent = '+' + e.amount; el.appendChild(f); setTimeout(() => f.remove(), 900); } }
      if (e.t === 'attack') { const el = document.querySelector(`[data-mon="${e.attacker}"]`); if (el) { el.classList.add('lunge'); setTimeout(() => el.classList.remove('lunge'), 500); } }
    }
  }, 30);
}

/* ---------- rendering ---------- */
export function render(main, doc) {
  const g = doc.state; const me = mySeat(doc); const bottom = me || 'a'; const top = other(bottom); const r = R(g.rules);
  const legal = me ? legalActions(g, me, PT.CARDS) : [];
  const pending = g.pending[0];
  const myTurn = me && g.phase === 'main' && g.turn === me && !g.pending.length && !g.winner;
  const chatEl = main.querySelector('#chatin'); const chatPrev = chatEl ? chatEl.value : ''; const chatFocus = chatEl && document.activeElement === chatEl;

  const pileHTML = (seat, z, label, count, faceUp) => `<div class="z"><span class="zlbl">${label}</span><div class="pile" data-pile="${z}" data-seat="${seat}">${count ? (faceUp ? PT.cardHTML(faceUp, .34) : PT.backHTML(.34)) : `<div class="slot">empty</div>`}${count ? `<span class="n">${count}</span>` : ''}</div></div>`;
  const sideHTML = (seat, isTop) => {
    const p = g.p[seat]; const own = seat === me;
    const prizeClick = pending && pending.t === 'prize' && pending.seat === seat && own;
    const promoteClick = pending && pending.t === 'promote' && pending.seat === seat && own;
    const benchSlots = []; for (let i = 0; i < Math.max(r.benchSize, p.bench.length); i++) benchSlots.push(p.bench[i] ? monHTML(p.bench[i], seat, false, promoteClick) : `<div class="slot">bench</div>`);
    const active = p.active ? monHTML(p.active, seat, true, false) : `<div class="slot big">${promoteClick ? 'promote from bench' : 'active'}</div>`;
    const rail = `<div class="zone-row">
      ${pileHTML(seat, 'deck', 'Deck', p.deck.length, null)}
      ${pileHTML(seat, 'discard', 'Discard', p.discard.length, p.discard.length ? p.discard[p.discard.length - 1].c : null)}
      <div class="z"><span class="zlbl">Prizes${prizeClick ? ' · take one' : ''}</span><div class="row" style="gap:3px;flex-wrap:nowrap">${p.prizes.map((c, i) => `<div class="pile ${prizeClick ? 'glow' : ''}" data-prize="${i}" data-seat="${seat}" style="--s:.2">${PT.backHTML(.2)}</div>`).join('') || '<span class="small">none left</span>'}</div><span class="cnt">${p.prizes.length} left</span></div>
      ${own ? '' : `<div class="z"><span class="zlbl">Hand</span><div class="row" style="gap:0">${p.hand.slice(0, 12).map((c, i) => `<div style="margin-left:${i ? '-14px' : 0}">${PT.backHTML(.2)}</div>`).join('') || '<span class="small">empty</span>'}</div><span class="cnt">${p.hand.length} cards</span></div>`}
    </div>`;
    const field = `<div class="zone-row" style="align-items:flex-end"><div class="z"><span class="zlbl">Active</span>${active}</div><div class="z grow" style="align-items:stretch"><span class="zlbl">Bench</span><div class="bench">${benchSlots.join('')}</div></div></div>`;
    const name = `<div class="pname"><span>${esc(g.seats[seat].name)}${own ? ' (you)' : ''}</span>${g.phase === 'main' && g.turn === seat && !g.winner ? `<span class="chip">${own ? 'Your turn' : 'Their turn'}</span>` : ''}${g.phase === 'setup' ? `<span class="chip">${p.setupDone ? 'Ready' : 'Setting up'}</span>` : ''}${g.winner === seat ? '<span class="chip">Winner</span>' : ''}</div>`;
    const hand = own ? `<div class="z" style="align-items:stretch"><span class="zlbl">Your hand · ${p.hand.length}</span><div class="hand">${p.hand.map((c) => PT.cardHTML(c.c, .42, `data-hand="${c.id}"`, legal.some((a) => a.card === c.id) ? 'click can' : 'click')).join('') || '<span class="small muted">empty</span>'}</div></div>` : '';
    return isTop ? `<div class="side">${name}${rail}${field}</div>` : `<div class="side">${name}${field}${rail}${hand}</div>`;
  };
  const statusLine = g.winner ? `${esc(g.seats[g.winner].name)} wins` : g.phase === 'setup' ? 'Setup: place your Basic Pokémon' : pending ? `${esc(g.seats[pending.seat].name)}: ${pending.t === 'prize' ? 'take a prize' : pending.t === 'promote' ? 'promote a Pokémon' : 'mulligan draw'}` : `Turn ${g.turnNo} · ${esc(g.seats[g.turn].name)}${g.turn === me ? ' (you)' : ''}`;
  const inflightMine = doc.inflight && doc.inflight.prompt && doc.inflight.prompt.seat === me;
  const buttons = me ? `
    ${g.phase === 'setup' && legal.some((a) => a.type === 'mulligan') ? '<button type="button" data-act="mulligan">Mulligan (no Basic)</button>' : ''}
    ${g.phase === 'setup' && legal.some((a) => a.type === 'setupDone') ? '<button type="button" class="pri" data-act="setupDone">Ready</button>' : ''}
    ${pending && pending.t === 'mulliganDraw' && pending.seat === me ? `<button type="button" class="pri" data-act="mulliganDraw1">Draw ${pending.n} extra</button><button type="button" data-act="mulliganDraw0">Skip</button>` : ''}
    ${myTurn ? '<button type="button" class="pri" data-act="end">End turn</button>' : ''}
    ${inflightMine ? '<button type="button" class="pri" data-act="answer">Answer the prompt</button>' : ''}
    <button type="button" data-act="more">More…</button>` : '<span class="small">Watching</span>';
  main.innerHTML = `<div class="tablewrap"><div class="board auto">${sideHTML(top, true)}
    <div class="midbar"><span class="turn ${myTurn ? 'mine' : ''}">${statusLine}</span>${doc.inflight && !inflightMine ? `<span class="chip">Waiting for ${esc(g.seats[doc.inflight.prompt.seat].name)}…</span>` : ''}<span class="grow"></span>${buttons}</div>
    ${sideHTML(bottom, false)}</div>
    <aside class="logpane panel"><div class="row"><h3 class="grow">${esc(doc.name)}</h3><span class="chip">Auto rules</span><button class="sm" type="button" data-act="rules">Rules</button></div>
    <div class="entries" id="logentries">${g.log.slice().reverse().map((e) => `<div class="e ${e.k === 'chat' ? 'chat' : ''}">${e.k === 'chat' ? `<b>${esc(e.n)}:</b> ${esc(e.m)}` : esc(e.m)}<span class="t">${e.turn != null ? 'T' + e.turn : ''}</span></div>`).join('')}</div>
    ${me ? `<form id="chat"><input type="text" id="chatin" placeholder="Say something" maxlength="200" class="grow" autocomplete="off"><button class="sm" type="submit">Send</button></form>` : ''}</aside></div>`;
  const chatNew = main.querySelector('#chatin'); if (chatNew && chatPrev) { chatNew.value = chatPrev; if (chatFocus) chatNew.focus(); }
  const chat = main.querySelector('#chat'); if (chat) chat.onsubmit = (e) => { e.preventDefault(); const i = chat.querySelector('#chatin'); const v = i.value.trim(); if (!v) return; i.value = ''; submit({ type: 'chat', text: v }); };

  main.onclick = (e) => {
    const t = e.target; const btn = t.closest('button');
    if (btn && btn.dataset.act) return onButton(btn.dataset.act, btn, doc, legal, me);
    const hand = t.closest('[data-hand]'); if (hand && me) return handMenu(doc, legal, hand.dataset.hand, hand);
    const mon = t.closest('[data-mon]'); if (mon) return monMenu(doc, legal, mon.dataset.mon, mon, me);
    const prize = t.closest('[data-prize]'); if (prize && me && prize.dataset.seat === me && pending && pending.t === 'prize' && pending.seat === me) return submit({ type: 'takePrize', index: +prize.dataset.prize });
    const pile = t.closest('[data-pile]'); if (pile) { if (pile.dataset.pile === 'discard') return viewPile(doc, pile.dataset.seat, 'discard'); if (pile.dataset.pile === 'deck' && me === pile.dataset.seat) return deckMenu(doc, pile); }
  };
  // if an inflight prompt is for me and no modal is open, open it
  if (inflightMine && !promptOpen && !document.querySelector('#modal-bg')) answerInflight(doc);
}

function monHTML(m, seat, active, promoteClick) {
  const c = C(m.c); const hp = c.hp; const sc = active ? .42 : .34; const step = Math.round(330 * sc * 0.13);
  const att = [...m.en, ...m.tools]; const n = att.length;
  const stack = att.map((x, i) => `<div class="attc" style="top:${i * step}px;z-index:${i + 1}">${PT.cardHTML(x.c, sc)}</div>`).join('');
  const fxChips = m.fx.filter((f) => ['preventDamage', 'preventAll', 'preventSmall', 'defender', 'plusPower', 'destinyBond', 'sandAttack', 'noAttack'].includes(f.k)).map((f) => `<span class="FX">${{ preventDamage: 'SHIELD', preventAll: 'BARRIER', preventSmall: 'HARDEN', defender: 'DEF', plusPower: '+10', destinyBond: 'BOND', sandAttack: 'SAND', noAttack: 'AMNESIA' }[f.k]}</span>`).join('');
  return `<div class="mon ${active ? 'active' : ''} ${promoteClick ? 'glow' : ''}" data-mon="${m.id}" tabindex="0"><div class="cdwrap" style="padding-top:${n * step}px">${stack}<div class="poke" style="z-index:${n + 1}">${PT.cardHTML(m.c, sc)}${hp ? `<span class="hp">${Math.max(0, hp - m.dmg)}/${hp}</span>` : ''}${m.dmg ? `<span class="dmg">${m.dmg}</span>` : ''}${m.st.length || fxChips ? `<div class="sts">${m.st.map((s) => `<span class="${s}">${s}</span>`).join('')}${fxChips}</div>` : ''}${m.un.length ? `<span class="stk">+${m.un.length} under</span>` : ''}</div></div>${n ? `<div class="attn">${n} attached</div>` : ''}</div>`;
}

/* ---------- menus ---------- */
function onButton(act, btn, doc, legal, me) {
  const g = doc.state;
  if (act === 'end') return submit({ type: 'endTurn' });
  if (act === 'setupDone') return submit({ type: 'setupDone' });
  if (act === 'mulligan') return submit({ type: 'mulligan' });
  if (act === 'mulliganDraw1') return submit({ type: 'mulliganDraw', n: g.pending[0].n });
  if (act === 'mulliganDraw0') return submit({ type: 'mulliganDraw', n: 0 });
  if (act === 'answer') return answerInflight(doc);
  if (act === 'rules') return PT.showModal('Rules at this table', `<p>${esc(PT.rulesSummary(g.rules))}</p>${g.rules.notes ? `<div class="notice info" style="white-space:pre-wrap">${esc(g.rules.notes)}</div>` : ''}<p class="small muted">Automated rules: the table enforces costs, timing, damage, conditions and prizes. Use "Fix" on a Pokémon or the More menu if a card isn't automated yet.</p>`);
  if (act === 'more') {
    const items = [];
    if (me) items.push({ label: 'Draw a card (fix)', fn: () => submit({ type: 'override', op: 'draw', n: 1 }) }, { label: 'Shuffle my deck (fix)', fn: () => submit({ type: 'override', op: 'shuffle' }) }, { label: 'Force end of turn (fix)', fn: () => submit({ type: 'override', op: 'endTurn' }) }, { label: "It's my turn (fix)", fn: () => submit({ type: 'override', op: 'turn', seat: me }) }, { label: 'Clear pending steps (fix)', fn: () => submit({ type: 'override', op: 'clearPending' }) }, { sep: true }, { label: 'I concede', danger: true, fn: () => submit({ type: 'concede' }) }, { sep: true });
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
  doc.state = r.state; doc.inflight = null; doc.status = r.state.status; if (r.state.winner) doc.winner = r.state.winner; playEvents(r.events, doc); await PT.saveGame(doc); PT.render();
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
  if (!acts.length && c.st === 'Trainer' && !scriptOf(card.c).trainer) items.push({ label: `${c.name} isn't automated yet`, fn: () => PT.toast('Apply its effect with the Fix menus, then discard it.') });
  items.push({ sep: true }, { label: 'Fix: discard this card', fn: () => submit({ type: 'override', op: 'move', card: iid, to: 'discard' }) }, { label: 'Fix: put on top of deck', fn: () => submit({ type: 'override', op: 'move', card: iid, to: 'deckTop' }) });
  PT.showMenu(items, anchor, c.name);
}
function monMenu(doc, legal, pid, anchor, me) {
  const g = doc.state; const f = findMon(g, pid); if (!f) return; const m = f.m; const own = f.seat === me; const c = C(m.c);
  const items = [{ label: 'View card', fn: () => PT.viewCard(m.c) }];
  if (own && me) {
    const atks = (c.atk || []).map((a, i) => ({ a, i, chk: canAttack(g, me, i, PT.CARDS) }));
    if (f.p.active && f.p.active.id === pid && atks.length) { items.push({ sep: true }); for (const { a, i, chk } of atks) items.push({ label: `${a.n} ${a.d || ''} (${a.c.length} energy)${chk.ok ? '' : ' — ' + chk.why}`, disabled: !chk.ok, fn: () => chk.ok && submit({ type: 'attack', index: i }) }); }
    const pws = legal.filter((a) => a.type === 'usePower' && a.pokemon === pid); for (const a of pws) items.push({ label: `Use ${a.power}`, fn: () => submit({ type: 'usePower', pokemon: pid, power: a.power }) });
    const rts = legal.filter((a) => a.type === 'retreat'); if (f.p.active && f.p.active.id === pid && rts.length) items.push({ label: 'Retreat…', fn: () => PT.showMenu(rts.map((a) => ({ label: `Switch to ${nm(findMon(g, a.target).m)}`, fn: () => submit({ type: 'retreat', target: a.target }) })), anchor, 'Retreat') });
    if (legal.some((a) => a.type === 'promote' && a.target === pid)) items.push({ label: 'Promote to Active', fn: () => submit({ type: 'promote', target: pid }) });
    if (legal.some((a) => a.type === 'discardDoll' && a.pokemon === pid)) items.push({ label: 'Discard', fn: () => submit({ type: 'discardDoll', pokemon: pid }) });
  }
  if (me) {
    items.push({ sep: true }, { label: 'Fix: +10 damage', fn: () => submit({ type: 'override', op: 'damage', target: pid, delta: 10 }) }, { label: 'Fix: −10 damage', fn: () => submit({ type: 'override', op: 'damage', target: pid, delta: -10 }) });
    for (const [code, label] of Object.entries(STATUS_NAMES)) items.push({ label: `Fix: ${m.st.includes(code) ? 'remove' : 'set'} ${label}`, fn: () => submit({ type: 'override', op: 'status', target: pid, code }) });
    if (m.en.length) items.push({ label: 'Fix: discard an attached card…', fn: () => PT.showMenu([...m.en, ...m.tools].map((x) => ({ label: nm(x), fn: () => submit({ type: 'override', op: 'move', card: x.id, to: 'discard', toSeat: f.seat }) })), anchor, 'Discard') });
    items.push({ label: 'Fix: Knocked Out', danger: true, fn: () => submit({ type: 'override', op: 'ko', target: pid }) });
  }
  PT.showMenu(items, anchor, `${g.seats[f.seat].name}'s ${c.name}`);
}
function deckMenu(doc, anchor) { PT.showMenu([{ label: 'Draw a card (fix)', fn: () => submit({ type: 'override', op: 'draw', n: 1 }) }, { label: 'Shuffle (fix)', fn: () => submit({ type: 'override', op: 'shuffle' }) }], anchor, 'Deck'); }
function viewPile(doc, seat, zone) {
  const g = doc.state; const me = mySeat(doc); const cards = g.p[seat][zone].slice().reverse();
  PT.showModal(`${g.seats[seat].name}'s ${zone} · ${cards.length}`, `<div class="pickgrid">${cards.map((c) => `<div class="pk" data-card="${c.id}"><div class="cd" style="${PT.cardStyle(c.c)}" data-cid="${c.c}"></div><div class="nm">${esc(nm(c))}</div></div>`).join('') || '<p class="muted">Empty.</p>'}</div>`, me === seat ? '<span class="small muted">Click a card to move it (fix).</span>' : '', (m) => {
    if (me !== seat) return;
    m.querySelectorAll('.pk').forEach((el) => (el.onclick = () => { PT.closeModal(); PT.showMenu([{ label: 'To hand', fn: () => submit({ type: 'override', op: 'move', card: el.dataset.card, to: 'hand' }) }, { label: 'Top of deck', fn: () => submit({ type: 'override', op: 'move', card: el.dataset.card, to: 'deckTop' }) }, { label: 'Shuffle into deck', fn: () => submit({ type: 'override', op: 'move', card: el.dataset.card, to: 'deckShuffle' }) }, { label: 'To bench', fn: () => submit({ type: 'override', op: 'move', card: el.dataset.card, to: 'bench' }) }], el, nm(el.dataset.card ? g.p[seat][zone].find((c) => c.id === el.dataset.card) : '')); }));
  });
}
