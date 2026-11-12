// The Arena: single-player runs. Draft a deck 1-of-3, then play the computer until 7 wins or 3 losses.
// One document per player (arena/<pid>) holds the current run and the player's record; the page syncs everyone's
// documents for the leaderboard. Arena games are ordinary auto-rules tables with the computer in seat B.
import { ARENA, arenaPool, makeOffer, poolEntry, addPick, draftedCount, basicsIn, energySplit, finalDeck, botDraft, OPPONENTS, oppSkill, tierOf } from './arena-draft.js';
import { TIER_NAMES } from './arena-tiers.js';
import { BOT_UID } from './bot.js';
import { play as sfx } from './sfx.js';

let PT = null;
const V = { busy: false, noted: new Set(), revealed: null, offer: null, picking: false };
const esc = (s) => PT.esc(s);
const me = () => PT.uid();
const C = (cid) => PT.CARDS[cid] || {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const docs = () => PT.S.arena || {};
const mine = () => docs()[me()] || null;
const run = () => (mine() && mine().run) || null;
const rid = () => Math.random().toString(36).slice(2, 10);
const rules = () => clone(PT.rules());

export function installArena(bridge) { PT = bridge; return { render, noteGame, lobbyFeature, isArenaGame, heroCount }; }
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
    const offer = makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules()); if (!offer.includes(key)) throw new Error('That card is no longer on offer');
    r.cards = addPick(PT.CARDS, r.cards, key, rules()); r.picks.push(key); r.round++;
    if (draftedCount(r.cards) >= ARENA.picksTo || !makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules()).length) { r.status = 'play'; r.energy = energySplit(PT.CARDS, r.cards); }
  }),
  retire: () => mutate((d) => { if (!d.run || d.run.status === 'done') return false; finishRun(d, true); }),
};
function finishRun(d, retired) {
  const r = d.run; r.status = 'done'; r.endedAt = Date.now(); if (retired) r.retired = true;
  d.runs = (d.runs || 0) + 1; d.totalWins = (d.totalWins || 0) + r.wins; if (r.wins >= ARENA.wins) d.perfect = (d.perfect || 0) + 1;
  const entry = { wins: r.wins, losses: r.losses, at: r.endedAt, top: topCards(r.cards, 3), retired: !!retired };
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
  const done = r.status === 'done';
  const head = done ? (r.wins >= ARENA.wins ? 'Perfect run!' : 'Run complete') : won ? 'Victory!' : 'Defeat';
  const body = done
    ? `<p>Your run ended <b>${r.wins}–${r.losses}</b>.${r.wins >= ARENA.wins ? ' Seven straight-up wins. That goes on the board.' : ''}</p>`
    : `<p>Arena record: <b>${r.wins}–${r.losses}</b>. ${won ? `Next up: <b>${esc(OPPONENTS[Math.min(r.wins, OPPONENTS.length - 1)])}</b>.` : `${ARENA.losses - r.losses} ${ARENA.losses - r.losses === 1 ? 'life' : 'lives'} left.`}</p>`;
  PT.showModal(head, body, `<button class="pri" id="tarena" type="button">Back to the Arena</button>`, (m) => { m.querySelector('#tarena').onclick = () => { PT.closeModal(); PT.go('arena'); }; });
}
/** Called by the page whenever it has a fresh copy of a game. */
export function noteGame(g) {
  if (!g || !g.arena || g.arena.pid !== me() || !g.state || !g.state.winner) return;
  const r = run(); if (!r || r.gameId !== g.id) return;
  record(g.id, g.state.winner === (g.seats.a.uid === me() ? 'a' : 'b'));
}
/** The run's table may have finished while the player was elsewhere: check it when the Arena opens. */
let checking = null;
async function checkCurrent() {
  const r = run(); if (!r || !r.gameId || checking === r.gameId) return; checking = r.gameId;
  try { const g = await PT.api('GET', 'games/' + r.gameId); if (!g || g.missing) await record(r.gameId, false); else noteGame(g); } catch (e) { /* try again next time */ }
  finally { checking = null; }
}

/* ---------- views ---------- */
const TCOL = { Fire: '#f08030', Water: '#6890f0', Grass: '#78c850', Lightning: '#f8d030', Psychic: '#f85888', Fighting: '#c03028', Colorless: '#a8a878' };
function header(r) {
  const rec = r && r.status !== 'done' ? `<div class="ar-record">${recordHTML(r)}</div>` : '';
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
function curveHTML(cards) {
  const cols = [['Basic', 0], ['Stage 1', 0], ['Stage 2', 0], ['Trainer', 0], ['Sp. Energy', 0]];
  for (const [cid, k] of Object.entries(cards || {})) {
    const c = C(cid); const i = c.st === 'Pokémon' ? (c.sub === 'Stage 2' ? 2 : c.sub === 'Stage 1' ? 1 : 0) : c.st === 'Trainer' ? 3 : c.sub === 'Basic' ? -1 : 4;
    if (i >= 0) cols[i][1] += k;
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
  const lastE = !energy && r.picks.length && V.offer && V.offer.first ? poolEntry(PT.CARDS, r.picks[r.picks.length - 1], rules()) : null;
  const fresh = lastE ? new Set(Object.keys(lastE.cards)) : null;
  return `<aside class="panel ar-side ar-deck"><div class="ar-dhead"><h3>${esc(title)}</h3><span class="ar-count"><b>${energy ? n + ARENA.energy : n}</b>/${energy ? ARENA.picksTo + ARENA.energy : ARENA.picksTo}</span></div>
    ${curveHTML(r.cards)}<p class="small muted ar-basics">${basics} Basic Pokémon${energy ? '' : ` · ${ARENA.energy} Energy added at the end`}</p>
    <div class="ar-tiles">${n || energy ? tilesHTML(r.cards, energy, fresh) : '<p class="muted small">Your picks show up here.</p>'}</div></aside>`;
}

function draftView(r) {
  const offer = makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules());
  const n = draftedCount(r.cards);
  const key = r.id + ':' + r.round; const first = V.revealed !== key; // the cards flip in (and sound) once per round, not on every refresh
  V.offer = { key, first, tiers: offer.map((k) => tierOf(k)) };
  const choice = (k, i) => {
    const e = poolEntry(PT.CARDS, k, rules()); const c = C(e.cid); const t = e.tier;
    const tag = e.kind === 'line' ? `${c.sub} line · ${e.size} cards` : e.kind === 'basic' ? 'Basic Pokémon' : e.kind === 'energy' ? 'Special Energy' : (c.sub || 'Trainer');
    const line = e.kind === 'line' ? `<div class="ar-line">${e.line.map((cid) => `${ARENA.lineCopies}× ${esc(C(cid).name)}`).join(' › ')}</div>` : '';
    return `<div class="ar-choice ${e.kind} t-${t}${first ? ' enter' : ''}" style="--i:${i}" data-pick="${esc(k)}" data-tier="${t}" role="button" tabindex="0" aria-label="Draft ${esc(c.name)} (${TIER_NAMES[t]})">
      <div class="ar-card"><span class="ar-aura" aria-hidden="true"></span>${PT.cardHTML(e.cid, 1).replace(/ data-cid="[^"]*"/, '')}${e.kind === 'line' ? `<span class="ar-stack" aria-hidden="true">×${e.size}</span>` : ''}
        <button type="button" class="ar-zoom" data-view="${esc(e.cid)}" title="Read ${esc(c.name)}" aria-label="Read ${esc(c.name)}">🔍</button></div>
      <div class="ar-gem">${TIER_NAMES[t]}</div><div class="ar-tag">${esc(tag)}</div>${line}</div>`;
  };
  return `<div class="ar-draft">
    <section class="ar-stage"><div class="ar-stagehead"><div><span class="kicker">Pick ${r.round + 1}</span><h2>Choose a card</h2></div>
      <div class="ar-bar" title="${n} of ${ARENA.picksTo} cards"><i style="width:${Math.round((n / ARENA.picksTo) * 100)}%"></i></div></div>
      <div class="ar-offer">${offer.map(choice).join('')}</div>
      <p class="small muted ar-hint">Click a card to draft it, or 🔍 to read it first. Evolved Pokémon bring their whole line, 2 of each card.</p>
      <button class="sm ghost ar-abandon" type="button" data-retire="1">Abandon this run</button></section>
    ${deckPanel(r, 'Your deck')}</div>`;
}
/** Fit the three cards to the space they have (as big as the screen allows, like Hearthstone). */
function sizeOffer() {
  const o = document.querySelector('.ar-offer'); if (!o) return;
  const gap = parseFloat(getComputedStyle(o).columnGap) || 16;
  const w = (o.clientWidth - 2 * gap) / 3 - 6;
  const h = Math.max(240, window.innerHeight - (o.getBoundingClientRect().top + window.scrollY) - 96); // the whole card and its labels fit on screen
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
  if (best) sfx(best === 'L' ? 'arena.legendary' : best === 'E' ? 'arena.epic' : 'arena.rare', 260 + o.tiers.indexOf(best) * 140);
}
function pickAnimated(el) {
  if (V.picking || V.busy) return; V.picking = true;
  document.querySelectorAll('.ar-choice').forEach((x) => { x.classList.remove('enter'); x.classList.add(x === el ? 'chosen' : 'passed'); });
  sfx('arena.pick', 0, el.dataset.tier);
  setTimeout(async () => { try { await A.pick(el.dataset.pick); } finally { V.picking = false; } }, 430);
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
      <div class="ar-tops">${topCards(last.cards, 3).map((cid) => PT.cardHTML(cid, 0.36, `data-view="${esc(cid)}"`)).join('')}</div></section>` : '';
  return `<div class="ar-start">
    <section class="panel ar-begin"><h2>${last ? 'Ready for another run?' : 'Enter the Arena'}</h2>
      <ol class="ar-steps"><li><b>Draft.</b> Pick 1 of 3 cards until you have ${ARENA.picksTo}. Only the top of each evolution line is offered, and an evolved Pokémon brings its whole line (2 of each card).</li>
        <li><b>Energy.</b> ${ARENA.energy} basic Energy are added for your Pokémon's types.</li>
        <li><b>Battle.</b> Play the computer under the league's standard rules. ${ARENA.wins} wins is a perfect run; ${ARENA.losses} losses ends it.</li></ol>
      <button class="pri cta" type="button" data-start="1">✦ Start a run</button></section>${lastHTML}</div>`;
}
function boardHTML() {
  const rows = Object.values(docs()).filter((d) => d && (d.runs || (d.run && d.run.status !== 'done')));
  if (!rows.length) return '';
  rows.sort((a, b) => ((b.best || {}).wins || 0) - ((a.best || {}).wins || 0) || (b.perfect || 0) - (a.perfect || 0) || (b.totalWins || 0) / Math.max(1, b.runs || 0) - (a.totalWins || 0) / Math.max(1, a.runs || 0));
  const tr = rows.map((d) => { const r = d.run && d.run.status !== 'done' ? d.run : null; const avg = d.runs ? (d.totalWins / d.runs).toFixed(1) : '–';
    return `<tr class="${d.owner === me() ? 'me' : ''}"><td>${esc(PT.nameOf(d.owner))}</td><td>${d.best ? `<b>${d.best.wins}–${d.best.losses}</b>` : '–'}</td><td>${d.runs || 0}</td><td>${avg}</td><td>${d.perfect ? `<span class="ar-perfect">${d.perfect}</span>` : '0'}</td><td>${r ? (r.status === 'draft' ? 'Drafting' : `${r.wins}–${r.losses}`) : '–'}</td></tr>`; }).join('');
  return `<section class="panel ar-board"><h2>Arena leaderboard</h2><div class="ar-tblwrap"><table class="dboard ar-table"><thead><tr><th>Player</th><th>Best run</th><th>Runs</th><th>Avg wins</th><th>Perfect</th><th>Now</th></tr></thead><tbody>${tr}</tbody></table></div></section>`;
}
function historyHTML(d) {
  const h = (d && d.history) || []; if (!h.length) return '';
  return `<section class="panel ar-hist"><h2>Your runs</h2><ul>${h.map((x) => `<li><b>${x.wins}–${x.losses}</b>${x.wins >= ARENA.wins ? ' <span class="ar-perfect">Perfect</span>' : ''}<span class="ar-hcards">${(x.top || []).map((cid) => esc(C(cid).name || '')).join(' · ')}</span><time>${new Date(x.at).toLocaleDateString()}</time></li>`).join('')}</ul></section>`;
}

export function render(main) {
  if (!Object.keys(PT.CARDS).length) { main.innerHTML = '<div class="panel muted">Loading cards…</div>'; return; }
  arenaPool(PT.CARDS, rules());
  const d = mine(); const r = run();
  if (r && r.gameId) checkCurrent();
  const body = !r || r.status === 'done' ? startView(d) : r.status === 'draft' ? draftView(r) : playView(r);
  main.innerHTML = `<div class="arena">${header(r)}${body}<div class="ar-lower">${boardHTML()}${historyHTML(d)}</div></div>`;
  if (r && r.status === 'draft') afterDraft();
  main.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ar-choice')) { e.preventDefault(); pickAnimated(e.target); } };
  main.onclick = (e) => {
    const b = e.target.closest('button');
    const v = e.target.closest('[data-view]'); if (v && (!b || b === v)) { PT.viewCard(v.dataset.view); return; }
    const ch = e.target.closest('.ar-choice[data-pick]'); if (ch && !b) { pickAnimated(ch); return; }
    if (!b) return;
    if (b.dataset.start) A.start();
    else if (b.dataset.battle) battle();
    else if (b.dataset.forfeit) forfeit();
    else if (b.dataset.savedeck) saveDeck();
    else if (b.dataset.retire) PT.showModal('End this run?', `<p>The run ends with its current record${r ? ` (${r.wins}–${r.losses})` : ''}. This can't be undone.</p>`, '<button class="dng" id="rtok" type="button">End run</button>', (m) => { m.querySelector('#rtok').onclick = async () => { PT.closeModal(); const gid = r && r.gameId; await A.retire(); if (gid) PT.api('DELETE', 'games/' + gid).catch(() => {}); }; });
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
  const leader = Object.values(docs()).filter((x) => x && x.best).sort((a, b) => b.best.wins - a.best.wins || a.best.losses - b.best.losses)[0];
  return `<section class="realm realm-arena"><header class="realm-head arena"><div class="rh-copy"><span class="kicker">Single player</span><h2>The Arena</h2></div></header>
    <div class="realm-body">${status}${leader ? `<p class="small muted ar-lobby-best">Best run so far: <b>${esc(PT.nameOf(leader.owner))}</b> ${leader.best.wins}–${leader.best.losses}</p>` : ''}</div></section>`;
}
