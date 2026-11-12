// The Arena: single-player runs. Draft a deck 1-of-3, then play the computer until 7 wins or 3 losses.
// One document per player (arena/<pid>) holds the current run and the player's record; the page syncs everyone's
// documents for the leaderboard. Arena games are ordinary auto-rules tables with the computer in seat B.
import { ARENA, arenaPool, makeOffer, poolEntry, addPick, draftedCount, basicsIn, energySplit, finalDeck, botDraft, OPPONENTS, oppSkill } from './arena-draft.js';
import { BOT_UID } from './bot.js';

let PT = null;
const V = { busy: false, noted: new Set() };
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
  return `<header class="arhead"><div class="ar-copy"><span class="kicker">Single player</span><h1>The Arena</h1><div class="ornate" aria-hidden="true"></div>
    <p class="small muted">Draft a deck one pick at a time, then take on the computer. Seven wins is a perfect run; three losses and you're out.</p></div>${rec}</header>`;
}
function recordHTML(r) {
  const w = Array.from({ length: ARENA.wins }, (_, i) => `<i class="ar-w${i < r.wins ? ' on' : ''}" title="Win ${i + 1}"></i>`).join('');
  const l = Array.from({ length: ARENA.losses }, (_, i) => `<i class="ar-l${i < r.losses ? ' on' : ''}" title="Loss ${i + 1}"></i>`).join('');
  return `<div class="ar-wins"><span>Wins</span><div>${w}</div><b>${r.wins}</b></div><div class="ar-losses"><span>Losses</span><div>${l}</div><b>${r.losses}</b></div>`;
}
function deckList(cards, energy) {
  const all = finalDeck(PT.CARDS, cards, energy);
  const groups = { 'Pokémon': [], Trainers: [], Energy: [] };
  for (const [cid, k] of Object.entries(all)) { const c = C(cid); (c.st === 'Pokémon' ? groups['Pokémon'] : c.st === 'Energy' ? groups.Energy : groups.Trainers).push([cid, k]); }
  const byName = (a, b) => (C(a[0]).name > C(b[0]).name ? 1 : -1);
  groups['Pokémon'].sort(byName); groups.Trainers.sort(byName);
  return Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) => `<div class="ar-dsec"><h4>${g} <span>${l.reduce((n, [, k]) => n + k, 0)}</span></h4>${l.map(([cid, k]) => `<button type="button" class="ar-row" data-view="${esc(cid)}"><b>${k}</b><span>${esc(C(cid).name)}</span><em>${esc(C(cid).sub || '')}</em></button>`).join('')}</div>`).join('');
}
function draftView(r) {
  const offer = makeOffer(PT.CARDS, r.seed, r.round, r.cards, rules());
  const n = draftedCount(r.cards); const basics = basicsIn(r.cards, PT.CARDS);
  const choice = (key) => {
    const e = poolEntry(PT.CARDS, key, rules()); const c = C(e.cid);
    const line = e.kind === 'line' ? `<div class="ar-line">${e.line.map((cid) => `<span>${ARENA.lineCopies}× ${esc(C(cid).name)}</span>`).join('<i aria-hidden="true">›</i>')}</div>` : '';
    const tag = e.kind === 'line' ? `${c.sub} line · ${e.size} cards` : e.kind === 'basic' ? 'Basic Pokémon · 1 card' : e.kind === 'energy' ? 'Special Energy · 1 card' : `${c.sub || 'Trainer'} · 1 card`;
    return `<div class="ar-choice ${e.kind}"><div class="ar-card" data-view="${esc(e.cid)}">${PT.cardHTML(e.cid, 0.8)}${e.kind === 'line' ? `<span class="ar-stack" aria-hidden="true">×${e.size}</span>` : ''}</div>
      <div class="ar-tag">${esc(tag)}</div>${line}<button class="pri" type="button" data-pick="${esc(key)}">Draft ${esc(c.name)}</button></div>`;
  };
  const pct = Math.round((n / ARENA.picksTo) * 100);
  return `<div class="ar-draft">
    <section class="panel ar-offer-wrap"><div class="ar-progress"><div><b>Pick ${r.round + 1}</b><span class="muted small"> · choose one</span></div><div class="ar-bar"><i style="width:${pct}%"></i></div><div class="small"><b>${n}</b> / ${ARENA.picksTo} cards · <b>${basics}</b> Basic${basics === 1 ? '' : 's'}</div></div>
      <div class="ar-offer">${offer.map(choice).join('')}</div>
      <p class="small muted ar-hint">Evolved Pokémon come with their whole line, 2 of each card. ${ARENA.energy} basic Energy are added for you at the end, matched to your Pokémon. Tap a card to read it.</p></section>
    <aside class="panel ar-side"><h3>Your deck so far</h3>${n ? deckList(r.cards, {}) : '<p class="muted small">Nothing yet. Your picks show up here.</p>'}
      <div class="ar-dsec"><h4>Energy <span>${ARENA.energy}</span></h4><p class="small muted">Added when the draft ends.</p></div>
      <button class="sm ghost" type="button" data-retire="1">Abandon this run</button></aside></div>`;
}
function playView(r) {
  const title = OPPONENTS[Math.min(r.wins, OPPONENTS.length - 1)];
  const games = r.games.map((x, i) => `<li class="${x.won ? 'w' : 'l'}"><b>${x.won ? 'W' : 'L'}</b> Game ${i + 1} vs ${esc(x.title)}</li>`).join('');
  const energy = Object.entries(r.energy || {}).map(([t, k]) => `<span class="ar-en"><i style="background:${TCOL[t] || '#999'}"></i>${k} ${esc(t)}</span>`).join('');
  return `<div class="ar-play">
    <section class="panel ar-next"><span class="kicker">Game ${r.games.length + 1} of up to ${ARENA.wins + ARENA.losses - 1}</span><h2>${r.gameId ? 'Your game is waiting' : `Next opponent: ${esc(title)}`}</h2>
      <p class="muted">${r.gameId ? 'Pick up where you left off.' : `The computer drafts its own deck for each game, and it drafts better as your wins climb.`}</p>
      <div class="ar-actions"><button class="pri cta" type="button" data-battle="1">${r.gameId ? '▶ Resume game' : '⚔ Battle!'}</button>${r.gameId ? '<button class="sec" type="button" data-forfeit="1">Forfeit this game</button>' : ''}</div>
      ${games ? `<ul class="ar-games">${games}</ul>` : ''}
      <div class="ar-foot"><button class="sm ghost" type="button" data-savedeck="1">Copy this deck to Your Decks</button><button class="sm ghost" type="button" data-retire="1">End this run now</button></div></section>
    <aside class="panel ar-side"><h3>Your Arena deck</h3><div class="ar-energy">${energy}</div>${deckList(r.cards, r.energy)}</aside></div>`;
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
  main.onclick = (e) => {
    const b = e.target.closest('button');
    const v = e.target.closest('[data-view]'); if (v && (!b || b === v)) { PT.viewCard(v.dataset.view); return; }
    if (!b) return;
    if (b.dataset.start) A.start();
    else if (b.dataset.pick) A.pick(b.dataset.pick);
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
