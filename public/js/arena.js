// The Arena: single-player runs. Draft a deck 1-of-3, then play the computer until 7 wins or 3 losses.
// One document per player (arena/<pid>) holds the current run and the player's record; the page syncs everyone's
// documents for the leaderboard. Arena games are ordinary auto-rules tables with the computer in seat B.
import { ARENA, ARENA_REWARDS, ENERGY_PICK, addEnergyPick, energyTaken, arenaPool, makeOffer, poolEntry, addPick, draftedCount, basicsIn, energySplit, finalDeck, botDraft, OPPONENTS, oppSkill, tierOf, goldPool, pickGold } from './arena-draft.js';
import { TIER_NAMES } from './arena-tiers.js';
import { BOT_UID } from './bot.js';
import { play as sfx } from './sfx.js';

let PT = null;
const V = { busy: false, noted: new Set(), revealed: null, offer: null, picking: false, peek: null, noClick: false };
const esc = (s) => PT.esc(s);
const me = () => PT.uid();
const C = (cid) => PT.CARDS[cid] || {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const docs = () => PT.S.arena || {};
const mine = () => docs()[me()] || null;
const run = () => (mine() && mine().run) || null;
const rid = () => Math.random().toString(36).slice(2, 10);
const rules = () => clone(PT.rules());
/** The currency Arena runs pay out (spent in the shop later). */
const COIN = { name: 'Cousin Tokens', one: 'Cousin Token', icon: '🪙' };
const coins = (n) => `${n} ${n === 1 ? COIN.one : COIN.name}`;
const goldIds = (d) => ((d && d.gold) || []).map((g) => g.cid);
/** A card with the gold holographic finish. */
const goldCard = (cid, s, attrs = '') => `<span class="goldcard" style="--s:${s}" ${attrs}>${PT.cardHTML(cid, s)}</span>`;

export function installArena(bridge) { PT = bridge; return { render, noteGame, closingTable, lobbyFeature, isArenaGame, heroCount }; }
export const isArenaGame = (g) => !!(g && g.arena);
function heroCount() { const r = run(); return r && r.status !== 'done' ? `${r.wins}–${r.losses}` : null; }

/* ---------- saving ---------- */
async function mutate(fn, okMsg) {
  if (V.busy) return false; V.busy = true;
  try {
    let cur = mine();
    if (!cur) { const d = await PT.api('GET', 'arena/' + me()); cur = d && !d.missing ? d : null; }
    for (let tries = 0; tries < 5; tries++) {
      const doc = cur ? clone(cur) : { owner: me(), runs: 0, totalWins: 0, perfect: 0, best: null, history: [] };
      const ver = cur ? cur.version : null; delete doc.id; delete doc.version;
      let res; try { res = fn(doc); } catch (e) { PT.toast(e.message || 'That did not work'); return false; }
      if (res === false) return false;
      doc.updatedAt = Date.now();
      const r = await PT.api('PUT', 'arena/' + me(), ver != null ? { data: doc, ifVersion: ver } : { data: doc });
      if (r && r.conflict) { cur = r.doc; continue; }
      PT.S.arena = { ...docs(), [me()]: { id: me(), version: r.version, ...doc } };
      if (okMsg) PT.toast(okMsg);
      return true;
    }
    PT.toast('The Arena changed under you. Try again.'); return false;
  } catch (e) { PT.toast('Could not save (' + (e.code || 'error') + ')'); return false; }
  finally { V.busy = false; PT.render(); }
}

/* ---------- actions ---------- */
const A = {
  start: () => mutate((d) => { if (d.run && d.run.status !== 'done') throw new Error('You already have a run going'); d.run = { id: rid(), seed: (Math.random() * 2 ** 31) >>> 0, status: 'draft', round: 0, cards: {}, picks: [], wins: 0, losses: 0, games: [], gameId: null, startedAt: Date.now() }; }),
  pick: (key) => mutate((d) => {
    const r = d.run; if (!r || r.status !== 'draft') throw new Error('The draft is over');
    if (key === ENERGY_PICK) r.cards = addEnergyPick(PT.CARDS, r.cards);
    else { const offer = makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules()); if (!offer.includes(key)) throw new Error('That card is no longer on offer'); r.cards = addPick(PT.CARDS, r.cards, key, rules()); }
    r.picks.push(key); r.round++;
    if (draftedCount(r.cards) >= ARENA.picksTo || !makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules()).length) { r.status = 'play'; r.energy = energySplit(PT.CARDS, r.cards); }
  }),
  /** A draft that is already full (the draft got shorter while this run was in progress) moves on to the battles. */
  closeDraft: () => mutate((d) => { const r = d.run; if (!r || r.status !== 'draft' || draftedCount(r.cards) < ARENA.picksTo) return false; r.status = 'play'; r.energy = energySplit(PT.CARDS, r.cards); }),
  retire: () => mutate((d) => { if (!d.run || d.run.status === 'done') return false; finishRun(d, true); }),
};
function finishRun(d, retired) {
  const r = d.run; r.status = 'done'; r.endedAt = Date.now(); if (retired) r.retired = true;
  d.runs = (d.runs || 0) + 1; d.totalWins = (d.totalWins || 0) + r.wins; if (r.wins >= ARENA.wins) d.perfect = (d.perfect || 0) + 1;
  const tokens = ARENA_REWARDS[Math.min(r.wins, ARENA_REWARDS.length - 1)] || 0;
  const gold = r.wins >= ARENA.wins ? pickGold(PT.CARDS, goldIds(d)) : null;
  d.tokens = (d.tokens || 0) + tokens; d.earned = (d.earned || 0) + tokens;
  if (gold) d.gold = [...(d.gold || []), { cid: gold, at: r.endedAt, run: r.id }];
  r.reward = { tokens, gold };
  const entry = { wins: r.wins, losses: r.losses, at: r.endedAt, top: topCards(r.cards, 3), retired: !!retired, tokens, gold };
  if (!d.best || r.wins > d.best.wins || (r.wins === d.best.wins && r.losses < d.best.losses)) d.best = entry;
  d.history = [entry, ...(d.history || [])].slice(0, 20);
}
/** The headline Pokémon of a set of cards: most evolved, then rarest, then HP. */
function topCards(cards, n) {
  const rank = (cid) => { const c = C(cid); return (['Basic', 'Stage 1', 'Stage 2'].indexOf(c.sub) + 1) * 1000 + (/Holo/.test(c.rar || '') ? 500 : 0) + (+c.hp || 0); };
  return Object.keys(cards || {}).filter((cid) => C(cid).st === 'Pokémon').sort((a, b) => rank(b) - rank(a)).slice(0, n);
}

/** Start (or resume) the next game of the run: a table with the computer, already dealt. */
async function battle() {
  const r = run(); if (!r || r.status !== 'play') return;
  if (r.gameId) { PT.openGame(r.gameId); return; }
  if (V.busy) return;
  const n = r.games.length + 1; const title = OPPONENTS[Math.min(r.wins, OPPONENTS.length - 1)];
  const oppSeed = ((r.seed ^ Math.imul(n, 40503)) >>> 0) || 1;
  const oppCards = botDraft(PT.CARDS, oppSeed, oppSkill(r.wins), rules());
  const myCards = finalDeck(PT.CARDS, r.cards, r.energy);
  const id = 'ar' + rid() + rid();
  try { await PT.api('PUT', 'players/' + BOT_UID, { data: { name: 'Computer', updatedAt: Date.now() } }); } catch (e) { /* the name is cosmetic */ }
  const doc = { name: `Arena · Game ${n} vs ${title}`, mode: 'auto', host: me(), createdAt: Date.now(), updatedAt: Date.now(), status: 'lobby', rules: rules(),
    seats: { a: { uid: me(), deckId: null, deckName: 'Arena deck' }, b: { uid: BOT_UID, deckId: null, deckName: `${title}'s deck` } },
    arena: { pid: me(), run: r.id, n, title, oppSeed }, state: null, log: [], v: 0 };
  doc.state = window.AUTO.startGame(doc, { a: { cards: myCards }, b: { cards: oppCards } });
  doc.state.seats.b.name = title; doc.status = 'playing'; doc.startedAt = Date.now();
  try { await PT.api('PUT', 'games/' + id, { data: doc }); } catch (e) { PT.toast('Could not create the game (' + (e.code || 'error') + ')'); return; }
  const prev = (r.games[r.games.length - 1] || {}).id;
  const ok = await mutate((d) => { if (!d.run || d.run.id !== r.id || d.run.gameId) return false; d.run.gameId = id; });
  if (!ok) { PT.api('DELETE', 'games/' + id).catch(() => {}); return; }
  if (prev) PT.api('DELETE', 'games/' + prev).catch(() => {}); // the finished table isn't needed any more
  PT.openGame(id);
}
/** Forfeit the game in progress (counts as a loss). */
function forfeit() {
  const r = run(); if (!r || !r.gameId) return;
  PT.showModal('Forfeit this game?', '<p>It counts as a loss for this run.</p>', '<button class="dng" id="ffok" type="button">Forfeit</button>', (m) => {
    m.querySelector('#ffok').onclick = async () => { PT.closeModal(); const gid = r.gameId; await record(gid, false); PT.api('DELETE', 'games/' + gid).catch(() => {}); };
  });
}
/** Record a finished game against the run (once). */
async function record(gid, won) {
  if (V.noted.has(gid)) return; V.noted.add(gid);
  let after = null;
  const ok = await mutate((d) => {
    const r = d.run; if (!r || r.status !== 'play' || r.gameId !== gid || r.games.some((x) => x.id === gid)) return false;
    r.games.push({ id: gid, title: OPPONENTS[Math.min(r.wins, OPPONENTS.length - 1)], won, at: Date.now() });
    if (won) r.wins++; else r.losses++; r.gameId = null;
    if (r.wins >= ARENA.wins || r.losses >= ARENA.losses) finishRun(d);
    after = clone(r);
  });
  if (!ok || !after) { V.noted.delete(gid); return; }
  setTimeout(() => resultModal(after, won), PT.S.screen === 'game' ? 2600 : 0); // let the table's win celebration play first
}
function resultModal(r, won) {
  if (r.status === 'done') { PT.closeModal(); chestReveal(r); return; }
  const body = `<p>Arena record: <b>${r.wins}–${r.losses}</b>. ${won ? `Next up: <b>${esc(OPPONENTS[Math.min(r.wins, OPPONENTS.length - 1)])}</b>.` : `${ARENA.losses - r.losses} ${ARENA.losses - r.losses === 1 ? 'life' : 'lives'} left.`}</p>`;
  PT.showModal(won ? 'Victory!' : 'Defeat', body, `<button class="pri" id="tarena" type="button">Back to the Arena</button>`, (m) => { m.querySelector('#tarena').onclick = () => { PT.closeModal(); PT.go('arena'); }; });
}
/* ---------- the prize chest ----------
   A run ends with a chest: it drops in, you click it, the lid swings back, light pours out, the Tokens fly up and
   count, and after a perfect run the gold card rises out of it. The chest is drawn here (SVG), better with more wins. */
const CHESTS = [
  { min: 7, name: "Champion's chest", body: ['#ffd95e', '#e89a1f'], band: ['#fff6cf', '#f3c64a'], trim: '#7a4a05', gem: '#ff5a7a' },
  { min: 6, name: 'Royal chest', body: ['#9a5cf0', '#5a2aa8'], band: ['#ffe08a', '#e0a02a'], trim: '#2a1250', gem: '#5fe0ff' },
  { min: 3, name: 'Silver chest', body: ['#4f86d8', '#2a4f96'], band: ['#f2f6ff', '#a9b6d2'], trim: '#15264d', gem: '#ffd95e' },
  { min: 0, name: 'Wooden chest', body: ['#a8713a', '#6e431c'], band: ['#c9ced9', '#7f8798'], trim: '#3a2209', gem: '#c9ced9' },
];
function chestSVG(k) {
  const id = 'ch' + Math.random().toString(36).slice(2, 7);
  const defs = `<defs><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.body[0]}"/><stop offset="1" stop-color="${k.body[1]}"/></linearGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.band[0]}"/><stop offset="1" stop-color="${k.band[1]}"/></linearGradient></defs>`;
  const planks = (y0, y1) => [70, 120, 170].map((x) => `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${k.trim}" stroke-opacity=".28" stroke-width="2"/>`).join('');
  const body = `<svg class="chest-body" viewBox="0 0 240 110" aria-hidden="true">${defs}
    <rect x="22" y="4" width="196" height="100" rx="10" fill="url(#${id}b)" stroke="${k.trim}" stroke-width="5"/>${planks(8, 100)}
    <rect x="22" y="4" width="196" height="16" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4"/>
    <rect x="40" y="4" width="20" height="100" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4"/><rect x="180" y="4" width="20" height="100" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4"/>
    <rect x="22" y="88" width="196" height="16" rx="6" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4"/>
    <rect x="102" y="10" width="36" height="42" rx="7" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4"/><circle cx="120" cy="27" r="6" fill="${k.trim}"/><rect x="117" y="27" width="6" height="14" rx="2" fill="${k.trim}"/>
    ${[50, 190].map((x) => [36, 60].map((y) => `<circle cx="${x}" cy="${y}" r="3" fill="${k.trim}" fill-opacity=".55"/>`).join('')).join('')}</svg>`;
  const lid = `<svg class="chest-lid" viewBox="0 0 240 84" aria-hidden="true">${defs}
    <path d="M22 80 V52 Q22 8 120 8 Q218 8 218 52 V80 Z" fill="url(#${id}b)" stroke="${k.trim}" stroke-width="5" stroke-linejoin="round"/>${planks(16, 78)}
    <path d="M40 80 V40 Q42 22 60 16 V80 Z" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4" stroke-linejoin="round"/><path d="M200 80 V40 Q198 22 180 16 V80 Z" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="22" y="66" width="196" height="14" fill="url(#${id}m)" stroke="${k.trim}" stroke-width="4"/>
    <circle cx="120" cy="40" r="13" fill="${k.gem}" stroke="${k.trim}" stroke-width="4"/><circle cx="115" cy="35" r="4" fill="#fff" fill-opacity=".75"/></svg>`;
  return { body, lid };
}
function chestReveal(r) {
  if (!r || document.querySelector('.chest-ov')) return;
  const rw = r.reward || { tokens: 0, gold: null }; const perfect = r.wins >= ARENA.wins;
  const k = CHESTS.find((c) => r.wins >= c.min); const art = chestSVG(k);
  const coinsN = Math.min(22, 4 + Math.round(rw.tokens / 12));
  const coinEls = rw.tokens ? Array.from({ length: coinsN }, (_, i) => { const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9; const d = 110 + Math.random() * 150; return `<i class="chest-coin" style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d)}px;--d:${(i * 0.035).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`; }).join('') : '';
  const ov = document.createElement('div'); ov.className = `chest-ov w${Math.min(r.wins, 7)}${perfect ? ' perfect' : ''}${rw.gold ? ' hascard' : ''}`; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Your Arena prize');
  ov.innerHTML = `<div class="chest-wrap">
    <div class="chest-head"><span class="kicker">${perfect ? 'Perfect run' : r.retired ? 'Run ended' : 'Run complete'}</span><h2>${r.wins}–${r.losses}</h2><p class="chest-name">${esc(k.name)}</p></div>
    <div class="chest-stage">
      <div class="chest-rays" aria-hidden="true"></div>
      ${rw.gold ? `<div class="chest-card">${goldCard(rw.gold, 0.72)}<b>${esc(C(rw.gold).name)}</b><span>Gold card unlocked</span></div>` : ''}
      <button type="button" class="chest" aria-label="Open the chest"><span class="chest-glow" aria-hidden="true"></span>${art.lid}<span class="chest-in" aria-hidden="true"></span>${art.body}<span class="chest-coins" aria-hidden="true">${coinEls}</span></button>
    </div>
    <p class="chest-hint">Click the chest to open it</p>
    <div class="chest-prize" aria-live="polite"><div class="ar-prize-coins"><span aria-hidden="true">${COIN.icon}</span><b class="chest-count">+0</b><em>${COIN.name}</em></div>
      ${perfect && !rw.gold ? '<p class="small muted">You already own every gold card. Incredible.</p>' : !rw.tokens ? '<p class="small muted">No wins this time. The next chest is waiting.</p>' : ''}</div>
    <button class="pri cta chest-done" type="button">Back to the Arena</button></div>`;
  document.body.appendChild(ov);
  const chest = ov.querySelector('.chest'); const count = ov.querySelector('.chest-count');
  const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 260); PT.go('arena'); };
  ov.querySelector('.chest-done').onclick = close;
  sfx('chest.drop', 380);
  let opened = false;
  const open = () => {
    if (opened) return; opened = true; ov.classList.add('shake'); sfx('chest.rattle', 0);
    setTimeout(() => {
      ov.classList.remove('shake'); ov.classList.add('open'); sfx('chest.open', 0);
      if (rw.tokens) sfx('chest.coins', 250, coinsN);
      if (rw.gold) sfx('arena.legendary', 700);
      const t0 = performance.now(); const dur = 500 + Math.min(900, rw.tokens * 5);
      const tick = (t) => { const p = Math.min(1, (t - t0 - 300) / dur); count.textContent = '+' + Math.round(rw.tokens * Math.max(0, p) ** 0.7); if (p < 1 && ov.isConnected) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      setTimeout(() => { ov.classList.add('done'); const b = ov.querySelector('.chest-done'); if (b) b.focus(); }, rw.gold ? 2400 : 1500);
    }, 620);
  };
  chest.onclick = open;
  setTimeout(() => chest.focus(), 700);
}
/** This player's Arena document, fetched if the page hasn't synced it (the game screen may have been opened by a reload). */
async function ensureMine() {
  if (mine()) return mine();
  try { const d = await PT.api('GET', 'arena/' + me()); if (d && !d.missing) { PT.S.arena = { ...docs(), [me()]: d }; return d; } } catch (e) { /* offline: try again on the next call */ }
  return null;
}
const wonGame = (g) => g.state.winner === (g.seats.a.uid === me() ? 'a' : 'b');
/** Called by the page whenever it has a fresh copy of a game: a finished Arena game is recorded against the run. */
let noting = null;
export function noteGame(g) {
  if (!g || !g.arena || g.arena.pid !== me() || !g.state || !g.state.winner) return;
  if (V.noted.has(g.id) || noting === g.id) return;
  noting = g.id;
  ensureMine().then(() => { const r = run(); if (r && r.gameId === g.id) return record(g.id, wonGame(g)); if (r) V.noted.add(g.id); }).finally(() => { noting = null; });
}
/**
 * Called before an Arena table is closed, with the full game: its result is recorded first, so closing a finished
 * table can never lose a win. Closing a game that is still being played forfeits it (the page warns first).
 */
export async function closingTable(g) {
  if (!g || !g.arena || g.arena.pid !== me()) return;
  await ensureMine(); const r = run(); if (!r || r.gameId !== g.id) return;
  await record(g.id, !!(g.state && g.state.winner) && wonGame(g));
}
/** The run's table may have finished while the player was elsewhere: check it when the Arena opens. */
let checking = null;
async function checkCurrent() {
  const r = run(); if (!r || !r.gameId || checking === r.gameId) return; checking = r.gameId;
  try {
    const g = await PT.api('GET', 'games/' + r.gameId);
    if (g && !g.missing) noteGame(g);
    // The table is gone and nothing was recorded: nobody can say who won, so the game doesn't count either way.
    else { const gid = r.gameId; const ok = await mutate((d) => { if (!d.run || d.run.gameId !== gid) return false; d.run.gameId = null; }); if (ok) PT.toast("That game's table was closed before its result was saved, so it doesn't count. Play it again."); }
  } catch (e) { /* try again next time */ }
  finally { checking = null; }
}

/* ---------- views ---------- */
const TCOL = { Fire: '#f08030', Water: '#6890f0', Grass: '#78c850', Lightning: '#f8d030', Psychic: '#f85888', Fighting: '#c03028', Colorless: '#a8a878' };
function header(r) {
  const d = mine(); const wallet = `<div class="ar-wallet" title="Arena winnings. A shop to spend them is coming."><span aria-hidden="true">${COIN.icon}</span><b>${(d && d.tokens) || 0}</b><em>${COIN.name}</em></div>`;
  const rec = `<div class="ar-headside">${wallet}${r && r.status !== 'done' ? `<div class="ar-record">${recordHTML(r)}</div>` : ''}</div>`;
  return `<header class="arhead${r && r.status === 'draft' ? ' slim' : ''}"><div class="ar-copy"><span class="kicker">Single player</span><h1>The Arena</h1><div class="ornate" aria-hidden="true"></div>
    <p class="small muted">Draft a deck one pick at a time, then take on the computer. Seven wins is a perfect run; three losses and you're out.</p></div>${rec}</header>`;
}
function recordHTML(r) {
  const w = Array.from({ length: ARENA.wins }, (_, i) => `<i class="ar-w${i < r.wins ? ' on' : ''}" title="Win ${i + 1}"></i>`).join('');
  const l = Array.from({ length: ARENA.losses }, (_, i) => `<i class="ar-l${i < r.losses ? ' on' : ''}" title="Loss ${i + 1}"></i>`).join('');
  return `<div class="ar-wins"><span>Wins</span><div>${w}</div><b>${r.wins}</b></div><div class="ar-losses"><span>Losses</span><div>${l}</div><b>${r.losses}</b></div>`;
}
/* Deck panel in the style of Hearthstone's Arena: a "curve" by stage, then one tile per card (its art, name and count). */
const KIND_ORDER = { Basic: 0, Baby: 0, 'Stage 1': 1, 'Stage 2': 2 };
function sortKey(cid) { const c = C(cid); const g = c.st === 'Pokémon' ? 0 : c.st === 'Trainer' ? 1 : 2; return [g, c.st === 'Pokémon' ? (KIND_ORDER[c.sub] ?? 0) : 0, c.name]; }
function cmpKey(a, b) { const x = sortKey(a), y = sortKey(b); for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; }
function curveHTML(cards, baseEnergy) {
  const cols = [['Basic', 0], ['Stage 1', 0], ['Stage 2', 0], ['Trainer', 0], ['Energy', baseEnergy || 0]];
  for (const [cid, k] of Object.entries(cards || {})) {
    const c = C(cid); const i = c.st === 'Pokémon' ? (c.sub === 'Stage 2' ? 2 : c.sub === 'Stage 1' ? 1 : 0) : c.st === 'Trainer' ? 3 : 4;
    cols[i][1] += k;
  }
  const max = Math.max(4, ...cols.map((x) => x[1]));
  return `<div class="ar-curve" aria-label="Deck makeup">${cols.map(([l, n]) => `<div class="ar-cbar"><b>${n}</b><div><i style="height:${Math.round((n / max) * 100)}%"></i></div><span>${l}</span></div>`).join('')}</div>`;
}
function tilesHTML(cards, energy, fresh) {
  const all = finalDeck(PT.CARDS, cards, energy || {});
  const ids = Object.keys(all).sort(cmpKey); let last = null;
  return ids.map((cid) => {
    const c = C(cid); const grp = c.st === 'Pokémon' ? 'Pokémon' : c.st === 'Trainer' ? 'Trainers' : 'Energy';
    const head = grp !== last ? `<h4 class="ar-tgrp">${grp}</h4>` : ''; last = grp;
    const t = (c.types || [])[0] || (c.st === 'Energy' ? c.name.split(' ')[0] : 'Trainer');
    return `${head}<button type="button" class="ar-tile t-${tierOf(cid)}${fresh && fresh.has(cid) ? ' fresh' : ''}" data-view="${esc(cid)}" style="--tc:${TCOL[t] || '#8a7fb0'}"><span class="ar-tart" aria-hidden="true">${PT.cardHTML(cid, 0.9)}</span><span class="ar-tname">${esc(c.name)}</span><b class="ar-tn">${all[cid] > 1 ? '×' + all[cid] : ''}</b></button>`;
  }).join('');
}
function deckPanel(r, title, energy) {
  const n = draftedCount(r.cards); const basics = basicsIn(r.cards, PT.CARDS);
  const baseEn = energy ? Object.values(energy).reduce((a, b) => a + b, 0) : ARENA.energy; const extra = energyTaken(PT.CARDS, r.cards);
  const have = draftedCount(finalDeck(PT.CARDS, r.cards, energy || {}));
  const lastE = !energy && r.picks.length && r.picks[r.picks.length - 1] !== ENERGY_PICK && V.offer && V.offer.first ? poolEntry(PT.CARDS, r.picks[r.picks.length - 1], rules()) : null;
  const fresh = lastE ? new Set(Object.keys(lastE.cards)) : null;
  return `<aside class="panel ar-side ar-deck"><div class="ar-dhead"><h3>${esc(title)}</h3><span class="ar-count"><b>${have}</b>/${energy ? have : ARENA.picksTo + ARENA.bills + ARENA.oaks}</span></div>
    ${curveHTML(finalDeck(PT.CARDS, r.cards, {}), baseEn)}<p class="small muted ar-basics">${basics} Basic Pokémon · ${ARENA.bills} Bills and ${ARENA.oaks} Professor Oak included${energy ? '' : ` · ${ARENA.energy} Energy added at the end${extra ? ` (+${extra} you took)` : ''}`}</p>
    <div class="ar-tiles">${tilesHTML(r.cards, energy, fresh)}</div></aside>`;
}

function draftView(r) {
  const offer = makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules());
  const n = draftedCount(r.cards);
  const key = r.id + ':' + r.round; const first = V.revealed !== key; // the cards flip in (and sound) once per round, not on every refresh
  V.offer = { key, first, tiers: offer.map((k) => tierOf(k)) };
  const choice = (k, i) => {
    const e = poolEntry(PT.CARDS, k, rules()); const c = C(e.cid); const t = e.tier; const big = t === 'E' || t === 'L';
    const tag = e.kind === 'line' ? `${c.sub} line · ${e.size} cards` : e.kind === 'basic' ? 'Basic Pokémon' : e.kind === 'energy' ? 'Special Energy' : (c.sub || 'Trainer');
    const line = e.kind === 'line' ? `<div class="ar-line">${e.line.map((cid) => `${ARENA.lineCopies}× ${esc(C(cid).name)}`).join(' › ')}</div>` : '';
    return `<div class="ar-choice ${e.kind} t-${t}${first ? ' enter' : ''}" style="--i:${i}" data-pick="${esc(k)}" data-tier="${t}" role="button" tabindex="0" aria-label="Draft ${esc(c.name)} (${TIER_NAMES[t]})">
      ${big ? '<span class="ar-pillar" aria-hidden="true"></span>' : ''}<div class="ar-card"><span class="ar-aura" aria-hidden="true"></span>${big ? `<span class="ar-ring" aria-hidden="true"></span><span class="ar-sparks" aria-hidden="true">${sparks(t === 'L' ? 12 : 7, i)}</span>` : ''}${PT.cardHTML(e.cid, 1).replace(/ data-cid="[^"]*"/, '')}${e.kind === 'line' ? `<span class="ar-stack" aria-hidden="true">×${e.size}</span>` : ''}</div>
      <div class="ar-under"><span class="ar-gem">${t === 'L' ? '★ ' : ''}${TIER_NAMES[t]}${t === 'L' ? ' ★' : ''}</span><button type="button" class="ar-read" data-read="${esc(k)}" title="Read ${esc(c.name)} up close" aria-label="Read ${esc(c.name)}"><span aria-hidden="true">🔍</span> Read</button></div>
      <div class="ar-tag">${esc(tag)}</div>${line}</div>`;
  };
  return `<div class="ar-draft">
    <section class="ar-stage"><div class="ar-stagehead"><div><span class="kicker">Pick ${r.round + 1}</span><h2>Choose a card</h2></div>
      <div class="ar-bar" title="${n} of ${ARENA.picksTo} cards"><i style="width:${Math.round((n / ARENA.picksTo) * 100)}%"></i></div></div>
      <div class="ar-offer">${offer.map(choice).join('')}</div>
      <div class="ar-or"><span>or</span><button type="button" class="ar-energybtn" data-energy="1"><span aria-hidden="true">⚡</span> Take a basic Energy instead</button><em>Your deck has <b>${ARENA.energy + energyTaken(PT.CARDS, r.cards)}</b> Energy so far</em></div>
      <p class="small muted ar-hint"><b>Click</b> a card to draft it. <b>Hold</b> it down, or press <b>Read</b>, to see it up close. Evolved Pokémon bring their whole line, 2 of each card. Your deck already has ${ARENA.bills} Bills, ${ARENA.oaks} Professor Oak and ${ARENA.energy} Energy.</p>
      <button class="sm ghost ar-abandon" type="button" data-retire="1">Abandon this run</button></section>
    ${deckPanel(r, 'Your deck')}</div>`;
}
/** Twinkling sparks around an Epic or Legendary card (placed around its edge; the same spots every redraw). */
function sparks(n, seed) {
  let x = 9301 * (seed + 3) + 49297; const rnd = () => { x = (x * 233280 + 49297) % 9973; return x / 9973; };
  return Array.from({ length: n }, (_, i) => { const edge = i % 4; const p = Math.round(rnd() * 100); const off = Math.round(rnd() * 9 - 6);
    const pos = edge === 0 ? `left:${p}%;top:${off}%` : edge === 1 ? `left:${100 - off}%;top:${p}%` : edge === 2 ? `left:${p}%;top:${100 - off}%` : `left:${off}%;top:${p}%`;
    return `<i style="${pos};--d:${(rnd() * 2.2).toFixed(2)}s;--z:${(0.7 + rnd() * 0.9).toFixed(2)}"></i>`; }).join('');
}
/** Fit the three cards to the space they have (as big as the screen allows, like Hearthstone). */
function sizeOffer() {
  const o = document.querySelector('.ar-offer'); if (!o) return;
  const gap = parseFloat(getComputedStyle(o).columnGap) || 16;
  const w = (o.clientWidth - 2 * gap) / 3 - 6;
  const h = Math.max(240, window.innerHeight - (o.getBoundingClientRect().top + window.scrollY) - 176); // the whole card, its labels and the Energy button fit on screen
  o.style.setProperty('--cs', Math.max(0.3, Math.min(1.25, w / 240, h / 330)).toFixed(3));
}
if (typeof window !== 'undefined') window.addEventListener('resize', sizeOffer);
/** After the draft screen is drawn: size the cards, and the first time a round is shown, play its reveal sounds. */
function afterDraft() {
  sizeOffer();
  const o = V.offer; if (!o || !o.first || !document.querySelector('.ar-offer')) return;
  V.revealed = o.key;
  sfx('arena.deal', 0);
  const best = ['L', 'E', 'R'].find((t) => o.tiers.includes(t));
  const stage = document.querySelector('.ar-stage'); if (stage && (best === 'L' || best === 'E')) { stage.style.setProperty('--fd', (260 + o.tiers.indexOf(best) * 140) + 'ms'); stage.classList.add('flash-' + best); }
  if (best) sfx(best === 'L' ? 'arena.legendary' : best === 'E' ? 'arena.epic' : 'arena.rare', 260 + o.tiers.indexOf(best) * 140);
}
/** Skip the three cards and take a basic Energy. */
function pickEnergy() {
  if (V.picking || V.busy) return; V.picking = true;
  document.querySelectorAll('.ar-choice').forEach((x) => { x.classList.remove('enter'); x.classList.add('passed'); });
  sfx('arena.pick', 0);
  setTimeout(async () => { try { await A.pick(ENERGY_PICK); } finally { V.picking = false; } }, 300);
}
function pickAnimated(el) {
  if (V.picking || V.busy) return; V.picking = true;
  document.querySelectorAll('.ar-choice').forEach((x) => { x.classList.remove('enter'); x.classList.add(x === el ? 'chosen' : 'passed'); });
  sfx('arena.pick', 0, el.dataset.tier);
  setTimeout(async () => { try { await A.pick(el.dataset.pick); } finally { V.picking = false; } }, 430);
}
/* ---------- hold a card to read it ----------
   Press and hold a draft card: a large copy appears with everything on it written out in plain text (the card art is
   small, so the print on it is hard to read). Let go and it closes; holding never drafts the card. */
const HOLD_MS = 260;
const costText = (a) => { const n = (a.c || []).length; return n ? `${n} Energy` : 'Free'; };
function cardText(cid, small) {
  const c = C(cid); const pw = Array.isArray(c.pw) ? c.pw : c.pw ? [c.pw] : [];
  const meta = [c.st === 'Pokémon' ? c.sub : c.st === 'Energy' ? 'Special Energy' : (c.sub || 'Trainer')]; if (c.hp) meta.push(`${c.hp} HP`); if (c.types && c.types.length) meta.push(c.types.join('/'));
  const foot = []; if (c.wk && c.wk.length) foot.push('Weakness: ' + c.wk.join(', ')); if (c.rs && c.rs.length) foot.push('Resistance: ' + c.rs.join(', ')); if (c.st === 'Pokémon') foot.push(`Retreat: ${c.rc || 0}`);
  return `<div class="pk-card${small ? ' small' : ''}"><div class="pk-name"><b>${esc(c.name)}</b><span>${esc(meta.join(' · '))}</span></div>
    ${pw.map((p) => `<div class="pk-pw"><em>Pokémon Power</em> <b>${esc(p.n)}</b><p>${esc(p.t || '')}</p></div>`).join('')}
    ${(c.atk || []).map((a) => `<div class="pk-atk"><div><span class="pk-cost">${(a.c || []).map((t) => `<i style="background:${TCOL[t] || '#999'}" title="${esc(t)}"></i>`).join('')}<small>${costText(a)}</small></span><b>${esc(a.n)}</b><strong>${esc(a.d || '')}</strong></div>${a.t ? `<p>${esc(a.t)}</p>` : ''}</div>`).join('')}
    ${c.txt ? `<p class="pk-txt">${esc(c.txt)}</p>` : ''}${foot.length ? `<div class="pk-foot">${esc(foot.join(' · '))}</div>` : ''}</div>`;
}
function showPeek(key, sticky) {
  hidePeek();
  const e = poolEntry(PT.CARDS, key, rules()); if (!e) return;
  const phone = window.innerWidth < 720;
  const s = phone ? Math.min(1.25, (window.innerWidth - 40) / 240, (window.innerHeight * 0.42) / 330) : Math.min(1.7, (window.innerHeight - 80) / 330, (window.innerWidth - 520) / 240);
  const pre = e.kind === 'line' ? e.line.slice(0, -1).reverse() : [];
  const ov = document.createElement('div'); ov.className = `ar-peek t-${e.tier}${sticky ? ' sticky' : ''}`; if (sticky) { ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', C(e.cid).name); ov.onclick = hidePeek; } else ov.setAttribute('aria-hidden', 'true');
  ov.innerHTML = `<div class="ar-peek-in"><div class="ar-peek-card"><span class="ar-aura"></span>${PT.cardHTML(e.cid, Math.max(0.6, s).toFixed(2)).replace(/ data-cid="[^"]*"/, '')}</div>
    <div class="ar-peek-text"><span class="ar-gem">${TIER_NAMES[e.tier]}</span>${cardText(e.cid)}
      ${pre.length ? `<div class="pk-with">Comes with ${ARENA.lineCopies} of each</div>${pre.map((cid) => cardText(cid, true)).join('')}` : ''}
      <div class="pk-hint">${sticky ? 'Click anywhere to close' : 'Let go to close'}</div></div></div>`;
  document.body.appendChild(ov); V.peek = ov;
}
function hidePeek() { if (V.peek) { V.peek.remove(); V.peek = null; } }
let hold = null;
function holdStart(e) {
  if (e.button != null && e.button !== 0) return;
  const ch = e.target.closest && e.target.closest('.ar-choice[data-pick]'); if (!ch || !e.target.closest('.ar-card') || V.picking) return;
  holdCancel();
  hold = { x: e.clientX, y: e.clientY, shown: false, t: setTimeout(() => { if (hold) { hold.shown = true; showPeek(ch.dataset.pick); } }, HOLD_MS) };
}
function holdMove(e) { if (hold && !hold.shown && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) holdCancel(); }
function holdCancel() { if (hold) { clearTimeout(hold.t); hold = null; } }
function holdEnd() {
  if (!hold) return; const shown = hold.shown; holdCancel(); hidePeek();
  if (shown) { V.noClick = true; setTimeout(() => { V.noClick = false; }, 350); } // the click that follows a hold must not draft
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', holdEnd); window.addEventListener('pointercancel', () => { holdCancel(); hidePeek(); });
  window.addEventListener('pointermove', holdMove, { passive: true });
  window.addEventListener('blur', () => { holdCancel(); hidePeek(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && V.peek) hidePeek(); });
  window.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.ar-choice, .ar-peek')) e.preventDefault(); });
}
function playView(r) {
  const title = OPPONENTS[Math.min(r.wins, OPPONENTS.length - 1)];
  const games = r.games.map((x, i) => `<li class="${x.won ? 'w' : 'l'}"><b>${x.won ? 'W' : 'L'}</b> Game ${i + 1} vs ${esc(x.title)}</li>`).join('');
  return `<div class="ar-play">
    <section class="panel ar-next"><span class="kicker">Game ${r.games.length + 1} of up to ${ARENA.wins + ARENA.losses - 1}</span><h2>${r.gameId ? 'Your game is waiting' : `Next opponent: ${esc(title)}`}</h2>
      <p class="muted">${r.gameId ? 'Pick up where you left off.' : `The computer drafts its own deck for each game, and it drafts better as your wins climb.`}</p>
      <div class="ar-actions"><button class="pri cta" type="button" data-battle="1">${r.gameId ? '▶ Resume game' : '⚔ Battle!'}</button>${r.gameId ? '<button class="sec" type="button" data-forfeit="1">Forfeit this game</button>' : ''}</div>
      ${games ? `<ul class="ar-games">${games}</ul>` : ''}
      <div class="ar-foot"><button class="sm ghost" type="button" data-savedeck="1">Copy this deck to Your Decks</button><button class="sm ghost" type="button" data-retire="1">End this run now</button></div></section>
    ${deckPanel(r, 'Your Arena deck', r.energy)}</div>`;
}
function startView(d) {
  const last = d && d.run && d.run.status === 'done' ? d.run : null;
  const lastHTML = last ? `<section class="panel ar-last"><span class="kicker">Last run</span><h2>${last.wins}–${last.losses}${last.wins >= ARENA.wins ? ' <span class="ar-perfect">Perfect</span>' : ''}${last.retired ? ' <span class="pill">Ended early</span>' : ''}</h2>
      <div class="ar-tops">${topCards(last.cards, 3).map((cid) => PT.cardHTML(cid, 0.36, `data-view="${esc(cid)}"`)).join('')}</div>
      ${last.reward ? `<p class="ar-lastprize">${COIN.icon} <b>+${last.reward.tokens}</b> ${COIN.name}${last.reward.gold ? ` · gold <b>${esc(C(last.reward.gold).name)}</b>` : ''}</p>` : ''}</section>` : '';
  return `<div class="ar-start">
    <section class="panel ar-begin"><h2>${last ? 'Ready for another run?' : 'Enter the Arena'}</h2>
      <ol class="ar-steps"><li><b>Draft.</b> Make ${ARENA.picksTo} picks: 1 of 3 cards each time, or a basic Energy instead. Only the top of each evolution line is offered, and an evolved Pokémon brings its whole line (2 of each card).</li>
        <li><b>Free cards.</b> Every deck starts with ${ARENA.bills} Bills (so Bill is never in the draft), ${ARENA.oaks} Professor Oak and ${ARENA.energy} basic Energy for your Pokémon's types. Want more Energy? Take it with your picks. That makes 60.</li>
        <li><b>Battle.</b> Play the computer under the league's standard rules. ${ARENA.wins} wins is a perfect run; ${ARENA.losses} losses ends it.</li></ol>
      <button class="pri cta" type="button" data-start="1">✦ Start a run</button></section>
    <div class="ar-startside">${lastHTML}<section class="panel ar-prizes"><span class="kicker">Prizes</span><h2>What a run pays</h2>
      <ol class="ar-ptable">${ARENA_REWARDS.map((t, w) => `<li class="${w >= ARENA.wins ? 'top' : ''}"><span>${w} ${w === 1 ? 'win' : 'wins'}</span><b>${COIN.icon} ${t}</b>${w >= ARENA.wins ? '<em>+ a gold card</em>' : ''}</li>`).join('')}</ol>
      <p class="small muted">A perfect run also unlocks a gold holographic version of a random Pokémon you don't have in gold yet.</p></section></div></div>`;
}
function boardHTML() {
  const rows = Object.values(docs()).filter((d) => d && (d.runs || (d.run && d.run.status !== 'done')));
  if (!rows.length) return '';
  rows.sort((a, b) => ((b.best || {}).wins || 0) - ((a.best || {}).wins || 0) || (b.perfect || 0) - (a.perfect || 0) || (b.totalWins || 0) / Math.max(1, b.runs || 0) - (a.totalWins || 0) / Math.max(1, a.runs || 0));
  const tr = rows.map((d) => { const r = d.run && d.run.status !== 'done' ? d.run : null; const avg = d.runs ? (d.totalWins / d.runs).toFixed(1) : '–';
    return `<tr class="${d.owner === me() ? 'me' : ''}"><td>${esc(PT.nameOf(d.owner))}</td><td>${d.best ? `<b>${d.best.wins}–${d.best.losses}</b>` : '–'}</td><td>${d.runs || 0}</td><td>${avg}</td><td>${d.perfect ? `<span class="ar-perfect">${d.perfect}</span>` : '0'}</td><td>${(d.gold || []).length ? `<b class="ar-goldn">${d.gold.length}</b>` : '0'}</td><td>${r ? (r.status === 'draft' ? 'Drafting' : `${r.wins}–${r.losses}`) : '–'}</td></tr>`; }).join('');
  return `<section class="panel ar-board"><h2>Arena leaderboard</h2><div class="ar-tblwrap"><table class="dboard ar-table"><thead><tr><th>Player</th><th>Best run</th><th>Runs</th><th>Avg wins</th><th>Perfect</th><th>Gold cards</th><th>Now</th></tr></thead><tbody>${tr}</tbody></table></div></section>`;
}
/** The player's gold cards, newest first. */
function goldCaseHTML(d) {
  const g = ((d && d.gold) || []).slice().reverse(); const total = goldPool(PT.CARDS).length;
  return `<section class="panel ar-goldcase"><div class="ar-dhead"><h2>Gold cards</h2><span class="ar-count"><b>${g.length}</b>/${total}</span></div>
    ${g.length ? `<div class="ar-golds">${g.map((x) => goldCard(x.cid, 0.5, `data-view="${esc(x.cid)}" title="${esc(C(x.cid).name)}"`)).join('')}</div>` : `<p class="muted">No gold cards yet. Win ${ARENA.wins} games in one run to unlock your first.</p>`}</section>`;
}
function historyHTML(d) {
  const h = (d && d.history) || []; if (!h.length) return '';
  return `<section class="panel ar-hist"><h2>Your runs</h2><ul>${h.map((x) => `<li><b>${x.wins}–${x.losses}</b>${x.wins >= ARENA.wins ? ' <span class="ar-perfect">Perfect</span>' : ''}<span class="ar-hcards">${(x.top || []).map((cid) => esc(C(cid).name || '')).join(' · ')}</span>${x.tokens != null ? `<span class="ar-hpay">${COIN.icon} ${x.tokens}${x.gold ? ' ★' : ''}</span>` : '<span></span>'}<time>${new Date(x.at).toLocaleDateString()}</time></li>`).join('')}</ul></section>`;
}

export function render(main) {
  if (!Object.keys(PT.CARDS).length) { main.innerHTML = '<div class="panel muted">Loading cards…</div>'; return; }
  arenaPool(PT.CARDS, rules());
  const d = mine(); const r = run();
  if (r && r.gameId) checkCurrent();
  if (r && r.status === 'draft' && draftedCount(r.cards) >= ARENA.picksTo && !V.busy) { A.closeDraft(); main.innerHTML = '<div class="panel muted">Finishing your draft…</div>'; return; }
  const body = !r || r.status === 'done' ? startView(d) : r.status === 'draft' ? draftView(r) : playView(r);
  main.innerHTML = `<div class="arena">${header(r)}${body}${r && r.status === 'draft' ? '' : goldCaseHTML(d)}<div class="ar-lower">${boardHTML()}${historyHTML(d)}</div></div>`;
  if (r && r.status === 'draft') afterDraft();
  main.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ar-choice')) { e.preventDefault(); pickAnimated(e.target); } };
  main.onpointerdown = holdStart;
  main.onclick = (e) => {
    if (V.noClick) { V.noClick = false; return; }
    const b = e.target.closest('button');
    const v = e.target.closest('[data-view]'); if (v && (!b || b === v)) { PT.viewCard(v.dataset.view); return; }
    if (b && b.dataset.read) { showPeek(b.dataset.read, true); return; }
    if (b && b.dataset.energy) { pickEnergy(); return; }
    const ch = e.target.closest('.ar-choice[data-pick]'); if (ch && !b && e.target.closest('.ar-card')) { pickAnimated(ch); return; }
    if (!b) return;
    if (b.dataset.start) A.start();
    else if (b.dataset.battle) battle();
    else if (b.dataset.forfeit) forfeit();
    else if (b.dataset.savedeck) saveDeck();
    else if (b.dataset.retire) PT.showModal('End this run?', `<p>The run ends with its current record${r ? ` (${r.wins}–${r.losses})` : ''} and pays ${coins(ARENA_REWARDS[Math.min(r ? r.wins : 0, ARENA_REWARDS.length - 1)] || 0)}. This can't be undone.</p>`, '<button class="dng" id="rtok" type="button">End run</button>', (m) => { m.querySelector('#rtok').onclick = async () => { PT.closeModal(); const gid = r && r.gameId; const ok = await A.retire(); if (gid) PT.api('DELETE', 'games/' + gid).catch(() => {}); if (ok && run() && run().status === 'done') chestReveal(run()); }; });
  };
}
async function saveDeck() {
  const r = run(); if (!r) return; const cards = finalDeck(PT.CARDS, r.cards, r.energy);
  const id = rid() + rid(); const count = Object.values(cards).reduce((a, b) => a + b, 0);
  try { await PT.api('PUT', 'decks/' + id, { data: { owner: me(), name: `Arena deck ${new Date().toLocaleDateString()}`, cards, count, updatedAt: Date.now() } }); PT.toast('Saved to Your Decks'); PT.syncSoon(50); }
  catch (e) { PT.toast('Could not save the deck (' + (e.code || 'error') + ')'); }
}

/** The lobby's Arena panel. */
export function lobbyFeature() {
  const r = run(); const d = mine();
  const status = !r || r.status === 'done'
    ? `<p class="ar-lobby-line">${d && d.best ? `Your best run: <b>${d.best.wins}–${d.best.losses}</b>` : 'Draft a deck from 3 choices at a time and take on the computer.'}</p><button class="pri" type="button" data-arena="1">⚔ Start a run</button>`
    : r.status === 'draft'
      ? `<p class="ar-lobby-line">Drafting: <b>${draftedCount(r.cards)}</b> / ${ARENA.picksTo} cards</p><button class="pri" type="button" data-arena="1">Keep drafting</button>`
      : `<div class="ar-mini">${recordHTML(r)}</div><button class="pri" type="button" data-arena="1">${r.gameId ? '▶ Resume game' : '⚔ Next battle'}</button>`;
  const purse = d && (d.tokens || (d.gold || []).length) ? `<p class="small ar-lobby-best">${COIN.icon} <b>${d.tokens || 0}</b> ${COIN.name}${(d.gold || []).length ? ` · <b class="ar-goldn">${d.gold.length}</b> gold ${d.gold.length === 1 ? 'card' : 'cards'}` : ''}</p>` : '';
  const leader = Object.values(docs()).filter((x) => x && x.best).sort((a, b) => b.best.wins - a.best.wins || a.best.losses - b.best.losses)[0];
  return `<section class="realm realm-arena"><header class="realm-head arena"><div class="rh-copy"><span class="kicker">Single player</span><h2>The Arena</h2></div></header>
    <div class="realm-body">${status}${purse}${leader ? `<p class="small muted ar-lobby-best">Best run so far: <b>${esc(PT.nameOf(leader.owner))}</b> ${leader.best.wins}–${leader.best.losses}</p>` : ''}</div></section>`;
}
